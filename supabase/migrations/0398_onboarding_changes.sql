begin;

set local search_path = pg_catalog, public;

-- Mutationen: neben Eintritt und Austritt gibt es die Art «Mutation»
-- (kind = 'change'), z. B. Namensänderung nach Heirat oder Wechsel der
-- Abteilung. Eine Mutation hat eine oder mehrere Mutationsarten:
--   name               Namensänderung
--   department         Abteilung/Angebot
--   function           Funktion/Rolle
--   location_workload  Standort/Pensum
-- Bisherige und neue Werte stehen in «details». Die Aufgaben kommen aus
-- onboarding_change_tasks (Vorlage pro Mutationsart, pro Mandant anpassbar)
-- und aus den Abteilungsaufgaben der Art «Mutation».

alter table public.onboarding_entries
  drop constraint if exists onboarding_entries_kind_check;
alter table public.onboarding_entries
  add constraint onboarding_entries_kind_check
  check (kind in ('onboarding', 'offboarding', 'change'));

alter table public.onboarding_department_tasks
  drop constraint if exists onboarding_department_tasks_kind_check;
alter table public.onboarding_department_tasks
  add constraint onboarding_department_tasks_kind_check
  check (kind in ('onboarding', 'offboarding', 'change'));

-- Mutationen brauchen keine Onboarding-Vorlage.
alter table public.onboarding_entries
  alter column template_id drop not null;

alter table public.onboarding_entries
  add column if not exists change_types text[] not null default '{}'::text[];

alter table public.onboarding_entries
  drop constraint if exists onboarding_entries_change_types_check;
alter table public.onboarding_entries
  add constraint onboarding_entries_change_types_check
  check (
    change_types <@ array['name', 'department', 'function', 'location_workload']::text[]
    and (kind = 'change') = (cardinality(change_types) > 0)
  );

create table if not exists public.onboarding_change_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  change_type text not null
    check (change_type in ('name', 'department', 'function', 'location_workload')),
  title text not null check (char_length(btrim(title)) between 3 and 200),
  due_offset_days integer not null default 0 check (due_offset_days between -90 and 90),
  responsibility text not null default 'ict' check (responsibility in ('ict', 'manager')),
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists onboarding_change_tasks_tenant_type_idx
  on public.onboarding_change_tasks (tenant_id, change_type, position);

alter table public.onboarding_change_tasks enable row level security;

drop policy if exists onboarding_change_tasks_member_read on public.onboarding_change_tasks;
create policy onboarding_change_tasks_member_read
  on public.onboarding_change_tasks
  for select to authenticated
  using (public.is_active_tenant_member(tenant_id));

revoke all on public.onboarding_change_tasks from anon;
grant select on public.onboarding_change_tasks to authenticated;
grant all on public.onboarding_change_tasks to service_role;

-- Standardaufgaben pro Mutationsart (Tage relativ zum Stichtag «Gültig ab»).
create or replace function public.seed_onboarding_change_tasks(p_tenant_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  insert into public.onboarding_change_tasks
    (tenant_id, change_type, title, due_offset_days, responsibility, position)
  select p_tenant_id, defaults.change_type, defaults.title, defaults.due_offset_days,
         defaults.responsibility, defaults.position
  from (values
    ('name', 'Benutzerkonto auf den neuen Namen umbenennen (Anzeigename, Anmeldename)', -3, 'ict', 10),
    ('name', 'E-Mail-Adresse anpassen, bisherige Adresse als Alias behalten', -3, 'ict', 20),
    ('name', 'Signatur, Telefonbuch und Teams-Anzeige aktualisieren', -1, 'ict', 30),
    ('name', 'Badge und Namensschild neu ausstellen', 0, 'ict', 40),
    ('name', 'Änderung mit der Person besprechen und bestätigen', 0, 'manager', 50),
    ('department', 'Gruppen und Berechtigungen der neuen Abteilung zuweisen', -3, 'ict', 10),
    ('department', 'Gruppenpostfächer und Verteiler anpassen', -2, 'ict', 20),
    ('department', 'Arbeitsplatz und Geräte für die neue Abteilung prüfen', -2, 'manager', 30),
    ('department', 'Nicht mehr benötigte Zugriffe der bisherigen Abteilung entfernen', 7, 'ict', 40),
    ('function', 'Rollen und Berechtigungen für die neue Funktion anpassen', -3, 'ict', 10),
    ('function', 'Software und Lizenzen für die neue Funktion prüfen', -2, 'ict', 20),
    ('function', 'Funktion in Konto, Signatur und Telefonbuch anpassen', -1, 'ict', 30),
    ('location_workload', 'Standort in Konto, Druckern und Telefonie anpassen', -2, 'ict', 10),
    ('location_workload', 'Arbeitsplatz am neuen Standort vorbereiten', -2, 'manager', 20),
    ('location_workload', 'Befristung bzw. Ablaufdatum des Kontos anpassen', -1, 'ict', 30)
  ) as defaults(change_type, title, due_offset_days, responsibility, position)
  where not exists (
    select 1 from public.onboarding_change_tasks existing
    where existing.tenant_id = p_tenant_id
  );
$$;

revoke all on function public.seed_onboarding_change_tasks(uuid) from public, anon, authenticated;
grant execute on function public.seed_onboarding_change_tasks(uuid) to service_role;

select public.seed_onboarding_change_tasks(tenant.id) from public.tenants tenant;

create or replace function public.create_onboarding_change(
  p_tenant_id uuid,
  p_employee_name text,
  p_starts_on date,
  p_organisation_unit text,
  p_location text,
  p_manager_user_id uuid,
  p_ict_responsible_user_id uuid,
  p_actor_id uuid,
  p_change_types text[],
  p_details jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_entry_id uuid;
  v_types text[];
  v_task_count integer;
begin
  if not exists (
    select 1 from public.tenant_memberships
    where tenant_id = p_tenant_id and user_id = p_actor_id and status = 'active'
  ) then
    raise exception 'Onboarding actor is not an active member' using errcode = '42501';
  end if;
  if not exists (
      select 1 from public.tenant_memberships
      where tenant_id = p_tenant_id and user_id = p_manager_user_id and status = 'active'
    )
    or not exists (
      select 1 from public.tenant_memberships
      where tenant_id = p_tenant_id and user_id = p_ict_responsible_user_id and status = 'active'
    ) then
    raise exception 'Onboarding responsible user unavailable' using errcode = '23503';
  end if;
  select coalesce(array_agg(distinct value order by value), '{}'::text[]) into v_types
  from unnest(coalesce(p_change_types, '{}'::text[])) as value;
  if cardinality(v_types) < 1
    or not v_types <@ array['name', 'department', 'function', 'location_workload']::text[] then
    raise exception 'Invalid onboarding change types' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid onboarding change details' using errcode = '22023';
  end if;

  perform public.seed_onboarding_change_tasks(p_tenant_id);

  insert into public.onboarding_entries (
    tenant_id, employee_name, starts_on, organisation_unit, location,
    manager_user_id, ict_responsible_user_id, template_id, created_by,
    kind, change_types, details
  ) values (
    p_tenant_id, btrim(p_employee_name), p_starts_on, btrim(p_organisation_unit),
    btrim(p_location), p_manager_user_id, p_ict_responsible_user_id, null, p_actor_id,
    'change', v_types, coalesce(p_details, '{}'::jsonb)
  )
  returning id into v_entry_id;

  insert into public.onboarding_tasks (
    tenant_id, entry_id, template_task_id, title, due_on, responsible_user_id, position
  )
  select p_tenant_id, v_entry_id, null, task.title, p_starts_on + task.due_offset_days,
         case when task.responsibility = 'manager' then p_manager_user_id
              else p_ict_responsible_user_id end,
         row_number() over (
           order by array_position(
             array['name', 'department', 'function', 'location_workload']::text[],
             task.change_type
           ), task.position, task.created_at
         ) * 10
  from public.onboarding_change_tasks task
  where task.tenant_id = p_tenant_id
    and task.active
    and task.change_type = any(v_types);
  get diagnostics v_task_count = row_count;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, severity, metadata)
  values (
    p_tenant_id, p_actor_id, 'onboarding.entry.created', 'onboarding_entry', v_entry_id, 'info',
    jsonb_build_object('kind', 'change', 'changeTypes', to_jsonb(v_types), 'taskCount', v_task_count)
  );
  return v_entry_id;
end;
$$;

revoke all on function public.create_onboarding_change(uuid, text, date, text, text, uuid, uuid, uuid, text[], jsonb)
  from public, anon, authenticated;
grant execute on function public.create_onboarding_change(uuid, text, date, text, text, uuid, uuid, uuid, text[], jsonb)
  to service_role;

commit;
