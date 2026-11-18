-- Phishing reports become security cases instead of ordinary tickets.
--
-- * tickets.is_security_case: the ticket behind a case; it is left out of the
--   normal ticket list and tiles and handled on the «Sicherheitsfälle» page.
-- * security_cases: state (triage → actions → closed), verdict, fingerprint
--   of the reported mail (reports of the same mail are bundled), deadline for
--   the verdict.
-- * security_action_templates / security_case_actions: checklist per verdict.
-- * security_click_questions: «Did you click?» question to each reporter,
--   answered on a public page via an unguessable token.
-- Access goes through the edge functions security-cases and
-- security-case-response (service role); the tables have no grants for
-- signed-in users.

alter table public.tickets
  add column if not exists is_security_case boolean not null default false;

create index if not exists tickets_security_case_idx
  on public.tickets (tenant_id, created_at desc)
  where is_security_case;

create table if not exists public.security_cases (
  ticket_id uuid primary key references public.tickets(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  fingerprint text,
  state text not null default 'triage'
    check (state in ('triage', 'actions', 'closed')),
  verdict text check (verdict in ('harmless', 'spam', 'phishing', 'targeted')),
  verdict_by uuid references public.user_profiles(id) on delete set null,
  verdict_at timestamptz,
  decision_due_at timestamptz,
  reporters_notified_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists security_cases_open_fingerprint_idx
  on public.security_cases (tenant_id, fingerprint)
  where state <> 'closed';
create index if not exists security_cases_tenant_state_idx
  on public.security_cases (tenant_id, state, created_at desc);

create table if not exists public.security_action_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  verdict text not null check (verdict in ('harmless', 'spam', 'phishing', 'targeted')),
  label text not null check (char_length(label) between 1 and 200),
  sort_order smallint not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists security_action_templates_tenant_idx
  on public.security_action_templates (tenant_id, verdict, sort_order);

create table if not exists public.security_case_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null references public.security_cases(ticket_id) on delete cascade,
  label text not null check (char_length(label) between 1 and 200),
  sort_order smallint not null default 0,
  done_at timestamptz,
  done_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists security_case_actions_case_idx
  on public.security_case_actions (ticket_id, sort_order);

create table if not exists public.security_click_questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null references public.security_cases(ticket_id) on delete cascade,
  comment_id uuid references public.ticket_comments(id) on delete set null,
  email text not null check (char_length(email) between 3 and 320),
  token uuid not null unique default gen_random_uuid(),
  answer text check (answer in ('yes', 'no')),
  answered_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (ticket_id, email)
);

alter table public.security_cases enable row level security;
alter table public.security_action_templates enable row level security;
alter table public.security_case_actions enable row level security;
alter table public.security_click_questions enable row level security;
revoke all on public.security_cases, public.security_action_templates,
  public.security_case_actions, public.security_click_questions
  from public, anon, authenticated;
grant select, insert, update, delete on public.security_cases,
  public.security_action_templates, public.security_case_actions,
  public.security_click_questions to service_role;

-- Outbound mails to reporters (thanks, result, «did you click?»).
alter table public.mail_messages drop constraint if exists mail_messages_kind_check;
alter table public.mail_messages add constraint mail_messages_kind_check check (
  kind = any (array[
    'new_ticket', 'reply', 'acknowledgement', 'agent_reply', 'resolution',
    'test', 'department_question', 'department_answer', 'ticket_copy',
    'notification', 'security_notice'
  ]::text[])
);
create unique index if not exists mail_messages_security_notice_unique
  on public.mail_messages (comment_id, (to_addresses[1]))
  where kind = 'security_notice' and comment_id is not null;

-- Readable security cases of the caller (for the list in the edge function).
create or replace function public.security_case_ticket_ids(p_tenant_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select security_case.ticket_id
  from public.security_cases security_case
  where security_case.tenant_id = p_tenant_id
    and public.is_tenant_ticket_agent(p_tenant_id)
    and public.can_read_ticket(security_case.ticket_id);
$$;
revoke all on function public.security_case_ticket_ids(uuid) from public, anon;
grant execute on function public.security_case_ticket_ids(uuid) to authenticated;

-- Security cases are not part of the normal ticket list ...
do $$
declare
  v_def text;
  v_old text := E'      and (\n        p_support_level is null';
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  where p.proname = 'list_authorized_ticket_list_page_v2'
    and p.pronamespace = 'public'::regnamespace;
  if v_def is null or position('is_security_case' in v_def) > 0 then
    return;
  end if;
  if position(v_old in v_def) = 0 then
    raise exception 'list_authorized_ticket_list_page_v2: anchor not found';
  end if;
  execute replace(
    v_def,
    v_old,
    E'      and not ticket.is_security_case\n' || v_old
  );
end;
$$;

-- ... nor of the tiles per support level.
create or replace function public.ticket_level_counts(
  p_tenant_id uuid,
  p_support_level smallint
)
returns table (total bigint, closed bigint, mine bigint, unassigned bigint)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    count(*) as total,
    count(*) filter (where status.is_closed) as closed,
    count(*) filter (where ticket.assigned_agent_id = auth.uid()) as mine,
    count(*) filter (where ticket.assigned_agent_id is null) as unassigned
  from public.tickets ticket
  join public.teams team
    on team.id = ticket.assigned_team_id
   and team.tenant_id = ticket.tenant_id
   and team.support_level = p_support_level
  join public.ticket_statuses status
    on status.id = ticket.status_id
  where ticket.tenant_id = p_tenant_id
    and not ticket.is_security_case
    and public.is_active_tenant_member(p_tenant_id)
    and public.can_read_ticket(ticket.id);
$$;

-- Existing phishing tickets become security cases.
update public.tickets ticket
   set is_security_case = true
 where exists (
   select 1 from public.phishing_reports report where report.ticket_id = ticket.id
 )
   and not ticket.is_security_case;

insert into public.security_cases (
  ticket_id, tenant_id, fingerprint, state, decision_due_at, closed_at, created_at
)
select
  ticket.id,
  ticket.tenant_id,
  (select report.fingerprint from public.phishing_reports report
    where report.ticket_id = ticket.id order by report.created_at limit 1),
  case when ticket.closed_at is not null then 'closed' else 'triage' end,
  ticket.created_at + interval '4 hours',
  ticket.closed_at,
  ticket.created_at
from public.tickets ticket
where ticket.is_security_case
on conflict (ticket_id) do nothing;
