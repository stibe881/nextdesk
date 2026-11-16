begin;

set local search_path = pg_catalog, public;

-- «Wiedervorlage» heisst in ganz nextDesk jetzt «Erinnerung», «Sicherheitsfälle»
-- heissen «Phishing / Junk» (ein einzelner Fall: «Phishing-/Junk-Fall»).
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

-- Search group of the operations search and the note on replacement devices
-- ordered from a case.
do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.search_operations(uuid,text,integer)'::regprocedure)
  into v_definition;
  if position('''Sicherheitsfälle''::text' in v_definition) > 0 then
    execute replace(v_definition, '''Sicherheitsfälle''::text', '''Phishing / Junk''::text');
  end if;

  select pg_get_functiondef(
    'public.shop_submit_order_direct(uuid,uuid,uuid,uuid,jsonb,text,text,date,text,text,text,uuid,text)'::regprocedure
  )
  into v_definition;
  if position('''Ersatzgerät aus Sicherheitsfall ''' in v_definition) > 0 then
    execute replace(
      v_definition,
      '''Ersatzgerät aus Sicherheitsfall ''',
      '''Ersatzgerät aus Phishing-/Junk-Fall '''
    );
  end if;
end;
$migration$;

commit;
