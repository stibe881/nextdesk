begin;

set local search_path = pg_catalog, public;

-- Eintritte zuweisen und Stellvertretung.
--
-- * tenant_ticket_agent_ids: alle aktiven Agenten eines Mandanten (Auswahl
--   «Zuweisen an …» bei Eintritten).
-- * onboarding_assign_entry: wechselt die ICT-Verantwortung eines Eintritts.
--   Die ICT-Aufgaben der bisherigen Person gehen mit; Aufgaben der Führung,
--   einer Abteilung oder anderer Personen bleiben. Hat die neue Person gerade
--   eine aktive Stellvertretung, geht der Eintritt wie ein Ticket direkt an die
--   Stellvertretung.
-- * Mitteilung «onboarding.assigned» in der Kategorie «assigned» (wie
--   zugewiesene Tickets); die Empfängerin legt die Edge Function fest.

create or replace function public.tenant_ticket_agent_ids(p_tenant_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(array_agg(distinct membership.user_id), '{}'::uuid[])
  from public.tenant_memberships membership
  where membership.tenant_id = p_tenant_id
    and membership.status = 'active'
    and public.user_is_ticket_agent(p_tenant_id, membership.user_id);
$$;

revoke all on function public.tenant_ticket_agent_ids(uuid)
  from public, anon, authenticated;
grant execute on function public.tenant_ticket_agent_ids(uuid) to service_role;

-- Aktive Stellvertretung einer Person (oder null), wie bei Ticketzuweisungen.
create or replace function public.active_delegate_for(p_tenant_id uuid, p_agent_id uuid)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select delegation.delegate_id
  from public.agent_delegations delegation
  join public.tenant_memberships membership
    on membership.tenant_id = delegation.tenant_id
   and membership.user_id = delegation.delegate_id
   and membership.status = 'active'
  where delegation.tenant_id = p_tenant_id
    and delegation.agent_id = p_agent_id
    and delegation.delegate_id <> p_agent_id
    and delegation.ended_at is null
    and delegation.starts_at <= timezone('utc', now())
    and delegation.ends_at > timezone('utc', now())
  order by delegation.starts_at desc
  limit 1;
$$;

revoke all on function public.active_delegate_for(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.active_delegate_for(uuid, uuid) to service_role;

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
  if p_tenant_id is null or p_entry_id is null or p_user_id is null or p_actor_id is null then
    raise exception 'onboarding_assign_invalid' using errcode = '22023';
  end if;
  select * into v_entry
  from public.onboarding_entries
  where tenant_id = p_tenant_id and id = p_entry_id
  for update;
  if not found then
    raise exception 'onboarding_entry_not_found' using errcode = 'P0002';
  end if;
  if not public.user_is_ticket_agent(p_tenant_id, p_user_id) then
    raise exception 'onboarding_assignee_invalid' using errcode = '22023';
  end if;
  v_delegate := public.active_delegate_for(p_tenant_id, p_user_id);
  if v_delegate is not null and public.user_is_ticket_agent(p_tenant_id, v_delegate) then
    v_target := v_delegate;
  end if;
  if v_target = v_entry.ict_responsible_user_id then
    return jsonb_build_object(
      'assignedTo', v_target,
      'previous', v_entry.ict_responsible_user_id,
      'redirected', v_target <> p_user_id,
      'changed', false,
      'movedTasks', 0
    );
  end if;

  update public.onboarding_tasks task
     set responsible_user_id = v_target
   where task.tenant_id = p_tenant_id
     and task.entry_id = p_entry_id
     and task.department_id is null
     and task.responsible_user_id = v_entry.ict_responsible_user_id
     and (
       -- Aufgaben aus der Vorlage: nur die der ICT. Freie Aufgaben gehören der
       -- ICT-Verantwortung, ausser sie ist zugleich die Führungsperson.
       exists (
         select 1 from public.onboarding_template_tasks template_task
         where template_task.id = task.template_task_id
           and template_task.responsibility = 'ict'
       )
       or (
         task.template_task_id is null
         and v_entry.ict_responsible_user_id is distinct from v_entry.manager_user_id
       )
     );
  get diagnostics v_moved = row_count;

  update public.onboarding_entries
     set ict_responsible_user_id = v_target
   where tenant_id = p_tenant_id and id = p_entry_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_tenant_id, p_actor_id, 'onboarding.entry.assigned', 'onboarding_entry', p_entry_id,
    jsonb_build_object(
      'previous', v_entry.ict_responsible_user_id,
      'assignedTo', v_target,
      'requested', p_user_id,
      'redirectedToDelegate', v_target <> p_user_id,
      'movedTasks', v_moved
    )
  );

  return jsonb_build_object(
    'assignedTo', v_target,
    'previous', v_entry.ict_responsible_user_id,
    'redirected', v_target <> p_user_id,
    'changed', true,
    'movedTasks', v_moved
  );
end;
$$;

revoke all on function public.onboarding_assign_entry(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.onboarding_assign_entry(uuid, uuid, uuid, uuid)
  to service_role;

do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public.push_notification_category(text)'::regprocedure)
    into v_def;
  v_new := replace(
    v_def,
    E'    when p_kind like ''project.%'' then ''assigned''\n',
    E'    when p_kind like ''project.%'' then ''assigned''\n    when p_kind like ''onboarding.%'' then ''assigned''\n'
  );
  if v_new = v_def then
    raise exception 'push_notification_category: Muster nicht gefunden';
  end if;
  execute v_new;

  select pg_get_functiondef(
    'public.push_non_ticket_recipient_authorized(uuid, uuid, text)'::regprocedure
  ) into v_def;
  v_new := replace(
    v_def,
    E'or p_kind like ''project.%'' then',
    E'or p_kind like ''project.%'' or p_kind like ''onboarding.%'' then'
  );
  if v_new = v_def then
    raise exception 'push_non_ticket_recipient_authorized: Muster nicht gefunden';
  end if;
  execute v_new;
end;
$$;

commit;
