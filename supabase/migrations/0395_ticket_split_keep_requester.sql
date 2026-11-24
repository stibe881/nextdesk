-- Teil-Tickets übernehmen die anfragende Person des aufgeteilten Tickets.
-- Bisher wurde die Person, die aufteilt, als anfragende Person eingetragen
-- (die ursprüngliche nur als betroffene Person). Dadurch standen die Teile
-- unter «Meine offenen Tickets» der aufteilenden Person, und Antworten
-- gingen nicht per Mail an die ursprüngliche anfragende Person. Jetzt werden
-- anfragende Person, Kontakt, betroffene Person und Postfach übernommen.

create or replace function public.ticket_split_create_children(p_tenant_id uuid, p_parent_ticket_id uuid, p_actor_id uuid, p_children jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_parent public.tickets%rowtype;
  v_parent_closed boolean;
  v_status_id uuid;
  v_child jsonb;
  v_department record;
  v_team_id uuid;
  v_agent_id uuid;
  v_number text;
  v_child_id uuid;
  v_result jsonb := '[]'::jsonb;
begin
  if p_actor_id is null
    or jsonb_typeof(p_children) is distinct from 'array'
    or jsonb_array_length(p_children) not between 1 and 10 then
    raise exception 'ticket_split_invalid' using errcode = '22023', hint = 'ticket_split_invalid';
  end if;

  select * into v_parent
  from public.tickets
  where id = p_parent_ticket_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'ticket_not_found' using errcode = 'P0002';
  end if;
  select is_closed into v_parent_closed from public.ticket_statuses where id = v_parent.status_id;
  if coalesce(v_parent_closed, false) or v_parent.merged_into_ticket_id is not null then
    raise exception 'ticket_split_parent_closed' using errcode = '22023', hint = 'ticket_split_parent_closed';
  end if;

  select id into v_status_id
  from public.ticket_statuses
  where tenant_id = p_tenant_id and key = 'new';
  if v_status_id is null then
    raise exception 'ticket_split_status_missing' using errcode = '22023', hint = 'ticket_split_invalid';
  end if;

  for v_child in select value from jsonb_array_elements(p_children)
  loop
    select department.id, department.key into v_department
    from public.departments department
    where department.id = nullif(v_child ->> 'departmentId', '')::uuid
      and department.tenant_id = p_tenant_id
      and department.active;
    if not found then
      raise exception 'ticket_split_department_invalid'
        using errcode = '22023', hint = 'ticket_split_department_invalid';
    end if;
    v_team_id := nullif(v_child ->> 'teamId', '')::uuid;
    v_agent_id := nullif(v_child ->> 'agentId', '')::uuid;

    v_number := public.reserve_ticket_number(p_tenant_id, v_department.id, left(v_department.key, 8));
    insert into public.tickets (
      tenant_id, department_id, ticket_number, subject, description,
      status_id, priority_id, category_id, subcategory_id,
      requester_id, affected_user_id, requester_contact_id, exchange_mail_channel_id,
      customer_organization_id, assigned_team_id, assigned_agent_id, parent_ticket_id
    )
    values (
      p_tenant_id,
      v_department.id,
      v_number,
      v_child ->> 'subject',
      v_child ->> 'description',
      v_status_id,
      v_parent.priority_id,
      case when v_department.id = v_parent.department_id then v_parent.category_id end,
      case when v_department.id = v_parent.department_id then v_parent.subcategory_id end,
      v_parent.requester_id,
      v_parent.affected_user_id,
      v_parent.requester_contact_id,
      v_parent.exchange_mail_channel_id,
      v_parent.customer_organization_id,
      v_team_id,
      v_agent_id,
      v_parent.id
    )
    returning id into v_child_id;

    insert into public.ticket_relations (ticket_id, related_ticket_id, relation_type, created_by)
    values (v_child_id, v_parent.id, 'parent', p_actor_id)
    on conflict do nothing;
    insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
    values (
      v_child_id,
      p_actor_id,
      'ticket.created',
      jsonb_build_object(
        'source', 'ticket_split',
        'parentTicketId', v_parent.id,
        'parentTicketNumber', v_parent.ticket_number
      )
    );
    v_result := v_result || jsonb_build_array(
      jsonb_build_object('id', v_child_id, 'ticketNumber', v_number)
    );
  end loop;

  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (v_parent.id, p_actor_id, 'ticket.split', jsonb_build_object('children', v_result));
  return v_result;
end;
$function$;

revoke all on function public.ticket_split_create_children(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.ticket_split_create_children(uuid, uuid, uuid, jsonb)
  to service_role;
