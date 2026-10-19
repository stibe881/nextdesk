begin;

set local search_path = pg_catalog, public;

-- A regular unique constraint supports PostgREST's on_conflict=(tenant_id,email)
-- used by delegated mail ingestion. PostgreSQL treats NULL values as distinct by
-- default, so account-less contacts remain unrestricted just as with the former
-- partial index.
drop index if exists public.ticket_requesters_tenant_email_unique;
alter table public.ticket_requesters
  add constraint ticket_requesters_tenant_email_unique
  unique (tenant_id, email);

notify pgrst, 'reload schema';

commit;
