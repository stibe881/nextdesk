begin;

set local search_path = pg_catalog, public;

-- Welle 3 bleibt vollständig mandantenlokal. Der Katalogeintrag wird nicht als
-- Mandantenentscheidung missbraucht; bestehende individuelle Flags bleiben erhalten.
insert into public.feature_catalog (key, name, description, category, default_enabled)
values
  ('agent.workbench', 'Agentenwerkbank', 'Makros, Erwähnungen, Stellvertretungen und erklärbare Arbeitsvorschläge für Agenten.', 'ticketing', true),
  ('requester.portal', 'Anfragendenportal', 'Eigene Tickets, Geräte, Freigaben, Störungsmeldungen und Datenauszug für Anfragende.', 'portal', true)
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      category = excluded.category,
      default_enabled = excluded.default_enabled;

insert into public.tenant_feature_flags (tenant_id, feature_key, enabled)
select tenant.id, catalog.key, catalog.default_enabled
from public.tenants tenant
join public.feature_catalog catalog on catalog.key in ('agent.workbench', 'requester.portal')
on conflict (tenant_id, feature_key) do nothing;

create or replace function public.is_tenant_ticket_agent(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select public.is_active_tenant_member(p_tenant_id)
    and exists (
      select 1
      from public.user_role_assignments assignment
      join public.roles role
        on role.id = assignment.role_id
        and role.tenant_id = assignment.tenant_id
        and role.active
        and role.scope in ('tenant', 'department')
      join public.role_permissions role_permission on role_permission.role_id = role.id
      where assignment.user_id = auth.uid()
        and assignment.tenant_id = p_tenant_id
        and assignment.starts_at <= timezone('utc', now())
        and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
        and role_permission.permission_code in (
          'ticket.read.department', 'ticket.read.assigned', 'ticket.update', 'ticket.internal_notes.read'
        )
    );
$$;
revoke all on function public.is_tenant_ticket_agent(uuid) from public, anon;
grant execute on function public.is_tenant_ticket_agent(uuid) to authenticated;

-- Die Kategorie besitzt bereits den strengeren Schlüssel inklusive Abteilung.
-- Für optionale, abteilungsübergreifend wiederverwendbare Makros und Hinweise
-- wird zusätzlich ein reiner Mandanten-Referenzschlüssel benötigt.
alter table public.ticket_categories
  add constraint ticket_categories_id_tenant_unique unique (id, tenant_id);

-- Macros may prepare text and categorisation only. There intentionally is no
-- assignee or status column: using a macro can never close or assign a ticket.
create table public.tenant_macros (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  response_text text check (response_text is null or char_length(response_text) <= 10000),
  category_id uuid,
  subcategory_id uuid,
  priority_id uuid,
  created_by uuid not null,
  updated_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint tenant_macros_id_tenant_unique unique (id, tenant_id),
  constraint tenant_macros_template_tenant_fk foreign key (template_id, tenant_id)
    references public.ticket_templates (id, tenant_id) on delete set null (template_id),
  constraint tenant_macros_category_tenant_fk foreign key (category_id, tenant_id)
    references public.ticket_categories (id, tenant_id) on delete set null (category_id),
  constraint tenant_macros_subcategory_tenant_fk foreign key (subcategory_id, tenant_id)
    references public.ticket_categories (id, tenant_id) on delete set null (subcategory_id),
  constraint tenant_macros_priority_tenant_fk foreign key (priority_id, tenant_id)
    references public.ticket_priorities (id, tenant_id) on delete set null (priority_id),
  constraint tenant_macros_created_by_tenant_fk foreign key (tenant_id, created_by)
    references public.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint tenant_macros_updated_by_tenant_fk foreign key (tenant_id, updated_by)
    references public.tenant_memberships (tenant_id, user_id) on delete set null (updated_by)
);

-- Mentions can only point at a ticket-local internal note. The application
-- validates the optional comment relation because legacy ticket_comments has
-- no tenant_id column on which a composite database FK could be built.
create table public.ticket_mentions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null,
  comment_id uuid references public.ticket_comments(id) on delete cascade,
  mentioned_user_id uuid not null,
  author_id uuid not null,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint ticket_mentions_id_tenant_unique unique (id, tenant_id),
  constraint ticket_mentions_ticket_tenant_fk foreign key (ticket_id, tenant_id)
    references public.tickets (id, tenant_id) on delete cascade,
  constraint ticket_mentions_mentioned_tenant_fk foreign key (tenant_id, mentioned_user_id)
    references public.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint ticket_mentions_author_tenant_fk foreign key (tenant_id, author_id)
    references public.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint ticket_mentions_distinct_users check (mentioned_user_id <> author_id),
  constraint ticket_mentions_unique_per_comment unique (comment_id, mentioned_user_id)
);

-- Delegations only describe declared availability. They are never an assignment
-- rule and no trigger or policy moves tickets as a side effect.
create table public.agent_delegations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id uuid not null,
  delegate_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text check (note is null or char_length(btrim(note)) between 1 and 2000),
  ended_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint agent_delegations_id_tenant_unique unique (id, tenant_id),
  constraint agent_delegations_agent_tenant_fk foreign key (tenant_id, agent_id)
    references public.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint agent_delegations_delegate_tenant_fk foreign key (tenant_id, delegate_id)
    references public.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint agent_delegations_created_by_tenant_fk foreign key (tenant_id, created_by)
    references public.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint agent_delegations_different_people check (agent_id <> delegate_id),
  constraint agent_delegations_period_valid check (ends_at > starts_at),
  constraint agent_delegations_ended_valid check (ended_at is null or ended_at >= starts_at)
);

create table public.service_incident_notices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 240),
  description text not null check (char_length(btrim(description)) between 3 and 10000),
  status text not null default 'investigating' check (status in ('investigating', 'identified', 'monitoring', 'resolved')),
  category_id uuid,
  department_id uuid,
  starts_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  created_by uuid not null,
  updated_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint service_incident_notices_id_tenant_unique unique (id, tenant_id),
  constraint service_incident_notices_category_tenant_fk foreign key (category_id, tenant_id)
    references public.ticket_categories (id, tenant_id) on delete set null (category_id),
  constraint service_incident_notices_department_tenant_fk foreign key (department_id, tenant_id)
    references public.departments (id, tenant_id) on delete set null (department_id),
  constraint service_incident_notices_created_by_tenant_fk foreign key (tenant_id, created_by)
    references public.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint service_incident_notices_updated_by_tenant_fk foreign key (tenant_id, updated_by)
    references public.tenant_memberships (tenant_id, user_id) on delete set null (updated_by),
  constraint service_incident_notices_resolution_valid check (
    (status = 'resolved' and resolved_at is not null)
    or (status <> 'resolved' and resolved_at is null)
  )
);

-- This is a decision record, not a lifecycle automation. A later human-confirmed
-- workflow remains responsible for reopening a ticket.
create table public.ticket_reopen_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null,
  requested_by uuid not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 3000),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ticket_reopen_requests_id_tenant_unique unique (id, tenant_id),
  constraint ticket_reopen_requests_ticket_tenant_fk foreign key (ticket_id, tenant_id)
    references public.tickets (id, tenant_id) on delete cascade,
  constraint ticket_reopen_requests_requested_by_tenant_fk foreign key (tenant_id, requested_by)
    references public.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint ticket_reopen_requests_decided_by_tenant_fk foreign key (tenant_id, decided_by)
    references public.tenant_memberships (tenant_id, user_id) on delete restrict,
  constraint ticket_reopen_requests_decision_valid check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status in ('accepted', 'declined') and decided_by is not null and decided_at is not null)
  )
);

create index tenant_macros_tenant_name_idx on public.tenant_macros (tenant_id, name);
create index ticket_mentions_recipient_unread_idx on public.ticket_mentions (tenant_id, mentioned_user_id, created_at desc) where read_at is null;
create index ticket_mentions_ticket_created_idx on public.ticket_mentions (tenant_id, ticket_id, created_at desc);
create index agent_delegations_agent_active_idx on public.agent_delegations (tenant_id, agent_id, starts_at, ends_at) where ended_at is null;
create index agent_delegations_delegate_active_idx on public.agent_delegations (tenant_id, delegate_id, starts_at, ends_at) where ended_at is null;
create index service_incident_notices_tenant_status_idx on public.service_incident_notices (tenant_id, status, starts_at desc);
create index ticket_reopen_requests_pending_idx on public.ticket_reopen_requests (tenant_id, ticket_id, created_at desc) where status = 'pending';
create index ticket_reopen_requests_requester_idx on public.ticket_reopen_requests (tenant_id, requested_by, created_at desc);

create or replace function public.audit_agent_workbench_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tenant_id uuid := new.tenant_id;
  v_actor_id uuid := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  v_entity_id uuid := new.id;
begin
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_tenant_id,
    v_actor_id,
    case tg_op when 'INSERT' then lower(tg_table_name) || '.created'
               when 'UPDATE' then lower(tg_table_name) || '.updated'
               else lower(tg_table_name) || '.deleted' end,
    tg_table_name,
    v_entity_id,
    jsonb_build_object('operation', tg_op)
  );
  return new;
end;
$$;
revoke all on function public.audit_agent_workbench_change() from public, anon, authenticated;

create trigger tenant_macros_audit_changes after insert or update on public.tenant_macros
  for each row execute function public.audit_agent_workbench_change();
create trigger ticket_mentions_audit_changes after insert or update on public.ticket_mentions
  for each row execute function public.audit_agent_workbench_change();
create trigger agent_delegations_audit_changes after insert or update on public.agent_delegations
  for each row execute function public.audit_agent_workbench_change();
create trigger service_incident_notices_audit_changes after insert or update on public.service_incident_notices
  for each row execute function public.audit_agent_workbench_change();
create trigger ticket_reopen_requests_audit_changes after insert or update on public.ticket_reopen_requests
  for each row execute function public.audit_agent_workbench_change();

create trigger tenant_macros_updated_at before update on public.tenant_macros
  for each row execute function public.set_updated_at();
create trigger agent_delegations_updated_at before update on public.agent_delegations
  for each row execute function public.set_updated_at();
create trigger service_incident_notices_updated_at before update on public.service_incident_notices
  for each row execute function public.set_updated_at();
create trigger ticket_reopen_requests_updated_at before update on public.ticket_reopen_requests
  for each row execute function public.set_updated_at();

alter table public.tenant_macros enable row level security;
alter table public.tenant_macros force row level security;
alter table public.ticket_mentions enable row level security;
alter table public.ticket_mentions force row level security;
alter table public.agent_delegations enable row level security;
alter table public.agent_delegations force row level security;
alter table public.service_incident_notices enable row level security;
alter table public.service_incident_notices force row level security;
alter table public.ticket_reopen_requests enable row level security;
alter table public.ticket_reopen_requests force row level security;

revoke all on table public.tenant_macros, public.ticket_mentions, public.agent_delegations,
  public.service_incident_notices, public.ticket_reopen_requests from public, anon, authenticated;
grant select on table public.tenant_macros, public.ticket_mentions, public.agent_delegations,
  public.service_incident_notices, public.ticket_reopen_requests to authenticated;

create policy tenant_macros_select_authorized on public.tenant_macros for select to authenticated using (
  public.is_active_tenant_member(tenant_id)
  and public.has_tenant_permission(tenant_id, 'ticket.manage')
);
create policy ticket_mentions_select_recipient_or_agent on public.ticket_mentions for select to authenticated using (
  public.is_active_tenant_member(tenant_id)
  and (mentioned_user_id = auth.uid() or public.can_read_internal_note(ticket_id))
);
create policy agent_delegations_select_authorized on public.agent_delegations for select to authenticated using (
  public.is_active_tenant_member(tenant_id)
  and (agent_id = auth.uid() or delegate_id = auth.uid() or public.has_tenant_permission(tenant_id, 'ticket.manage'))
);
create policy service_incident_notices_select_member on public.service_incident_notices for select to authenticated using (
  public.is_active_tenant_member(tenant_id)
);
create policy ticket_reopen_requests_select_participant_or_agent on public.ticket_reopen_requests for select to authenticated using (
  public.is_active_tenant_member(tenant_id)
  and (
    requested_by = auth.uid()
    or exists (
      select 1 from public.tickets ticket
      where ticket.id = ticket_reopen_requests.ticket_id
        and ticket.tenant_id = ticket_reopen_requests.tenant_id
        and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.read.department')
    )
  )
);

comment on table public.tenant_macros is
  'Tenant-scoped text and classification macros. No status, closure or assignment data is stored.';
comment on table public.ticket_mentions is
  'Internal-note mentions for active members only; recipient read state is separate from ticket lifecycle.';
comment on table public.agent_delegations is
  'Declared absence and delegation information only. It never automatically redistributes tickets.';
comment on table public.service_incident_notices is
  'Tenant-local service incident notices readable by active tenant members.';
comment on table public.ticket_reopen_requests is
  'Requester reopen decision record. It does not automatically alter ticket status.';
comment on function public.is_tenant_ticket_agent(uuid) is
  'Returns true only for an active tenant member with an active ticket-agent permission.';

commit;
