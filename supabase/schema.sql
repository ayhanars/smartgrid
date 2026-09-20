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
-- (other people's projects, emails). Each checks the
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
    'community_downloads', (select coalesce(sum(downloads), 0) from public.community_items)
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
  community_items integer
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
      (select count(*)::integer from public.community_items ci where ci.owner_id = u.id and ci.status <> 'removed')
    from auth.users u
    left join public.profiles p on p.id = u.id
    where p_query = '' or u.email ilike '%' || p_query || '%' or p.display_name ilike '%' || p_query || '%'
    order by u.created_at desc
    limit greatest(1, least(p_limit, 500));
end;
$$;

revoke all on function public.admin_stats() from public;
revoke all on function public.admin_users(text, integer) from public;
grant execute on function public.admin_stats() to authenticated;
grant execute on function public.admin_users(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Likes, comments and collections on community items.
-- ---------------------------------------------------------------------------

alter table public.community_items add column if not exists likes integer not null default 0;
alter table public.community_items add column if not exists comments integer not null default 0;

create table if not exists public.community_likes (
  item_id uuid not null references public.community_items (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

alter table public.community_likes enable row level security;

drop policy if exists "Likes are visible to everyone" on public.community_likes;
create policy "Likes are visible to everyone" on public.community_likes for select using (true);
drop policy if exists "Users like as themselves" on public.community_likes;
create policy "Users like as themselves" on public.community_likes for insert with check (auth.uid() = user_id);
drop policy if exists "Users remove their own likes" on public.community_likes;
create policy "Users remove their own likes" on public.community_likes for delete using (auth.uid() = user_id);

create table if not exists public.community_comments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.community_items (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists community_comments_item_idx on public.community_comments (item_id, created_at);

alter table public.community_comments enable row level security;

drop policy if exists "Comments are visible to everyone" on public.community_comments;
create policy "Comments are visible to everyone" on public.community_comments for select using (true);
drop policy if exists "Signed-in users comment as themselves" on public.community_comments;
create policy "Signed-in users comment as themselves" on public.community_comments for insert with check (auth.uid() = author_id);
drop policy if exists "Authors edit their own comments" on public.community_comments;
create policy "Authors edit their own comments" on public.community_comments for update using (auth.uid() = author_id) with check (auth.uid() = author_id);
drop policy if exists "Authors, item owners and staff delete comments" on public.community_comments;
create policy "Authors, item owners and staff delete comments" on public.community_comments for delete
  using (auth.uid() = author_id or public.is_staff() or auth.uid() = (select owner_id from public.community_items ci where ci.id = item_id));

drop trigger if exists community_comments_set_updated_at on public.community_comments;
create trigger community_comments_set_updated_at
  before update on public.community_comments
  for each row
  execute function public.set_updated_at();

-- Counters on the item row, kept by triggers (the item guard lets these
-- through via the same setting the download counter uses).
create or replace function public.bump_community_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.item_id, old.item_id);
  col text := case when tg_table_name = 'community_likes' then 'likes' else 'comments' end;
begin
  perform set_config('smartgrid.counting', 'on', true);
  execute format('update public.community_items set %I = greatest(0, (select count(*) from public.%I where item_id = $1)) where id = $1', col, tg_table_name) using target;
  perform set_config('smartgrid.counting', '', true);
  return null;
end;
$$;

drop trigger if exists community_likes_count on public.community_likes;
create trigger community_likes_count after insert or delete on public.community_likes for each row execute function public.bump_community_counter();
drop trigger if exists community_comments_count on public.community_comments;
create trigger community_comments_count after insert or delete on public.community_comments for each row execute function public.bump_community_counter();

-- The item guard must also let the counters move.
create or replace function public.guard_community_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_user_request() and not public.is_staff() then
    if new.featured is distinct from old.featured then new.featured := old.featured; end if;
    if coalesce(current_setting('smartgrid.counting', true), '') <> 'on' then
      if new.downloads is distinct from old.downloads then new.downloads := old.downloads; end if;
      if new.likes is distinct from old.likes then new.likes := old.likes; end if;
      if new.comments is distinct from old.comments then new.comments := old.comments; end if;
    end if;
    if new.status = 'removed' or old.status = 'removed' then new.status := old.status; end if;
    if new.owner_id is distinct from old.owner_id then new.owner_id := old.owner_id; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Collections: a person's named sets of community models ("IKEA
-- organizers", "desk gadgets"). Private by default; a public one can be
-- shared by link.
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '',
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists collections_owner_idx on public.collections (owner_id, updated_at desc);

alter table public.collections enable row level security;

drop policy if exists "Own or public collections are visible" on public.collections;
create policy "Own or public collections are visible" on public.collections for select using (is_public or auth.uid() = owner_id or public.is_staff());
drop policy if exists "Users create their own collections" on public.collections;
create policy "Users create their own collections" on public.collections for insert with check (auth.uid() = owner_id);
drop policy if exists "Owners update their collections" on public.collections;
create policy "Owners update their collections" on public.collections for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "Owners and admins delete collections" on public.collections;
create policy "Owners and admins delete collections" on public.collections for delete using (auth.uid() = owner_id or public.is_admin());

drop trigger if exists collections_set_updated_at on public.collections;
create trigger collections_set_updated_at before update on public.collections for each row execute function public.set_updated_at();

create table if not exists public.collection_items (
  collection_id uuid not null references public.collections (id) on delete cascade,
  item_id uuid not null references public.community_items (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (collection_id, item_id)
);

create index if not exists collection_items_item_idx on public.collection_items (item_id);

alter table public.collection_items enable row level security;

drop policy if exists "Items of visible collections are visible" on public.collection_items;
create policy "Items of visible collections are visible" on public.collection_items for select
  using (exists (select 1 from public.collections c where c.id = collection_id and (c.is_public or c.owner_id = auth.uid() or public.is_staff())));
drop policy if exists "Owners add to their collections" on public.collection_items;
create policy "Owners add to their collections" on public.collection_items for insert
  with check (exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid()));
drop policy if exists "Owners remove from their collections" on public.collection_items;
create policy "Owners remove from their collections" on public.collection_items for delete
  using (exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid()));

-- Touch the collection so lists sort by recent activity.
create or replace function public.touch_collection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.collections set updated_at = now() where id = coalesce(new.collection_id, old.collection_id);
  return null;
end;
$$;

drop trigger if exists collection_items_touch on public.collection_items;
create trigger collection_items_touch after insert or delete on public.collection_items for each row execute function public.touch_collection();

-- ---------------------------------------------------------------------------
-- Moderation queue, versions, notifications, XP levels, comment replies,
-- collection covers.
-- ---------------------------------------------------------------------------

-- Every new community item and collection waits for a moderator unless a
-- moderator / admin created it.
alter table public.community_items add column if not exists approval text not null default 'pending' check (approval in ('pending', 'approved', 'rejected'));
alter table public.community_items add column if not exists review_note text not null default '';
-- Versions: a model published from a copy of another one.
alter table public.community_items add column if not exists parent_id uuid references public.community_items (id) on delete set null;
alter table public.community_items add column if not exists changes text not null default '';
create index if not exists community_items_parent_idx on public.community_items (parent_id);
create index if not exists community_items_approval_idx on public.community_items (approval, created_at desc);

alter table public.collections add column if not exists approval text not null default 'pending' check (approval in ('pending', 'approved', 'rejected'));
alter table public.collections add column if not exists review_note text not null default '';
alter table public.collections add column if not exists cover_url text;

-- Where a project came from, so "publish" can offer it as a version.
alter table public.projects add column if not exists source_item_id uuid references public.community_items (id) on delete set null;

alter table public.community_comments add column if not exists parent_id uuid references public.community_comments (id) on delete cascade;
alter table public.community_comments add column if not exists mentions uuid[] not null default '{}';

alter table public.profiles add column if not exists xp integer not null default 0;
alter table public.profiles add column if not exists level integer not null default 1;

-- Items already published before moderation existed stay visible.
update public.community_items set approval = 'approved' where approval = 'pending' and created_at < now() - interval '1 minute';
update public.collections set approval = 'approved' where approval = 'pending' and created_at < now() - interval '1 minute';

-- Visibility now also needs approval.
drop policy if exists "Published items are visible to everyone" on public.community_items;
create policy "Published items are visible to everyone"
  on public.community_items for select
  using ((status = 'published' and approval = 'approved') or auth.uid() = owner_id or public.is_staff());

drop policy if exists "Own or public collections are visible" on public.collections;
create policy "Own or public collections are visible"
  on public.collections for select
  using ((is_public and approval = 'approved') or auth.uid() = owner_id or public.is_staff());

drop policy if exists "Items of visible collections are visible" on public.collection_items;
create policy "Items of visible collections are visible" on public.collection_items for select
  using (exists (select 1 from public.collections c where c.id = collection_id and ((c.is_public and c.approval = 'approved') or c.owner_id = auth.uid() or public.is_staff())));

-- Staff-authored things skip the queue; only staff change approval.
create or replace function public.set_initial_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_staff() or not public.is_user_request() then
    new.approval := 'approved';
  else
    new.approval := 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists community_items_initial_approval on public.community_items;
create trigger community_items_initial_approval before insert on public.community_items for each row execute function public.set_initial_approval();
drop trigger if exists collections_initial_approval on public.collections;
create trigger collections_initial_approval before insert on public.collections for each row execute function public.set_initial_approval();

create or replace function public.guard_community_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_user_request() and not public.is_staff() then
    if new.featured is distinct from old.featured then new.featured := old.featured; end if;
    if coalesce(current_setting('smartgrid.counting', true), '') <> 'on' then
      if new.downloads is distinct from old.downloads then new.downloads := old.downloads; end if;
      if new.likes is distinct from old.likes then new.likes := old.likes; end if;
      if new.comments is distinct from old.comments then new.comments := old.comments; end if;
    end if;
    if new.status = 'removed' or old.status = 'removed' then new.status := old.status; end if;
    if new.owner_id is distinct from old.owner_id then new.owner_id := old.owner_id; end if;
    if new.review_note is distinct from old.review_note then new.review_note := old.review_note; end if;
    -- The author replacing the model sends it back to the queue.
    if new.approval is distinct from old.approval then new.approval := old.approval; end if;
    if new.data is distinct from old.data and old.approval = 'approved' then new.approval := 'pending'; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.guard_collection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_user_request() and not public.is_staff() then
    if new.approval is distinct from old.approval then new.approval := old.approval; end if;
    if new.review_note is distinct from old.review_note then new.review_note := old.review_note; end if;
    if new.owner_id is distinct from old.owner_id then new.owner_id := old.owner_id; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists collections_set_updated_at on public.collections;
drop trigger if exists collections_guard on public.collections;
create trigger collections_guard before update on public.collections for each row execute function public.guard_collection();

-- Collection covers: a public bucket, owner's folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', true, 4194304, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 4194304, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

drop policy if exists "Covers are publicly readable" on storage.objects;
create policy "Covers are publicly readable" on storage.objects for select using (bucket_id = 'covers');
drop policy if exists "Users manage their own covers" on storage.objects;
create policy "Users manage their own covers" on storage.objects for all
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);

-- Notifications ---------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, read, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "Users read their notifications" on public.notifications;
create policy "Users read their notifications" on public.notifications for select using (auth.uid() = user_id);
drop policy if exists "Users mark their notifications" on public.notifications;
create policy "Users mark their notifications" on public.notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users delete their notifications" on public.notifications;
create policy "Users delete their notifications" on public.notifications for delete using (auth.uid() = user_id);

create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text default '', p_link text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select p_user, p_kind, p_title, p_body, p_link where p_user is not null;
$$;

create or replace function public.notify_staff(p_kind text, p_title text, p_body text default '', p_link text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, kind, title, body, link)
  select id, p_kind, p_title, p_body, p_link from public.profiles where role in ('admin', 'moderator');
$$;

-- XP / levels -----------------------------------------------------------------
-- Level L needs 50 * L * (L - 1) XP: 0, 100, 300, 600, 1000, 1500…

create or replace function public.xp_to_level(p_xp integer)
returns integer
language sql
immutable
as $$
  -- 50·L·(L−1) ≤ xp  ⇔  L ≤ (1 + sqrt(1 + 4·xp/50)) / 2
  select greatest(1, floor((1 + sqrt(1 + 4 * greatest(p_xp, 0) / 50.0)) / 2)::integer);
$$;

create or replace function public.award_xp(p_user uuid, p_points integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_level integer;
  new_level integer;
begin
  if p_user is null or p_points = 0 then return; end if;
  select level into old_level from public.profiles where id = p_user;
  perform set_config('smartgrid.counting', 'on', true);
  update public.profiles set xp = greatest(0, xp + p_points), level = public.xp_to_level(greatest(0, xp + p_points)) where id = p_user returning level into new_level;
  perform set_config('smartgrid.counting', '', true);
  if new_level > coalesce(old_level, 1) then
    perform public.notify(p_user, 'level', format('You reached level %s', new_level), p_reason, '/account');
  end if;
end;
$$;

-- award_xp updates profiles: the role guard must not block it (it only
-- touches role), and RLS is bypassed by security definer.

-- Events --------------------------------------------------------------------------

create or replace function public.on_community_item_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  author text;
begin
  if tg_op = 'INSERT' then
    perform public.award_xp(new.owner_id, 20, format('Published "%s"', new.title));
    if new.approval = 'pending' then
      select display_name into author from public.profiles where id = new.owner_id;
      perform public.notify_staff('review', format('New model to review: %s', new.title), format('by %s%s', coalesce(author, 'someone'), case when new.parent_id is not null then ' (a version of another model)' else '' end), '/admin?tab=approvals');
    elsif new.approval = 'approved' then
      perform public.award_xp(new.owner_id, 30, format('"%s" is live', new.title));
    end if;
    if new.parent_id is not null then
      perform public.notify((select owner_id from public.community_items where id = new.parent_id and owner_id <> new.owner_id), 'version', format('Someone made a version of your model'), new.title, '/c/' || new.id);
    end if;
    return new;
  end if;
  if new.approval is distinct from old.approval then
    if new.approval = 'approved' then
      perform public.notify(new.owner_id, 'approved', format('"%s" was approved', new.title), 'It is now visible to everyone in the community.', '/c/' || new.id);
      perform public.award_xp(new.owner_id, 30, format('"%s" is live', new.title));
    elsif new.approval = 'rejected' then
      perform public.notify(new.owner_id, 'rejected', format('"%s" was not approved', new.title), coalesce(nullif(new.review_note, ''), 'A moderator declined it. You can edit and resubmit from the project.'), '/c/' || new.id);
    elsif new.approval = 'pending' and old.approval = 'approved' then
      perform public.notify_staff('review', format('Updated model to review: %s', new.title), 'The author replaced the shared model.', '/admin?tab=approvals');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists community_items_events on public.community_items;
create trigger community_items_events after insert or update on public.community_items for each row execute function public.on_community_item_change();

create or replace function public.on_collection_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  author text;
begin
  if tg_op = 'INSERT' then
    perform public.award_xp(new.owner_id, 5, format('Created the collection "%s"', new.name));
    if new.approval = 'pending' then
      select display_name into author from public.profiles where id = new.owner_id;
      perform public.notify_staff('review', format('New collection to review: %s', new.name), format('by %s', coalesce(author, 'someone')), '/admin?tab=approvals');
    end if;
    return new;
  end if;
  if new.approval is distinct from old.approval then
    if new.approval = 'approved' then
      perform public.notify(new.owner_id, 'approved', format('Collection "%s" was approved', new.name), 'You can make it public and share it by link.', '/collections/' || new.id);
    elsif new.approval = 'rejected' then
      perform public.notify(new.owner_id, 'rejected', format('Collection "%s" was not approved', new.name), coalesce(nullif(new.review_note, ''), 'A moderator declined it.'), '/collections/' || new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists collections_events on public.collections;
create trigger collections_events after insert or update on public.collections for each row execute function public.on_collection_change();

create or replace function public.on_comment_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item_owner uuid;
  item_title text;
  author text;
  parent_author uuid;
  m uuid;
begin
  select owner_id, title into item_owner, item_title from public.community_items where id = new.item_id;
  select display_name into author from public.profiles where id = new.author_id;
  perform public.award_xp(new.author_id, 2, 'Commented');
  if new.parent_id is not null then
    select author_id into parent_author from public.community_comments where id = new.parent_id;
    if parent_author is not null and parent_author <> new.author_id then
      perform public.notify(parent_author, 'reply', format('%s replied to your comment', coalesce(author, 'Someone')), left(new.body, 140), '/c/' || new.item_id);
    end if;
  end if;
  foreach m in array new.mentions loop
    if m <> new.author_id and m is distinct from parent_author then
      perform public.notify(m, 'mention', format('%s mentioned you', coalesce(author, 'Someone')), left(new.body, 140), '/c/' || new.item_id);
    end if;
  end loop;
  if item_owner is not null and item_owner <> new.author_id and item_owner is distinct from parent_author and not (item_owner = any (new.mentions)) then
    perform public.notify(item_owner, 'comment', format('%s commented on "%s"', coalesce(author, 'Someone'), item_title), left(new.body, 140), '/c/' || new.item_id);
  end if;
  return new;
end;
$$;

drop trigger if exists community_comments_events on public.community_comments;
create trigger community_comments_events after insert on public.community_comments for each row execute function public.on_comment_insert();

create or replace function public.on_like_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.award_xp((select owner_id from public.community_items where id = new.item_id and owner_id <> new.user_id), 5, 'Your model was liked');
  return new;
end;
$$;

drop trigger if exists community_likes_xp on public.community_likes;
create trigger community_likes_xp after insert on public.community_likes for each row execute function public.on_like_insert();

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
  perform public.award_xp((select owner_id from public.community_items where id = p_item and owner_id is distinct from auth.uid()), 3, 'Someone opened a copy of your model');
end;
$$;

-- New accounts start with a little XP for showing up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url, role, xp, level)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url',
    case when exists (select 1 from public.bootstrap_admins where lower(email) = lower(coalesce(new.email, ''))) then 'admin' else 'user' end,
    10, 1
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Mention lookup: name search over profiles (public columns only).
create or replace function public.search_profiles(p_query text, p_limit integer default 8)
returns table (id uuid, display_name text, avatar_url text, level integer)
language sql
stable
security definer
set search_path = public
as $$
  select id, display_name, avatar_url, level from public.profiles
  where display_name ilike '%' || p_query || '%'
  order by display_name
  limit greatest(1, least(p_limit, 20));
$$;

grant execute on function public.search_profiles(text, integer) to authenticated;

-- Staff: approve / reject.
create or replace function public.review_community_item(p_item uuid, p_approval text, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  if p_approval not in ('approved', 'rejected', 'pending') then raise exception 'bad approval'; end if;
  update public.community_items set approval = p_approval, review_note = coalesce(p_note, '') where id = p_item;
end;
$$;

create or replace function public.review_collection(p_collection uuid, p_approval text, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  if p_approval not in ('approved', 'rejected', 'pending') then raise exception 'bad approval'; end if;
  update public.collections set approval = p_approval, review_note = coalesce(p_note, '') where id = p_collection;
end;
$$;

grant execute on function public.review_community_item(uuid, text, text) to authenticated;
grant execute on function public.review_collection(uuid, text, text) to authenticated;

-- Staff readers pick up the queue and levels.
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
    'community_published', (select count(*) from public.community_items where status = 'published' and approval = 'approved'),
    'community_pending', (select count(*) from public.community_items where approval = 'pending' and status <> 'removed') + (select count(*) from public.collections where approval = 'pending'),
    'community_hidden', (select count(*) from public.community_items where status = 'hidden'),
    'community_removed', (select count(*) from public.community_items where status = 'removed'),
    'community_downloads', (select coalesce(sum(downloads), 0) from public.community_items),
    'community_likes', (select coalesce(sum(likes), 0) from public.community_items),
    'community_comments', (select count(*) from public.community_comments),
    'collections', (select count(*) from public.collections)
  ) into result;
  return result;
end;
$$;

drop function if exists public.admin_users(text, integer);
create or replace function public.admin_users(p_query text default '', p_limit integer default 100)
returns table (
  id uuid,
  email text,
  display_name text,
  avatar_url text,
  role text,
  xp integer,
  level integer,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  projects integer,
  community_items integer
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
      p.xp,
      p.level,
      u.created_at,
      u.last_sign_in_at,
      (select count(*)::integer from public.projects pr where pr.owner_id = u.id),
      (select count(*)::integer from public.community_items ci where ci.owner_id = u.id and ci.status <> 'removed')
    from auth.users u
    left join public.profiles p on p.id = u.id
    where p_query = '' or u.email ilike '%' || p_query || '%' or p.display_name ilike '%' || p_query || '%'
    order by u.created_at desc
    limit greatest(1, least(p_limit, 500));
end;
$$;
grant execute on function public.admin_users(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Following: people get a notification when someone they follow has a
-- model approved. Profile pages are public.
-- ---------------------------------------------------------------------------

create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create index if not exists follows_followee_idx on public.follows (followee_id);

alter table public.follows enable row level security;

drop policy if exists "Follows are visible to everyone" on public.follows;
create policy "Follows are visible to everyone" on public.follows for select using (true);
drop policy if exists "Users follow as themselves" on public.follows;
create policy "Users follow as themselves" on public.follows for insert with check (auth.uid() = follower_id);
drop policy if exists "Users unfollow as themselves" on public.follows;
create policy "Users unfollow as themselves" on public.follows for delete using (auth.uid() = follower_id);

alter table public.profiles add column if not exists followers integer not null default 0;
alter table public.profiles add column if not exists following integer not null default 0;
alter table public.profiles add column if not exists bio text not null default '';

create or replace function public.on_follow_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f uuid := coalesce(new.follower_id, old.follower_id);
  t uuid := coalesce(new.followee_id, old.followee_id);
  who text;
begin
  perform set_config('smartgrid.counting', 'on', true);
  update public.profiles set followers = (select count(*) from public.follows where followee_id = t) where id = t;
  update public.profiles set following = (select count(*) from public.follows where follower_id = f) where id = f;
  perform set_config('smartgrid.counting', '', true);
  if tg_op = 'INSERT' then
    select display_name into who from public.profiles where id = f;
    perform public.notify(t, 'follow', format('%s started following you', coalesce(who, 'Someone')), '', '/u/' || f);
    perform public.award_xp(t, 5, 'New follower');
  end if;
  return null;
end;
$$;

drop trigger if exists follows_events on public.follows;
create trigger follows_events after insert or delete on public.follows for each row execute function public.on_follow_change();

-- The counters on profiles are kept by triggers, not by users.
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_user_request() then
    if new.role is distinct from old.role and not public.is_admin() then new.role := old.role; end if;
    -- Counters move only through award_xp / the follow trigger, which set
    -- the same flag the community counters use.
    if coalesce(current_setting('smartgrid.counting', true), '') <> 'on' and (new.xp is distinct from old.xp or new.level is distinct from old.level or new.followers is distinct from old.followers or new.following is distinct from old.following) then
      new.xp := old.xp; new.level := old.level; new.followers := old.followers; new.following := old.following;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Followers hear about approved models (new or resubmitted).
create or replace function public.notify_followers_of_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
begin
  if new.approval = 'approved' and new.status = 'published' and (tg_op = 'INSERT' or old.approval is distinct from 'approved') then
    select display_name into who from public.profiles where id = new.owner_id;
    insert into public.notifications (user_id, kind, title, body, link)
    select follower_id, 'follow_post', format('%s published %s', coalesce(who, 'Someone'), new.title), left(new.description, 140), '/c/' || new.id
    from public.follows where followee_id = new.owner_id;
  end if;
  return null;
end;
$$;

drop trigger if exists community_items_followers on public.community_items;
create trigger community_items_followers after insert or update on public.community_items for each row execute function public.notify_followers_of_item();

-- People search for the global search box (profiles are public).
grant execute on function public.search_profiles(text, integer) to anon;

-- ---------------------------------------------------------------------------
-- Categories and tag suggestions for publishing.
-- ---------------------------------------------------------------------------

alter table public.community_items add column if not exists category text not null default 'other';
create index if not exists community_items_category_idx on public.community_items (category);

-- Tags people already use, most common first: the publish form suggests
-- them so spellings do not drift.
create or replace function public.popular_tags(p_query text default '', p_limit integer default 12)
returns table (tag text, uses bigint)
language sql
stable
security definer
set search_path = public
as $$
  select t.tag, count(*) as uses
  from public.community_items ci, unnest(ci.tags) as t(tag)
  where ci.status = 'published' and ci.approval = 'approved' and (p_query = '' or t.tag ilike p_query || '%')
  group by t.tag
  order by uses desc, t.tag
  limit greatest(1, least(p_limit, 50));
$$;

grant execute on function public.popular_tags(text, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Version families: every item knows the root model of its lineage, so a
-- model page can list the original and every version in one query.
-- ---------------------------------------------------------------------------

alter table public.community_items add column if not exists root_id uuid references public.community_items (id) on delete set null;
create index if not exists community_items_root_idx on public.community_items (root_id, created_at);

create or replace function public.set_item_root()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.parent_id is not null then
    select coalesce(p.root_id, p.id) into new.root_id from public.community_items p where p.id = new.parent_id;
  end if;
  if new.root_id is null then new.root_id := new.id; end if;
  return new;
end;
$$;

drop trigger if exists community_items_root on public.community_items;
create trigger community_items_root
  before insert on public.community_items
  for each row
  execute function public.set_item_root();

-- Items published before this column existed.
with recursive lineage as (
  select id, id as root from public.community_items where parent_id is null
  union all
  select c.id, l.root from public.community_items c join lineage l on c.parent_id = l.id
)
update public.community_items ci set root_id = l.root from lineage l where ci.id = l.id and ci.root_id is null;
update public.community_items set root_id = id where root_id is null;

-- When an author publishes a new version of their own model, the older one
-- stays downloadable from the Versions list but leaves the listings.
alter table public.community_items add column if not exists superseded boolean not null default false;

create or replace function public.supersede_parent_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.parent_id is not null then
    update public.community_items set superseded = true where id = new.parent_id and owner_id = new.owner_id;
  end if;
  return new;
end;
$$;

drop trigger if exists community_items_supersede on public.community_items;
create trigger community_items_supersede
  after insert on public.community_items
  for each row
  execute function public.supersede_parent_version();

-- ---------------------------------------------------------------------------
-- Revisions: an author's new version of a model updates the same listing;
-- the previous state is archived here so every version stays downloadable.
-- Versions published by other people from a copy stay separate items
-- (parent_id / root_id above).
-- ---------------------------------------------------------------------------

drop trigger if exists community_items_supersede on public.community_items;
drop function if exists public.supersede_parent_version();
-- The column stays (unused) so app versions that still select it keep working.

create table if not exists public.community_item_versions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.community_items (id) on delete cascade,
  version integer not null,
  title text not null default '',
  data jsonb not null,
  thumbnail text,
  changes text not null default '',
  created_at timestamptz not null default now(),
  unique (item_id, version)
);
create index if not exists community_item_versions_item_idx on public.community_item_versions (item_id, version);

alter table public.community_item_versions enable row level security;

drop policy if exists "Versions of visible items are visible" on public.community_item_versions;
create policy "Versions of visible items are visible"
  on public.community_item_versions for select
  using (exists (
    select 1 from public.community_items ci
    where ci.id = item_id and ((ci.status = 'published' and ci.approval = 'approved') or ci.owner_id = auth.uid() or public.is_staff())
  ));

-- Archives the item's current model as the next version and replaces it
-- with the new one (which goes back to review for non-staff, like any
-- model change). Returns the new version number.
create or replace function public.publish_item_version(p_item uuid, p_data jsonb, p_thumbnail text, p_changes text, p_source_project uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cur public.community_items%rowtype;
  next_no integer;
begin
  select * into cur from public.community_items where id = p_item;
  if cur.id is null then raise exception 'Model not found'; end if;
  if cur.owner_id <> auth.uid() then raise exception 'Only the author can publish a version'; end if;
  select coalesce(max(version), 0) + 1 into next_no from public.community_item_versions where item_id = p_item;
  insert into public.community_item_versions (item_id, version, title, data, thumbnail, changes, created_at)
    values (p_item, next_no, cur.title, cur.data, cur.thumbnail, cur.changes, cur.updated_at);
  update public.community_items
    set data = p_data, thumbnail = p_thumbnail, changes = coalesce(p_changes, ''), source_project_id = coalesce(p_source_project, source_project_id)
    where id = p_item;
  return next_no + 1;
end;
$$;

grant execute on function public.publish_item_version(uuid, jsonb, text, text, uuid) to authenticated;
