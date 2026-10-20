begin;

set local search_path = pg_catalog, public;

-- A deliberately confirmed ticket deletion removes ticket-scoped history as one
-- atomic lifecycle. These two legacy foreign keys were the only remaining
-- restrictive ticket references, so even resolved follow-ups could block an
-- otherwise authorized and audited deletion.
alter table public.experience_follow_ups
  drop constraint if exists experience_follow_ups_ticket_tenant_fk;
alter table public.experience_follow_ups
  add constraint experience_follow_ups_ticket_tenant_fk
  foreign key (ticket_id, tenant_id)
  references public.tickets (id, tenant_id)
  on delete cascade;

alter table public.ticket_resolution_confirmations
  drop constraint if exists ticket_resolution_confirmations_ticket_tenant_fk;
alter table public.ticket_resolution_confirmations
  add constraint ticket_resolution_confirmations_ticket_tenant_fk
  foreign key (ticket_id, tenant_id)
  references public.tickets (id, tenant_id)
  on delete cascade;

comment on constraint experience_follow_ups_ticket_tenant_fk
  on public.experience_follow_ups is
  'Ticket-linked personal follow-ups are removed only as part of a confirmed ticket deletion.';
comment on constraint ticket_resolution_confirmations_ticket_tenant_fk
  on public.ticket_resolution_confirmations is
  'Ticket resolution confirmations are removed only as part of a confirmed ticket deletion.';

commit;
