# Release Notes – nextDesk

- **Version / Commit:** `a1de86ac01c2dbef952ae2966fe4c1badbe849db` und Korrektur `e7c44539f5a7550fd072cc974612c59fe7807065`
- **Datum und Uhrzeit (UTC):** 2026-10-19 18:20 UTC
- **Verantwortlich:** Manus
- **Umgebung:** Produktion `https://app.nextdesk.ch`

## Nutzerwirkung

- Mandantenadministrationen können synchronisierte Entra-Personen unter **Einstellungen → Personen** bewusst als Support-Agent einer aktiven Abteilung vormerken.
- Ist die Person bereits aktiv bei nextDesk angemeldet, wird die Support-Agentenrolle sofort wirksam. Vor der ersten Anmeldung bleibt es ausschliesslich bei der Vormerkung.
- Beim nächsten erfolgreichen Entra-SSO-Login wird die vorgemerkte Rolle atomar und nur für die gewählte Abteilung angewendet.
- Über die gleiche Oberfläche kann eine Entra-Agentenzuordnung wieder aufgehoben werden.

## Sicherheit und Mandantentrennung

- Kein Entra-Abgleich und kein SSO-Login vergibt ohne bewusste Aktion einer Mandantenadministration Agentenrechte.
- Jede Vormerkung trägt Administration und Zeitpunkt als nachweisbare Herkunft; zugehörige Rollenreferenzen werden beim Entzug oder Entra-Offboarding atomar beendet.
- Die drei internen Entra-RPCs sind `SECURITY DEFINER`, haben einen festen Suchpfad und können ausschliesslich durch `service_role` ausgeführt werden. `anon` und `authenticated` besitzen keine Ausführungsrechte.
- Generische Rollen- und Personenbearbeitung kann eine Entra-verwaltete Agentenrolle weder heimlich entfernen noch bei einer späteren SSO-Anmeldung wiederherstellen.
- Die aktualisierte Entra-Verzeichnissynchronisierung entzieht eine getrackte Agentenrolle, wenn das Entra-Konto deaktiviert oder beim Abgleich nicht mehr aktiv ist.

## Datenbank und Edge Functions

- **Migrationen:**
  - `0077_entra_agent_assignment_provenance.sql`: Provenance, kontrollierte Agentenvormerkung, Login-Anwendung, Offboarding und zentraler Rollenschutz.
  - `0078_fix_entra_agent_directory_assignment.sql`: idempotente Korrektur der Mitgliederverzeichnis-Abteilung für bereits angemeldete Personen.
- **Edge Functions:**
  - `tenant-users` v11, JWT erforderlich
  - `tenant-sso-access` v17, JWT erforderlich
  - `entra-directory-sync` v7, JWT erforderlich
  - `tenant-role-management` v9, JWT erforderlich

## Prüfungen

- `pnpm check`: erfolgreich
- `pnpm test:schema` / `pnpm test:db`: erfolgreich; Datenbanktests decken Vormerkung vor Login, unmittelbare Zuordnung, SSO-Anwendung, Entzug, Offboarding und Mandantentrennung ab.
- Web-Build: `pnpm --filter @nextdesk/web build:hetzner` erfolgreich.
- Produktion-Smoketest: erfolgreich, `https://app.nextdesk.ch` lieferte HTTP 200.
- Produktivprüfung: alle drei Entra-RPCs haben `SECURITY DEFINER`, nur `service_role`-Ausführungsrecht und die korrigierte Directory-Spaltenreihenfolge. Beim Release existierten keine offenen Vormerkungen oder getrackten Rollen.

## Bekannte Einschränkungen

- Die Funktion steht nur für Personen zur Verfügung, die durch den bereits eingerichteten Entra-Verzeichnisabgleich im jeweiligen Mandanten vorhanden sind.
- Die Wissensdatenbank-XML bleibt ausdrücklich pausiert und war nicht Bestandteil dieses Releases.

## Rücknahmeweg

- **Vorheriger geprüfter Commit:** `bc02f18`
- **Web-Rollback getestet / nicht erforderlich:** nicht erforderlich; vor dem Rollout wurde die vorherige Webversion nach `/usr/www/users/jqviwy/backups/entra-agent-20261019T182020Z` gesichert.
- **Datenbankrücknahme:** keine automatische Rücknahme. Die Migrationen sind additiv; eine allfällige Datenrücknahme benötigt ein separates, ausdrücklich freigegebenes Wartungsfenster.
