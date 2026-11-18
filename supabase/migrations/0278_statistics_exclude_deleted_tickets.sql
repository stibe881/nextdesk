begin;

set local search_path = pg_catalog, public;

-- Gelöschte Tickets (Papierkorb) zählen in keiner Statistik mit.
-- 1) Personenübersicht: der Durchschnitt aller Tickets des Mandanten (Lösungszeit)
--    und der Zufriedenheit berücksichtigte gelöschte Tickets. Die Tickets der
--    Person selbst waren schon ausgeschlossen (can_read_ticket).
-- 2) Anfragendenportal: «typischerweise gelöst in …» (Median der Lösungszeit).
do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.person_overview(uuid,uuid,uuid,uuid)'::regprocedure);
  v_new := replace(
    v_def,
    'and other.resolved_at is not null',
    'and other.deleted_at is null
            and other.resolved_at is not null'
  );
  v_new := replace(
    v_new,
    'and rating.submitted_at >= v_now - interval ''365 days'';',
    'and ticket.deleted_at is null
     and rating.submitted_at >= v_now - interval ''365 days'';'
  );
  if v_new = v_def or position('other.deleted_at is null' in v_new) = 0
     or position('ticket.deleted_at is null' in v_new) = 0 then
    raise exception 'person_overview: Anpassung nicht anwendbar';
  end if;
  execute v_new;

  v_def := pg_get_functiondef('public.ticket_resolution_median(uuid,uuid,uuid)'::regprocedure);
  v_new := replace(
    v_def,
    'and ticket.merged_into_ticket_id is null',
    'and ticket.deleted_at is null
      and ticket.merged_into_ticket_id is null'
  );
  if v_new = v_def then
    raise exception 'ticket_resolution_median: Anpassung nicht anwendbar';
  end if;
  execute v_new;
end $$;

commit;
