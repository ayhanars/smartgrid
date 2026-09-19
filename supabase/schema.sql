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
