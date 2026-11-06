begin;

set local search_path = pg_catalog, public;

-- Employees see their own tickets and the tickets of the people who report
-- to them directly (manager from Entra). A ticket belongs to a person when
-- the person requested it, is the requester contact (linked or by e-mail)
-- or is affected by it.

create or replace function public.current_user_email()
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
  select nullif(lower(btrim(account.email)), '')
  from auth.users account
  where account.id = auth.uid();
$$;
revoke all on function public.current_user_email() from public, anon;
grant execute on function public.current_user_email() to authenticated, service_role;

-- E-mail of the person who requested the ticket: the requester contact,
-- otherwise the requesting account.
create or replace function public.ticket_requester_email(p_ticket_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
  select nullif(lower(btrim(coalesce(contact.email, account.email))), '')
  from public.tickets ticket
  left join public.ticket_requesters contact
    on contact.id = ticket.requester_contact_id
  left join auth.users account
    on account.id = ticket.requester_id
  where ticket.id = p_ticket_id;
$$;
revoke all on function public.ticket_requester_email(uuid) from public, anon, authenticated;

create or replace function public.employee_can_read_ticket(p_ticket_id uuid)
returns boolean
language plpgsql
stable
security definer
-- Evaluated after the cheaper permission checks of can_read_ticket.
cost 1000
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_ticket public.tickets;
  v_me text;
  v_requester text;
begin
  if auth.uid() is null then
    return false;
  end if;
  select * into v_ticket from public.tickets where id = p_ticket_id;
  if not found or not public.is_active_tenant_member(v_ticket.tenant_id) then
    return false;
  end if;

  -- Own ticket through the linked requester contact.
  if exists (
    select 1 from public.ticket_requesters contact
    where contact.id = v_ticket.requester_contact_id
      and contact.user_id = auth.uid()
  ) then
    return true;
  end if;

  v_me := public.current_user_email();
  v_requester := public.ticket_requester_email(p_ticket_id);
  if v_me is null or v_requester is null then
    return false;
  end if;
  if v_me = v_requester then
    return true;
  end if;

  -- Ticket of a direct report.
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
$$;
revoke all on function public.employee_can_read_ticket(uuid) from public, anon;
grant execute on function public.employee_can_read_ticket(uuid) to authenticated, service_role;

create or replace function public.can_read_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $function$
  select exists (
    select 1
    from public.tickets ticket
    where ticket.id = p_ticket_id
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
      )
  );
$function$;

commit;
