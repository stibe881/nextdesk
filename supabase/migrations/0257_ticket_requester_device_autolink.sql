-- Devices of the requesting person on a ticket: active asset assignments of
-- the requester contact(s) plus Intune primary-person links of the matching
-- Entra person (the same sources as the person overview).
create or replace function public.ticket_requester_device_ids(p_ticket_id uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid;
  v_requester_id uuid;
  v_contact_id uuid;
  v_user_id uuid;
  v_email text;
  v_contact_ids uuid[];
  v_entra_ids uuid[];
  v_result uuid[];
begin
  select ticket.tenant_id, ticket.requester_id, ticket.requester_contact_id
    into v_tenant_id, v_requester_id, v_contact_id
    from public.tickets ticket
   where ticket.id = p_ticket_id;
  if not found then
    return '{}'::uuid[];
  end if;

  if v_contact_id is not null then
    select contact.user_id, lower(contact.email)
      into v_user_id, v_email
      from public.ticket_requesters contact
     where contact.tenant_id = v_tenant_id and contact.id = v_contact_id;
  end if;
  -- Without a contact the requester is the signed-in person who opened it.
  if v_contact_id is null then
    v_user_id := v_requester_id;
    select lower(account.email) into v_email
      from auth.users account where account.id = v_requester_id;
  end if;

  select coalesce(array_agg(contact.id), '{}'::uuid[]) into v_contact_ids
    from public.ticket_requesters contact
   where contact.tenant_id = v_tenant_id
     and (
       contact.id = v_contact_id
       or (v_user_id is not null and contact.user_id = v_user_id)
       or (v_email is not null and lower(contact.email) = v_email)
     );

  select coalesce(array_agg(person.entra_object_id), '{}'::uuid[]) into v_entra_ids
    from public.tenant_entra_directory_people person
   where person.tenant_id = v_tenant_id
     and person.inactive_at is null
     and (
       (v_user_id is not null and person.local_user_id = v_user_id)
       or (v_email is not null and lower(person.email) = v_email)
     );

  select coalesce(array_agg(distinct asset.id), '{}'::uuid[]) into v_result
    from (
      select assignment.asset_id
        from public.asset_assignments assignment
       where assignment.tenant_id = v_tenant_id
         and assignment.returned_at is null
         and assignment.requester_id = any(v_contact_ids)
      union
      select link.asset_id
        from public.asset_intune_primary_person_links link
       where link.tenant_id = v_tenant_id
         and link.entra_object_id = any(v_entra_ids)
    ) device
    join public.assets asset
      on asset.id = device.asset_id and asset.tenant_id = v_tenant_id
   where asset.active;
  return v_result;
end;
$$;

revoke all on function public.ticket_requester_device_ids(uuid) from public, anon, authenticated;
grant execute on function public.ticket_requester_device_ids(uuid) to service_role;

-- Suggestions for agents in the ticket detail.
create or replace function public.ticket_requester_devices(p_tenant_id uuid, p_ticket_id uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_tenant_ticket_agent(p_tenant_id)
     or not public.can_read_ticket(p_ticket_id)
     or not exists (
       select 1 from public.tickets ticket
        where ticket.id = p_ticket_id and ticket.tenant_id = p_tenant_id
     ) then
    raise exception 'Ticket agent required' using errcode = '42501';
  end if;
  return public.ticket_requester_device_ids(p_ticket_id);
end;
$$;

revoke all on function public.ticket_requester_devices(uuid, uuid) from public, anon;
grant execute on function public.ticket_requester_devices(uuid, uuid) to authenticated;

-- A new ticket gets the requester's device linked automatically when the
-- person has exactly one. With several devices the agent picks from the
-- suggestions in the ticket detail.
create or replace function public.ticket_autolink_requester_device()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_devices uuid[];
begin
  begin
    v_devices := public.ticket_requester_device_ids(new.id);
    if cardinality(v_devices) = 1 then
      insert into public.ticket_assets (tenant_id, ticket_id, asset_id, linked_by)
      values (new.tenant_id, new.id, v_devices[1], null)
      on conflict do nothing;
    end if;
  exception when others then
    -- Linking is a convenience; it must never block creating the ticket.
    raise warning 'ticket_autolink_requester_device failed: %', sqlstate;
  end;
  return null;
end;
$$;

revoke all on function public.ticket_autolink_requester_device() from public, anon, authenticated;

drop trigger if exists tickets_autolink_requester_device on public.tickets;
create trigger tickets_autolink_requester_device
  after insert on public.tickets
  for each row execute function public.ticket_autolink_requester_device();
