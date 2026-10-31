# nextDesk-Connector (MCP)

Verbindet KI-Clients wie die Gemini CLI mit nextDesk. Die Anmeldung läuft über
den OAuth-2.1-Server von Supabase Auth, also mit dem normalen nextDesk-Konto
(auch Microsoft-SSO). Jede Aktion läuft mit den Rechten der angemeldeten Person.

## Werkzeuge

| Werkzeug | Art | Zweck |
| --- | --- | --- |
| `list_workspaces` | lesen | Arbeitsbereiche des Kontos |
| `search_tickets` | lesen | Tickets suchen (mine, open, unassigned, all) |
| `get_ticket` | lesen | Ticket mit Beschreibung und Verlauf |
| `search_knowledge`, `get_knowledge_article` | lesen | Wissensdatenbank |
| `find_asset` | lesen | Geräte nach Name, Nummer, Tag oder Seriennummer |
| `create_ticket` | schreiben | Ticket für sich selbst erfassen |
| `add_internal_note` | schreiben | Interne Notiz an ein Ticket |

Geschriebene Texte enden mit dem Hinweis «Erfasst über den nextDesk-Connector.».

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
