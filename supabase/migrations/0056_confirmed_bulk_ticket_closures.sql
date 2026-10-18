begin;
set local search_path = pg_catalog, public;

-- Eine Massenänderung in einen geschlossenen Status braucht eine ausdrückliche
-- Bestätigung. Die Prüfung liegt in der service-role-exklusiven RPC, damit sie
-- weder über die Weboberfläche noch über einen direkten Funktionsaufruf
-- umgangen werden kann.
drop function public.bulk_update_ticket_statuses(uuid, uuid, uuid[], text);

create function public.bulk_update_ticket_statuses(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_ticket_ids uuid[],
  p_status_key text,
  p_confirm_close boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_status record;
  v_updated integer := 0;
  v_now timestamptz := timezone('utc', now());
  v_requested integer;
begin
  v_requested := coalesce(cardinality(p_ticket_ids), 0);
  if p_actor_id is null
    or p_tenant_id is null
    or p_confirm_close is null
    or p_status_key !~ '^[a-z][a-z0-9_]{0,63}$'
    or v_requested < 1
    or v_requested > 50
    or (select count(distinct ticket_id) from unnest(p_ticket_ids) as ticket_id) <> v_requested then
    raise exception 'Invalid bulk ticket status request' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.tenant_memberships membership
    join public.tenants tenant on tenant.id = membership.tenant_id and tenant.status = 'active'
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_actor_id
      and membership.status = 'active'
  ) then
    raise exception 'Tenant membership required' using errcode = '42501';
  end if;

  select status.id, status.key, status.is_closed
  into v_status
  from public.ticket_statuses status
  where status.tenant_id = p_tenant_id
    and status.key = p_status_key;
  if not found then
    raise exception 'Ticket status not found' using errcode = 'P0002';
  end if;

  if v_status.is_closed and not p_confirm_close then
    raise exception 'Bulk ticket close confirmation required' using errcode = 'P0001';
  end if;

  if (
    select count(*)
    from public.tickets ticket
    where ticket.tenant_id = p_tenant_id
      and ticket.id = any(p_ticket_ids)
  ) <> v_requested then
    raise exception 'One or more tickets are unavailable' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.tickets ticket
    where ticket.tenant_id = p_tenant_id
      and ticket.id = any(p_ticket_ids)
      and (
        not exists (
          select 1
          from public.department_memberships department_membership
          where department_membership.user_id = p_actor_id
            and department_membership.tenant_id = p_tenant_id
            and department_membership.department_id = ticket.department_id
            and department_membership.status = 'active'
        )
        or not exists (
          select 1
          from public.user_role_assignments assignment
          join public.roles role
            on role.id = assignment.role_id
            and role.tenant_id = assignment.tenant_id
            and role.active
            and role.scope in ('tenant', 'department')
          join public.role_permissions role_permission
            on role_permission.role_id = role.id
          where assignment.user_id = p_actor_id
            and assignment.tenant_id = p_tenant_id
            and role_permission.permission_code = 'ticket.update'
            and assignment.starts_at <= v_now
            and (assignment.expires_at is null or assignment.expires_at > v_now)
            and (role.scope = 'tenant' or assignment.department_id = ticket.department_id)
        )
      )
  ) then
    raise exception 'Ticket update permission required for every selected ticket'
      using errcode = '42501';
  end if;

  if v_status.is_closed and exists (
    select 1
    from public.tickets ticket
    where ticket.tenant_id = p_tenant_id
      and ticket.id = any(p_ticket_ids)
      and ticket.status_id is distinct from v_status.id
      and not exists (
        select 1
        from public.user_role_assignments assignment
        join public.roles role
          on role.id = assignment.role_id
          and role.tenant_id = assignment.tenant_id
          and role.active
          and role.scope in ('tenant', 'department')
        join public.role_permissions role_permission
          on role_permission.role_id = role.id
        where assignment.user_id = p_actor_id
          and assignment.tenant_id = p_tenant_id
          and role_permission.permission_code = 'ticket.close'
          and assignment.starts_at <= v_now
          and (assignment.expires_at is null or assignment.expires_at > v_now)
          and (role.scope = 'tenant' or assignment.department_id = ticket.department_id)
      )
  ) then
    raise exception 'Ticket close permission required for every selected ticket'
      using errcode = '42501';
  end if;

  with changed_tickets as (
    update public.tickets ticket
    set status_id = v_status.id,
        closed_at = case when v_status.is_closed then v_now else null end,
        resolved_at = case
          when v_status.key = 'resolved' then v_now
          else ticket.resolved_at
        end,
        waiting_since = case
          when v_status.key like 'waiting%' then v_now
          else null
        end
    where ticket.tenant_id = p_tenant_id
      and ticket.id = any(p_ticket_ids)
      and ticket.status_id is distinct from v_status.id
    returning ticket.id
  ), inserted_events as (
    insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
    select
      changed_ticket.id,
      p_actor_id,
      'ticket.bulk_status_updated',
      jsonb_build_object(
        'changedFields', jsonb_build_array('status'),
        'statusKey', v_status.key,
        'confirmedClose', v_status.is_closed,
        'source', 'bulk'
      )
    from changed_tickets changed_ticket
    returning ticket_id
  )
  select count(*) into v_updated from inserted_events;

  return jsonb_build_object(
    'requested', v_requested,
    'updated', v_updated,
    'statusKey', v_status.key
  );
end;
$$;

revoke all on function public.bulk_update_ticket_statuses(uuid, uuid, uuid[], text, boolean)
  from public, anon, authenticated;
grant execute on function public.bulk_update_ticket_statuses(uuid, uuid, uuid[], text, boolean)
  to service_role;

comment on function public.bulk_update_ticket_statuses(uuid, uuid, uuid[], text, boolean) is
  'Atomically updates up to 50 authorized tickets to one tenant-local status, requiring explicit confirmation for closed target statuses and recording one event per changed ticket.';

commit;
