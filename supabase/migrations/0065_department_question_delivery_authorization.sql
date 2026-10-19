begin;

set local search_path = pg_catalog, public;

-- 0064's routing helpers are intentionally private to clients, but they are
-- required by the service-role Edge Function that builds the safe recipient list.
grant execute on function public.is_department_question_route_candidate(uuid, uuid, uuid)
  to service_role;
grant execute on function public.department_question_recipient(uuid, uuid)
  to service_role;

-- A queued notification must be re-authorized immediately before provider
-- delivery. A revoked department role, a reassigned ticket or a closed question
-- therefore prevents both e-mail and APNs delivery.
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
set search_path = pg_catalog, public
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
      )
    else false
  end;
$$;
revoke all on function public.department_question_delivery_authorized(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.department_question_delivery_authorized(uuid, uuid, uuid, text)
  to service_role;

-- This worker-side sweep runs directly before the existing atomic claim. It
-- skips only the new sensitive notification kinds and leaves all other pushes
-- untouched.
create or replace function public.push_skip_unauthorized_department_question_outbox()
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
  where outbox.notification_id = notification.id
    and outbox.tenant_id = notification.tenant_id
    and outbox.status in ('pending', 'sending')
    and notification.kind in (
      'ticket.department_question.asked',
      'ticket.department_question.answered'
    )
    and not coalesce(
      case
        when coalesce(notification.payload ->> 'questionId', '')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then public.department_question_delivery_authorized(
          outbox.tenant_id,
          (notification.payload ->> 'questionId')::uuid,
          outbox.user_id,
          notification.kind
        )
        else false
      end,
      false
    );
  get diagnostics v_skipped = row_count;
  return v_skipped;
end;
$$;
revoke all on function public.push_skip_unauthorized_department_question_outbox()
  from public, anon, authenticated;
grant execute on function public.push_skip_unauthorized_department_question_outbox()
  to service_role;

commit;
