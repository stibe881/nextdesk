begin;

set local search_path = pg_catalog, public;

-- Eintritt aus der Eintrittsmeldung per Mail: Vorgesetzte Person ist die
-- Person, die den Eintritt meldet. Gesucht wird sie zuerst über die
-- Absender-Adresse der Mail (details.reporterEmail) unter den aktiven
-- Mitgliedern, dann wie bisher über den Namen; sonst die verantwortliche
-- Person (der gemeldete Name bleibt in details.supervisor sichtbar).
do $migration$
declare
  v_definition text;
  v_old text := E'  v_manager := coalesce(v_manager, v_responsible);';
  v_new text := E'  if v_manager is null and nullif(btrim(p_details ->> ''reporterEmail''), '''') is not null then\n    select membership.user_id into v_manager\n    from public.tenant_memberships membership\n    join auth.users account on account.id = membership.user_id\n    where membership.tenant_id = p_tenant_id\n      and membership.status = ''active''\n      and lower(account.email) = lower(btrim(p_details ->> ''reporterEmail''))\n    order by membership.created_at\n    limit 1;\n  end if;\n  v_manager := coalesce(v_manager, v_responsible);';
begin
  v_definition := pg_get_functiondef(
    'public.create_onboarding_entry_from_email(uuid,text,text,date,text,text,text,jsonb,jsonb,text)'::regprocedure);
  if position('reporterEmail' in v_definition) = 0 and position(v_old in v_definition) > 0 then
    execute replace(v_definition, v_old, v_new);
  end if;
end;
$migration$;

commit;
