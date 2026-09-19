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

-- A small WebP data URL rendered from the 3D view (see thumbnails.ts).
alter table public.projects add column if not exists thumbnail text;

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

-- True for requests that carry a user JWT (the app); false for the SQL
-- editor, migrations and the service role, which may change anything.
create or replace function public.is_user_request()
returns boolean
language sql
stable
as $$
  select coalesce(auth.role(), '') in ('authenticated', 'anon');
$$;

-- Only admins may change a role; everyone else keeps whatever they had.
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and public.is_user_request() and not public.is_admin() then
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

-- ---------------------------------------------------------------------------
-- User assets ("My assets"): shapes saved from a selection, mirrored from
-- the browser so they follow the account across projects and devices.
-- ---------------------------------------------------------------------------

create table if not exists public.user_assets (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'My asset',
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_assets_owner_id_idx on public.user_assets (owner_id);

alter table public.user_assets enable row level security;

drop policy if exists "Users manage their own assets" on public.user_assets;
create policy "Users manage their own assets"
  on public.user_assets for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop trigger if exists user_assets_set_updated_at on public.user_assets;
create trigger user_assets_set_updated_at
  before update on public.user_assets
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Community: models people chose to share. Each item is a *copy* of the
-- project at publish time (plus the author's notes); the author can push a
-- fresh copy from the source project later. Published items are visible to
-- everyone, including guests; hidden ones only to their author and staff;
-- removed ones only to staff.
-- ---------------------------------------------------------------------------

-- Author names and avatars show on community pages, so profiles are
-- readable without signing in (they hold nothing private).
drop policy if exists "Signed-in users can read profiles" on public.profiles;
drop policy if exists "Profiles are publicly readable" on public.profiles;
create policy "Profiles are publicly readable"
  on public.profiles for select
  using (true);

create table if not exists public.community_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  -- The author's project this was published from (null once that project
  -- is deleted); lets "Update from project" find the item again.
  source_project_id uuid,
  title text not null,
  description text not null default '',
  -- Free-form notes from the author: print tips, filament, what it fits.
  notes text not null default '',
  tags text[] not null default '{}',
  data jsonb not null,
  thumbnail text,
  status text not null default 'published' check (status in ('published', 'hidden', 'removed')),
  featured boolean not null default false,
  downloads integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists community_items_owner_id_idx on public.community_items (owner_id);
create index if not exists community_items_status_idx on public.community_items (status, created_at desc);
create index if not exists community_items_source_idx on public.community_items (owner_id, source_project_id);

alter table public.community_items enable row level security;

drop policy if exists "Published items are visible to everyone" on public.community_items;
create policy "Published items are visible to everyone"
  on public.community_items for select
  using (status = 'published' or auth.uid() = owner_id or public.is_staff());

drop policy if exists "Users publish their own items" on public.community_items;
create policy "Users publish their own items"
  on public.community_items for insert
  with check (auth.uid() = owner_id);

drop policy if exists "Owners and staff update items" on public.community_items;
create policy "Owners and staff update items"
  on public.community_items for update
  using (auth.uid() = owner_id or public.is_staff())
  with check (auth.uid() = owner_id or public.is_staff());

drop policy if exists "Owners and admins delete items" on public.community_items;
create policy "Owners and admins delete items"
  on public.community_items for delete
  using (auth.uid() = owner_id or public.is_admin());

-- Authors may publish / hide; only staff may remove, feature or reset the
-- download count.
create or replace function public.guard_community_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_user_request() and not public.is_staff() then
    if new.featured is distinct from old.featured then new.featured := old.featured; end if;
    -- The download counter only moves through record_community_download.
    if new.downloads is distinct from old.downloads and coalesce(current_setting('smartgrid.counting', true), '') <> 'on' then
      new.downloads := old.downloads;
    end if;
    if new.status = 'removed' or old.status = 'removed' then new.status := old.status; end if;
    if new.owner_id is distinct from old.owner_id then new.owner_id := old.owner_id; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists community_items_guard on public.community_items;
create trigger community_items_guard
  before update on public.community_items
  for each row
  execute function public.guard_community_item();

-- Anyone (guests too) may count an "Open a copy".
create or replace function public.record_community_download(p_item uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('smartgrid.counting', 'on', true);
  update public.community_items set downloads = downloads + 1 where id = p_item and status = 'published';
  perform set_config('smartgrid.counting', '', true);
end;
$$;

grant execute on function public.record_community_download(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin dashboard: staff-only readers over data that RLS otherwise hides
-- (other people's projects, emails, assistant usage). Each checks the
-- caller's role itself, so they are safe to expose through PostgREST.
-- ---------------------------------------------------------------------------

create or replace function public.admin_stats()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result json;
begin
  if not public.is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  select json_build_object(
    'users', (select count(*) from auth.users),
    'users_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'projects', (select count(*) from public.projects),
    'assets', (select count(*) from public.user_assets),
    'community_published', (select count(*) from public.community_items where status = 'published'),
    'community_hidden', (select count(*) from public.community_items where status = 'hidden'),
    'community_removed', (select count(*) from public.community_items where status = 'removed'),
    'community_downloads', (select coalesce(sum(downloads), 0) from public.community_items),
    'assistant_requests_today', (select coalesce(sum(requests), 0) from public.assistant_usage where day = (now() at time zone 'utc')::date),
    'assistant_output_tokens_today', (select coalesce(sum(output_tokens), 0) from public.assistant_usage where day = (now() at time zone 'utc')::date),
    'assistant_requests_30d', (select coalesce(sum(requests), 0) from public.assistant_usage where day > (now() at time zone 'utc')::date - 30),
    'assistant_output_tokens_30d', (select coalesce(sum(output_tokens), 0) from public.assistant_usage where day > (now() at time zone 'utc')::date - 30)
  ) into result;
  return result;
end;
$$;

create or replace function public.admin_users(p_query text default '', p_limit integer default 100)
returns table (
  id uuid,
  email text,
  display_name text,
  avatar_url text,
  role text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  projects integer,
  community_items integer,
  assistant_requests_30d integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  return query
    select
      u.id,
      u.email::text,
      p.display_name,
      p.avatar_url,
      p.role,
      u.created_at,
      u.last_sign_in_at,
      (select count(*)::integer from public.projects pr where pr.owner_id = u.id),
      (select count(*)::integer from public.community_items ci where ci.owner_id = u.id and ci.status <> 'removed'),
      (select coalesce(sum(au.requests), 0)::integer from public.assistant_usage au where au.user_id = u.id and au.day > (now() at time zone 'utc')::date - 30)
    from auth.users u
    left join public.profiles p on p.id = u.id
    where p_query = '' or u.email ilike '%' || p_query || '%' or p.display_name ilike '%' || p_query || '%'
    order by u.created_at desc
    limit greatest(1, least(p_limit, 500));
end;
$$;

create or replace function public.admin_assistant_usage(p_days integer default 30)
returns table (
  day date,
  requests bigint,
  input_tokens bigint,
  output_tokens bigint,
  users bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  return query
    select au.day, sum(au.requests), sum(au.input_tokens), sum(au.output_tokens), count(distinct au.user_id)
    from public.assistant_usage au
    where au.day > (now() at time zone 'utc')::date - greatest(1, least(p_days, 365))
    group by au.day
    order by au.day desc;
end;
$$;

revoke all on function public.admin_stats() from public;
revoke all on function public.admin_users(text, integer) from public;
revoke all on function public.admin_assistant_usage(integer) from public;
grant execute on function public.admin_stats() to authenticated;
grant execute on function public.admin_users(text, integer) to authenticated;
grant execute on function public.admin_assistant_usage(integer) to authenticated;
