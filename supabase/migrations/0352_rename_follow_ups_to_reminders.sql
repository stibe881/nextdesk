begin;

set local search_path = pg_catalog, public;

-- «Wiedervorlage» heisst in ganz nextDesk jetzt «Erinnerung».
-- Only user-visible texts change; tables, functions and keys keep their
-- technical names (follow_ups, follow_up_*).

update public.feature_catalog
set description = 'Persönliche Arbeitsbereichseinstellungen, Erinnerungen und Mein Tag.'
where key = 'experience.workspace'
  and description like '%Wiedervorlagen%';

-- The global search labels its result group «Wiedervorlagen». Rewrite only
-- that literal in the current definition instead of copying the whole
-- function here, so later changes to the search are kept.
do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.search_global_workspace(uuid,text,integer)'::regprocedure)
  into v_definition;
  if position('''Wiedervorlagen''::text' in v_definition) > 0 then
    execute replace(v_definition, '''Wiedervorlagen''::text', '''Erinnerungen''::text');
  end if;
end;
$migration$;

commit;
