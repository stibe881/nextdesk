set local search_path = pg_catalog, public;

-- Mitteilungskategorie «Sicherheitsfälle» (security_case) getrennt von
-- «Phishing» (security_report): überfällige Fälle, «geklickt» und Kampagnen
-- haben eine eigene Zeile in den Benachrichtigungseinstellungen. Es gelten
-- dieselben Regeln wie bisher (Opt-in, Phishing-Team erhält sie immer).

do $$
declare
  v_def text;
  v_new text;
begin
  -- Welche Kategorie ein Mitteilungstyp hat.
  select pg_get_functiondef('public.push_notification_category(text)'::regprocedure) into v_def;
  v_new := replace(
    v_def,
    E'''security.campaign'')\n      then ''security_report''',
    E'''security.campaign'')\n      then ''security_case'''
  );
  if v_new = v_def then
    raise exception 'push_notification_category: Muster nicht gefunden';
  end if;
  execute v_new;

  -- Erlaubte Kategorien in den Zustellmodi.
  select pg_get_functiondef('public.push_delivery_modes_valid(jsonb)'::regprocedure) into v_def;
  v_new := replace(v_def, '''security_report'', ''incident''', '''security_report'', ''security_case'', ''incident''');
  if v_new = v_def then
    raise exception 'push_delivery_modes_valid: Muster nicht gefunden';
  end if;
  execute v_new;

  -- Eintragen in die Warteschlange (Kategorien ohne Voreinstellung).
  select pg_get_functiondef('public.push_enqueue_ticket_notification()'::regprocedure) into v_def;
  v_new := replace(v_def, '''security_report'', ''incident''', '''security_report'', ''security_case'', ''incident''');
  if v_new = v_def then
    raise exception 'push_enqueue_ticket_notification: Muster nicht gefunden';
  end if;
  execute v_new;

  -- Zustellung: dieselbe Opt-in-Regel wie für Phishing, auch für Sicherheitsfälle.
  select pg_get_functiondef('public.push_claim_outbox_v2(integer)'::regprocedure) into v_def;
  v_new := regexp_replace(
    v_def,
    E'(    if v_category = ''security_report''\n.*?\n    end if;\n)',
    E'\\1' || E'    -- Sicherheitsfälle: gleiche Regel wie Phishing.\n'
      || replace(
           substring(v_def from E'    if v_category = ''security_report''\n.*?\n    end if;\n'),
           'security_report',
           'security_case'
         ),
    's'
  );
  if v_new = v_def then
    raise exception 'push_claim_outbox_v2: Muster nicht gefunden';
  end if;
  execute v_new;

  -- Neue Agenten: Standardmodus auch für Sicherheitsfälle aus.
  select pg_get_functiondef('public.agent_notification_defaults_all(uuid,uuid,boolean)'::regprocedure) into v_def;
  v_new := replace(
    v_def,
    'jsonb_build_object(''security_report'', ''off'')',
    'jsonb_build_object(''security_report'', ''off'', ''security_case'', ''off'')'
  );
  if v_new <> v_def then
    execute v_new;
  end if;
end;
$$;

-- Mail: «security_case» ist eine erlaubte Kategorie.
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.push_preferences'::regclass
       and conname = 'push_preferences_email_categories_valid'
       and position('''security_case''' in pg_get_constraintdef(oid)) = 0
  ) then
    alter table public.push_preferences
      drop constraint push_preferences_email_categories_valid;
    alter table public.push_preferences
      add constraint push_preferences_email_categories_valid check (
        email_categories <@ array[
          'assigned', 'requester_reply', 'support_reply', 'mention', 'resolved',
          'sla', 'escalation', 'approval', 'follow_up', 'contract_deadline',
          'inventory_low_stock', 'shop', 'service_task', 'infrastructure',
          'security_report', 'security_case', 'incident', 'ipam'
        ]::text[]
        and cardinality(email_categories) <= 20
      );
  end if;
end;
$$;

-- Bestehende Wahl übernehmen: wer «Phishing und Sicherheitsfälle» eingeschaltet
-- hatte, hat beide Zeilen eingeschaltet.
update public.push_preferences preference
   set category_modes = preference.category_modes
         || jsonb_build_object('security_case', preference.category_modes -> 'security_report')
 where preference.category_modes ? 'security_report'
   and not (preference.category_modes ? 'security_case');

update public.push_preferences preference
   set email_categories = array_append(preference.email_categories, 'security_case')
 where 'security_report' = any(preference.email_categories)
   and not 'security_case' = any(preference.email_categories);
