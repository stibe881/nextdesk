begin;
set local search_path = pg_catalog, public;

-- Lagerort-Codes dürfen Punkte enthalten (z. B. «WSICT.01.01», «G10.2.1»).
-- Der Code wird weiterhin klein geschrieben gespeichert; er beginnt mit einem
-- Buchstaben oder einer Ziffer. Bisher waren nur a–z, 0–9, «_» und «-» erlaubt,
-- sodass das Speichern eines Codes mit Punkt mit «Die Eingaben sind
-- unvollständig oder ungültig» scheiterte.

alter table public.inventory_locations
  drop constraint if exists inventory_locations_code_check;
alter table public.inventory_locations
  add constraint inventory_locations_code_check
  check (
    code = lower(btrim(code))
    and code ~ '^[a-z0-9][a-z0-9._-]{0,62}$'
  );

-- Gleiche Regel in der Funktion, die Lagerorte anlegt und ändert. Die
-- Definition wird übernommen und nur das Muster ersetzt, damit spätere
-- Änderungen an der Funktion nicht überschrieben werden.
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(
    'public.upsert_inventory_location(uuid,uuid,uuid,uuid,text,text,boolean)'::regprocedure
  ) into v_def;
  v_new := replace(v_def, '[a-z0-9_-]{0,62}', '[a-z0-9._-]{0,62}');
  if v_new = v_def then
    raise exception 'upsert_inventory_location: Muster nicht gefunden';
  end if;
  execute v_new;
end;
$$;

commit;
