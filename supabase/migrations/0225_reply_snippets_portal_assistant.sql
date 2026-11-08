begin;

set local search_path = pg_catalog, public;

-- 1. «Antwort-Bausteine»: short reply texts with placeholders such as
--    {Vorname}, {Ticketnummer} or {Gerät}. A snippet is either personal
--    (owner_id = the agent) or shared with the whole tenant (owner_id null),
--    optionally limited to one department. The placeholders are resolved in
--    the composer from the ticket; the database only stores the template.
--    Access runs through the edge function reply-snippets (service role).
--    Snippets are never removed: «Löschen» in the UI sets active = false.
create table if not exists public.reply_snippets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  owner_id uuid references public.user_profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  shortcut text check (
    shortcut is null or shortcut ~ '^[a-z0-9][a-z0-9_-]{0,39}$'
  ),
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  active boolean not null default true,
  usage_count integer not null default 0 check (usage_count >= 0),
  created_by uuid references public.user_profiles(id) on delete set null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists reply_snippets_tenant_active_idx
  on public.reply_snippets (tenant_id, active, name);
create index if not exists reply_snippets_owner_idx
  on public.reply_snippets (owner_id) where owner_id is not null;
-- A shortcut is unique among the shared snippets of a tenant and among the
-- personal snippets of one person (a personal one may shadow a shared one).
create unique index if not exists reply_snippets_shared_shortcut_unique
  on public.reply_snippets (tenant_id, shortcut)
  where owner_id is null and shortcut is not null and active;
create unique index if not exists reply_snippets_personal_shortcut_unique
  on public.reply_snippets (tenant_id, owner_id, shortcut)
  where owner_id is not null and shortcut is not null and active;

create or replace trigger reply_snippets_set_updated_at
  before update on public.reply_snippets
  for each row execute function public.set_updated_at();

alter table public.reply_snippets enable row level security;
revoke all on table public.reply_snippets from public, anon, authenticated;
grant all on table public.reply_snippets to service_role;

-- 2. «Selbstbedienungs-Assistent im Portal»: optional per tenant and off by
--    default. Without a row the assistant is off.
create table if not exists public.portal_assistant_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.portal_assistant_settings enable row level security;
revoke all on table public.portal_assistant_settings from public, anon, authenticated;
grant all on table public.portal_assistant_settings to service_role;

-- One row per assistant conversation, for reporting: was the problem solved
-- with an article, or did the person create a ticket? No conversation text is
-- stored here.
create table if not exists public.portal_assistant_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references public.user_profiles(id) on delete set null,
  mode text not null default 'search' check (mode in ('ai', 'search')),
  question_count integer not null default 0 check (question_count between 0 and 2),
  turn_count integer not null default 0 check (turn_count between 0 and 20),
  outcome text not null default 'open'
    check (outcome in ('open', 'solved_by_article', 'ticket_created', 'abandoned')),
  article_id uuid references public.knowledge_articles(id) on delete set null,
  ticket_id uuid references public.tickets(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  constraint portal_assistant_sessions_finished_valid check (
    (outcome = 'open') = (finished_at is null)
  )
);

create index if not exists portal_assistant_sessions_tenant_created_idx
  on public.portal_assistant_sessions (tenant_id, created_at desc);
create index if not exists portal_assistant_sessions_ticket_idx
  on public.portal_assistant_sessions (ticket_id) where ticket_id is not null;

create or replace trigger portal_assistant_sessions_set_updated_at
  before update on public.portal_assistant_sessions
  for each row execute function public.set_updated_at();

alter table public.portal_assistant_sessions enable row level security;
revoke all on table public.portal_assistant_sessions from public, anon, authenticated;
grant all on table public.portal_assistant_sessions to service_role;

-- Outcome counts of a tenant since p_since (reporting in the tenant settings).
create or replace function public.portal_assistant_outcome_summary(
  p_tenant_id uuid,
  p_since timestamptz
)
returns table (
  total bigint,
  solved_by_article bigint,
  ticket_created bigint,
  abandoned bigint,
  open bigint,
  ai_sessions bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    count(*),
    count(*) filter (where session.outcome = 'solved_by_article'),
    count(*) filter (where session.outcome = 'ticket_created'),
    count(*) filter (where session.outcome = 'abandoned'),
    count(*) filter (where session.outcome = 'open'),
    count(*) filter (where session.mode = 'ai')
  from public.portal_assistant_sessions session
  where session.tenant_id = p_tenant_id
    and session.created_at >= p_since;
$$;

revoke all on function public.portal_assistant_outcome_summary(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.portal_assistant_outcome_summary(uuid, timestamptz)
  to service_role;

commit;
