begin;

-- Korrigiert ausschliesslich Produktivinstallationen, deren Funktionsdefinition
-- vor dieser Migration mit vertauschten Directory-Spalten ausgeliefert wurde.
do $repair$
declare
  v_source text;
  v_repaired text;
begin
  select pg_get_functiondef(
    'public.set_entra_agent_request(uuid, uuid, boolean, uuid, uuid)'::regprocedure
  ) into v_source;

  if v_source ~
    'values[[:space:]]*\([[:space:]]*p_tenant_id,[[:space:]]*v_person\.local_user_id,[[:space:]]*p_department_id[[:space:]]*\)'
  then
    null;
  else
    v_repaired := regexp_replace(
      v_source,
      'values[[:space:]]*\([[:space:]]*p_tenant_id,[[:space:]]*p_department_id,[[:space:]]*v_person\.local_user_id[[:space:]]*\)',
      'values (p_tenant_id, v_person.local_user_id, p_department_id)'
    );
    if v_repaired = v_source then
      raise exception 'unexpected_set_entra_agent_request_definition';
    end if;
    execute v_repaired;
  end if;
end;
$repair$;

commit;
