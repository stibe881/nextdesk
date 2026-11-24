-- Teil-Tickets übernehmen die anfragende Person des aufgeteilten Tickets.
-- Bisher wurde die Person, die aufteilt, als anfragende Person eingetragen
-- (die ursprüngliche nur als betroffene Person). Dadurch standen die Teile
-- unter «Meine offenen Tickets» der aufteilenden Person, und Antworten
-- gingen nicht per Mail an die ursprüngliche anfragende Person. Jetzt werden
-- anfragende Person, Kontakt, betroffene Person und Postfach übernommen.
--
-- Zusätzlich erhält die anfragende Person eine Mail («split_notice»): in wie
-- viele Tickets die Anfrage aufgeteilt wurde, mit Nummern und Betreff, und die
-- Bitte, künftig pro Anliegen ein eigenes Ticket zu erstellen.

alter table public.mail_messages
  drop constraint if exists mail_messages_kind_check;
alter table public.mail_messages
  add constraint mail_messages_kind_check
  check (kind in (
    'new_ticket', 'reply', 'acknowledgement', 'agent_reply', 'resolution', 'test',
    'department_question', 'department_answer', 'ticket_copy', 'notification',
    'security_notice', 'status_confirmation', 'status_change', 'rating_reminder',
    'merge_notice', 'ticket_forward', 'split_notice'
  ));

-- Höchstens eine Aufteilungs-Mail pro Ticket.
create unique index if not exists mail_messages_split_notice_unique
  on public.mail_messages (ticket_id)
  where kind = 'split_notice' and ticket_id is not null;

-- Stellt die Mail über das Postfach, über das das Ticket kam, in die
-- Warteschlange (wie die Zusammenführungs-Mail). Ohne Postfach oder
-- Mailadresse der anfragenden Person entfällt sie. Ein Fehler hier darf das
-- Aufteilen nie verhindern.
create or replace function public.exchange_mail_enqueue_split_notice(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket record;
  v_channel record;
  v_recipient text;
begin
  select ticket.id, ticket.tenant_id, ticket.subject, ticket.requester_contact_id,
         ticket.exchange_mail_channel_id
  into v_ticket
  from public.tickets ticket
  where ticket.id = p_ticket_id;
  if not found or v_ticket.exchange_mail_channel_id is null then
    return;
  end if;
  if not public.exchange_mail_feature_enabled(v_ticket.tenant_id) then
    return;
  end if;
  select channel.id, channel.mailbox_address, channel.configuration_version into v_channel
  from public.exchange_mail_channels channel
  where channel.tenant_id = v_ticket.tenant_id
    and channel.status = 'active'
    and channel.access_mode = 'delegated'
    and channel.send_resolution
    and channel.id = v_ticket.exchange_mail_channel_id
  limit 1;
  if not found then
    return;
  end if;
  select requester.email into v_recipient
  from public.ticket_requesters requester
  where requester.id = v_ticket.requester_contact_id
    and requester.tenant_id = v_ticket.tenant_id
    and requester.email is not null;
  if v_recipient is null then
    return;
  end if;
  insert into public.mail_messages (
    tenant_id, channel_id, exchange_configuration_version, direction, kind, ticket_id,
    from_address, to_addresses, subject
  ) values (
    v_ticket.tenant_id, v_channel.id, v_channel.configuration_version, 'outbound',
    'split_notice', v_ticket.id, v_channel.mailbox_address, array[v_recipient], v_ticket.subject
  ) on conflict do nothing;
exception when others then
  return;
end;
$$;

revoke all on function public.exchange_mail_enqueue_split_notice(uuid)
  from public, anon, authenticated;
grant execute on function public.exchange_mail_enqueue_split_notice(uuid)
  to service_role;

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
  perform public.exchange_mail_enqueue_split_notice(v_parent.id);
  return v_result;
end;
$function$;

revoke all on function public.ticket_split_create_children(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.ticket_split_create_children(uuid, uuid, uuid, jsonb)
  to service_role;
