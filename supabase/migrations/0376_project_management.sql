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
-- Verknüpfungen zu Tickets, Shop-Bestellungen, IPAM, Monitoring und Geräten
-- ---------------------------------------------------------------------------

create unique index if not exists monitoring_sensors_tenant_id_unique
  on public.monitoring_sensors (tenant_id, id);

create table if not exists public.project_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null,
  -- null = am Projekt, sonst an einem Element des Projektplans.
  task_id uuid,
  target_kind text not null check (target_kind in (
    'ticket', 'shop_order', 'ipam_prefix', 'ipam_vlan', 'ipam_address',
    'monitoring_sensor', 'asset'
  )),
  ticket_id uuid,
  shop_order_id uuid,
  ipam_prefix_id uuid,
  ipam_vlan_id uuid,
  ipam_address_id uuid,
  monitoring_sensor_id uuid,
  asset_id uuid,
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint project_links_one_target check (
    num_nonnulls(
      ticket_id, shop_order_id, ipam_prefix_id, ipam_vlan_id, ipam_address_id,
      monitoring_sensor_id, asset_id
    ) = 1
    and case target_kind
      when 'ticket' then ticket_id is not null
      when 'shop_order' then shop_order_id is not null
      when 'ipam_prefix' then ipam_prefix_id is not null
      when 'ipam_vlan' then ipam_vlan_id is not null
      when 'ipam_address' then ipam_address_id is not null
      when 'monitoring_sensor' then monitoring_sensor_id is not null
      when 'asset' then asset_id is not null
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
    references public.assets (id, tenant_id) on delete cascade
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
      monitoring_sensor_id, asset_id
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
  null::uuid,
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
join public.service_task_templates as template on template.id = occurrence.template_id;

revoke all on table public.work_items from public, anon, authenticated;
grant select on table public.work_items to service_role;

comment on view public.work_items is
  'Projektaufgaben, Tickets und Serviceaufgaben in einer Form (Zuweisung, Zeitraum, Aufwand). Grundlage der Auslastung; nur über Edge Functions.';
comment on table public.projects is
  'Projekte. Zugriff ausschliesslich über die Edge Function "projects".';
comment on table public.project_tasks is
  'Projektstruktur: Phasen, Meilensteine, Arbeitspakete und Unteraufgaben in einer Tabelle (kind, parent_task_id).';
comment on column public.ticket_time_entries.project_task_id is
  'Gesetzt, wenn die Zeit auf eine Projektaufgabe statt auf ein Ticket gebucht wurde.';

commit;
