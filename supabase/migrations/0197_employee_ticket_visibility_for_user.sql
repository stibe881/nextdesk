begin;

set local search_path = pg_catalog, public;

-- The same rule as employee_can_read_ticket (0196) for a given person, for
-- edge functions that authorize with the service role.
create or replace function public.employee_can_read_ticket_for(
  p_user_id uuid,
  p_ticket_id uuid
)
returns boolean
language plpgsql
stable
security definer
cost 1000
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_ticket public.tickets;
  v_me text;
  v_requester text;
begin
  if p_user_id is null then
    return false;
  end if;
  select * into v_ticket from public.tickets where id = p_ticket_id;
  if not found or not exists (
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
$$;
revoke all on function public.employee_can_read_ticket_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.employee_can_read_ticket_for(uuid, uuid) to service_role;

create or replace function public.employee_can_read_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
cost 1000
set search_path = pg_catalog, public, auth, pg_temp
as $$
  select auth.uid() is not null
    and public.employee_can_read_ticket_for(auth.uid(), p_ticket_id);
$$;

commit;
