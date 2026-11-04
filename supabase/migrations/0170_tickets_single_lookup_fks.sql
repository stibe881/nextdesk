-- tickets carries both a single-column and a tenant-bound composite foreign key
-- to ticket_statuses, ticket_priorities and departments (since 0006). PostgREST
-- now rejects embeds such as `status:ticket_statuses(...)` as ambiguous (HTTP
-- 300), which broke service reporting, the CSV export and several ticket
-- operations. All referencing columns and tickets.tenant_id are NOT NULL, so the
-- composite keys enforce the same integrity; the single-column keys are dropped.
alter table public.tickets
  drop constraint if exists tickets_status_id_fkey,
  drop constraint if exists tickets_priority_id_fkey,
  drop constraint if exists tickets_department_id_fkey;

notify pgrst, 'reload schema';
