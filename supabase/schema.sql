-- Run this in the Supabase SQL editor for your project.
-- Stores each user's smartgrid documents (equivalent to what the old
-- Ascensor.js app kept in localStorage) as JSON, scoped by owner via RLS.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'Untitled',
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_owner_id_idx on public.projects (owner_id);

alter table public.projects enable row level security;

create policy "Users can select their own projects"
  on public.projects for select
  using (auth.uid() = owner_id);

create policy "Users can insert their own projects"
  on public.projects for insert
  with check (auth.uid() = owner_id);

create policy "Users can update their own projects"
  on public.projects for update
  using (auth.uid() = owner_id);

create policy "Users can delete their own projects"
  on public.projects for delete
  using (auth.uid() = owner_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger projects_set_updated_at
  before update on public.projects
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Assistant usage: a per-user, per-day token ledger the `claude` Edge
-- Function consults before forwarding a request to Anthropic. Only the
-- function (service role) writes here; users can read their own rows so the
-- UI can show what's left of today's allowance.
-- ---------------------------------------------------------------------------

create table if not exists public.assistant_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  requests integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  primary key (user_id, day)
);

alter table public.assistant_usage enable row level security;

create policy "Users can read their own assistant usage"
  on public.assistant_usage for select
  using (auth.uid() = user_id);

-- Atomically adds one request's token counts to today's row.
create or replace function public.record_assistant_usage(
  p_user_id uuid,
  p_input_tokens integer,
  p_output_tokens integer
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.assistant_usage (user_id, day, requests, input_tokens, output_tokens)
  values (p_user_id, (now() at time zone 'utc')::date, 1, p_input_tokens, p_output_tokens)
  on conflict (user_id, day) do update
    set requests = assistant_usage.requests + 1,
        input_tokens = assistant_usage.input_tokens + excluded.input_tokens,
        output_tokens = assistant_usage.output_tokens + excluded.output_tokens;
$$;

revoke all on function public.record_assistant_usage(uuid, integer, integer) from public;
grant execute on function public.record_assistant_usage(uuid, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Profiles: one row per auth user with the public bits of an account
-- (display name, avatar) and its role. Rows are created by a trigger on
-- sign-up; anyone signed in can read them (community pages show authors),
-- users edit their own, and only admins change roles.
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  role text not null default 'user' check (role in ('user', 'moderator', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Role checks used by policies. `security definer` so they can read
-- profiles without recursing into the profiles policies themselves.
create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'user');
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_name() = 'admin';
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_name() in ('admin', 'moderator');
$$;

drop policy if exists "Signed-in users can read profiles" on public.profiles;
create policy "Signed-in users can read profiles"
  on public.profiles for select
  using (auth.role() = 'authenticated');

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

-- Only admins may change a role; everyone else keeps whatever they had.
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    new.role := old.role;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row
  execute function public.guard_profile_role();

-- Accounts that become admins the moment they sign up.
create table if not exists public.bootstrap_admins (
  email text primary key
);
insert into public.bootstrap_admins (email) values ('ayhanars@gmail.com') on conflict do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url',
    case when exists (select 1 from public.bootstrap_admins where lower(email) = lower(coalesce(new.email, ''))) then 'admin' else 'user' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Backfill users who signed up before this table existed.
insert into public.profiles (id, display_name, role)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'full_name', split_part(coalesce(u.email, ''), '@', 1)),
  case when exists (select 1 from public.bootstrap_admins b where lower(b.email) = lower(coalesce(u.email, ''))) then 'admin' else 'user' end
from auth.users u
on conflict (id) do nothing;

-- Avatars live in a public bucket under `<user id>/...`; only the owner
-- writes there.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

drop policy if exists "Avatars are publicly readable" on storage.objects;
create policy "Avatars are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "Users manage their own avatar" on storage.objects;
create policy "Users manage their own avatar"
  on storage.objects for all
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
