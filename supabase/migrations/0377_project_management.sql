begin;

set local search_path = pg_catalog, public;

-- Projekte: Projektmanagement auf derselben Basis wie Tickets und
-- Serviceaufgaben.
--
-- Projektaufgaben sind keine Tickets (keine SLA, keine Meldenden, keine
-- Ticketnummer), teilen aber die Infrastruktur:
--   * Zeiten liegen in ticket_time_entries (Ticket ODER Projektaufgabe).
--   * Anhänge liegen in record_attachments (Vertrag, Lizenz, Projekt oder
--     Projektaufgabe).
--   * Zuweisung über user_profiles und teams wie bei Tickets.
--   * Echte Tickets werden über project_links in den Projektplan gehängt.
--   * Die View work_items führt Projektaufgaben, Tickets und Serviceaufgaben
--     für die Auslastung zusammen.
--
-- Zugriff ausschliesslich über die Edge Function "projects" (service_role).
-- Rechte: project.read (alle Projekte sehen), project.create (Projekte
-- anlegen), project.manage (alle Projekte und Vorlagen verwalten). Zusätzlich
-- gilt die Projektmitgliedschaft (project_members), auch für externe Gäste.

-- ---------------------------------------------------------------------------
-- Modul und Rechte
-- ---------------------------------------------------------------------------

insert into public.feature_catalog (key, name, description, category, default_enabled)
values (
  'projects.management',
  'Projekte',
  'Projekte mit Phasen, Meilensteinen, Aufgaben, Zeitplan, Budget und Auslastung.',
  'ticketing',
  false
)
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    default_enabled = excluded.default_enabled;

insert into public.tenant_feature_flags (tenant_id, feature_key, enabled)
select tenant.id, 'projects.management', false
from public.tenants as tenant
on conflict (tenant_id, feature_key) do nothing;

insert into public.permissions (code, description, is_sensitive)
values
  ('project.read', 'Alle Projekte ansehen', false),
  ('project.create', 'Projekte anlegen', false),
  ('project.manage', 'Alle Projekte und Projektvorlagen verwalten', true)
on conflict (code) do update
set description = excluded.description,
    is_sensitive = excluded.is_sensitive;

create or replace function public.project_default_permissions_for_role(
  p_name text,
  p_scope text
)
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_name in ('Tenant administrator', 'ICT Mitarbeiter') and p_scope = 'tenant'
      then array['project.read', 'project.create', 'project.manage']
    when p_name = 'Support agent'
      then array['project.read']
    else array[]::text[]
  end;
$$;

insert into public.role_permissions (role_id, permission_code)
select role.id, permission_code
from public.roles as role
cross join lateral unnest(
  public.project_default_permissions_for_role(role.name, role.scope::text)
) as permission_code
where role.active
on conflict (role_id, permission_code) do nothing;

create or replace function public.grant_default_project_permissions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.active then
    insert into public.role_permissions (role_id, permission_code)
    select new.id, permission_code
    from unnest(
      public.project_default_permissions_for_role(new.name, new.scope::text)
    ) as permission_code
    on conflict (role_id, permission_code) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.grant_default_project_permissions()
  from public, anon, authenticated;

drop trigger if exists roles_grant_default_project_permissions on public.roles;
create trigger roles_grant_default_project_permissions
after insert or update of name, scope, is_system, active on public.roles
for each row execute function public.grant_default_project_permissions();

-- ---------------------------------------------------------------------------
-- Einstellungen und Nummernkreis
-- ---------------------------------------------------------------------------

create table if not exists public.project_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  -- Tickets haben keinen Aufwandswert; die Auslastung rechnet mit dieser
  -- Pauschale je offenem Ticket.
  ticket_workload_minutes integer not null default 30
    check (ticket_workload_minutes between 0 and 1440),
  -- Verfügbare Arbeitszeit je Person und Arbeitstag.
  daily_capacity_minutes integer not null default 480
    check (daily_capacity_minutes between 30 and 1440),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.project_sequences (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  calendar_year integer not null,
  last_value integer not null default 0,
  primary key (tenant_id, calendar_year)
);

create or replace function public.project_next_number(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_year integer := extract(year from timezone('Europe/Zurich', now()))::integer;
  v_value integer;
begin
  insert into public.project_sequences (tenant_id, calendar_year, last_value)
  values (p_tenant_id, v_year, 1)
  on conflict (tenant_id, calendar_year)
  do update set last_value = public.project_sequences.last_value + 1
  returning last_value into v_value;
  return format('P-%s-%s', v_year, lpad(v_value::text, 4, '0'));
end;
$$;

revoke all on function public.project_next_number(uuid) from public, anon, authenticated;
grant execute on function public.project_next_number(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Vorlagen
-- ---------------------------------------------------------------------------

create table if not exists public.project_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text check (description is null or char_length(description) <= 2000),
  -- Phasen, Aufgaben, Checklisten und Abhängigkeiten; Termine als
  -- Tagesabstand zum Projektstart. Aufbau siehe _shared/project-template.ts.
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  source_project_id uuid,
  created_by uuid references public.user_profiles(id) on delete set null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint project_templates_id_tenant_unique unique (id, tenant_id)
);

create unique index if not exists project_templates_tenant_name_unique
  on public.project_templates (tenant_id, lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- Projekte
-- ---------------------------------------------------------------------------

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_number text not null check (char_length(project_number) between 1 and 40),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 20000),
  status text not null default 'planning'
    check (status in ('planning', 'active', 'paused', 'completed')),
  health text not null default 'green' check (health in ('green', 'yellow', 'red')),
  health_note text check (health_note is null or char_length(health_note) <= 500),
  manager_id uuid references public.user_profiles(id) on delete set null,
  department_id uuid,
  customer_organization_id uuid,
  location_id uuid,
  starts_on date,
  ends_on date,
  budget_minutes integer check (budget_minutes is null or budget_minutes between 0 and 6000000),
  budget_amount_cents bigint
    check (budget_amount_cents is null or budget_amount_cents between 0 and 100000000000),
  -- Ist-Kosten = gebuchte Minuten × Stundensatz.
  hourly_rate_cents integer
    check (hourly_rate_cents is null or hourly_rate_cents between 0 and 10000000),
  currency text not null default 'CHF' check (currency ~ '^[A-Z]{3}$'),
  -- auto: Terminänderungen verschieben Nachfolger sofort.
  -- manual: Verschiebungen werden nur vorgeschlagen.
  schedule_mode text not null default 'auto' check (schedule_mode in ('auto', 'manual')),
  source_ticket_id uuid,
  source_shop_order_id uuid,
  template_id uuid,
  completed_at timestamptz,
  archived_at timestamptz,
  created_by uuid references public.user_profiles(id) on delete set null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint projects_id_tenant_unique unique (id, tenant_id),
  constraint projects_number_unique unique (tenant_id, project_number),
  constraint projects_dates_check
    check (starts_on is null or ends_on is null or ends_on >= starts_on),
  constraint projects_department_fk foreign key (department_id, tenant_id)
    references public.departments (id, tenant_id) on delete set null (department_id),
  constraint projects_customer_fk foreign key (customer_organization_id, tenant_id)
    references public.customer_organizations (id, tenant_id)
    on delete set null (customer_organization_id),
  constraint projects_location_fk foreign key (location_id, tenant_id)
    references public.asset_locations (id, tenant_id) on delete set null (location_id),
  constraint projects_source_ticket_fk foreign key (source_ticket_id, tenant_id)
    references public.tickets (id, tenant_id) on delete set null (source_ticket_id),
  constraint projects_source_shop_order_fk foreign key (source_shop_order_id, tenant_id)
    references public.shop_orders (id, tenant_id) on delete set null (source_shop_order_id),
  constraint projects_template_fk foreign key (template_id, tenant_id)
    references public.project_templates (id, tenant_id) on delete set null (template_id)
);

create index if not exists projects_tenant_status_idx
  on public.projects (tenant_id, status, ends_on) where archived_at is null;
create index if not exists projects_manager_idx
  on public.projects (tenant_id, manager_id) where manager_id is not null;
create index if not exists projects_customer_idx
  on public.projects (tenant_id, customer_organization_id)
  where customer_organization_id is not null;
create index if not exists projects_source_ticket_idx
  on public.projects (source_ticket_id) where source_ticket_id is not null;
create index if not exists projects_source_shop_order_idx
  on public.projects (source_shop_order_id) where source_shop_order_id is not null;

alter table public.project_templates
  drop constraint if exists project_templates_source_project_fk;
alter table public.project_templates
  add constraint project_templates_source_project_fk
  foreign key (source_project_id, tenant_id)
  references public.projects (id, tenant_id) on delete set null (source_project_id);

-- Mitglieder. Gäste sind aktive Mandantenmitglieder ohne Rolle; ihr Zugriff
-- ergibt sich allein aus dieser Tabelle. Endet die Mandantenmitgliedschaft,
-- endet auch der Projektzugriff.
create table if not exists public.project_members (
  project_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member'
    check (role in ('manager', 'member', 'guest_read', 'guest_comment')),
  invited_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (project_id, user_id),
  constraint project_members_project_fk foreign key (project_id, tenant_id)
    references public.projects (id, tenant_id) on delete cascade,
  constraint project_members_tenant_user_fk foreign key (tenant_id, user_id)
    references public.tenant_memberships (tenant_id, user_id) on delete cascade
);

create index if not exists project_members_user_idx
  on public.project_members (tenant_id, user_id);

-- Einladungen für Gäste, die noch kein Konto im Mandanten haben. Beim ersten
-- Anmelden löst claim_project_invitations sie ein: Mandantenmitgliedschaft
-- ohne Rolle plus Projektmitgliedschaft.
create table if not exists public.project_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null,
  email text not null
    check (email = lower(btrim(email)) and char_length(email) between 3 and 320),
  role text not null default 'guest_read' check (role in ('guest_read', 'guest_comment')),
  status text not null default 'sent' check (status in ('sent', 'accepted', 'revoked')),
  invited_by uuid references public.user_profiles(id) on delete set null,
  expires_at timestamptz not null default (timezone('utc', now()) + interval '14 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint project_invitations_project_fk foreign key (project_id, tenant_id)
    references public.projects (id, tenant_id) on delete cascade
);

create unique index if not exists project_invitations_open_unique
  on public.project_invitations (project_id, email) where status = 'sent';
create index if not exists project_invitations_email_idx
  on public.project_invitations (email, status, expires_at);

create or replace function public.claim_project_invitations(p_user_id uuid, p_email text)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_invitation public.project_invitations%rowtype;
  v_status public.membership_status;
  v_accepted integer := 0;
begin
  if p_user_id is null or p_email is null or btrim(p_email) = '' then
    return 0;
  end if;

  for v_invitation in
    select *
    from public.project_invitations as invitation
    where invitation.email = lower(btrim(p_email))
      and invitation.status = 'sent'
      and invitation.expires_at > timezone('utc', now())
    for update
  loop
    insert into public.user_profiles (id) values (p_user_id) on conflict (id) do nothing;

    select membership.status into v_status
    from public.tenant_memberships as membership
    where membership.tenant_id = v_invitation.tenant_id
      and membership.user_id = p_user_id
    for update;

    if not found then
      insert into public.tenant_memberships (tenant_id, user_id, status, joined_at)
      values (v_invitation.tenant_id, p_user_id, 'active', timezone('utc', now()));
    elsif v_status <> 'active' then
      -- Entfernte oder gesperrte Personen kommen nicht über ein Projekt zurück.
      continue;
    end if;

    insert into public.project_members (project_id, tenant_id, user_id, role, invited_by)
    values (
      v_invitation.project_id, v_invitation.tenant_id, p_user_id,
      v_invitation.role, v_invitation.invited_by
    )
    on conflict (project_id, user_id) do nothing;

    update public.project_invitations
    set status = 'accepted', accepted_at = timezone('utc', now())
    where id = v_invitation.id;
    v_accepted := v_accepted + 1;
  end loop;

  return v_accepted;
end;
$$;

revoke all on function public.claim_project_invitations(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_project_invitations(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Projektstruktur: Phase / Meilenstein -> Arbeitspaket -> Unteraufgabe
-- ---------------------------------------------------------------------------

create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null,
  parent_task_id uuid,
  kind text not null default 'task' check (kind in ('phase', 'milestone', 'task')),
  title text not null check (char_length(btrim(title)) between 1 and 240),
  description text check (description is null or char_length(description) <= 20000),
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'blocked', 'done')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  assignee_id uuid references public.user_profiles(id) on delete set null,
  team_id uuid,
  starts_on date,
  due_on date,
  estimated_minutes integer
    check (estimated_minutes is null or estimated_minutes between 0 and 600000),
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  position integer not null default 0,
  completed_at timestamptz,
  completed_by uuid references public.user_profiles(id) on delete set null,
  created_by uuid references public.user_profiles(id) on delete set null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint project_tasks_id_tenant_unique unique (id, tenant_id),
  constraint project_tasks_id_project_unique unique (id, project_id),
  constraint project_tasks_dates_check
    check (starts_on is null or due_on is null or due_on >= starts_on),
  -- Ein Meilenstein ist ein Zeitpunkt.
  constraint project_tasks_milestone_date_check
    check (kind <> 'milestone' or starts_on is null or starts_on = due_on),
  constraint project_tasks_not_own_parent check (parent_task_id is null or parent_task_id <> id),
  constraint project_tasks_project_fk foreign key (project_id, tenant_id)
    references public.projects (id, tenant_id) on delete cascade,
  -- Eltern und Kind gehören immer zum selben Projekt.
  constraint project_tasks_parent_fk foreign key (parent_task_id, project_id)
    references public.project_tasks (id, project_id) on delete cascade,
  constraint project_tasks_team_fk foreign key (team_id, tenant_id)
    references public.teams (id, tenant_id) on delete set null (team_id)
);

create index if not exists project_tasks_project_idx
  on public.project_tasks (project_id, parent_task_id, position, created_at);
create index if not exists project_tasks_assignee_idx
  on public.project_tasks (tenant_id, assignee_id, due_on)
  where assignee_id is not null and status <> 'done';
create index if not exists project_tasks_parent_idx
  on public.project_tasks (parent_task_id) where parent_task_id is not null;

-- Erlaubte Hierarchie:
--   Phase        -> oberste Ebene
--   Meilenstein  -> oberste Ebene oder in einer Phase, ohne Kinder
--   Aufgabe      -> oberste Ebene, in einer Phase oder als Unteraufgabe einer
--                   Aufgabe; Unteraufgaben haben keine eigenen Kinder
create or replace function public.project_tasks_enforce_hierarchy()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_parent_kind text;
  v_parent_parent_kind text;
  v_has_children boolean;
begin
  if tg_op = 'UPDATE'
     and new.kind is not distinct from old.kind
     and new.parent_task_id is not distinct from old.parent_task_id then
    return new;
  end if;

  v_has_children := exists (
    select 1 from public.project_tasks as child where child.parent_task_id = new.id
  );

  if tg_op = 'UPDATE' and new.kind <> old.kind and v_has_children then
    raise exception 'project_task_kind_locked'
      using errcode = '23514',
            detail = 'Die Art eines Elements mit untergeordneten Elementen kann nicht geändert werden.';
  end if;

  if new.parent_task_id is null then
    return new;
  end if;

  select parent.kind, grandparent.kind
    into v_parent_kind, v_parent_parent_kind
  from public.project_tasks as parent
  left join public.project_tasks as grandparent on grandparent.id = parent.parent_task_id
  where parent.id = new.parent_task_id;

  if new.kind = 'phase' then
    raise exception 'project_task_hierarchy_invalid'
      using errcode = '23514', detail = 'Eine Phase steht immer auf der obersten Ebene.';
  end if;

  if v_parent_kind = 'milestone' then
    raise exception 'project_task_hierarchy_invalid'
      using errcode = '23514', detail = 'Ein Meilenstein kann keine untergeordneten Elemente haben.';
  end if;

  if new.kind = 'milestone' and v_parent_kind <> 'phase' then
    raise exception 'project_task_hierarchy_invalid'
      using errcode = '23514', detail = 'Ein Meilenstein gehört auf die oberste Ebene oder in eine Phase.';
  end if;

  if new.kind = 'task' and v_parent_kind = 'task' then
    if v_parent_parent_kind = 'task' then
      raise exception 'project_task_hierarchy_invalid'
        using errcode = '23514', detail = 'Unteraufgaben können keine eigenen Unteraufgaben haben.';
    end if;
    if v_has_children then
      raise exception 'project_task_hierarchy_invalid'
        using errcode = '23514',
              detail = 'Eine Aufgabe mit Unteraufgaben kann nicht selbst Unteraufgabe werden.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists project_tasks_hierarchy on public.project_tasks;
create trigger project_tasks_hierarchy
before insert or update of kind, parent_task_id on public.project_tasks
for each row execute function public.project_tasks_enforce_hierarchy();

create table if not exists public.project_task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  task_id uuid not null,
  description text not null check (char_length(btrim(description)) between 1 and 500),
  position integer not null default 0,
  completed_at timestamptz,
  completed_by uuid references public.user_profiles(id) on delete set null,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint project_task_checklist_items_task_fk foreign key (task_id, tenant_id)
    references public.project_tasks (id, tenant_id) on delete cascade
);

create index if not exists project_task_checklist_items_task_idx
  on public.project_task_checklist_items (task_id, position, created_at);

-- Abhängigkeiten zwischen Elementen desselben Projekts.
create table if not exists public.project_task_dependencies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null,
  predecessor_id uuid not null,
  successor_id uuid not null,
  dependency_type text not null default 'finish_to_start' check (dependency_type in (
    'finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish'
  )),
  -- Abstand in Arbeitstagen; negativ = Überlappung.
  lag_days integer not null default 0 check (lag_days between -365 and 365),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint project_task_dependencies_distinct check (predecessor_id <> successor_id),
  constraint project_task_dependencies_pair_unique unique (predecessor_id, successor_id),
  constraint project_task_dependencies_project_fk foreign key (project_id, tenant_id)
    references public.projects (id, tenant_id) on delete cascade,
  constraint project_task_dependencies_predecessor_fk foreign key (predecessor_id, project_id)
    references public.project_tasks (id, project_id) on delete cascade,
  constraint project_task_dependencies_successor_fk foreign key (successor_id, project_id)
    references public.project_tasks (id, project_id) on delete cascade
);

create index if not exists project_task_dependencies_project_idx
  on public.project_task_dependencies (project_id);
create index if not exists project_task_dependencies_successor_idx
  on public.project_task_dependencies (successor_id);

-- Zyklen würden die Terminberechnung endlos laufen lassen.
create or replace function public.project_task_dependencies_reject_cycle()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- Serialisiert gleichzeitige Änderungen am Abhängigkeitsnetz eines Projekts.
  perform 1 from public.projects where id = new.project_id for update;

  if exists (
    with recursive downstream as (
      select dependency.successor_id as task_id
      from public.project_task_dependencies as dependency
      where dependency.predecessor_id = new.successor_id
        and dependency.id <> new.id
      union
      select dependency.successor_id
      from public.project_task_dependencies as dependency
      join downstream on downstream.task_id = dependency.predecessor_id
      where dependency.id <> new.id
    )
    select 1 from downstream where task_id = new.predecessor_id
  ) then
    raise exception 'project_dependency_cycle'
      using errcode = '23514', detail = 'Die Abhängigkeit würde einen Kreis bilden.';
  end if;
  return new;
end;
$$;

drop trigger if exists project_task_dependencies_cycle on public.project_task_dependencies;
create trigger project_task_dependencies_cycle
before insert or update of predecessor_id, successor_id on public.project_task_dependencies
for each row execute function public.project_task_dependencies_reject_cycle();

-- ---------------------------------------------------------------------------
-- Gemeinsame Zeiterfassung: ein Eintrag gehört zu einem Ticket ODER zu einer
-- Projektaufgabe. Die bestehende Leserichtlinie (can_read_internal_note über
-- ticket_id) gibt Projektzeiten nicht an Clients frei; sie laufen über die
-- Edge Function.
-- ---------------------------------------------------------------------------

alter table public.ticket_time_entries
  alter column ticket_id drop not null;
alter table public.ticket_time_entries
  add column if not exists project_task_id uuid
  references public.project_tasks(id) on delete cascade;
alter table public.ticket_time_entries
  drop constraint if exists ticket_time_entries_one_parent;
alter table public.ticket_time_entries
  add constraint ticket_time_entries_one_parent
  check (num_nonnulls(ticket_id, project_task_id) = 1);

create index if not exists ticket_time_entries_project_task_idx
  on public.ticket_time_entries (project_task_id, created_at desc)
  where project_task_id is not null;

-- ---------------------------------------------------------------------------
-- Verknüpfungen zu Tickets, Shop-Bestellungen, IPAM, Monitoring, Geräten,
-- Störungen und Serviceaufgaben
-- ---------------------------------------------------------------------------

create unique index if not exists monitoring_sensors_tenant_id_unique
  on public.monitoring_sensors (tenant_id, id);
create unique index if not exists monitoring_incidents_tenant_id_unique
  on public.monitoring_incidents (tenant_id, id);
create unique index if not exists service_task_occurrences_tenant_id_unique
  on public.service_task_occurrences (tenant_id, id);

create table if not exists public.project_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null,
  -- null = am Projekt, sonst an einem Element des Projektplans.
  task_id uuid,
  target_kind text not null check (target_kind in (
    'ticket', 'shop_order', 'ipam_prefix', 'ipam_vlan', 'ipam_address',
    'monitoring_sensor', 'asset', 'monitoring_incident', 'service_task'
  )),
  ticket_id uuid,
  shop_order_id uuid,
  ipam_prefix_id uuid,
  ipam_vlan_id uuid,
  ipam_address_id uuid,
  monitoring_sensor_id uuid,
  asset_id uuid,
  monitoring_incident_id uuid,
  service_task_occurrence_id uuid,
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint project_links_one_target check (
    num_nonnulls(
      ticket_id, shop_order_id, ipam_prefix_id, ipam_vlan_id, ipam_address_id,
      monitoring_sensor_id, asset_id, monitoring_incident_id,
      service_task_occurrence_id
    ) = 1
    and case target_kind
      when 'ticket' then ticket_id is not null
      when 'shop_order' then shop_order_id is not null
      when 'ipam_prefix' then ipam_prefix_id is not null
      when 'ipam_vlan' then ipam_vlan_id is not null
      when 'ipam_address' then ipam_address_id is not null
      when 'monitoring_sensor' then monitoring_sensor_id is not null
      when 'asset' then asset_id is not null
      when 'monitoring_incident' then monitoring_incident_id is not null
      when 'service_task' then service_task_occurrence_id is not null
      else false
    end
  ),
  constraint project_links_project_fk foreign key (project_id, tenant_id)
    references public.projects (id, tenant_id) on delete cascade,
  constraint project_links_task_fk foreign key (task_id, project_id)
    references public.project_tasks (id, project_id) on delete cascade,
  constraint project_links_ticket_fk foreign key (ticket_id, tenant_id)
    references public.tickets (id, tenant_id) on delete cascade,
  constraint project_links_shop_order_fk foreign key (shop_order_id, tenant_id)
    references public.shop_orders (id, tenant_id) on delete cascade,
  constraint project_links_ipam_prefix_fk foreign key (ipam_prefix_id, tenant_id)
    references public.ipam_prefixes (id, tenant_id) on delete cascade,
  constraint project_links_ipam_vlan_fk foreign key (ipam_vlan_id, tenant_id)
    references public.ipam_vlans (id, tenant_id) on delete cascade,
  constraint project_links_ipam_address_fk foreign key (ipam_address_id, tenant_id)
    references public.ipam_addresses (id, tenant_id) on delete cascade,
  constraint project_links_monitoring_sensor_fk foreign key (monitoring_sensor_id, tenant_id)
    references public.monitoring_sensors (id, tenant_id) on delete cascade,
  constraint project_links_asset_fk foreign key (asset_id, tenant_id)
    references public.assets (id, tenant_id) on delete cascade,
  constraint project_links_monitoring_incident_fk
    foreign key (monitoring_incident_id, tenant_id)
    references public.monitoring_incidents (id, tenant_id) on delete cascade,
  constraint project_links_service_task_fk
    foreign key (service_task_occurrence_id, tenant_id)
    references public.service_task_occurrences (id, tenant_id) on delete cascade
);

-- Ein Ticket gehört höchstens zu einem Projekt, damit seine Zeiten nicht
-- doppelt in den Soll-Ist-Vergleich einfliessen.
create unique index if not exists project_links_ticket_unique
  on public.project_links (ticket_id) where ticket_id is not null;
create unique index if not exists project_links_target_unique
  on public.project_links (
    project_id,
    coalesce(task_id, '00000000-0000-0000-0000-000000000000'::uuid),
    target_kind,
    coalesce(
      shop_order_id, ipam_prefix_id, ipam_vlan_id, ipam_address_id,
      monitoring_sensor_id, asset_id, monitoring_incident_id,
      service_task_occurrence_id
    )
  )
  where ticket_id is null;
create index if not exists project_links_project_idx
  on public.project_links (project_id, task_id);
create index if not exists project_links_shop_order_idx
  on public.project_links (shop_order_id) where shop_order_id is not null;
create index if not exists project_links_ipam_prefix_idx
  on public.project_links (ipam_prefix_id) where ipam_prefix_id is not null;
create index if not exists project_links_ipam_vlan_idx
  on public.project_links (ipam_vlan_id) where ipam_vlan_id is not null;
create index if not exists project_links_ipam_address_idx
  on public.project_links (ipam_address_id) where ipam_address_id is not null;
create index if not exists project_links_monitoring_sensor_idx
  on public.project_links (monitoring_sensor_id) where monitoring_sensor_id is not null;
create index if not exists project_links_asset_idx
  on public.project_links (asset_id) where asset_id is not null;
create index if not exists project_links_monitoring_incident_idx
  on public.project_links (monitoring_incident_id)
  where monitoring_incident_id is not null;
create index if not exists project_links_service_task_idx
  on public.project_links (service_task_occurrence_id)
  where service_task_occurrence_id is not null;

-- ---------------------------------------------------------------------------
-- Dokumentation, Kommentare, Verlauf
-- ---------------------------------------------------------------------------

create table if not exists public.project_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  -- Markdown.
  body text not null default '' check (char_length(body) <= 200000),
  -- Für Gäste sichtbar?
  visibility public.comment_visibility not null default 'internal',
  position integer not null default 0,
  created_by uuid references public.user_profiles(id) on delete set null,
  updated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint project_documents_project_fk foreign key (project_id, tenant_id)
    references public.projects (id, tenant_id) on delete cascade
);

create index if not exists project_documents_project_idx
  on public.project_documents (project_id, position, created_at);

-- Kommentare am Projekt (task_id null) oder an einem Element. "external" ist
-- auch für Gäste sichtbar, "internal" nur für Mitarbeitende des Projekts.
create table if not exists public.project_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null,
  task_id uuid,
  author_id uuid references public.user_profiles(id) on delete set null,
  visibility public.comment_visibility not null default 'internal',
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  edited_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint project_comments_project_fk foreign key (project_id, tenant_id)
    references public.projects (id, tenant_id) on delete cascade,
  constraint project_comments_task_fk foreign key (task_id, project_id)
    references public.project_tasks (id, project_id) on delete cascade
);

create index if not exists project_comments_project_idx
  on public.project_comments (project_id, task_id, created_at);

create table if not exists public.project_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null,
  -- Bewusst ohne Fremdschlüssel: der Verlauf bleibt nach dem Löschen eines
  -- Elements lesbar.
  task_id uuid,
  actor_id uuid references public.user_profiles(id) on delete set null,
  event_type text not null check (char_length(event_type) between 1 and 80),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint project_events_project_fk foreign key (project_id, tenant_id)
    references public.projects (id, tenant_id) on delete cascade
);

create index if not exists project_events_project_idx
  on public.project_events (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Gemeinsame Anhänge: Vertrag, Lizenz, Projekt oder Projektaufgabe.
-- ---------------------------------------------------------------------------

alter table public.record_attachments
  add column if not exists project_id uuid,
  add column if not exists project_task_id uuid;

alter table public.record_attachments
  drop constraint if exists record_attachments_one_parent;
alter table public.record_attachments
  add constraint record_attachments_one_parent
  check (num_nonnulls(contract_id, license_id, project_id, project_task_id) = 1);

alter table public.record_attachments
  drop constraint if exists record_attachments_project_fk,
  drop constraint if exists record_attachments_project_task_fk;
alter table public.record_attachments
  add constraint record_attachments_project_fk
    foreign key (project_id, tenant_id)
    references public.projects (id, tenant_id) on delete cascade,
  add constraint record_attachments_project_task_fk
    foreign key (project_task_id, tenant_id)
    references public.project_tasks (id, tenant_id) on delete cascade;

create index if not exists record_attachments_project_idx
  on public.record_attachments (tenant_id, project_id) where project_id is not null;
create index if not exists record_attachments_project_task_idx
  on public.record_attachments (tenant_id, project_task_id)
  where project_task_id is not null;

comment on table public.record_attachments is
  'Metadata for images and PDFs attached to contracts, licenses, projects and project tasks. Files live in the private record-attachments bucket; access only through Edge Functions.';

-- ---------------------------------------------------------------------------
-- Zeitstempel, Zugriff
-- ---------------------------------------------------------------------------

drop trigger if exists project_settings_updated_at on public.project_settings;
create trigger project_settings_updated_at before update on public.project_settings
for each row execute function public.set_updated_at();
drop trigger if exists project_templates_updated_at on public.project_templates;
create trigger project_templates_updated_at before update on public.project_templates
for each row execute function public.set_updated_at();
drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at before update on public.projects
for each row execute function public.set_updated_at();
drop trigger if exists project_tasks_updated_at on public.project_tasks;
create trigger project_tasks_updated_at before update on public.project_tasks
for each row execute function public.set_updated_at();
drop trigger if exists project_documents_updated_at on public.project_documents;
create trigger project_documents_updated_at before update on public.project_documents
for each row execute function public.set_updated_at();

alter table public.project_settings enable row level security;
alter table public.project_sequences enable row level security;
alter table public.project_templates enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_invitations enable row level security;
alter table public.project_tasks enable row level security;
alter table public.project_task_checklist_items enable row level security;
alter table public.project_task_dependencies enable row level security;
alter table public.project_links enable row level security;
alter table public.project_documents enable row level security;
alter table public.project_comments enable row level security;
alter table public.project_events enable row level security;

revoke all on table
  public.project_settings,
  public.project_sequences,
  public.project_templates,
  public.projects,
  public.project_members,
  public.project_invitations,
  public.project_tasks,
  public.project_task_checklist_items,
  public.project_task_dependencies,
  public.project_links,
  public.project_documents,
  public.project_comments,
  public.project_events
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.project_settings,
  public.project_sequences,
  public.project_templates,
  public.projects,
  public.project_members,
  public.project_invitations,
  public.project_tasks,
  public.project_task_checklist_items,
  public.project_task_dependencies,
  public.project_links,
  public.project_documents,
  public.project_comments,
  public.project_events
to service_role;

-- ---------------------------------------------------------------------------
-- work_items: einheitliche Sicht auf alles, was einer Person Arbeit macht.
-- Grundlage der Auslastung. Nur für service_role.
-- ---------------------------------------------------------------------------

create or replace view public.work_items
with (security_invoker = true)
as
select
  task.tenant_id,
  'project_task'::text as kind,
  task.id,
  task.project_id,
  project.department_id,
  task.title,
  task.assignee_id,
  task.team_id,
  task.starts_on,
  task.due_on,
  task.estimated_minutes,
  task.progress_percent,
  (
    task.status <> 'done'
    and project.status in ('planning', 'active')
    and project.archived_at is null
  ) as is_open
from public.project_tasks as task
join public.projects as project on project.id = task.project_id
where task.kind = 'task'
union all
select
  ticket.tenant_id,
  'ticket'::text,
  ticket.id,
  link.project_id,
  ticket.department_id,
  ticket.subject,
  ticket.assigned_agent_id,
  ticket.assigned_team_id,
  (ticket.created_at at time zone tenant.timezone)::date,
  (coalesce(ticket.resolution_due_at, ticket.due_at) at time zone tenant.timezone)::date,
  null::integer,
  0,
  not status.is_closed
from public.tickets as ticket
join public.tenants as tenant on tenant.id = ticket.tenant_id
join public.ticket_statuses as status on status.id = ticket.status_id
left join public.project_links as link on link.ticket_id = ticket.id
where ticket.deleted_at is null
  and ticket.spam_at is null
union all
select
  occurrence.tenant_id,
  'service_task'::text,
  occurrence.id,
  task_link.project_id,
  template.department_id,
  template.title,
  coalesce(occurrence.assignee_id, template.assignee_id),
  template.team_id,
  occurrence.visible_from,
  occurrence.due_on,
  template.estimated_minutes,
  0,
  occurrence.status in ('open', 'in_progress')
from public.service_task_occurrences as occurrence
join public.service_task_templates as template on template.id = occurrence.template_id
left join lateral (
  select link.project_id
  from public.project_links as link
  where link.service_task_occurrence_id = occurrence.id
  order by link.created_at
  limit 1
) as task_link on true;

revoke all on table public.work_items from public, anon, authenticated;
grant select on table public.work_items to service_role;

-- ---------------------------------------------------------------------------
-- Auswertungen und Suche für die Edge Function
-- ---------------------------------------------------------------------------

-- Kennzahlen je Projekt für das Multiprojekt-Dashboard. Fortschritt über
-- Aufgaben ohne Unteraufgaben, gewichtet nach Schätzung (ohne Schätzung:
-- eine Stunde). Gebuchte Zeit umfasst verknüpfte Tickets.
create or replace function public.project_stats(p_tenant_id uuid, p_project_ids uuid[])
returns table (
  project_id uuid,
  task_count integer,
  done_count integer,
  progress_percent integer,
  estimated_minutes bigint,
  booked_minutes bigint,
  overdue_tasks integer,
  overdue_milestones integer,
  next_milestone_title text,
  next_milestone_on date,
  latest_due_on date
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with today as (
    select (timezone(tenant.timezone, now()))::date as day
    from public.tenants as tenant
    where tenant.id = p_tenant_id
  ),
  scope as (
    select project.id
    from public.projects as project
    where project.tenant_id = p_tenant_id
      and (p_project_ids is null or project.id = any (p_project_ids))
  ),
  leaf as (
    select task.*
    from public.project_tasks as task
    join scope on scope.id = task.project_id
    where task.kind = 'task'
      and not exists (
        select 1 from public.project_tasks as child where child.parent_task_id = task.id
      )
  ),
  leaf_stats as (
    select
      leaf.project_id,
      count(*)::integer as task_count,
      count(*) filter (where leaf.status = 'done')::integer as done_count,
      round(
        sum(
          coalesce(nullif(leaf.estimated_minutes, 0), 60)
          * case when leaf.status = 'done' then 100 else leaf.progress_percent end
        )::numeric
        / nullif(sum(coalesce(nullif(leaf.estimated_minutes, 0), 60)), 0)
      )::integer as progress_percent,
      coalesce(sum(leaf.estimated_minutes), 0)::bigint as estimated_minutes,
      count(*) filter (
        where leaf.status <> 'done' and leaf.due_on < (select day from today)
      )::integer as overdue_tasks
    from leaf
    group by leaf.project_id
  ),
  milestone_stats as (
    select
      task.project_id,
      count(*) filter (
        where task.status <> 'done' and task.due_on < (select day from today)
      )::integer as overdue_milestones
    from public.project_tasks as task
    join scope on scope.id = task.project_id
    where task.kind = 'milestone'
    group by task.project_id
  ),
  next_milestone as (
    select distinct on (task.project_id) task.project_id, task.title, task.due_on
    from public.project_tasks as task
    join scope on scope.id = task.project_id
    where task.kind = 'milestone' and task.status <> 'done' and task.due_on is not null
    order by task.project_id, task.due_on, task.position
  ),
  latest as (
    select task.project_id, max(coalesce(task.due_on, task.starts_on)) as latest_due_on
    from public.project_tasks as task
    join scope on scope.id = task.project_id
    group by task.project_id
  ),
  booked as (
    select project_id, sum(minutes)::bigint as booked_minutes
    from (
      select task.project_id, entry.minutes
      from public.ticket_time_entries as entry
      join public.project_tasks as task on task.id = entry.project_task_id
      join scope on scope.id = task.project_id
      union all
      select link.project_id, entry.minutes
      from public.project_links as link
      join scope on scope.id = link.project_id
      join public.ticket_time_entries as entry on entry.ticket_id = link.ticket_id
    ) as entries
    group by project_id
  )
  select
    scope.id,
    coalesce(leaf_stats.task_count, 0),
    coalesce(leaf_stats.done_count, 0),
    coalesce(leaf_stats.progress_percent, 0),
    coalesce(leaf_stats.estimated_minutes, 0),
    coalesce(booked.booked_minutes, 0),
    coalesce(leaf_stats.overdue_tasks, 0),
    coalesce(milestone_stats.overdue_milestones, 0),
    next_milestone.title,
    next_milestone.due_on,
    latest.latest_due_on
  from scope
  left join leaf_stats on leaf_stats.project_id = scope.id
  left join milestone_stats on milestone_stats.project_id = scope.id
  left join next_milestone on next_milestone.project_id = scope.id
  left join latest on latest.project_id = scope.id
  left join booked on booked.project_id = scope.id;
$$;

-- Ziel einer Verknüpfung in lesbarer Form.
create or replace function public.project_link_details(p_tenant_id uuid, p_project_id uuid)
returns table (
  link_id uuid,
  task_id uuid,
  target_kind text,
  target_id uuid,
  label text,
  detail text,
  state text,
  is_closed boolean,
  assignee_id uuid,
  booked_minutes bigint,
  note text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    link.id,
    link.task_id,
    link.target_kind,
    coalesce(
      link.ticket_id, link.shop_order_id, link.ipam_prefix_id, link.ipam_vlan_id,
      link.ipam_address_id, link.monitoring_sensor_id, link.asset_id,
      link.monitoring_incident_id, link.service_task_occurrence_id
    ),
    case link.target_kind
      when 'ticket' then ticket.ticket_number
      when 'shop_order' then shop_order.order_number
      when 'ipam_prefix' then prefix.prefix::text
      when 'ipam_vlan' then 'VLAN ' || vlan.vlan_number::text
      when 'ipam_address' then host(address.address)
      when 'monitoring_sensor' then sensor.name
      when 'asset' then asset.name
      when 'monitoring_incident' then incident.number
      when 'service_task' then task_template.title
    end,
    case link.target_kind
      when 'ticket' then ticket.subject
      when 'shop_order' then null
      when 'ipam_prefix' then prefix.description
      when 'ipam_vlan' then vlan.name
      when 'ipam_address' then coalesce(address.hostname, address.dns_name)
      when 'monitoring_sensor' then sensor_asset.name
      when 'asset' then asset.asset_tag
      when 'monitoring_incident' then incident.title
      when 'service_task' then to_char(occurrence.due_on, 'DD.MM.YYYY')
    end,
    case link.target_kind
      when 'ticket' then status.label
      when 'shop_order' then shop_order.status
      when 'ipam_prefix' then prefix.status
      when 'ipam_address' then address.status
      when 'monitoring_sensor' then sensor.kind
      when 'asset' then asset.status
      when 'monitoring_incident' then incident.state
      when 'service_task' then occurrence.status
    end,
    coalesce(
      status.is_closed,
      incident.state in ('resolved', 'closed'),
      occurrence.status in ('done', 'skipped'),
      false
    ),
    coalesce(
      ticket.assigned_agent_id, incident.assigned_agent_id,
      occurrence.assignee_id, task_template.assignee_id
    ),
    coalesce((
      select sum(entry.minutes) from public.ticket_time_entries as entry
      where entry.ticket_id = link.ticket_id
    ), 0)::bigint,
    link.note,
    link.created_at
  from public.project_links as link
  left join public.tickets as ticket on ticket.id = link.ticket_id
  left join public.ticket_statuses as status on status.id = ticket.status_id
  left join public.shop_orders as shop_order on shop_order.id = link.shop_order_id
  left join public.ipam_prefixes as prefix on prefix.id = link.ipam_prefix_id
  left join public.ipam_vlans as vlan on vlan.id = link.ipam_vlan_id
  left join public.ipam_addresses as address on address.id = link.ipam_address_id
  left join public.monitoring_sensors as sensor on sensor.id = link.monitoring_sensor_id
  left join public.assets as sensor_asset on sensor_asset.id = sensor.asset_id
  left join public.assets as asset on asset.id = link.asset_id
  left join public.monitoring_incidents as incident on incident.id = link.monitoring_incident_id
  left join public.service_task_occurrences as occurrence
    on occurrence.id = link.service_task_occurrence_id
  left join public.service_task_templates as task_template
    on task_template.id = occurrence.template_id
  where link.tenant_id = p_tenant_id
    and link.project_id = p_project_id
  order by link.created_at;
$$;

-- Suche nach verknüpfbaren Einträgen (ohne Tickets; die laufen über die
-- Ticketrechte der Person). Die Rechteprüfung je Art macht die Edge Function.
create or replace function public.project_search_link_targets(
  p_tenant_id uuid,
  p_kind text,
  p_query text
)
returns table (target_id uuid, label text, detail text)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with needle as (select lower(btrim(coalesce(p_query, ''))) as q)
  select found.target_id, found.label, found.detail
  from (
    select shop_order.id as target_id, shop_order.order_number as label,
           shop_order.status as detail, shop_order.created_at as sort_at
    from public.shop_orders as shop_order
    where p_kind = 'shop_order' and shop_order.tenant_id = p_tenant_id
    union all
    select prefix.id, prefix.prefix::text, prefix.description, prefix.created_at
    from public.ipam_prefixes as prefix
    where p_kind = 'ipam_prefix' and prefix.tenant_id = p_tenant_id
    union all
    select vlan.id, 'VLAN ' || vlan.vlan_number::text, vlan.name, vlan.created_at
    from public.ipam_vlans as vlan
    where p_kind = 'ipam_vlan' and vlan.tenant_id = p_tenant_id
    union all
    select address.id, host(address.address),
           coalesce(address.hostname, address.dns_name), address.created_at
    from public.ipam_addresses as address
    where p_kind = 'ipam_address' and address.tenant_id = p_tenant_id
    union all
    select sensor.id, sensor.name, asset.name, sensor.created_at
    from public.monitoring_sensors as sensor
    join public.assets as asset on asset.id = sensor.asset_id
    where p_kind = 'monitoring_sensor' and sensor.tenant_id = p_tenant_id
    union all
    select asset.id, asset.name, asset.asset_tag, asset.created_at
    from public.assets as asset
    where p_kind = 'asset' and asset.tenant_id = p_tenant_id
    union all
    select incident.id, incident.number, incident.title, incident.opened_at
    from public.monitoring_incidents as incident
    where p_kind = 'monitoring_incident' and incident.tenant_id = p_tenant_id
    union all
    select occurrence.id, template.title,
           to_char(occurrence.due_on, 'DD.MM.YYYY') || ' · ' || occurrence.status,
           occurrence.due_at
    from public.service_task_occurrences as occurrence
    join public.service_task_templates as template on template.id = occurrence.template_id
    where p_kind = 'service_task' and occurrence.tenant_id = p_tenant_id
      and occurrence.status in ('open', 'in_progress')
  ) as found, needle
  where needle.q = ''
     or position(needle.q in lower(found.label)) > 0
     or position(needle.q in lower(coalesce(found.detail, ''))) > 0
  order by found.sort_at desc
  limit 20;
$$;

revoke all on function public.project_stats(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.project_link_details(uuid, uuid) from public, anon, authenticated;
revoke all on function public.project_search_link_targets(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.project_stats(uuid, uuid[]) to service_role;
grant execute on function public.project_link_details(uuid, uuid) to service_role;
grant execute on function public.project_search_link_targets(uuid, text, text) to service_role;

comment on view public.work_items is
  'Projektaufgaben, Tickets und Serviceaufgaben in einer Form (Zuweisung, Zeitraum, Aufwand). Grundlage der Auslastung; nur über Edge Functions.';
comment on table public.projects is
  'Projekte. Zugriff ausschliesslich über die Edge Function "projects".';
comment on table public.project_tasks is
  'Projektstruktur: Phasen, Meilensteine, Arbeitspakete und Unteraufgaben in einer Tabelle (kind, parent_task_id).';
comment on column public.ticket_time_entries.project_task_id is
  'Gesetzt, wenn die Zeit auf eine Projektaufgabe statt auf ein Ticket gebucht wurde.';

commit;
