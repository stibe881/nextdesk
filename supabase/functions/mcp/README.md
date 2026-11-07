# nextDesk-Connector (MCP)

Verbindet KI-Clients wie die Gemini CLI mit nextDesk. Die Anmeldung läuft über
den OAuth-2.1-Server von Supabase Auth, also mit dem normalen nextDesk-Konto
(auch Microsoft-SSO). Jede Aktion läuft mit den Rechten der angemeldeten Person.

## Werkzeuge

| Werkzeug | Art | Zweck |
| --- | --- | --- |
| `list_workspaces` | lesen | Arbeitsbereiche des Kontos |
| `search_tickets` | lesen | Tickets suchen (mine, open, unassigned, all) |
| `get_ticket` | lesen | Ticket mit Beschreibung, Verlauf, Checkliste, erfasster Zeit, Eskalationen und Verknüpfungen |
| `search_knowledge`, `get_knowledge_article` | lesen | Wissensdatenbank. Sucht bei ganzen Fragen einzeln nach Stichwörtern; gibt es zu einem Programm keinen eigenen Artikel, liefert sie den allgemeinen Weg (z. B. «Unternehmensportal») |
| `list_shop_catalog`, `list_shop_orders` | lesen | Self-Service-Shop: Katalog und eigene Bestellungen |
| `find_asset` | lesen | Geräte nach Name, Nummer, Tag oder Seriennummer |
| `global_search` | lesen | Gleichzeitig in Tickets, Wiedervorlagen, Wissen, Veranstaltungsräumen und Eintritten suchen |
| `list_notifications` | lesen | Eigene Benachrichtigungen (standardmässig nur ungelesene) |
| `list_pending_approvals` | lesen | Ticketfreigaben, die auf den eigenen Entscheid warten |
| `list_service_tasks` | lesen | Serviceaufgaben: überfällig, heute, kommend (mine, team, all) |
| `search_requesters` | lesen | Anfragende Personen nach Name suchen |
| `list_follow_ups` | lesen | Eigene Wiedervorlagen (optional nur zu einem Ticket) |
| `list_mentions` | lesen | @-Erwähnungen in Ticketnotizen |
| `my_metrics` | lesen | Persönliche Kennzahlen (offen, heute gelöst, Reaktions- und Lösungszeit, SLA) |
| `team_queues` | lesen | Offene Tickets je Abteilung und Team |
| `list_handovers` | lesen | Übergaben eines Tickets |
| `service_status` | lesen | Status der IT-Services und anstehende Wartungen |
| `inventory_lookup` | lesen | Lagerartikel oder -ort über Nummer, Barcode oder QR-Code |
| `list_licenses`, `list_contracts` | lesen | Lizenzen und Verträge, optional nur bald ablaufende |
| `list_macros`, `get_macro_text` | lesen | Antwortmakros und ihr Text |
| `list_event_bookings` | lesen | Räume und Raumbuchungen mit Aufgaben (alle Seiten, rund 13 Monate) |
| `list_onboardings` | lesen | Eintritte mit Aufgaben, Vorlagen und Personen |
| `list_ticket_templates` | lesen | Ticketvorlagen je Abteilung |
| `list_knowledge_collections`, `list_knowledge_revisions`, `list_ticket_knowledge` | lesen | Sammlungen, Fassungen eines Artikels, Wissen am Ticket |
| `get_service_task`, `service_task_calendar` | lesen | Serviceaufgabe im Detail, Monatskalender |
| `list_ticket_approvals` | lesen | Freigaben eines Tickets |
| `list_delegations`, `list_incident_notices` | lesen | Stellvertretungen, Störungsmeldungen |
| `suggest_assignees`, `get_ticket_context`, `get_ticket_devices` | lesen | Zuweisungsvorschläge, Ticketumfeld, Geräte der anfragenden Person |
| `service_report`, `list_sla_escalations`, `list_sla_rules` | lesen | Kennzahlen, SLA-Eskalationen und -Regeln (braucht Berichtsrecht) |
| `team_overview`, `team_review_queue`, `team_monthly_report` | lesen | Teamführung (nur für Vorgesetzte) |
| `get_requester_profile`, `list_customer_organizations` | lesen | Profil Anfragende, Kundenorganisationen |
| `get_asset`, `inventory_overview`, `list_inventory_reservations` | lesen | Gerät im Detail, Lager, Reservationen |
| `create_ticket` | schreiben | Ticket erfassen, für sich selbst oder eine anfragende Person (`requester`) |
| `add_internal_note` | schreiben | Interne Notiz an ein Ticket |
| `update_ticket_status` | schreiben | Status ändern; Lösen/Schliessen nur mit `confirm=true` |
| `set_ticket_priority` | schreiben | Priorität ändern (low, normal, high, urgent) |
| `assign_ticket_to_me` | schreiben | Ticket sich selbst zuweisen |
| `reply_to_ticket` | schreiben | Antwort an Anfragende; nur mit `confirm=true` |
| `add_time_entry` | schreiben | Arbeitszeit in Minuten erfassen (internal, billable, goodwill) |
| `add_checklist_item`, `set_checklist_item` | schreiben | Checklistenpunkt hinzufügen bzw. abhaken |
| `watch_ticket` | schreiben | Ticket beobachten oder nicht mehr beobachten |
| `mark_notifications_read` | schreiben | Eine oder alle Benachrichtigungen als gelesen markieren |
| `decide_approval` | schreiben | Freigabe genehmigen oder ablehnen; nur mit `confirm=true` |
| `complete_service_task` | schreiben | Serviceaufgabe erledigen (optional mit Notiz) |
| `create_follow_up`, `resolve_follow_up` | schreiben | Wiedervorlage erstellen bzw. erledigen |
| `mark_mention_read` | schreiben | Erwähnung als gelesen markieren |
| `create_handover`, `acknowledge_handover` | schreiben | Übergabe erstellen, bestätigen oder abschliessen |
| `escalate_ticket` | schreiben | Ticket eskalieren; nur mit `confirm=true` |
| `link_tickets` | schreiben | Zwei Tickets verknüpfen (Duplikat, blockiert, Eltern/Kind …) |
| `attach_knowledge_article` | schreiben | Wissensartikel mit Ticket verknüpfen; extern nur mit `confirm=true` |
| `create_knowledge_draft` | schreiben | Wissensartikel-Entwurf aus einem Ticket (geht in die Prüfung) |
| `book_event_space` | schreiben | Raum buchen, einmalig oder als Serie (wöchentlich bis 52, monatlich bis 12 Termine); bei Überschneidung nur mit `confirmConflicts=true` |
| `update_event_booking`, `update_event_task` | schreiben | Status einer Raumbuchung bzw. ihrer Aufgaben setzen |
| `create_onboarding` | schreiben | Eintritt erfassen (Vorlage, Führungsperson, ICT-Verantwortung) |
| `update_onboarding_task` | schreiben | Status einer Eintrittsaufgabe setzen |
| `assign_ticket`, `assign_ticket_team` | schreiben | Ticket einer Person oder einem Team zuweisen |
| `change_ticket_department` | schreiben | Abteilung wechseln; nur mit `confirm=true` |
| `set_ticket_category` | schreiben | Kategorie und Unterkategorie setzen |
| `merge_tickets` | schreiben | Tickets zusammenführen; nur mit `confirm=true` |
| `unlink_tickets` | schreiben | Verknüpfung entfernen |
| `save_knowledge_article`, `request_knowledge_review` | schreiben | Wissensartikel schreiben und zur Prüfung geben |
| `decide_knowledge_review`, `archive_knowledge_article` | schreiben | Veröffentlichen bzw. archivieren; nur mit `confirm=true` |
| `detach_knowledge_article`, `send_knowledge_to_requester` | schreiben | Artikel vom Ticket lösen bzw. an Anfragende senden (nur mit `confirm=true`) |
| `update_service_task` | schreiben | Serviceaufgabe starten, überspringen, Notiz, Checkliste, neu planen, zuweisen, wieder öffnen |
| `request_approval`, `cancel_approval` | schreiben | Freigabe anfordern bzw. zurückziehen |
| `set_delegation`, `end_delegation` | schreiben | Stellvertretung einrichten bzw. beenden |
| `save_incident_notice` | schreiben | Störungsmeldung erfassen oder aktualisieren |
| `save_ticket_review`, `reassign_tickets` | schreiben | Teamführung: Ticket bewerten, Tickets umverteilen (nur mit `confirm=true`) |
| `post_inventory_movement`, `reserve_inventory`, `release_inventory_reservation` | schreiben | Lagerbewegung buchen, Material reservieren, Reservation freigeben |
| `order_from_shop` | schreiben | Im Shop bestellen; nur mit `confirm=true` |

Bei IT-Fragen (Software, Geräte, Zugänge …) weist der Connector Gemini an, zuerst
die Wissensdatenbank zu befragen und keine allgemeinen Anleitungen aus dem Web
zu erfinden.

Geschriebene Texte (Ticket, interne Notiz, Zeitnotiz, Notiz zur Serviceaufgabe,
Wiedervorlage)
enden mit dem Hinweis «Erfasst über den nextDesk-Connector.». Antworten an
Anfragende werden ohne diesen Hinweis versendet.

## Berechtigungen

Der Connector hat keine eigenen Rechte. Jedes Werkzeug ruft dieselben Edge
Functions wie die Web-App mit dem Zugriffstoken der angemeldeten Person auf;
nextDesk prüft dort Mitgliedschaft, Funktionsfreigaben und Rechte (z. B.
`ticket.assign`, `knowledge.manage`, `knowledge.publish`, `report.read`,
`inventory.move`, `team.supervise`). Fehlt ein Recht, meldet das Werkzeug
«Keine Berechtigung für diese Aktion». Zusätzlich verlangt der Connector für
folgenreiche Aktionen die ausdrückliche Bestätigung der Person (`confirm=true`).

## Einrichtung (einmalig)

1. **Supabase → Authentication → OAuth Server:** aktivieren.
   - Authorization Path: `/oauth/consent`
   - Dynamic Client Registration: aktivieren (MCP-Clients registrieren sich selbst).
2. **Supabase → Authentication → URL Configuration:**
   - Site URL: `https://app.nextdesk.ch`
   - Redirect URLs: `https://app.nextdesk.ch/**` ergänzen.
3. **Web-App deployen** (enthält die Seite `/oauth/consent`).
4. **Funktion ausliefern:**
   `npx supabase functions deploy mcp --import-map supabase/functions/deno.json --use-api`
   (`verify_jwt = false` steht in `supabase/config.toml`, weil Clients zuerst die
   Metadaten ohne Token abrufen.)

## Gemini CLI

In `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "nextdesk": { "httpUrl": "https://<projekt-ref>.supabase.co/functions/v1/mcp" }
  }
}
```

Dann in der Gemini CLI `/mcp auth nextdesk` ausführen, im Browser anmelden und
«Zulassen» wählen.

## Sicherheit

- Ohne gültiges Zugriffstoken antwortet die Funktion mit 401; das Token wird bei
  jeder Anfrage beim Auth-Server geprüft (widerrufene Sitzungen fallen durch).
- Zugriff auf Daten und Aktionen erfolgt über dieselben Edge Functions und
  Zeilenregeln wie in der Web-App. Es gibt keinen eigenen Rechtepfad.
- Die Person bestätigt jede Verbindung auf der Seite `/oauth/consent` und kann
  sie jederzeit in Supabase widerrufen.
