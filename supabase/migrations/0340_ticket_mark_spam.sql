begin;

set local search_path = pg_catalog, public;

-- «Als Spam/Phishing einstufen» in the ticket detail: one atomic step that
-- writes an internal note, hands the ticket to the 2nd level team of its
-- department (e.g. «System Engineer») and records the classification once.
-- The standard reply to the requester (template «phishing_thanks») is queued
-- by the Edge Function ticket-support-levels after this function succeeded.
-- Permissions are checked there; only service_role may call this.
create or replace function public.ticket_mark_spam(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_actor_id uuid,
  p_target_team_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_ticket public.tickets%rowtype;
  v_closed boolean;
  v_current_level smallint;
  v_target public.teams%rowtype;
  v_note text;
  v_comment_id uuid;
  v_change_id uuid;
  v_moved boolean;
begin
  if p_actor_id is null or p_target_team_id is null then
    raise exception 'ticket_spam_invalid'
      using errcode = '22023', hint = 'ticket_spam_invalid';
  end if;

  select * into v_ticket
  from public.tickets
  where id = p_ticket_id and tenant_id = p_tenant_id and deleted_at is null
  for update;
  if not found then
    raise exception 'ticket_not_found' using errcode = 'P0002', hint = 'ticket_not_found';
  end if;
  select is_closed into v_closed from public.ticket_statuses where id = v_ticket.status_id;
  if coalesce(v_closed, false) or v_ticket.merged_into_ticket_id is not null then
    raise exception 'support_level_ticket_closed'
      using errcode = '22023', hint = 'support_level_ticket_closed';
  end if;
  -- The row lock above serialises concurrent clicks: the reply goes out once.
  if exists (
    select 1 from public.ticket_events event
    where event.ticket_id = v_ticket.id and event.event_type = 'ticket.marked_spam'
  ) then
    raise exception 'ticket_spam_already_marked'
      using errcode = '22023', hint = 'ticket_spam_already_marked';
  end if;

  select * into v_target
  from public.teams
  where id = p_target_team_id
    and tenant_id = p_tenant_id
    and department_id = v_ticket.department_id
    and active
    and support_level = 2
  for share;
  if not found then
    raise exception 'ticket_spam_target_invalid'
      using errcode = '22023', hint = 'ticket_spam_target_invalid';
  end if;

  v_current_level := public.team_support_level(v_ticket.assigned_team_id);
  v_moved := v_ticket.assigned_team_id is distinct from v_target.id;
  v_note := 'Als Spam/Phishing eingestuft. Die anfragende Person erhält die Standardantwort, '
    || 'das Ticket geht an den 2nd Level (' || v_target.name || ').';

  insert into public.ticket_comments (ticket_id, author_id, visibility, body)
  values (v_ticket.id, p_actor_id, 'internal', v_note)
  returning id into v_comment_id;

  if v_moved then
    perform set_config(
      'nextdesk.support_level_handover',
      jsonb_build_object(
        'ticketId', v_ticket.id,
        'actorId', p_actor_id,
        'note', v_note,
        'commentId', v_comment_id
      )::text,
      true
    );
    update public.tickets
    set assigned_team_id = v_target.id,
        assigned_agent_id = null
    where id = v_ticket.id;
    perform set_config('nextdesk.support_level_handover', '', true);

    select change.id into v_change_id
    from public.ticket_support_level_changes change
    where change.ticket_id = v_ticket.id and change.comment_id = v_comment_id
    order by change.seq desc
    limit 1;

    insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
    values (
      v_ticket.id,
      p_actor_id,
      'ticket.support_level_changed',
      jsonb_build_object(
        'direction', case when v_current_level > 2 then 'returned' else 'escalated' end,
        'fromLevel', v_current_level,
        'toLevel', 2,
        'fromTeamId', v_ticket.assigned_team_id,
        'toTeamId', v_target.id,
        'toTeamName', v_target.name,
        'toAgentId', null,
        'commentId', v_comment_id,
        'changeId', v_change_id,
        'reason', 'spam'
      )
    );
  end if;

  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (
    v_ticket.id,
    p_actor_id,
    'ticket.marked_spam',
    jsonb_build_object(
      'teamId', v_target.id,
      'teamName', v_target.name,
      'moved', v_moved,
      'commentId', v_comment_id
    )
  );

  return jsonb_build_object(
    'teamId', v_target.id,
    'teamName', v_target.name,
    'fromLevel', v_current_level,
    'moved', v_moved,
    'commentId', v_comment_id
  );
end;
$$;

revoke all on function public.ticket_mark_spam(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.ticket_mark_spam(uuid, uuid, uuid, uuid)
  to service_role;

commit;
