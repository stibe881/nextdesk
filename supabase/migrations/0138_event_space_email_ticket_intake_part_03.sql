begin;

revoke all on function public.create_event_space_email_ticket_request(
  uuid, uuid, text, text, text, uuid, text, timestamptz, timestamptz, text[],
  boolean, boolean, boolean, boolean, boolean, text, text, text, text[]
) from public, anon, authenticated;

grant execute on function public.create_event_space_email_ticket_request(
  uuid, uuid, text, text, text, uuid, text, timestamptz, timestamptz, text[],
  boolean, boolean, boolean, boolean, boolean, text, text, text, text[]
) to service_role;


-- Manual recovery is deliberately a single, short-lived claim. It validates
-- tenant, active actor and the e-mail ticket/outbox relationship in the
-- database, but returns the source body only to the service-role Edge Function
-- that immediately processes it. No scheduler or automatic retry consumes this
-- queue. A stale lease can only be reclaimed by another explicit user action.
create or replace function public.claim_event_space_email_ticket_intake_retry(
  p_tenant_id uuid,
  p_ticket_id uuid,
  p_actor_id uuid
)
returns table(
  outcome text,
  ticket_subject text,
  ticket_description text,
  retry_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outbox public.event_space_ticket_intake_outbox%rowtype;
  v_subject text;
  v_description text;
  v_next_retry_count integer;
begin
  if p_tenant_id is null or p_ticket_id is null or p_actor_id is null then
    raise exception 'Invalid event-space intake recovery arguments' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_actor_id
      and membership.status = 'active'
  ) then
    raise exception 'The recovery actor is not an active tenant member' using errcode = '42501';
  end if;

  select outbox.* into v_outbox
  from public.event_space_ticket_intake_outbox outbox
  join public.tickets ticket
    on ticket.id = outbox.ticket_id
   and ticket.tenant_id = outbox.tenant_id
   and ticket.source = 'email'
  where outbox.ticket_id = p_ticket_id
    and outbox.tenant_id = p_tenant_id
  for update of outbox;
  if not found then
    return query select 'unavailable'::text, null::text, null::text, null::integer;
    return;
  end if;
  select ticket.subject, ticket.description
  into v_subject, v_description
  from public.tickets ticket
  where ticket.id = p_ticket_id
    and ticket.tenant_id = p_tenant_id
    and ticket.source = 'email';
  if not found then
    return query select 'unavailable'::text, null::text, null::text, null::integer;
    return;
  end if;
  if v_outbox.status in ('processed', 'ignored') then
    return query select 'not_retryable'::text, null::text, null::text, v_outbox.manual_retry_count;
    return;
  end if;
  if v_outbox.status = 'retrying'
    and v_outbox.retry_lease_expires_at > now() then
    return query select 'busy'::text, null::text, null::text, v_outbox.manual_retry_count;
    return;
  end if;
  if v_outbox.manual_retry_count >= 3 then
    return query select 'retry_limit_reached'::text, null::text, null::text, v_outbox.manual_retry_count;
    return;
  end if;
  if v_outbox.status not in ('pending', 'failed', 'retrying') then
    return query select 'unavailable'::text, null::text, null::text, null::integer;
    return;
  end if;

  update public.event_space_ticket_intake_outbox
  set status = 'retrying', manual_retry_count = manual_retry_count + 1,
      last_retry_at = now(),
      retry_lease_expires_at = now() + interval '5 minutes',
      last_error_code = null, updated_at = now()
  where ticket_id = p_ticket_id and tenant_id = p_tenant_id
  returning manual_retry_count into v_next_retry_count;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  ) values (
    p_tenant_id, p_actor_id, 'event_spaces.email_ticket_intake.retry_started',
    'event_space_ticket_intake_outbox', p_ticket_id, 'info',
    jsonb_build_object(
      'retryCount', v_next_retry_count,
      'statusBefore', v_outbox.status
    )
  );
  return query select 'claimed'::text, v_subject, v_description, v_next_retry_count;
end;
$$;


revoke all on function public.claim_event_space_email_ticket_intake_retry(
  uuid, uuid, uuid
) from public, anon, authenticated;

grant execute on function public.claim_event_space_email_ticket_intake_retry(
  uuid, uuid, uuid
) to service_role;

commit;
