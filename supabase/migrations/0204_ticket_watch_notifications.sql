begin;

set local search_path = pg_catalog, public;

-- People who watch a ticket are told about its progress: status changes,
-- reassignment and every new message or internal note. The acting person is
-- never notified about their own change, and people who already receive a
-- dedicated notification for the same change (new assignee, requester or
-- assignee of a reply) do not get a second one.

create or replace function public.ticket_watch_actor_id()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor_id uuid;
  v_header_actor text;
  v_role text;
begin
  v_actor_id := auth.uid();
  if v_actor_id is not null then
    return v_actor_id;
  end if;
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    nullif(current_setting('role', true), '')
  );
  if v_role = 'service_role' then
    v_header_actor := nullif(current_setting('request.headers', true), '')::jsonb
      ->> 'x-nextdesk-actor-id';
    if v_header_actor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return v_header_actor::uuid;
    end if;
  end if;
  return null;
exception when others then
  return null;
end;
$$;
revoke all on function public.ticket_watch_actor_id() from public, anon, authenticated;

create or replace function public.notify_ticket_watchers(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_kind text,
  p_payload jsonb,
  p_actor_id uuid,
  p_skip_user_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_watcher record;
begin
  for v_watcher in
    select watcher.user_id
    from public.ticket_watchers watcher
    where watcher.ticket_id = p_ticket_id
      and not (watcher.user_id = any(coalesce(p_skip_user_ids, '{}'::uuid[])))
  loop
    -- Skips the actor and anybody who may no longer read the ticket.
    perform public.push_insert_ticket_notification(
      p_tenant_id,
      v_watcher.user_id,
      p_ticket_id,
      p_kind,
      p_payload,
      p_actor_id
    );
  end loop;
exception when others then
  return;
end;
$$;
revoke all on function public.notify_ticket_watchers(uuid, uuid, text, jsonb, uuid, uuid[])
  from public, anon, authenticated;

create or replace function public.ticket_watch_notify_ticket_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor_id uuid;
  v_actor_name text;
  v_status record;
  v_assignee_name text;
begin
  if not exists (select 1 from public.ticket_watchers where ticket_id = new.id) then
    return new;
  end if;
  v_actor_id := public.ticket_watch_actor_id();
  if v_actor_id is not null then
    select profile.display_name into v_actor_name
    from public.user_profiles profile where profile.id = v_actor_id;
  end if;

  if new.status_id is distinct from old.status_id then
    select status.label, status.is_closed into v_status
    from public.ticket_statuses status where status.id = new.status_id;
    perform public.notify_ticket_watchers(
      new.tenant_id,
      new.id,
      'ticket.watch.status',
      jsonb_strip_nulls(jsonb_build_object(
        'ticketNumber', new.ticket_number,
        'statusLabel', v_status.label,
        'closed', coalesce(v_status.is_closed, false),
        'actorName', v_actor_name
      )),
      v_actor_id,
      -- The requester already hears about a resolution.
      case when old.resolved_at is null and new.resolved_at is not null
        then array[new.requester_id] else '{}'::uuid[] end
    );
  end if;

  if new.assigned_agent_id is distinct from old.assigned_agent_id then
    if new.assigned_agent_id is not null then
      select profile.display_name into v_assignee_name
      from public.user_profiles profile where profile.id = new.assigned_agent_id;
    end if;
    perform public.notify_ticket_watchers(
      new.tenant_id,
      new.id,
      'ticket.watch.assigned',
      jsonb_strip_nulls(jsonb_build_object(
        'ticketNumber', new.ticket_number,
        'assigneeName', v_assignee_name,
        'unassigned', new.assigned_agent_id is null,
        'actorName', v_actor_name
      )),
      v_actor_id,
      -- The new assignee already gets "Ticket zugewiesen".
      case when new.assigned_agent_id is not null
        then array[new.assigned_agent_id] else '{}'::uuid[] end
    );
  end if;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.ticket_watch_notify_ticket_change() from public, anon, authenticated;

create or replace trigger ticket_watch_notify_ticket_change
  after update of status_id, assigned_agent_id on public.tickets
  for each row execute function public.ticket_watch_notify_ticket_change();

create or replace function public.ticket_watch_notify_comment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket record;
  v_author_name text;
  v_skip uuid[] := '{}'::uuid[];
begin
  if not exists (select 1 from public.ticket_watchers where ticket_id = new.ticket_id) then
    return new;
  end if;
  select ticket.tenant_id, ticket.id, ticket.ticket_number, ticket.requester_id,
         ticket.affected_user_id, ticket.assigned_agent_id
  into v_ticket
  from public.tickets ticket
  where ticket.id = new.ticket_id;
  if not found then
    return new;
  end if;
  select profile.display_name into v_author_name
  from public.user_profiles profile where profile.id = new.author_id;

  if new.visibility = 'external' then
    -- Mirrors push_notify_ticket_comment: a requester reply reaches the
    -- assignee, a support reply reaches the requester.
    if new.author_id = v_ticket.requester_id
       or new.author_id is not distinct from v_ticket.affected_user_id then
      if v_ticket.assigned_agent_id is not null then
        v_skip := array[v_ticket.assigned_agent_id];
      end if;
    else
      v_skip := array[v_ticket.requester_id];
    end if;
  end if;

  perform public.notify_ticket_watchers(
    v_ticket.tenant_id,
    v_ticket.id,
    'ticket.watch.comment',
    jsonb_strip_nulls(jsonb_build_object(
      'ticketNumber', v_ticket.ticket_number,
      'commentId', new.id,
      'visibility', new.visibility::text,
      'authorName', v_author_name
    )),
    new.author_id,
    v_skip
  );
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function public.ticket_watch_notify_comment() from public, anon, authenticated;

create or replace trigger ticket_watch_notify_comment
  after insert on public.ticket_comments
  for each row execute function public.ticket_watch_notify_comment();

-- Push: watched-ticket updates use the "mention" category (the person chose
-- to follow the ticket personally).
create or replace function public.push_notification_category(p_kind text)
returns text
language sql
immutable strict
set search_path = pg_catalog
as $function$
  select case
    when p_kind = 'ticket.assigned' then 'assigned'
    when p_kind = 'ticket.requester_reply' then 'requester_reply'
    when p_kind = 'ticket.support_reply' then 'support_reply'
    when p_kind = 'ticket.mention' then 'mention'
    when p_kind in ('ticket.supervisor_request', 'ticket.supervisor_answer') then 'mention'
    when p_kind like 'ticket.watch.%' then 'mention'
    when p_kind = 'ticket.resolved' then 'resolved'
    when p_kind = 'ticket.approval.requested' then 'approval'
    when p_kind = 'ticket.follow_up_due' then 'follow_up'
    when p_kind = 'ticket.escalation_opened' then 'escalation'
    when p_kind like 'ticket.sla.%' then 'sla'
    when p_kind = 'contract.deadline' then 'contract_deadline'
    when p_kind = 'inventory.low_stock' then 'inventory_low_stock'
    when p_kind like 'shop.order.%' then 'shop'
    when p_kind like 'service_task.%' then 'service_task'
    else null
  end;
$function$;

commit;
