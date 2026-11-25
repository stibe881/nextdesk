begin;
set local search_path = pg_catalog, public;

-- Ein Artikel ohne Mindestbestand (0) gilt nie als «Unterbestand». Das betrifft
-- Software und Ausleihartikel, die keinen Mindest- und Zielbestand haben: Diese
-- Artikel lösen weder die Mitteilung «Mindestbestand» noch eine Nachbestellung aus.
-- Die Funktionen werden aus ihrer aktuellen Definition übernommen und nur an
-- zwei Stellen ergänzt.

do $$
declare
  v_def text;
  v_new text;
begin
  -- Neue Unterbestand-Episoden (und deren Push) nur bei Mindestbestand > 0. Ist
  -- der Mindestbestand 0, endet eine offene Episode beim nächsten Buchungsereignis.
  select pg_get_functiondef(
    'public.inventory_evaluate_low_stock_after_event_lines()'::regprocedure
  ) into v_def;
  v_new := replace(
    v_def,
    'if v_available <= v_minimum then',
    'if v_minimum > 0 and v_available <= v_minimum then'
  );
  if v_new = v_def then
    raise exception 'inventory_evaluate_low_stock_after_event_lines: Muster nicht gefunden';
  end if;
  execute v_new;

  -- Nachbestellung nur für Artikel mit Mindestbestand.
  select pg_get_functiondef('public.inventory_process_reorders()'::regprocedure)
    into v_def;
  v_new := replace(
    v_def,
    E'      and item.active\n      and public.inventory_management_feature_enabled(episode.tenant_id)',
    E'      and item.active\n      and item.minimum_quantity > 0\n      and public.inventory_management_feature_enabled(episode.tenant_id)'
  );
  if v_new = v_def then
    raise exception 'inventory_process_reorders: Muster nicht gefunden';
  end if;
  execute v_new;
end;
$$;

commit;
