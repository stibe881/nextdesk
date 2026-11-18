begin;

set local search_path = pg_catalog, public;

-- Eintritt aus einer Mail: Die Edge Function ermittelt das Konto der meldenden
-- Person (bestehendes Mitglied oder aus Entra angelegt) und gibt es in
-- details.reporterUserId mit. Dieses Konto wird vorgesetzte Person, sofern es
-- aktives Mitglied des Mandanten ist.
do $migration$
declare
  v_definition text;
  v_old text := E'  select profile.id into v_manager\n  from public.user_profiles profile';
  v_new text := E'  if (p_details ->> ''reporterUserId'') ~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'' then\n    select membership.user_id into v_manager\n    from public.tenant_memberships membership\n    where membership.tenant_id = p_tenant_id\n      and membership.status = ''active''\n      and membership.user_id = (p_details ->> ''reporterUserId'')::uuid;\n  end if;\n\n  if v_manager is null then\n  select profile.id into v_manager\n  from public.user_profiles profile';
  v_old_end text := E'  order by membership.created_at\n  limit 1;\n  if v_manager is null and nullif(btrim(p_details ->> ''reporterEmail''), '''') is not null then';
  v_new_end text := E'  order by membership.created_at\n  limit 1;\n  end if;\n  if v_manager is null and nullif(btrim(p_details ->> ''reporterEmail''), '''') is not null then';
begin
  v_definition := pg_get_functiondef(
    'public.create_onboarding_entry_from_email(uuid,text,text,date,text,text,text,jsonb,jsonb,text)'::regprocedure);
  if position('reporterUserId' in v_definition) = 0
     and position(v_old in v_definition) > 0
     and position(v_old_end in v_definition) > 0 then
    execute replace(replace(v_definition, v_old, v_new), v_old_end, v_new_end);
  end if;
end;
$migration$;

commit;
