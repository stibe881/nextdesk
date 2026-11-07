begin;

set local search_path = pg_catalog, public;

-- Eintritte und Austritte: pro Mandant wird festgelegt, welche Abteilungen
-- welche Teilaufgaben übernehmen. Sie entstehen bei jedem neuen Eintritt bzw.
-- Austritt automatisch und gehören der Abteilung, nicht einer einzelnen
-- Person. Jedes aktive Abteilungsmitglied kann sie erledigen.

alter table public.onboarding_entries
  add column if not exists kind text not null default 'onboarding'
    check (kind in ('onboarding', 'offboarding'));

alter table public.onboarding_tasks
  alter column responsible_user_id drop not null;
alter table public.onboarding_tasks
  add column if not exists department_id uuid references public.departments(id) on delete set null;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'onboarding_tasks_owner_present'
  ) then
    alter table public.onboarding_tasks
      add constraint onboarding_tasks_owner_present
      check (responsible_user_id is not null or department_id is not null);
  end if;
end;
$$;
create index if not exists onboarding_tasks_department_idx
  on public.onboarding_tasks (tenant_id, department_id, due_on)
  where department_id is not null;

create table if not exists public.onboarding_department_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('onboarding', 'offboarding')),
  department_id uuid not null references public.departments(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 240),
  due_offset_days integer not null default 0 check (due_offset_days between -60 and 90),
  position integer not null default 1 check (position between 1 and 100),
  active boolean not null default true,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create index if not exists onboarding_department_tasks_tenant_idx
  on public.onboarding_department_tasks (tenant_id, kind, department_id, position);
alter table public.onboarding_department_tasks enable row level security;
revoke all on table public.onboarding_department_tasks from public, anon, authenticated;
grant all on table public.onboarding_department_tasks to service_role;

-- Runs at commit, after the template tasks (and e-mail extras) exist, so the
-- department tasks follow them in the list.
create or replace function public.onboarding_add_department_tasks()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_entry record;
  v_position integer;
  v_task record;
begin
  select entry.id, entry.tenant_id, entry.kind, entry.starts_on
  into v_entry
  from public.onboarding_entries entry where entry.id = new.id;
  if not found then
    return null;
  end if;
  if exists (
    select 1 from public.onboarding_tasks task
    where task.entry_id = v_entry.id and task.department_id is not null
  ) then
    return null;
  end if;
  select coalesce(max(task.position), 0) into v_position
  from public.onboarding_tasks task where task.entry_id = v_entry.id;
  for v_task in
    select config.department_id, config.title, config.due_offset_days
    from public.onboarding_department_tasks config
    join public.departments department
      on department.id = config.department_id and department.tenant_id = config.tenant_id
    where config.tenant_id = v_entry.tenant_id
      and config.kind = v_entry.kind
      and config.active
    order by department.name, config.position, config.created_at
  loop
    v_position := v_position + 1;
    exit when v_position > 100;
    insert into public.onboarding_tasks (
      tenant_id, entry_id, title, due_on, responsible_user_id, department_id, position
    ) values (
      v_entry.tenant_id, v_entry.id, v_task.title,
      v_entry.starts_on + v_task.due_offset_days, null, v_task.department_id, v_position
    );
  end loop;
  return null;
end;
$$;
revoke all on function public.onboarding_add_department_tasks() from public, anon, authenticated;

drop trigger if exists onboarding_add_department_tasks on public.onboarding_entries;
create constraint trigger onboarding_add_department_tasks
  after insert on public.onboarding_entries
  deferrable initially deferred
  for each row execute function public.onboarding_add_department_tasks();

create or replace function public.create_onboarding_entry_with_kind(
  p_tenant_id uuid,
  p_employee_name text,
  p_starts_on date,
  p_organisation_unit text,
  p_location text,
  p_manager_user_id uuid,
  p_ict_responsible_user_id uuid,
  p_template_id uuid,
  p_actor_id uuid,
  p_kind text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_entry uuid;
begin
  if p_kind not in ('onboarding', 'offboarding') then
    raise exception 'Invalid onboarding kind' using errcode = '22023';
  end if;
  v_entry := public.create_onboarding_entry(
    p_tenant_id, p_employee_name, p_starts_on, p_organisation_unit, p_location,
    p_manager_user_id, p_ict_responsible_user_id, p_template_id, p_actor_id
  );
  update public.onboarding_entries set kind = p_kind
  where id = v_entry and tenant_id = p_tenant_id;
  return v_entry;
end;
$$;
revoke all on function public.create_onboarding_entry_with_kind(
  uuid, text, date, text, text, uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.create_onboarding_entry_with_kind(
  uuid, text, date, text, text, uuid, uuid, uuid, uuid, text
) to service_role;

commit;
