-- Demo-Mandant "nextDesk Demo" (Slug: app-review) für die App-Store-Prüfung.
--
-- Voraussetzung: Der Mandant wurde mit public.provision_tenant angelegt und das
-- Testkonto appreview@gross-ict.ch ist dort aktives Mitglied (Admin).
--
-- Das Skript ist wiederholbar: Es schaltet die Funktionen frei und legt die
-- Beispieldaten nur an, wenn sie noch nicht vorhanden sind. Es berührt
-- ausschliesslich den Mandanten mit dem Slug 'app-review'.
--
-- Nicht enthalten ist das Lager (Artikel, Bestände). Es wird über die Web-App
-- angelegt, weil Bestände über Buchungen entstehen.

begin;

do $$
declare
  v_tenant uuid;
  v_user uuid;
  v_department uuid;
  v_status_new uuid;
  v_status_progress uuid;
  v_status_waiting uuid;
  v_status_resolved uuid;
  v_prio_low uuid;
  v_prio_normal uuid;
  v_prio_high uuid;
  v_ticket uuid;
  v_number text;
  v_collection uuid;
  v_article uuid;
  v_location_office uuid;
  v_location_store uuid;
  v_asset uuid;
  v_item record;
  v_ticket_seed jsonb;
  v_asset_seed jsonb;
  v_article_seed jsonb;
begin
  select id into v_tenant from public.tenants where slug = 'app-review';
  if v_tenant is null then
    raise exception 'Mandant app-review nicht gefunden';
  end if;
  select u.id into v_user
  from auth.users u
  join public.tenant_memberships m
    on m.user_id = u.id and m.tenant_id = v_tenant and m.status = 'active'
  where u.email = 'appreview@gross-ict.ch';
  if v_user is null then
    raise exception 'Testkonto appreview@gross-ict.ch ist kein aktives Mitglied von app-review';
  end if;

  -- 1. Funktionsfreigaben ---------------------------------------------------
  -- Nicht freigegeben bleiben Funktionen, die eine externe Einrichtung
  -- brauchen: E-Mail-Kanal, Webhooks, Push, KI und SLA-Automatisierung.
  update public.tenant_feature_flags
  set enabled = true, pilot_ends_at = null
  where tenant_id = v_tenant
    and feature_key in (
      'agent.workbench',
      'assets.management',
      'contracts.management',
      'experience.workspace',
      'inventory.management',
      'knowledge.base',
      'portal.self-service',
      'reporting.service',
      'requester.department-view',
      'requester.portal',
      'ticketing.checklists',
      'ticketing.detail',
      'ticketing.templates',
      'ticketing.time-tracking'
    );

  -- 2. Tickets --------------------------------------------------------------
  select id into v_department
  from public.departments where tenant_id = v_tenant and key = 'ict';
  select id into v_status_new from public.ticket_statuses
    where tenant_id = v_tenant and key = 'new';
  select id into v_status_progress from public.ticket_statuses
    where tenant_id = v_tenant and key = 'in_progress';
  select id into v_status_waiting from public.ticket_statuses
    where tenant_id = v_tenant and key = 'waiting_customer';
  select id into v_status_resolved from public.ticket_statuses
    where tenant_id = v_tenant and key = 'resolved';
  select id into v_prio_low from public.ticket_priorities
    where tenant_id = v_tenant and key = 'low';
  select id into v_prio_normal from public.ticket_priorities
    where tenant_id = v_tenant and key = 'normal';
  select id into v_prio_high from public.ticket_priorities
    where tenant_id = v_tenant and key = 'high';

  v_ticket_seed := '[
    {"subject": "Drucker im Sekretariat druckt nicht",
     "description": "Seit heute Morgen erscheint am Drucker im Sekretariat die Meldung Papierstau, obwohl kein Papier eingeklemmt ist.",
     "status": "in_progress", "priority": "high", "assigned": true, "days": 1,
     "external": "Wir schauen uns den Drucker heute Vormittag vor Ort an.",
     "internal": "Walze vermutlich verschmutzt, Reinigungsset mitnehmen."},
    {"subject": "Neues Notebook für Praktikantin einrichten",
     "description": "Ab Montag arbeitet eine Praktikantin im Team. Bitte Notebook mit Standardsoftware und Zugängen vorbereiten.",
     "status": "new", "priority": "normal", "assigned": false, "days": 2},
    {"subject": "WLAN im Sitzungszimmer instabil",
     "description": "Im grossen Sitzungszimmer bricht die WLAN-Verbindung während Videokonferenzen mehrfach ab.",
     "status": "waiting_customer", "priority": "normal", "assigned": true, "days": 4,
     "external": "Bitte teilen Sie uns mit, an welchen Tagen und um welche Uhrzeit die Verbindung abbricht."},
    {"subject": "Zugriff auf das gemeinsame Laufwerk fehlt",
     "description": "Nach dem Wechsel in die Buchhaltung kann ich nicht mehr auf das Laufwerk der Abteilung zugreifen.",
     "status": "resolved", "priority": "low", "assigned": true, "days": 6,
     "external": "Der Zugriff wurde eingerichtet. Bitte melden Sie sich einmal ab und wieder an."},
    {"subject": "Bildschirm flackert am Arbeitsplatz 12",
     "description": "Der zweite Bildschirm flackert in unregelmässigen Abständen. Das Kabel wurde bereits getauscht.",
     "status": "new", "priority": "low", "assigned": false, "days": 0}
  ]'::jsonb;

  for v_item in select value from jsonb_array_elements(v_ticket_seed) loop
    if exists (
      select 1 from public.tickets
      where tenant_id = v_tenant and subject = v_item.value ->> 'subject'
    ) then
      continue;
    end if;
    v_number := public.reserve_ticket_number(v_tenant, v_department, 'ICT');
    insert into public.tickets (
      tenant_id, department_id, ticket_number, subject, description,
      status_id, priority_id, requester_id, assigned_agent_id, created_at
    )
    values (
      v_tenant, v_department, v_number,
      v_item.value ->> 'subject', v_item.value ->> 'description',
      case when v_item.value ->> 'status' = 'new' then v_status_new
           when v_item.value ->> 'status' = 'waiting_customer' then v_status_waiting
           else v_status_progress end,
      case v_item.value ->> 'priority'
        when 'high' then v_prio_high
        when 'low' then v_prio_low
        else v_prio_normal end,
      v_user,
      case when (v_item.value ->> 'assigned')::boolean then v_user end,
      timezone('utc', now()) - make_interval(days => (v_item.value ->> 'days')::int)
    )
    returning id into v_ticket;

    if v_item.value ? 'internal' then
      insert into public.ticket_comments (ticket_id, author_id, visibility, body)
      values (v_ticket, v_user, 'internal', v_item.value ->> 'internal');
    end if;
    if v_item.value ? 'external' then
      insert into public.ticket_comments (ticket_id, author_id, visibility, body)
      values (v_ticket, v_user, 'external', v_item.value ->> 'external');
      update public.tickets
      set first_responded_at = coalesce(first_responded_at, timezone('utc', now()))
      where id = v_ticket;
    end if;
    if v_item.value ->> 'status' = 'resolved' then
      -- Der Statuswechsel setzt das Lösungsdatum über den SLA-Trigger.
      update public.tickets set status_id = v_status_resolved where id = v_ticket;
    end if;
  end loop;

  -- 3. Wissensartikel -------------------------------------------------------
  insert into public.knowledge_collections (tenant_id, name, slug, created_by)
  values (v_tenant, 'Anleitungen', 'anleitungen', v_user)
  on conflict (tenant_id, slug) do nothing;
  select id into v_collection from public.knowledge_collections
    where tenant_id = v_tenant and slug = 'anleitungen';

  v_article_seed := '[
    {"slug": "vpn-einrichten", "title": "VPN einrichten",
     "body": "So richten Sie das VPN auf Ihrem Notebook ein.\n\n1. Öffnen Sie die VPN-Anwendung.\n2. Wählen Sie Verbindung hinzufügen und tragen Sie den Servernamen ein, den Ihnen die IT mitgeteilt hat.\n3. Melden Sie sich mit Ihrem Geschäftskonto an.\n4. Bestätigen Sie die Anmeldung auf Ihrem Mobiltelefon.\n\nFunktioniert die Verbindung nicht, erfassen Sie ein Ticket.",
     "summary": "Schritt für Schritt zur VPN-Verbindung."},
    {"slug": "passwort-zuruecksetzen", "title": "Passwort zurücksetzen",
     "body": "Wenn Sie Ihr Passwort vergessen haben:\n\n1. Öffnen Sie die Anmeldeseite und wählen Sie Passwort vergessen.\n2. Geben Sie Ihre E-Mail-Adresse ein.\n3. Folgen Sie dem Link in der E-Mail, die Sie erhalten.\n\nKommt keine E-Mail an, prüfen Sie den Spam-Ordner oder melden Sie sich beim Support.",
     "summary": "Eigenes Passwort selbst zurücksetzen."},
    {"slug": "drucker-verbinden", "title": "Drucker verbinden",
     "body": "So verbinden Sie einen Netzwerkdrucker:\n\n1. Öffnen Sie die Einstellungen und wählen Sie Drucker und Scanner.\n2. Wählen Sie Drucker hinzufügen.\n3. Wählen Sie den Drucker aus der Liste und bestätigen Sie.\n\nDer Drucker steht danach in allen Anwendungen zur Verfügung.",
     "summary": "Netzwerkdrucker hinzufügen."}
  ]'::jsonb;

  for v_item in select value from jsonb_array_elements(v_article_seed) loop
    if exists (
      select 1 from public.knowledge_articles
      where tenant_id = v_tenant and slug = v_item.value ->> 'slug'
    ) then
      continue;
    end if;
    insert into public.knowledge_articles (
      tenant_id, title, slug, visibility, status, current_revision,
      published_revision, created_by, published_at
    )
    values (
      v_tenant, v_item.value ->> 'title', v_item.value ->> 'slug', 'internal',
      'published', 1, 1, v_user, timezone('utc', now())
    )
    returning id into v_article;
    insert into public.knowledge_article_revisions (
      article_id, revision, body, summary, author_id
    )
    values (
      v_article, 1, v_item.value ->> 'body', v_item.value ->> 'summary', v_user
    );
    insert into public.knowledge_article_collections (
      tenant_id, article_id, collection_id, created_by
    )
    values (v_tenant, v_article, v_collection, v_user);
  end loop;

  -- 4. Assets ---------------------------------------------------------------
  insert into public.asset_locations (tenant_id, name)
  values (v_tenant, 'Büro')
  on conflict (tenant_id, name) do nothing;
  insert into public.asset_locations (tenant_id, name)
  values (v_tenant, 'IT-Raum')
  on conflict (tenant_id, name) do nothing;
  select id into v_location_office from public.asset_locations
    where tenant_id = v_tenant and name = 'Büro';
  select id into v_location_store from public.asset_locations
    where tenant_id = v_tenant and name = 'IT-Raum';

  v_asset_seed := '[
    {"name": "Notebook Empfang", "tag": "DEMO-0001", "inv": "INV-1001", "serial": "DEMO-SN-1001",
     "kind": "laptop", "maker": "Lenovo", "model": "ThinkPad L14", "os": "Windows 11", "loc": "office"},
    {"name": "Notebook Geschäftsleitung", "tag": "DEMO-0002", "inv": "INV-1002", "serial": "DEMO-SN-1002",
     "kind": "laptop", "maker": "Dell", "model": "Latitude 5440", "os": "Windows 11", "loc": "office"},
    {"name": "Monitor Arbeitsplatz 12", "tag": "DEMO-0003", "inv": "INV-1003", "serial": "DEMO-SN-1003",
     "kind": "monitor", "maker": "Dell", "model": "P2422H", "os": null, "loc": "office"},
    {"name": "Smartphone Ersatzgerät", "tag": "DEMO-0004", "inv": "INV-1004", "serial": "DEMO-SN-1004",
     "kind": "phone", "maker": "Apple", "model": "iPhone 13", "os": "iOS 17", "loc": "store"},
    {"name": "Netzwerkdrucker Sekretariat", "tag": "DEMO-0005", "inv": "INV-1005", "serial": "DEMO-SN-1005",
     "kind": "printer", "maker": "HP", "model": "LaserJet Pro M404", "os": null, "loc": "office"}
  ]'::jsonb;

  for v_item in select value from jsonb_array_elements(v_asset_seed) loop
    if exists (
      select 1 from public.assets
      where tenant_id = v_tenant and asset_tag = v_item.value ->> 'tag'
    ) then
      continue;
    end if;
    insert into public.assets (
      tenant_id, name, asset_tag, inventory_number, serial_number, kind,
      manufacturer, model, operating_system, location_id
    )
    values (
      v_tenant, v_item.value ->> 'name', v_item.value ->> 'tag',
      v_item.value ->> 'inv', v_item.value ->> 'serial', v_item.value ->> 'kind',
      v_item.value ->> 'maker', v_item.value ->> 'model', v_item.value ->> 'os',
      case when v_item.value ->> 'loc' = 'store' then v_location_store
           else v_location_office end
    )
    returning id into v_asset;
    -- Suchkennungen für den Scanner (QR-Code, Barcode, Inventar-, Seriennummer).
    insert into public.asset_identifiers (
      tenant_id, asset_id, identifier_type, canonical_value
    )
    values
      (v_tenant, v_asset, 'asset_tag', lower(v_item.value ->> 'tag')),
      (v_tenant, v_asset, 'inventory_number', lower(v_item.value ->> 'inv')),
      (v_tenant, v_asset, 'serial_number', lower(v_item.value ->> 'serial'))
    on conflict (tenant_id, asset_id, identifier_type) do nothing;
  end loop;
end;
$$;

commit;

-- Kontrolle
select 'Tickets' as bereich, count(*) as anzahl
from public.tickets t join public.tenants n on n.id = t.tenant_id and n.slug = 'app-review'
union all
select 'Wissensartikel', count(*)
from public.knowledge_articles a join public.tenants n on n.id = a.tenant_id and n.slug = 'app-review'
union all
select 'Assets', count(*)
from public.assets a join public.tenants n on n.id = a.tenant_id and n.slug = 'app-review'
union all
select 'Freigaben aktiv', count(*)
from public.tenant_feature_flags f join public.tenants n on n.id = f.tenant_id and n.slug = 'app-review'
where f.enabled;
