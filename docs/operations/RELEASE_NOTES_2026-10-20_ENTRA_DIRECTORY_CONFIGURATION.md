# nextDesk – Release Notes: Entra-Verzeichniskonfiguration

- **Zeitpunkt (UTC):** 2026-10-20T04:25:22Z
- **Produktionscommit:** `850da6f18164887654062fb6f5e2512e6d7346ff`
- **Bereich:** P1.1 – mandantenadministrierbare, auditierte und testbare Microsoft-Entra-Verzeichniskonfiguration

## Ausgeliefert

- Migration `0081_entra_directory_configuration_management` im Supabase-Produktionsprojekt.
- `tenant-admin-settings` als aktive Edge Function, Version 13, mit JWT-Prüfung.
- `entra-directory-sync` als aktive Edge Function, Version 8, mit JWT-Prüfung und vollständigem lokalen Importbaum.
- Webbundle aus `apps/web/dist/` auf Hetzner ausgerollt.

## Sicherheits- und Betriebswirkung

Die Verzeichniskonfiguration leitet die Entra-Tenant-ID ausschliesslich aus einer bereits aktiven, tenant-spezifischen Azure-SSO-Konfiguration ab. Es gibt kein frei editierbares Tenant-ID-Feld. Ein Verbindungstest verwendet den personenbezugsfreien Microsoft-Graph-Endpunkt `GET /v1.0/users/$count` mit `ConsistencyLevel: eventual` und der vorgesehenen minimalen Anwendungsberechtigung `User.Read.All`.

Browserrollen können weder die private Konfigurationstabelle lesen noch die neuen RPCs ausführen. Die neuen Konfigurations-, Test- und Sync-RPCs sind ausschliesslich für `service_role` freigegeben. Test- und Sync-Läufe sind mandantenbezogen gelockt und per Konfigurationsgeneration gegen verspätete Resultate sowie SSO-Rebinding gefenced. Auditdaten enthalten nur Status und aggregierte Zahlen; keine Tokens, Graph-Antworten, Personendaten oder Tenant-ID-Kopien.

Die Veröffentlichung aktiviert keinen Kundenconnector, keinen echten Verzeichnisabgleich und keinen periodischen Scheduler. Ein manueller Abgleich bleibt serverseitig gesperrt, bis für den jeweiligen Mandanten ein erfolgreicher Verbindungstest vorliegt.

## Datenwirkung und Rücknahmegrenze

Die Migration ergänzt ausschliesslich Spalten, Constraints sowie SECURITY-DEFINER-RPCs mit expliziten Grants. Sie startet weder Imports noch andere Datenmutationen für Kundenverzeichnisse. Bereits angewendete produktive Migrationen werden nicht gelöscht oder zurückgeschrieben. Eine allfällige spätere Rücknahme erfolgt deshalb über eine neue, separat geprüfte Vorwärtsmigration.

## Verifikation

Vor dem Release erfolgreich:

- `pnpm check`
- `pnpm test:db`
- `pnpm test:schema`
- `pnpm test:edge`
- `pnpm check:edge`
- `pnpm format:check`
- `pnpm --filter @nextdesk/web build:hetzner`
- unabhängiger read-only Sicherheitsreview

Nach dem Release erfolgreich:

- Migration 0081 ist produktiv registriert.
- Beide Edge Functions sind aktiv und behalten `verify_jwt = true`.
- RLS ist für `tenant_entra_directory_sync_configurations` aktiv; `anon` und `authenticated` haben weder Tabellenleserechte noch Ausführungsrechte auf Konfigurations-, Test- oder Sync-RPCs; `service_role` besitzt diese Rechte.
- Web-Smoke-Test: erfolgreich.

## Web-Rückfallkopie

Vor dem Ausrollen wurde das bisherige Webbundle auf dem Hosting in folgendem Verzeichnis gesichert:

`/usr/www/users/jqviwy/backups/nextdesk-web-20261020T042508Z-850da6f`
