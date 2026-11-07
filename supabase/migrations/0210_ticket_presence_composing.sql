begin;

set local search_path = pg_catalog, public;

-- Which reply someone is writing in a ticket right now (external answer or
-- internal note), so colleagues are warned before answering twice.
alter table public.ticket_presence_sessions
  add column if not exists composing text
    check (composing is null or composing in ('external', 'internal'));

commit;
