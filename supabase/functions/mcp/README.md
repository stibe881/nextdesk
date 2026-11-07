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
| `search_knowledge`, `get_knowledge_article` | lesen | Wissensdatenbank |
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

Geschriebene Texte (Ticket, interne Notiz, Zeitnotiz, Notiz zur Serviceaufgabe,
Wiedervorlage)
enden mit dem Hinweis «Erfasst über den nextDesk-Connector.». Antworten an
Anfragende werden ohne diesen Hinweis versendet.

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
