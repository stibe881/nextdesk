begin;
set local search_path = pg_catalog, public;

-- Papierkorb für Tickets.
--
-- Löschen markiert ein Ticket nur noch (deleted_at). Gelöschte Tickets sind
-- überall ausgeblendet (can_read_ticket, RLS, Benachrichtigungen, ausgehende
-- Mails) und lassen sich 90 Tage lang wiederherstellen. Danach werden sie
-- endgültig entfernt (Migration 0263).

alter table public.tickets
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.user_profiles(id) on delete set null;

create index if not exists tickets_trash_idx
  on public.tickets (tenant_id, deleted_at)
  where deleted_at is not null;

-- Clients (authenticated) sehen gelöschte Tickets nie direkt.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tickets'
      and policyname = 'tickets_hide_deleted'
  ) then
    create policy tickets_hide_deleted on public.tickets
      as restrictive
      for select
      to anon, authenticated
      using (deleted_at is null);
  end if;
end;
$$;

-- Zentrale Leserechte: gelöschte Tickets sind für niemanden lesbar.
create or replace function public.can_read_ticket(p_ticket_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'auth'
as $function$
  select exists (
    select 1
    from public.tickets ticket
    where ticket.id = p_ticket_id
      and ticket.deleted_at is null
      and public.is_active_tenant_member(ticket.tenant_id)
      and (
        ticket.requester_id = auth.uid()
        or ticket.affected_user_id = auth.uid()
        or public.customer_can_read_ticket(ticket.id)
        or (
          ticket.assigned_agent_id = auth.uid()
          and public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.read.assigned')
          and (
            ticket.assigned_team_id is null
            or public.is_current_user_team_member(ticket.tenant_id, ticket.assigned_team_id)
          )
        )
        or (
          public.has_ticket_permission(ticket.tenant_id, ticket.department_id, 'ticket.read.department')
          and (
            ticket.assigned_team_id is null
            or public.is_current_user_team_member(ticket.tenant_id, ticket.assigned_team_id)
          )
        )
        or public.employee_can_read_ticket(ticket.id)
        or public.delegate_can_read_ticket_for(auth.uid(), ticket.id)
      )
  );
$function$;

create or replace function public.customer_can_read_ticket(p_ticket_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'auth'
as $function$
  select exists (
    select 1
    from public.tickets ticket
    join public.customer_memberships membership on membership.user_id = auth.uid()
    join public.customer_organizations organization
      on organization.id = membership.customer_organization_id
    where ticket.id = p_ticket_id
      and ticket.deleted_at is null
      and ticket.customer_organization_id = organization.id
      and organization.tenant_id = ticket.tenant_id
      and organization.active
      and organization.ticket_access <> 'disabled'
      and membership.access = 'company'
  );
$function$;

create or replace function public.delegate_can_read_ticket_for(p_user_id uuid, p_ticket_id uuid)
returns boolean
language sql
stable security definer cost 1000
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
  select exists (
    select 1
    from public.tickets ticket
    where ticket.id = p_ticket_id
      and ticket.deleted_at is null
      and ticket.assigned_agent_id is not null
      and ticket.assigned_agent_id = any(
        public.active_delegators_for(ticket.tenant_id, p_user_id)
      )
  );
$function$;

create or replace function public.employee_can_read_ticket_for(p_user_id uuid, p_ticket_id uuid)
returns boolean
language plpgsql
stable security definer cost 1000
set search_path to 'pg_catalog', 'public', 'auth', 'pg_temp'
as $function$
declare
  v_ticket public.tickets;
  v_me text;
  v_requester text;
begin
  if p_user_id is null then
    return false;
  end if;
  select * into v_ticket from public.tickets where id = p_ticket_id;
  if not found or v_ticket.deleted_at is not null or not exists (
    select 1 from public.tenant_memberships membership
    where membership.tenant_id = v_ticket.tenant_id
      and membership.user_id = p_user_id
      and membership.status = 'active'
  ) then
    return false;
  end if;

  if exists (
    select 1 from public.ticket_requesters contact
    where contact.id = v_ticket.requester_contact_id
      and contact.user_id = p_user_id
  ) then
    return true;
  end if;

  select nullif(lower(btrim(account.email)), '') into v_me
  from auth.users account where account.id = p_user_id;
  v_requester := public.ticket_requester_email(p_ticket_id);
  if v_me is null or v_requester is null then
    return false;
  end if;
  if v_me = v_requester then
    return true;
  end if;

  return exists (
    select 1
    from public.tenant_entra_directory_people manager
    join public.tenant_entra_directory_people report
      on report.tenant_id = manager.tenant_id
     and report.manager_entra_object_id = manager.entra_object_id
    where manager.tenant_id = v_ticket.tenant_id
      and lower(manager.email) = v_me
      and lower(report.email) = v_requester
      and coalesce(report.account_enabled, true)
  );
end;
$function$;

-- Keine Benachrichtigungen und keine ausgehenden Mails zu Tickets im
-- Papierkorb (z. B. aus Automationen, SLA, Erinnerungen).
create or replace function public.ticket_trash_skip_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.ticket_id is not null and exists (
    select 1 from public.tickets ticket
    where ticket.id = new.ticket_id and ticket.deleted_at is not null
  ) then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function public.ticket_trash_skip_notification() from public, anon, authenticated;

create or replace function public.ticket_trash_skip_outbound_mail()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.direction = 'outbound' and new.ticket_id is not null and exists (
    select 1 from public.tickets ticket
    where ticket.id = new.ticket_id and ticket.deleted_at is not null
  ) then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function public.ticket_trash_skip_outbound_mail() from public, anon, authenticated;

-- «0_» sorgt dafür, dass der Trigger vor den übrigen BEFORE-Triggern läuft.
create or replace trigger "0_ticket_trash_skip"
  before insert on public.ticket_notifications
  for each row execute function public.ticket_trash_skip_notification();
create or replace trigger "0_ticket_trash_skip"
  before insert on public.mail_messages
  for each row execute function public.ticket_trash_skip_outbound_mail();

-- Darf die Person Tickets dieser Abteilung löschen bzw. wiederherstellen?
create or replace function public.ticket_trash_allowed(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_department_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
      select 1
      from public.department_memberships department_membership
      where department_membership.user_id = p_actor_id
        and department_membership.tenant_id = p_tenant_id
        and department_membership.department_id = p_department_id
        and department_membership.status = 'active'
    )
    and exists (
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
        and assignment.starts_at <= timezone('utc', now())
        and (assignment.expires_at is null or assignment.expires_at > timezone('utc', now()))
        and (role.scope = 'tenant' or assignment.department_id = p_department_id)
    );
$$;
revoke all on function public.ticket_trash_allowed(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ticket_trash_allowed(uuid, uuid, uuid) to service_role;

create or replace function public.ticket_trash_require_member(p_actor_id uuid, p_tenant_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
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
end;
$$;
revoke all on function public.ticket_trash_require_member(uuid, uuid) from public, anon, authenticated;

-- Löschen = in den Papierkorb verschieben (gleiche Prüfungen wie bisher).
create or replace function public.bulk_delete_tickets(
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

  perform public.ticket_trash_require_member(p_actor_id, p_tenant_id);

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
      and ticket.deleted_at is null
  ) <> v_requested then
    raise exception 'One or more tickets are unavailable' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.tickets ticket
    where ticket.tenant_id = p_tenant_id
      and ticket.id = any(p_ticket_ids)
      and not public.ticket_trash_allowed(p_actor_id, p_tenant_id, ticket.department_id)
  ) then
    raise exception 'Ticket delete permission required for every selected ticket'
      using errcode = '42501';
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  )
  select
    p_tenant_id, p_actor_id, 'ticket.deleted', 'ticket', ticket.id, 'warning',
    jsonb_build_object(
      'source', 'bulk',
      'confirmedDelete', true,
      'requested', v_requested,
      'trash', true,
      'ticketNumber', ticket.ticket_number
    )
  from public.tickets ticket
  where ticket.tenant_id = p_tenant_id
    and ticket.id = any(p_ticket_ids);

  update public.tickets ticket
     set deleted_at = v_now,
         deleted_by = p_actor_id
   where ticket.tenant_id = p_tenant_id
     and ticket.id = any(p_ticket_ids)
     and ticket.deleted_at is null;
  get diagnostics v_deleted = row_count;

  if v_deleted <> v_requested then
    raise exception 'Bulk ticket delete did not remove every ticket' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'requested', v_requested,
    'deleted', v_deleted,
    'cleanupQueued', 0,
    'trash', true
  );
end;
$$;

revoke all on function public.bulk_delete_tickets(uuid, uuid, uuid[], boolean)
  from public, anon, authenticated;
grant execute on function public.bulk_delete_tickets(uuid, uuid, uuid[], boolean)
  to service_role;

comment on function public.bulk_delete_tickets(uuid, uuid, uuid[], boolean) is
  'Moves up to 50 authorized tickets to the trash (deleted_at) after explicit confirmation; they can be restored for 90 days and are then removed for good.';

-- Aus dem Papierkorb wiederherstellen.
create or replace function public.restore_deleted_tickets(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_ticket_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_requested integer;
  v_restored integer := 0;
begin
  v_requested := coalesce(cardinality(p_ticket_ids), 0);
  if p_actor_id is null
    or p_tenant_id is null
    or v_requested < 1
    or v_requested > 50
    or (select count(distinct ticket_id) from unnest(p_ticket_ids) as ticket_id) <> v_requested then
    raise exception 'Invalid ticket restore request' using errcode = '22023';
  end if;

  perform public.ticket_trash_require_member(p_actor_id, p_tenant_id);

  if (
    select count(*)
    from public.tickets ticket
    where ticket.tenant_id = p_tenant_id
      and ticket.id = any(p_ticket_ids)
      and ticket.deleted_at is not null
  ) <> v_requested then
    raise exception 'One or more tickets are not in the trash' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.tickets ticket
    where ticket.tenant_id = p_tenant_id
      and ticket.id = any(p_ticket_ids)
      and not public.ticket_trash_allowed(p_actor_id, p_tenant_id, ticket.department_id)
  ) then
    raise exception 'Ticket delete permission required for every selected ticket'
      using errcode = '42501';
  end if;

  update public.tickets ticket
     set deleted_at = null,
         deleted_by = null
   where ticket.tenant_id = p_tenant_id
     and ticket.id = any(p_ticket_ids)
     and ticket.deleted_at is not null;
  get diagnostics v_restored = row_count;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, severity, metadata
  )
  select
    p_tenant_id, p_actor_id, 'ticket.restored', 'ticket', ticket.id, 'info',
    jsonb_build_object('ticketNumber', ticket.ticket_number)
  from public.tickets ticket
  where ticket.tenant_id = p_tenant_id
    and ticket.id = any(p_ticket_ids);

  return jsonb_build_object('requested', v_requested, 'restored', v_restored);
end;
$$;
revoke all on function public.restore_deleted_tickets(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.restore_deleted_tickets(uuid, uuid, uuid[]) to service_role;

-- Papierkorb: Tickets, die die Person wiederherstellen darf.
create or replace function public.list_deleted_tickets(
  p_actor_id uuid,
  p_tenant_id uuid,
  p_limit integer default 200
)
returns table (
  id uuid,
  ticket_number text,
  subject text,
  department_id uuid,
  status_id uuid,
  priority_id uuid,
  requester_id uuid,
  assigned_agent_id uuid,
  created_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid,
  purge_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.ticket_trash_require_member(p_actor_id, p_tenant_id);
  return query
    select
      ticket.id, ticket.ticket_number, ticket.subject, ticket.department_id,
      ticket.status_id, ticket.priority_id, ticket.requester_id,
      ticket.assigned_agent_id, ticket.created_at, ticket.deleted_at,
      ticket.deleted_by, ticket.deleted_at + interval '90 days'
    from public.tickets ticket
    where ticket.tenant_id = p_tenant_id
      and ticket.deleted_at is not null
      and public.ticket_trash_allowed(p_actor_id, p_tenant_id, ticket.department_id)
    order by ticket.deleted_at desc
    limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;
revoke all on function public.list_deleted_tickets(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.list_deleted_tickets(uuid, uuid, integer) to service_role;

commit;
