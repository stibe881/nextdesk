-- Person overview: the average satisfaction shows from the first rating on
-- (was: from three). Single ratings and comments are still never returned.

do $migration$
declare
  v_definition text;
begin
  v_definition := pg_get_functiondef(
    'public.person_overview(uuid,uuid,uuid,uuid)'::regprocedure
  );
  if position('''minimumRatings'', 1' in v_definition) > 0 then
    return;
  end if;
  if position('''minimumRatings'', 3' in v_definition) = 0 then
    raise exception 'person_overview: satisfaction threshold not found';
  end if;
  v_definition := replace(v_definition, '''minimumRatings'', 3', '''minimumRatings'', 1');
  v_definition := replace(
    v_definition,
    '''average'', case when v_rating_count >= 3 then',
    '''average'', case when v_rating_count >= 1 then'
  );
  v_definition := replace(
    v_definition,
    '''positiveShare'', case when v_rating_count >= 3 then',
    '''positiveShare'', case when v_rating_count >= 1 then'
  );
  execute v_definition;
end;
$migration$;
