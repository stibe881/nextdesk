-- An e-mail that becomes a room plan must not remain as a ticket. The plan keeps
-- its source order data; only the reference to the removed ticket is cleared.
alter table public.event_space_requests
  drop constraint if exists event_space_requests_source_ticket_tenant_fk,
  add constraint event_space_requests_source_ticket_tenant_fk
    foreign key (source_ticket_id, tenant_id)
    references public.tickets (id, tenant_id)
    on delete set null (source_ticket_id);
