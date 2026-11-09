-- Requester names for ticket cards (list, overview, kanban).
--
-- Agents without the right to manage requester contacts cannot read
-- ticket_requesters directly. This function returns only the display name of
-- the requester, and only for tickets the caller may read.

create or replace function public.ticket_requester_names(
  p_tenant_id uuid,
  p_ticket_ids uuid[]
)
returns table (ticket_id uuid, requester_name text)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'auth'
as $$
  select
    ticket.id,
    coalesce(
      nullif(btrim(contact.display_name), ''),
      nullif(btrim(profile.display_name), ''),
      contact.email
    )
  from public.tickets ticket
  left join public.ticket_requesters contact
    on contact.id = ticket.requester_contact_id
   and contact.tenant_id = ticket.tenant_id
  left join public.user_profiles profile
    on profile.id = ticket.requester_id
   and ticket.requester_contact_id is null
  where ticket.tenant_id = p_tenant_id
    and ticket.id = any(p_ticket_ids[1:200])
    and public.can_read_ticket(ticket.id);
$$;

revoke all on function public.ticket_requester_names(uuid, uuid[]) from public, anon;
grant execute on function public.ticket_requester_names(uuid, uuid[]) to authenticated;
