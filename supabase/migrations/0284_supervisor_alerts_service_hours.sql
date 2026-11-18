-- Team-lead alerts («Team: Ticket ohne Antwort», «Team: SLA in Gefahr») ignored
-- the SLA service hours: «ohne Antwort» fired exactly 24 calendar hours after
-- the ticket arrived, e.g. at 20:20 for a ticket from 20:20 the evening before.
--
-- * «ohne Antwort» now follows the ticket's first-response due date
--   (response_due_at, already computed in service hours); tickets without
--   one keep the 24-hour rule.
-- * Both alerts are only sent inside the service hours of the SLA profile for
--   the ticket's department; outside them they wait for the next window.

-- True when p_at lies inside the service hours that apply to the department
-- (or when no business-hours profile applies, e.g. 24/7).
create or replace function public.sla_in_service_hours(
  p_tenant_id uuid,
  p_department_id uuid,
  p_at timestamptz default timezone('utc', now())
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_hours jsonb;
  v_timezone text;
  v_local timestamp;
  v_start time;
  v_end time;
begin
  select profile.service_hours, profile.timezone
    into v_hours, v_timezone
    from public.ticket_sla_profiles profile
   where profile.tenant_id = p_tenant_id
     and profile.active
     and coalesce(profile.service_hours ->> 'mode', 'always') in ('business', 'extended')
     and (
       profile.service_hours ->> 'department_id' is null
       or profile.service_hours ->> 'department_id' = p_department_id::text
     )
   order by (profile.service_hours ->> 'department_id' is null), profile.created_at
   limit 1;
  if v_hours is null or jsonb_typeof(v_hours -> 'weekdays') <> 'array' then
    return true;
  end if;
  begin
    v_start := (v_hours ->> 'start')::time;
    v_end := (v_hours ->> 'end')::time;
    v_local := p_at at time zone coalesce(nullif(v_timezone, ''), 'Europe/Zurich');
  exception when others then
    return true;
  end;
  if v_start is null or v_end is null or v_end <= v_start then
    return true;
  end if;
  return exists (
           select 1 from jsonb_array_elements_text(v_hours -> 'weekdays') as day
            where day = extract(isodow from v_local)::text
         )
     and v_local::time >= v_start
     and v_local::time < v_end;
end;
$$;
revoke all on function public.sla_in_service_hours(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.sla_in_service_hours(uuid, uuid, timestamptz) to authenticated, service_role;

create or replace function public.supervisor_send_ticket_alerts()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_ticket record;
  v_supervisor uuid;
  v_sent integer := 0;
  v_agent_name text;
begin
  for v_ticket in
    select ticket.id, ticket.tenant_id, ticket.department_id, ticket.ticket_number,
      ticket.subject, ticket.assigned_agent_id, ticket.resolution_due_at,
      case
        when ticket.resolution_due_at is not null
          and ticket.resolution_due_at > timezone('utc', now())
          and ticket.resolution_due_at <= timezone('utc', now()) + interval '1 hour'
          then 'sla_risk'
        else 'no_first_response'
      end as alert_kind
    from public.tickets ticket
    join public.ticket_statuses status on status.id = ticket.status_id
    where ticket.deleted_at is null
      and not status.is_closed
      and ticket.merged_into_ticket_id is null
      and (
        (
          ticket.resolution_due_at is not null
          and ticket.resolution_due_at > timezone('utc', now())
          and ticket.resolution_due_at <= timezone('utc', now()) + interval '1 hour'
        )
        or (
          ticket.first_responded_at is null
          and ticket.created_at > timezone('utc', now()) - interval '14 days'
          and (
            -- First-response due date of the SLA (service hours) ...
            (ticket.response_due_at is not null
              and ticket.response_due_at <= timezone('utc', now()))
            -- ... or, without SLA, 24 hours.
            or (ticket.response_due_at is null
              and ticket.created_at <= timezone('utc', now()) - interval '24 hours')
          )
        )
      )
      -- Only during service hours; otherwise the alert waits.
      and public.sla_in_service_hours(ticket.tenant_id, ticket.department_id)
  loop
    insert into public.supervisor_ticket_alerts (tenant_id, ticket_id, kind)
    values (v_ticket.tenant_id, v_ticket.id, v_ticket.alert_kind)
    on conflict do nothing;
    if not found then
      continue;
    end if;
    v_agent_name := null;
    if v_ticket.assigned_agent_id is not null then
      select nullif(btrim(display_name), '') into v_agent_name
      from public.user_profiles where id = v_ticket.assigned_agent_id;
    end if;
    foreach v_supervisor in array public.department_supervisor_ids(v_ticket.tenant_id, v_ticket.department_id)
    loop
      insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
      values (
        v_ticket.tenant_id, v_supervisor, v_ticket.id,
        case v_ticket.alert_kind
          when 'sla_risk' then 'ticket.sla.supervisor_risk'
          else 'ticket.sla.supervisor_no_response'
        end,
        jsonb_build_object(
          'ticketNumber', v_ticket.ticket_number,
          'subject', v_ticket.subject,
          'agentName', v_agent_name,
          'resolutionDueAt', v_ticket.resolution_due_at,
          'supervisorAlert', true
        )
      );
      v_sent := v_sent + 1;
    end loop;
  end loop;
  return v_sent;
end;
$function$;
