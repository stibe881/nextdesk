begin;

set local search_path = pg_catalog, public;

-- The supabase_realtime publication had lost its tables in production, so the
-- web app received no live ticket changes and new tickets only appeared after
-- a reload or the slow poll. Add tickets and ticket_comments again
-- (idempotent, same as 0111).
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tickets'
  ) then
    alter publication supabase_realtime add table public.tickets;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ticket_comments'
  ) then
    alter publication supabase_realtime add table public.ticket_comments;
  end if;
end;
$$;

commit;
