begin;

set local search_path = pg_catalog, public;

-- Eintritte gehören zur Abteilung, über die sie gemeldet wurden (bei einer
-- Eintrittsmeldung per Mail die Abteilung des Mail-Tickets). Zugewiesen werden
-- können nur Agenten aus den Teams dieser Abteilung. Neue Eintritte sind
-- standardmässig nicht zugewiesen: Die ICT-Verantwortung bleibt leer, die
-- ICT-Aufgaben haben keine verantwortliche Person, bis jemand zuweist.

alter table public.onboarding_entries
  add column if not exists department_id uuid;

alter table public.onboarding_entries
  drop constraint if exists onboarding_entries_department_fk;
alter table public.onboarding_entries
  add constraint onboarding_entries_department_fk
  foreign key (department_id) references public.departments(id) on delete set null;

create index if not exists onboarding_entries_department_idx
  on public.onboarding_entries (tenant_id, department_id);

alter table public.onboarding_entries
  alter column ict_responsible_user_id drop not null;

-- ICT-Aufgaben eines nicht zugewiesenen Eintritts haben weder Person noch
-- Abteilung; sie gehören der Abteilung des Eintritts, bis jemand zuweist.
alter table public.onboarding_tasks
  drop constraint if exists onboarding_tasks_owner_present;

-- Bestehende Einträge: Abteilung aus dem Kürzel der Ticketnummer (Mail) bzw.
-- aus dem Team der ICT-Verantwortung.
update public.onboarding_entries entry
   set department_id = department.id
  from public.departments department
 where entry.department_id is null
   and entry.source_ticket_number is not null
   and department.tenant_id = entry.tenant_id
   and upper(department.key) = upper(split_part(entry.source_ticket_number, '-', 1));

update public.onboarding_entries entry
   set department_id = (
     select team.department_id
     from public.team_memberships membership
     join public.teams team on team.id = membership.team_id and team.active
     where membership.tenant_id = entry.tenant_id
       and membership.user_id = entry.ict_responsible_user_id
       and team.department_id is not null
     order by team.created_at
     limit 1
   )
 where entry.department_id is null
   and entry.ict_responsible_user_id is not null;

-- Agenten, die einem aktiven Team der Abteilung angehören.
create or replace function public.onboarding_department_agent_ids(
  p_tenant_id uuid,
  p_department_id uuid
)
returns uuid[]
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(array_agg(distinct membership.user_id), '{}'::uuid[])
  from public.team_memberships membership
  join public.teams team
    on team.id = membership.team_id
   and team.tenant_id = membership.tenant_id
   and team.active
  where membership.tenant_id = p_tenant_id
    and team.department_id = p_department_id
    and public.user_is_ticket_agent(p_tenant_id, membership.user_id);
$$;

revoke all on function public.onboarding_department_agent_ids(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.onboarding_department_agent_ids(uuid, uuid)
  to service_role;

-- Ohne ICT-Verantwortung anlegen (Eintritt planen und Eintrittsmeldung per Mail).
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(
    'public.create_onboarding_entry(uuid, text, date, text, text, uuid, uuid, uuid, uuid)'::regprocedure
  ) into v_def;
  v_new := replace(
    v_def,
    'or not exists (select 1 from public.tenant_memberships where tenant_id = p_tenant_id and user_id = p_ict_responsible_user_id and status = ''active'')',
    'or (p_ict_responsible_user_id is not null and not exists (select 1 from public.tenant_memberships where tenant_id = p_tenant_id and user_id = p_ict_responsible_user_id and status = ''active''))'
  );
  if v_new = v_def then
    raise exception 'create_onboarding_entry: Muster nicht gefunden';
  end if;
  execute v_new;

  select pg_get_functiondef(
    'public.create_onboarding_change(uuid, text, date, text, text, uuid, uuid, uuid, text[], jsonb)'::regprocedure
  ) into v_def;
  v_new := replace(
    v_def,
    E'    or not exists (\n      select 1 from public.tenant_memberships\n      where tenant_id = p_tenant_id and user_id = p_ict_responsible_user_id and status = ''active''\n    ) then',
    E'    or (p_ict_responsible_user_id is not null and not exists (\n      select 1 from public.tenant_memberships\n      where tenant_id = p_tenant_id and user_id = p_ict_responsible_user_id and status = ''active''\n    )) then'
  );
  if v_new = v_def then
    raise exception 'create_onboarding_change: Muster nicht gefunden';
  end if;
  execute v_new;

  -- Eintrittsmeldung per Mail: nicht zugewiesen. Die Person mit
  -- onboarding.manage bleibt nur die erfassende Person.
  select pg_get_functiondef(
    'public.create_onboarding_entry_from_email(uuid, text, text, date, text, text, text, jsonb, jsonb, text)'::regprocedure
  ) into v_def;
  v_new := replace(
    v_def,
    'v_manager, v_responsible, v_template, v_responsible',
    'v_manager, null, v_template, v_responsible'
  );
  v_new := replace(
    v_new,
    E'      v_responsible, v_position\n',
    E'      null, v_position\n'
  );
  if v_new = v_def or position('null, v_position' in v_new) = 0 then
    raise exception 'create_onboarding_entry_from_email: Muster nicht gefunden';
  end if;
  execute v_new;
end;
$$;

-- Zuweisen an einen Agenten der Abteilung oder Zuweisung aufheben (null).
create or replace function public.onboarding_assign_entry(
  p_tenant_id uuid,
  p_entry_id uuid,
  p_user_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_entry public.onboarding_entries%rowtype;
  v_target uuid := p_user_id;
  v_delegate uuid;
  v_moved integer := 0;
begin
  if p_tenant_id is null or p_entry_id is null or p_actor_id is null then
    raise exception 'onboarding_assign_invalid' using errcode = '22023';
  end if;
  select * into v_entry
  from public.onboarding_entries
  where tenant_id = p_tenant_id and id = p_entry_id
  for update;
  if not found then
    raise exception 'onboarding_entry_not_found' using errcode = 'P0002';
  end if;
  if p_user_id is not null then
    if not public.user_is_ticket_agent(p_tenant_id, p_user_id)
      or (
        v_entry.department_id is not null
        and not p_user_id = any(public.onboarding_department_agent_ids(p_tenant_id, v_entry.department_id))
      ) then
      raise exception 'onboarding_assignee_invalid' using errcode = '22023';
    end if;
    v_delegate := public.active_delegate_for(p_tenant_id, p_user_id);
    if v_delegate is not null
      and public.user_is_ticket_agent(p_tenant_id, v_delegate)
      and (
        v_entry.department_id is null
        or v_delegate = any(public.onboarding_department_agent_ids(p_tenant_id, v_entry.department_id))
      ) then
      v_target := v_delegate;
    end if;
  end if;
  if v_target is not distinct from v_entry.ict_responsible_user_id then
    return jsonb_build_object(
      'assignedTo', v_target,
      'previous', v_entry.ict_responsible_user_id,
      'redirected', v_target is distinct from p_user_id,
      'changed', false,
      'movedTasks', 0
    );
  end if;

  update public.onboarding_tasks task
     set responsible_user_id = v_target
   where task.tenant_id = p_tenant_id
     and task.entry_id = p_entry_id
     and task.department_id is null
     and (
       -- Bisher nicht zugewiesen: die ICT-Aufgaben ohne Person.
       (v_entry.ict_responsible_user_id is null and task.responsible_user_id is null)
       or (
         task.responsible_user_id = v_entry.ict_responsible_user_id
         and (
           exists (
             select 1 from public.onboarding_template_tasks template_task
             where template_task.id = task.template_task_id
               and template_task.responsibility = 'ict'
           )
           -- Aufgaben ohne Vorlage: bei Eintritten (Mail) immer ICT; bei
           -- Mutationen nur, wenn die ICT nicht zugleich die Führung ist.
           or (
             task.template_task_id is null
             and (
               v_entry.kind <> 'change'
               or v_entry.ict_responsible_user_id is distinct from v_entry.manager_user_id
             )
           )
         )
       )
     );
  get diagnostics v_moved = row_count;

  update public.onboarding_entries
     set ict_responsible_user_id = v_target
   where tenant_id = p_tenant_id and id = p_entry_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_tenant_id, p_actor_id,
    case when v_target is null then 'onboarding.entry.unassigned' else 'onboarding.entry.assigned' end,
    'onboarding_entry', p_entry_id,
    jsonb_build_object(
      'previous', v_entry.ict_responsible_user_id,
      'assignedTo', v_target,
      'requested', p_user_id,
      'redirectedToDelegate', v_target is distinct from p_user_id,
      'movedTasks', v_moved
    )
  );

  return jsonb_build_object(
    'assignedTo', v_target,
    'previous', v_entry.ict_responsible_user_id,
    'redirected', v_target is distinct from p_user_id,
    'changed', true,
    'movedTasks', v_moved
  );
end;
$$;

revoke all on function public.onboarding_assign_entry(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.onboarding_assign_entry(uuid, uuid, uuid, uuid)
  to service_role;

commit;
