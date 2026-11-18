-- Follow-up to 0284: the team-lead alert «Team: Ticket ohne Antwort» should
-- not be held back to the service hours; instead its deadline itself counts
-- only service time.
--
-- * With SLA: the first-response due date (response_due_at), which is
--   already computed in service time (e.g. 8 h from Monday 20:17 → Tuesday
--   15:00 with service hours 07–17).
-- * Without SLA due date: 24 hours counted in the service hours of the
--   department's SLA profile (sla_add_service_minutes); 24/7 without one.
-- * Alerts are sent as soon as they are due (no send window any more).

create or replace function public.sla_department_due_at(
  p_tenant_id uuid,
  p_department_id uuid,
  p_start timestamptz,
  p_minutes integer
)
returns timestamptz
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    (
      select public.sla_add_service_minutes(p_start, p_minutes, profile.service_hours, profile.timezone)
        from public.ticket_sla_profiles profile
       where profile.tenant_id = p_tenant_id
         and profile.active
         and coalesce(profile.service_hours ->> 'mode', 'always') in ('business', 'extended')
         and (
           profile.service_hours ->> 'department_id' is null
           or profile.service_hours ->> 'department_id' = p_department_id::text
         )
       order by (profile.service_hours ->> 'department_id' is null), profile.created_at
       limit 1
    ),
    p_start + make_interval(mins => p_minutes)
  );
$$;
revoke all on function public.sla_department_due_at(uuid, uuid, timestamptz, integer) from public, anon;
grant execute on function public.sla_department_due_at(uuid, uuid, timestamptz, integer) to authenticated, service_role;

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
          and coalesce(
                ticket.response_due_at,
                public.sla_department_due_at(
                  ticket.tenant_id, ticket.department_id, ticket.created_at, 24 * 60
                )
              ) <= timezone('utc', now())
        )
      )
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
