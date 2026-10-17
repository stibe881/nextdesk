begin;

-- Ticketvorlagen dürfen nur einen kleinen, kontextgebundenen Satz von
-- Platzhaltern enthalten. Der Ausdruck entfernt alle erlaubten Platzhalter und
-- lehnt danach jedes verbliebene geschweifte Klammerzeichen ab; damit sind keine
-- verschachtelten, dynamischen oder auswertbaren Ausdrücke möglich.
create or replace function public.ticket_template_placeholders_valid(p_template text)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select regexp_replace(
    p_template,
    '\{\{(anfragende_person|abteilung|heute|ticket_nummer)\}\}',
    '',
    'g'
  ) !~ '[{}]';
$$;

revoke all on function public.ticket_template_placeholders_valid(text) from public, anon, authenticated;

-- Ergänzt die bisherige Vorlagentabelle um einen mandantenbezogenen
-- Referenzschlüssel. Bestehende Daten bleiben lesbar, neue und geänderte
-- Vorlagen müssen die Sicherheitsinvarianten erfüllen.
alter table public.ticket_templates
  add constraint ticket_templates_id_tenant_unique unique (id, tenant_id);

alter table public.ticket_templates
  add constraint ticket_templates_department_tenant_fk
  foreign key (department_id, tenant_id)
  references public.departments (id, tenant_id)
  on delete set null;

alter table public.ticket_templates
  add constraint ticket_templates_subject_safe_placeholders
  check (public.ticket_template_placeholders_valid(subject_template)) not valid;

alter table public.ticket_templates
  add constraint ticket_templates_description_safe_placeholders
  check (public.ticket_template_placeholders_valid(description_template)) not valid;

-- Checklisten erben den Mandanten nicht nur über die Vorlage, sondern tragen
-- ihn explizit. So hält bereits die Datenbank eine fehlerhafte Cross-Tenant-
-- Referenz zurück, auch bei künftigen Serverfunktionen.
alter table public.ticket_template_checklist_items
  add column tenant_id uuid;

update public.ticket_template_checklist_items checklist
set tenant_id = template.tenant_id
from public.ticket_templates template
where template.id = checklist.template_id
  and checklist.tenant_id is null;

alter table public.ticket_template_checklist_items
  alter column tenant_id set not null;

alter table public.ticket_template_checklist_items
  add constraint ticket_template_checklist_items_template_tenant_fk
  foreign key (template_id, tenant_id)
  references public.ticket_templates (id, tenant_id)
  on delete cascade;

create index ticket_template_checklist_items_template_tenant_position_idx
  on public.ticket_template_checklist_items (tenant_id, template_id, position, id);

-- Vorlagen und ihre Checklisten werden ausschliesslich über authentisierte,
-- berechtigungsgeprüfte Edge Functions verarbeitet. Browserrollen erhalten
-- weder Tabellenrechte noch RLS-Policies als Umgehungsweg.
alter table public.ticket_templates enable row level security;
alter table public.ticket_templates force row level security;
alter table public.ticket_template_checklist_items enable row level security;
alter table public.ticket_template_checklist_items force row level security;
revoke all on table public.ticket_templates, public.ticket_template_checklist_items from public, anon, authenticated;

insert into public.permissions (code, description, is_sensitive)
values
  ('ticket.approval.request', 'Ticketfreigaben anfordern', false),
  ('ticket.approval.decide', 'Ticketfreigaben entscheiden', true)
on conflict (code) do update
set description = excluded.description,
    is_sensitive = excluded.is_sensitive;

-- Eine Freigabe ist immer gleichzeitig an Ticket und Mandant gebunden. Ein
-- offener Vorgang desselben Typs pro Ticket verhindert parallele Doppelanträge.
create table public.ticket_approval_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null,
  approval_kind text not null collate "C",
  status text not null default 'pending' collate "C",
  required_approvals smallint not null default 1,
  requested_by uuid not null references public.user_profiles(id) on delete restrict,
  reason text not null,
  requested_at timestamptz not null default timezone('utc', now()),
  decided_at timestamptz,
  constraint ticket_approval_requests_id_tenant_unique unique (id, tenant_id),
  constraint ticket_approval_requests_ticket_tenant_fk
    foreign key (ticket_id, tenant_id)
    references public.tickets (id, tenant_id) on delete cascade,
  constraint ticket_approval_requests_kind_valid
    check (approval_kind ~ '^[a-z][a-z0-9_]{1,62}$'),
  constraint ticket_approval_requests_status_valid
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  constraint ticket_approval_requests_required_count_valid
    check (required_approvals between 1 and 10),
  constraint ticket_approval_requests_reason_valid
    check (
      char_length(btrim(reason)) between 3 and 2000
      and reason = btrim(reason)
      and reason !~ '[[:cntrl:]]'
    ),
  constraint ticket_approval_requests_decision_time_valid
    check (
      (status = 'pending' and decided_at is null)
      or (status in ('approved', 'rejected', 'cancelled') and decided_at is not null)
    )
);

create unique index ticket_approval_requests_open_kind_unique
  on public.ticket_approval_requests (ticket_id, approval_kind)
  where status = 'pending';
create index ticket_approval_requests_tenant_ticket_idx
  on public.ticket_approval_requests (tenant_id, ticket_id, requested_at desc);

create table public.ticket_approval_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  approval_id uuid not null,
  approver_id uuid not null references public.user_profiles(id) on delete restrict,
  decision text not null collate "C",
  comment text,
  decided_at timestamptz not null default timezone('utc', now()),
  constraint ticket_approval_decisions_id_tenant_unique unique (id, tenant_id),
  constraint ticket_approval_decisions_request_tenant_fk
    foreign key (approval_id, tenant_id)
    references public.ticket_approval_requests (id, tenant_id) on delete cascade,
  constraint ticket_approval_decisions_approver_once_unique unique (approval_id, approver_id),
  constraint ticket_approval_decisions_decision_valid
    check (decision in ('approved', 'rejected')),
  constraint ticket_approval_decisions_comment_valid
    check (
      comment is null or (
        char_length(btrim(comment)) between 1 and 2000
        and comment = btrim(comment)
        and comment !~ '[[:cntrl:]]'
      )
    )
);

create index ticket_approval_decisions_tenant_request_idx
  on public.ticket_approval_decisions (tenant_id, approval_id, decided_at);

alter table public.ticket_approval_requests enable row level security;
alter table public.ticket_approval_requests force row level security;
alter table public.ticket_approval_decisions enable row level security;
alter table public.ticket_approval_decisions force row level security;
revoke all on table public.ticket_approval_requests, public.ticket_approval_decisions from public, anon, authenticated;

-- Nur Mandantenadministrationen erhalten die sensible Entscheidungsbefugnis
-- standardmässig. Die Berechtigungen werden auch bei zukünftig angelegten
-- Systemrollen konsistent vergeben; Support- und Requesterrollen bleiben ohne
-- implizite Freigaberechte.
insert into public.role_permissions (role_id, permission_code)
select role.id, permission.code
from public.roles role
cross join (values ('ticket.approval.request'), ('ticket.approval.decide')) as permission(code)
where role.active
  and role.is_system
  and role.scope = 'tenant'
  and role.name = 'Tenant administrator'
on conflict (role_id, permission_code) do nothing;

create or replace function public.grant_default_ticket_approval_permissions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.active
    and new.is_system
    and new.scope = 'tenant'
    and new.name = 'Tenant administrator' then
    insert into public.role_permissions (role_id, permission_code)
    values
      (new.id, 'ticket.approval.request'),
      (new.id, 'ticket.approval.decide')
    on conflict (role_id, permission_code) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.grant_default_ticket_approval_permissions() from public, anon, authenticated;
drop trigger if exists roles_grant_default_ticket_approval_permissions on public.roles;
create trigger roles_grant_default_ticket_approval_permissions
after insert on public.roles
for each row execute function public.grant_default_ticket_approval_permissions();

-- Diese RPCs bilden die serverseitige Grundlage für zukünftige Freigabe-UI und
-- Integrationen. Sie sind ausschliesslich für Edge Functions mit Service Role
-- ausführbar, prüfen den tatsächlichen Akteur jedoch erneut gegen Mandant,
-- Ticketabteilung und explizite Berechtigung.
create or replace function public.create_ticket_approval_request(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_approval_kind text,
  p_reason text,
  p_required_approvals smallint default 1
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket record;
  v_request public.ticket_approval_requests%rowtype;
  v_approval_kind text := lower(btrim(p_approval_kind));
  v_reason text := btrim(p_reason);
begin
  if p_actor_id is null
    or p_tenant_id is null
    or p_ticket_id is null
    or v_approval_kind !~ '^[a-z][a-z0-9_]{1,62}$'
    or char_length(v_reason) not between 3 and 2000
    or v_reason ~ '[[:cntrl:]]'
    or p_required_approvals not between 1 and 10 then
    raise exception 'invalid_ticket_approval_request' using errcode = '22023';
  end if;

  select ticket.id, ticket.department_id
  into v_ticket
  from public.tickets ticket
  where ticket.id = p_ticket_id
    and ticket.tenant_id = p_tenant_id
  for share;
  if not found then
    raise exception 'ticket_not_found' using errcode = 'P0002';
  end if;

  if not public.user_has_ticket_permission_for(
    p_actor_id,
    p_tenant_id,
    v_ticket.department_id,
    'ticket.approval.request'
  ) then
    raise exception 'ticket_approval_request_denied' using errcode = '42501';
  end if;

  insert into public.ticket_approval_requests (
    tenant_id,
    ticket_id,
    approval_kind,
    required_approvals,
    requested_by,
    reason
  ) values (
    p_tenant_id,
    p_ticket_id,
    v_approval_kind,
    p_required_approvals,
    p_actor_id,
    v_reason
  ) returning * into v_request;

  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (
    p_ticket_id,
    p_actor_id,
    'ticket.approval.requested',
    jsonb_build_object(
      'approvalId', v_request.id,
      'approvalKind', v_request.approval_kind,
      'requiredApprovals', v_request.required_approvals
    )
  );

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_tenant_id,
    p_actor_id,
    'ticket.approval.requested',
    'ticket_approval_request',
    v_request.id,
    jsonb_build_object(
      'ticketId', p_ticket_id,
      'approvalKind', v_request.approval_kind,
      'requiredApprovals', v_request.required_approvals
    )
  );

  return jsonb_build_object(
    'approvalId', v_request.id,
    'status', v_request.status,
    'requiredApprovals', v_request.required_approvals
  );
end;
$$;

create or replace function public.decide_ticket_approval(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_approval_id uuid,
  p_decision text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.ticket_approval_requests%rowtype;
  v_department_id uuid;
  v_decision text := lower(btrim(p_decision));
  v_comment text := nullif(btrim(p_comment), '');
  v_approved_count integer;
  v_next_status text;
begin
  if p_actor_id is null
    or p_tenant_id is null
    or p_approval_id is null
    or v_decision not in ('approved', 'rejected')
    or (v_comment is not null and (
      char_length(v_comment) > 2000 or v_comment ~ '[[:cntrl:]]'
    )) then
    raise exception 'invalid_ticket_approval_decision' using errcode = '22023';
  end if;

  select request.*
  into v_request
  from public.ticket_approval_requests request
  where request.id = p_approval_id
    and request.tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'ticket_approval_not_found' using errcode = 'P0002';
  end if;

  select ticket.department_id
  into v_department_id
  from public.tickets ticket
  where ticket.id = v_request.ticket_id
    and ticket.tenant_id = p_tenant_id;
  if not found then
    raise exception 'ticket_approval_ticket_not_found' using errcode = 'P0002';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'ticket_approval_not_pending' using errcode = '22023';
  end if;
  if v_request.requested_by = p_actor_id then
    raise exception 'ticket_approval_self_decision_denied' using errcode = '42501';
  end if;
  if not public.user_has_ticket_permission_for(
    p_actor_id,
    p_tenant_id,
    v_department_id,
    'ticket.approval.decide'
  ) then
    raise exception 'ticket_approval_decision_denied' using errcode = '42501';
  end if;

  insert into public.ticket_approval_decisions (
    tenant_id,
    approval_id,
    approver_id,
    decision,
    comment
  ) values (
    p_tenant_id,
    p_approval_id,
    p_actor_id,
    v_decision,
    v_comment
  );

  if v_decision = 'rejected' then
    v_next_status := 'rejected';
  else
    select count(*) into v_approved_count
    from public.ticket_approval_decisions decision
    where decision.tenant_id = p_tenant_id
      and decision.approval_id = p_approval_id
      and decision.decision = 'approved';
    v_next_status := case
      when v_approved_count >= v_request.required_approvals then 'approved'
      else 'pending'
    end;
  end if;

  if v_next_status <> 'pending' then
    update public.ticket_approval_requests
    set status = v_next_status,
        decided_at = timezone('utc', now())
    where id = p_approval_id
      and tenant_id = p_tenant_id;
  end if;

  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (
    v_request.ticket_id,
    p_actor_id,
    'ticket.approval.decided',
    jsonb_build_object(
      'approvalId', p_approval_id,
      'decision', v_decision,
      'status', v_next_status,
      'requiredApprovals', v_request.required_approvals
    )
  );

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, before_data, after_data, metadata)
  values (
    p_tenant_id,
    p_actor_id,
    'ticket.approval.decided',
    'ticket_approval_request',
    p_approval_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', v_next_status),
    jsonb_build_object(
      'ticketId', v_request.ticket_id,
      'decision', v_decision,
      'requiredApprovals', v_request.required_approvals
    )
  );

  return jsonb_build_object(
    'approvalId', p_approval_id,
    'decision', v_decision,
    'status', v_next_status,
    'requiredApprovals', v_request.required_approvals
  );
end;
$$;

revoke all on function public.create_ticket_approval_request(uuid, uuid, uuid, text, text, smallint) from public, anon, authenticated;
revoke all on function public.decide_ticket_approval(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_ticket_approval_request(uuid, uuid, uuid, text, text, smallint) to service_role;
grant execute on function public.decide_ticket_approval(uuid, uuid, uuid, text, text) to service_role;

comment on table public.ticket_approval_requests is
  'Mandantenisolierte Ticketfreigaben; direkte Browserzugriffe sind verboten.';
comment on table public.ticket_approval_decisions is
  'Einzelentscheidungen zu Ticketfreigaben; jede Person kann pro Antrag nur einmal entscheiden.';
comment on function public.create_ticket_approval_request(uuid, uuid, uuid, text, text, smallint) is
  'Erstellt eine mandanten- und abteilungsgeprüfte Ticketfreigabe samt Ticket- und Auditereignis.';
comment on function public.decide_ticket_approval(uuid, uuid, uuid, text, text) is
  'Entscheidet eine Ticketfreigabe mandantenisoliert, verhindert Selbstfreigaben und protokolliert jede Entscheidung.';

commit;
