begin;

set local search_path = pg_catalog, public;

-- Storage objects are not removed by a database cascade. Persist their cleanup
-- work before deleting the ticket so failed provider calls remain retryable.
create table public.ticket_deletion_attachment_cleanup (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null,
  storage_bucket text not null default 'ticket-attachments'
    check (storage_bucket = 'ticket-attachments'),
  storage_object_path text not null unique
    check (
      char_length(storage_object_path) between 80 and 256
      and storage_object_path = lower(storage_object_path)
      and split_part(storage_object_path, '/', 1) = tenant_id::text
      and split_part(storage_object_path, '/', 2) = ticket_id::text
      and split_part(storage_object_path, '/', 3) ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and array_length(string_to_array(storage_object_path, '/'), 1) = 3
    ),
  status text not null default 'pending'
    check (status in ('pending', 'processing')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 100),
  available_at timestamptz not null default timezone('utc', now()),
  lease_expires_at timestamptz,
  last_attempt_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index ticket_deletion_attachment_cleanup_due_idx
  on public.ticket_deletion_attachment_cleanup (status, available_at, created_at);

alter table public.ticket_deletion_attachment_cleanup enable row level security;
alter table public.ticket_deletion_attachment_cleanup force row level security;
revoke all on table public.ticket_deletion_attachment_cleanup
  from public, anon, authenticated;
grant select, insert, update, delete on table public.ticket_deletion_attachment_cleanup
  to service_role;
create policy ticket_deletion_attachment_cleanup_service_role_only
  on public.ticket_deletion_attachment_cleanup
  for all to service_role using (true) with check (true);

create function public.claim_ticket_deletion_attachment_cleanup(
  p_tenant_id uuid,
  p_limit integer default 100
)
returns table (
  cleanup_id uuid,
  storage_bucket text,
  storage_object_path text
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    ) <> 'service_role' then
    raise exception 'Ticket attachment cleanup requires service_role' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Invalid ticket attachment cleanup limit' using errcode = '22023';
  end if;

  return query
  with claimed_candidates as (
    select cleanup.id
    from public.ticket_deletion_attachment_cleanup cleanup
    where cleanup.tenant_id = p_tenant_id
      and cleanup.attempt_count < 100
      and (
        (
          cleanup.status = 'pending'
          and cleanup.available_at <= timezone('utc', now())
        ) or (
          cleanup.status = 'processing'
          and cleanup.lease_expires_at <= timezone('utc', now())
        )
      )
    order by cleanup.available_at, cleanup.created_at
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.ticket_deletion_attachment_cleanup cleanup
    set status = 'processing',
        attempt_count = cleanup.attempt_count + 1,
        last_attempt_at = timezone('utc', now()),
        lease_expires_at = timezone('utc', now()) + interval '5 minutes'
    from claimed_candidates candidate
    where cleanup.id = candidate.id
    returning cleanup.id, cleanup.storage_bucket, cleanup.storage_object_path
  )
  select claimed.id, claimed.storage_bucket, claimed.storage_object_path
  from claimed;
end;
$$;

create function public.complete_ticket_deletion_attachment_cleanup(
  p_cleanup_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_requested integer;
  v_deleted integer;
begin
  if coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    ) <> 'service_role' then
    raise exception 'Ticket attachment cleanup requires service_role' using errcode = '42501';
  end if;
  v_requested := coalesce(cardinality(p_cleanup_ids), 0);
  if v_requested < 1
     or v_requested > 100
     or (select count(distinct cleanup_id) from unnest(p_cleanup_ids) as cleanup_id) <> v_requested then
    raise exception 'Invalid ticket attachment cleanup completion' using errcode = '22023';
  end if;

  delete from public.ticket_deletion_attachment_cleanup cleanup
  where cleanup.id = any(p_cleanup_ids)
    and cleanup.status = 'processing';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create function public.release_ticket_deletion_attachment_cleanup(
  p_cleanup_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_requested integer;
  v_released integer;
begin
  if coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    ) <> 'service_role' then
    raise exception 'Ticket attachment cleanup requires service_role' using errcode = '42501';
  end if;
  v_requested := coalesce(cardinality(p_cleanup_ids), 0);
  if v_requested < 1
     or v_requested > 100
     or (select count(distinct cleanup_id) from unnest(p_cleanup_ids) as cleanup_id) <> v_requested then
    raise exception 'Invalid ticket attachment cleanup release' using errcode = '22023';
  end if;

  update public.ticket_deletion_attachment_cleanup cleanup
  set status = 'pending',
      available_at = timezone('utc', now()) + interval '5 minutes',
      lease_expires_at = null
  where cleanup.id = any(p_cleanup_ids)
    and cleanup.status = 'processing';
  get diagnostics v_released = row_count;
  return v_released;
end;
$$;

revoke all on function public.claim_ticket_deletion_attachment_cleanup(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.complete_ticket_deletion_attachment_cleanup(uuid[])
  from public, anon, authenticated;
revoke all on function public.release_ticket_deletion_attachment_cleanup(uuid[])
  from public, anon, authenticated;
grant execute on function public.claim_ticket_deletion_attachment_cleanup(uuid, integer)
  to service_role;
grant execute on function public.complete_ticket_deletion_attachment_cleanup(uuid[])
  to service_role;
grant execute on function public.release_ticket_deletion_attachment_cleanup(uuid[])
  to service_role;

-- Ticket deletion is intentionally available only through this service-role
-- procedure. It validates each selected ticket against the actor's current
-- tenant, department and ticket.delete permission before any row is removed.
create function public.bulk_delete_tickets(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_ticket_ids uuid[],
  p_confirm_delete boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_requested integer;
  v_deleted integer := 0;
  v_cleanup_queued integer := 0;
begin
  v_requested := coalesce(cardinality(p_ticket_ids), 0);
  if p_actor_id is null
    or p_tenant_id is null
    or p_confirm_delete is null
    or v_requested < 1
    or v_requested > 50
    or (select count(distinct ticket_id) from unnest(p_ticket_ids) as ticket_id) <> v_requested then
    raise exception 'Invalid bulk ticket delete request' using errcode = '22023';
  end if;

  if not p_confirm_delete then
    raise exception 'Bulk ticket delete confirmation required' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.tenant_memberships membership
    join public.tenants tenant
      on tenant.id = membership.tenant_id
      and tenant.status = 'active'
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_actor_id
      and membership.status = 'active'
  ) then
    raise exception 'Tenant membership required' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.tenant_data_retention_policies retention
    where retention.tenant_id = p_tenant_id
      and retention.legal_hold
  ) then
    raise exception 'Ticket deletion blocked by legal hold' using errcode = 'P0001';
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
            and role_permission.permission_code = 'ticket.delete'
            and assignment.starts_at <= v_now
            and (assignment.expires_at is null or assignment.expires_at > v_now)
            and (role.scope = 'tenant' or assignment.department_id = ticket.department_id)
        )
      )
  ) then
    raise exception 'Ticket delete permission required for every selected ticket'
      using errcode = '42501';
  end if;

  insert into public.ticket_deletion_attachment_cleanup (
    tenant_id,
    ticket_id,
    storage_bucket,
    storage_object_path
  )
  select
    p_tenant_id,
    attachment.ticket_id,
    attachment.storage_bucket,
    attachment.storage_object_path
  from public.ticket_attachments attachment
  where attachment.ticket_id = any(p_ticket_ids)
  on conflict (storage_object_path) do nothing;
  get diagnostics v_cleanup_queued = row_count;

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    severity,
    metadata
  )
  select
    p_tenant_id,
    p_actor_id,
    'ticket.deleted',
    'ticket',
    ticket.id,
    'warning',
    jsonb_build_object(
      'source', 'bulk',
      'confirmedDelete', true,
      'requested', v_requested
    )
  from public.tickets ticket
  where ticket.tenant_id = p_tenant_id
    and ticket.id = any(p_ticket_ids);

  with deleted_tickets as (
    delete from public.tickets ticket
    where ticket.tenant_id = p_tenant_id
      and ticket.id = any(p_ticket_ids)
    returning ticket.id
  )
  select count(*) into v_deleted from deleted_tickets;

  if v_deleted <> v_requested then
    raise exception 'Bulk ticket delete did not remove every ticket' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'requested', v_requested,
    'deleted', v_deleted,
    'cleanupQueued', v_cleanup_queued
  );
end;
$$;

revoke all on function public.bulk_delete_tickets(uuid, uuid, uuid[], boolean)
  from public, anon, authenticated;
grant execute on function public.bulk_delete_tickets(uuid, uuid, uuid[], boolean)
  to service_role;

comment on function public.bulk_delete_tickets(uuid, uuid, uuid[], boolean) is
  'Atomically and permanently deletes up to 50 authorized tickets only after explicit confirmation, records a durable audit event per ticket and queues attachment storage cleanup for the trusted Edge Function.';

commit;
