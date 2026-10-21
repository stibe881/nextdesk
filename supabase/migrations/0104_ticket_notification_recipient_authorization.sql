begin;

set local search_path = pg_catalog, public;

-- Service-role notification paths must evaluate the same current ticket access
-- boundary as a user session.  In particular, a team assignment narrows broad
-- department access; it must never turn a watcher, mention or route target into
-- a recipient merely because they are an active tenant member.
create or replace function public.ticket_notification_recipient_authorized(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
    from public.tickets ticket
    join public.tenant_memberships membership
      on membership.tenant_id = ticket.tenant_id
     and membership.user_id = p_user_id
     and membership.status = 'active'
    where ticket.id = p_ticket_id
      and ticket.tenant_id = p_tenant_id
      and (
        ticket.requester_id = p_user_id
        or ticket.affected_user_id = p_user_id
        or exists (
          select 1
          from public.customer_memberships customer_membership
          join public.customer_organizations organization
            on organization.id = customer_membership.customer_organization_id
          where customer_membership.user_id = p_user_id
            and customer_membership.access = 'company'
            and organization.id = ticket.customer_organization_id
            and organization.tenant_id = ticket.tenant_id
            and organization.active
            and organization.ticket_access <> 'disabled'
        )
        or (
          public.can_user_access_ticket_team(ticket.id, p_user_id)
          and (
            (
              ticket.assigned_agent_id = p_user_id
              and public.user_has_ticket_permission_for(
                p_user_id,
                ticket.tenant_id,
                ticket.department_id,
                'ticket.read.assigned'
              )
            )
            or public.user_has_ticket_permission_for(
              p_user_id,
              ticket.tenant_id,
              ticket.department_id,
              'ticket.read.department'
            )
          )
        )
      )
  );
$$;
revoke all on function public.ticket_notification_recipient_authorized(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.ticket_notification_recipient_authorized(uuid, uuid, uuid)
  to service_role;

-- All ticket_notifications are generated with elevated database credentials.
-- Return NULL rather than throwing so a stale recipient can neither learn why
-- access was denied nor break the underlying ticket operation.
create or replace function public.suppress_unauthorized_ticket_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not public.ticket_notification_recipient_authorized(
    new.tenant_id,
    new.ticket_id,
    new.user_id
  ) then
    return null;
  end if;
  return new;
exception when others then
  return null;
end;
$$;
revoke all on function public.suppress_unauthorized_ticket_notification()
  from public, anon, authenticated;
drop trigger if exists ticket_notifications_authorize_recipient_trigger
  on public.ticket_notifications;
create trigger ticket_notifications_authorize_recipient_trigger
  before insert on public.ticket_notifications
  for each row
  when (new.ticket_id is not null)
  execute function public.suppress_unauthorized_ticket_notification();

-- Keep the explicit helper fence as well: most trigger-driven notification
-- paths use this helper and thereby avoid attempting an insert for a recipient
-- who has already lost access.
create or replace function public.push_insert_ticket_notification(
  p_tenant_id uuid,
  p_user_id uuid,
  p_ticket_id uuid,
  p_kind text,
  p_payload jsonb,
  p_actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_user_id is null
     or p_user_id = p_actor_id
     or not public.ticket_notification_recipient_authorized(
       p_tenant_id, p_ticket_id, p_user_id
     ) then
    return;
  end if;

  insert into public.ticket_notifications (tenant_id, user_id, ticket_id, kind, payload)
  values (p_tenant_id, p_user_id, p_ticket_id, p_kind, p_payload);
exception when others then
  -- Notification generation is strictly best-effort and must never abort ticket work.
  return;
end;
$$;
revoke all on function public.push_insert_ticket_notification(uuid, uuid, uuid, text, jsonb, uuid)
  from public, anon, authenticated;

-- E-mail workers retain their delivery-kind/state checks and additionally apply
-- the current team-aware ticket recipient check immediately before sending.
create or replace function public.department_question_delivery_authorized(
  p_tenant_id uuid,
  p_question_id uuid,
  p_recipient_user_id uuid,
  p_delivery_kind text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select case
    when p_delivery_kind in ('department_question', 'ticket.department_question.asked') then
      exists (
        select 1
        from public.ticket_department_questions question
        join public.tickets ticket
          on ticket.id = question.ticket_id
         and ticket.tenant_id = question.tenant_id
        where question.tenant_id = p_tenant_id
          and question.id = p_question_id
          and question.status = 'open'
          and question.recipient_user_id = p_recipient_user_id
          and ticket.department_id = question.department_id
          and public.is_department_question_route_candidate(
            p_tenant_id, question.department_id, p_recipient_user_id
          )
          and public.ticket_notification_recipient_authorized(
            p_tenant_id, ticket.id, p_recipient_user_id
          )
      )
    when p_delivery_kind in ('department_answer', 'ticket.department_question.answered') then
      exists (
        select 1
        from public.ticket_department_questions question
        join public.tickets ticket
          on ticket.id = question.ticket_id
         and ticket.tenant_id = question.tenant_id
        join public.tenant_memberships membership
          on membership.tenant_id = ticket.tenant_id
         and membership.user_id = p_recipient_user_id
         and membership.status = 'active'
        where question.tenant_id = p_tenant_id
          and question.id = p_question_id
          and question.status = 'answered'
          and ticket.assigned_agent_id = p_recipient_user_id
          and ticket.department_id = question.department_id
          and public.user_has_ticket_permission_for(
            p_recipient_user_id, p_tenant_id, ticket.department_id, 'ticket.update'
          )
          and public.ticket_notification_recipient_authorized(
            p_tenant_id, ticket.id, p_recipient_user_id
          )
      )
    else false
  end;
$$;
revoke all on function public.department_question_delivery_authorized(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.department_question_delivery_authorized(uuid, uuid, uuid, text)
  to service_role;

-- Existing queues can outlive a membership or team change.  Remove sensitive
-- ticket entries before claim without disclosing recipient or team details.
create or replace function public.push_skip_unauthorized_ticket_outbox()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_skipped integer := 0;
begin
  update public.push_outbox outbox
  set status = 'skipped',
      last_error = 'recipient_not_authorized',
      claimed_at = null
  from public.ticket_notifications notification
  where outbox.source_type = 'ticket'
    and outbox.notification_id = notification.id
    and outbox.tenant_id = notification.tenant_id
    and outbox.status in ('pending', 'sending')
    and not public.ticket_notification_recipient_authorized(
      outbox.tenant_id,
      notification.ticket_id,
      outbox.user_id
    );
  get diagnostics v_skipped = row_count;
  return v_skipped;
end;
$$;
revoke all on function public.push_skip_unauthorized_ticket_outbox()
  from public, anon, authenticated;
grant execute on function public.push_skip_unauthorized_ticket_outbox()
  to service_role;

commit;
