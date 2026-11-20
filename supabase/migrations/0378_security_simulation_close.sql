-- Phishing-Simulationen (vereinbartes Awareness-Training) schliessen ohne
-- zuständige Person: Die Statusregel «Neu nur mit zugewiesener Person»
-- erlaubt eine Ausnahme, wenn die Funktion security_case_close_simulation den
-- Abschluss vornimmt (transaktionslokale Einstellung, nur über diese Funktion).

create or replace function public.enforce_ticket_status_rules()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_old_key text;
  v_new_key text;
  v_old_closed boolean;
  v_new_closed boolean;
  v_merging boolean;
  v_simulation boolean;
begin
  if new.status_id is not distinct from old.status_id then
    return new;
  end if;
  select key, is_closed into v_old_key, v_old_closed
  from public.ticket_statuses where id = old.status_id;
  select key, is_closed into v_new_key, v_new_closed
  from public.ticket_statuses where id = new.status_id;
  v_merging := old.merged_into_ticket_id is null and new.merged_into_ticket_id is not null;
  v_simulation := coalesce(current_setting('nextdesk.simulation_close', true), '') = new.id::text;

  if v_new_key = 'new' and v_old_key is distinct from 'new' then
    raise exception 'Ein Ticket kann nicht auf «Neu» zurückgesetzt werden.'
      using errcode = '23514', hint = 'ticket_status_new_locked';
  end if;

  if v_old_key = 'new'
    and new.assigned_agent_id is null
    and not v_merging
    and not v_simulation then
    raise exception 'Der Status «Neu» kann erst geändert werden, wenn das Ticket einer Person zugewiesen ist.'
      using errcode = '23514', hint = 'ticket_assignee_required';
  end if;

  if coalesce(v_new_closed, false)
    and not coalesce(v_old_closed, false)
    and not v_merging
    and exists (
      select 1
      from public.tickets child
      join public.ticket_statuses child_status on child_status.id = child.status_id
      where child.parent_ticket_id = new.id
        and child.merged_into_ticket_id is null
        and not child_status.is_closed
    ) then
    raise exception 'Das Ticket kann erst gelöst oder geschlossen werden, wenn alle Teil-Tickets gelöst oder geschlossen sind.'
      using errcode = '23514', hint = 'ticket_children_open';
  end if;

  return new;
end;
$function$;

-- Schliesst Fall und Ticket einer erkannten Phishing-Simulation als «Phishing».
create or replace function public.security_case_close_simulation(
  p_tenant_id uuid,
  p_ticket_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_status uuid;
begin
  update public.security_cases
     set verdict = 'phishing', verdict_at = timezone('utc', now()),
         state = 'closed', closed_at = timezone('utc', now())
   where tenant_id = p_tenant_id and ticket_id = p_ticket_id and state <> 'closed';
  if not found then
    return false;
  end if;
  select id into v_status from public.ticket_statuses
   where tenant_id = p_tenant_id and key = 'closed';
  if v_status is not null then
    perform set_config('nextdesk.simulation_close', p_ticket_id::text, true);
    update public.tickets set status_id = v_status
     where id = p_ticket_id and tenant_id = p_tenant_id;
    perform set_config('nextdesk.simulation_close', '', true);
  end if;
  return true;
end;
$$;
revoke all on function public.security_case_close_simulation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.security_case_close_simulation(uuid, uuid) to service_role;
