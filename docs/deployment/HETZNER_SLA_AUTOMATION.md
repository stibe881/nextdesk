# nextDesk SLA-Automation auf Hetzner Webhosting L

> **Zweck:** Überfällige Erstreaktions- und Lösungsziele werden automatisiert geprüft. Pro Ticket und Breach-Typ wird der Ablauf transaktional und idempotent ausgeführt: SLA-Ereignis, Ticket-Timeline, Audit-Eintrag, bei Lösungszielüberschreitung eine Eskalation sowie eine Benachrichtigung an die zugewiesene Person.

## Voraussetzungen

- Bereitgestellte Supabase Edge Function: `sla-automation`
- Datenbankmigrationen `0028_sla_automation_idempotency.sql` und `0029_apply_sla_breach_atomically.sql`
- Hetzner-SSH-Benutzer `jqviwy`
- Bereitgestelltes Skript [`scripts/run-sla-automation.sh`](../../scripts/run-sla-automation.sh)

Die Funktion nimmt **keine Browser-JWTs** an und sendet keine CORS-Header. Sie wird ausschließlich durch ein geheimes Automations-Token geschützt.

## Einmalige sichere Einrichtung

### 1. Zufälliges Secret erzeugen

Auf einem vertrauenswürdigen Rechner ein Secret erzeugen:

```bash
openssl rand -hex 32
```

Das Secret nie in Git, im statischen Webroot, in Browser-Code, in einer URL oder in Cron-Ausgaben speichern.

### 2. Supabase-Secret setzen

Im Supabase-Dashboard des Projekts **TicketHub Development**:

1. **Edge Functions → Secrets** öffnen.
2. `SLA_AUTOMATION_SECRET` als Namen und den erzeugten Wert hinterlegen.
3. Speichern.

Erst danach ist der Endpunkt aktiv; vorher antwortet er absichtlich mit `503 sla_automation_unavailable`.

### 3. Geschützte Hetzner-Datei und Runner anlegen

Per SSH das Skript und die Secret-Datei **außerhalb** von `public_html` hinterlegen:

```bash
install -d -m 700 "$HOME/.config/nextdesk" "$HOME/bin"
install -m 700 /pfad/zu/run-sla-automation.sh "$HOME/bin/run-sla-automation.sh"

cat > "$HOME/.config/nextdesk/sla-automation.env" <<'EOF'
SLA_AUTOMATION_SECRET='HIER_DAS_ERZEUGTE_SECRET_EINFÜGEN'
EOF
chmod 600 "$HOME/.config/nextdesk/sla-automation.env"
```

Der Runner erwartet standardmäßig diese Secret-Datei. Optional kann der Pfad mit `NEXTDESK_SLA_ENV_FILE` überschrieben werden.

### 4. Sicheren Testlauf durchführen

Die Secret-Datei laden und zuerst einen Dry-Run direkt gegen die Function ausführen:

```bash
set -a
. "$HOME/.config/nextdesk/sla-automation.env"
set +a
curl --fail-with-body --request POST \
  --header 'Content-Type: application/json' \
  --header "X-NextDesk-Automation-Secret: $SLA_AUTOMATION_SECRET" \
  --data '{"dryRun":true,"limit":100}' \
  'https://ewizsylzrwogsztsthbl.supabase.co/functions/v1/sla-automation'
```

Erwartet wird HTTP `200` und eine JSON-Antwort mit `dryRun: true`. Der Dry-Run nimmt keine Datenänderung vor.

### 5. Hetzner-Cronjob anlegen

In **konsoleH → Cronjobs** einen Job mit folgendem Zeitplan einrichten:

```text
*/5 * * * *
```

Befehl:

```bash
$HOME/bin/run-sla-automation.sh >> "$HOME/.config/nextdesk/sla-automation.log" 2>&1
```

Der Cronjob darf nur Schreibrechte auf die geschützte Logdatei haben. Die Logdatei kann regulär rotiert oder periodisch geleert werden; sie enthält niemals das Secret.

## Betriebsprüfung

- Im ersten Produktivlauf prüfen, ob ein überfälliges Testticket exakt **ein** `ticket.sla.response_breached` bzw. `ticket.sla.resolution_breached` Ereignis bekommt.
- Den Runner sofort erneut ausführen. Das Ergebnis darf kein zweites Ereignis, keine weitere Eskalation und keine doppelte Benachrichtigung erzeugen.
- In **Einstellungen → Änderungsprotokoll** die daraus resultierenden Audit-Einträge prüfen.
- Bei Fehlern zuerst die beschränkte Runner-Logdatei lesen; Secrets nicht in Support-Tickets oder Chatprotokolle kopieren.

## Fehlerbehandlung

| Antwort                           | Bedeutung                                           | Maßnahme                                                                   |
| --------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| `401 sla_automation_unauthorized` | Secret fehlt oder stimmt nicht überein.             | Secret in beiden Secret-Speichern vergleichen, ohne den Wert offenzulegen. |
| `422 invalid_request`             | Der Scheduler sendet keinen gültigen JSON-Body.     | Runner unverändert verwenden.                                              |
| `503 sla_automation_unavailable`  | Supabase-Secret ist noch nicht hinterlegt.          | Schritt 2 abschließen.                                                     |
| `207`                             | Ein Teil der Batch-Verarbeitung ist fehlgeschlagen. | Runner-Log und Supabase Function Logs prüfen; ein Retry ist sicher.        |
