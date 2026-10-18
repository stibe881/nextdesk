# nextDesk – Release, Rücknahme und Wiederherstellung

## Ziel

Jede Web-Veröffentlichung muss anhand eines Git-Commits, eines erfolgreichen Builds und eines Smoke-Tests nachvollziehbar sein. Dieses Runbook beschreibt ausschließlich reversible Schritte. Es verändert keine Produktivdaten.

## Vor der Veröffentlichung

1. `git status --short` muss leer sein und `origin/main` muss den beabsichtigten Commit enthalten.
2. `pnpm check`, `pnpm test:schema`, `pnpm test:db`, `pnpm format:check` und `pnpm --filter @nextdesk/web build:hetzner` müssen erfolgreich sein.
3. Bei Änderungen an Edge Functions: zuerst die Function bereitstellen und ihren Status `ACTIVE` bestätigen.
4. Bei Migrationen: Nummer, Zweck, Datenwirkung und Rücknahmegrenze in den Release Notes festhalten. Additive Migrationen werden nicht durch Löschen historischer Migrationen zurückgenommen.

## Web-Veröffentlichung

Die Produktionsauslieferung erfolgt aus `apps/web/dist/` auf das Hetzner-Ziel. Direkt danach ist `pnpm smoke:web` erforderlich. Der erfolgreiche Commit und die UTC-Zeit gehören in die Release Notes.

## Rücknahme einer Web-Version

1. Den letzten nachweislich funktionierenden Git-Commit bestimmen.
2. In einem sauberen Arbeitsbaum diesen Commit auschecken, die vollständige Qualitätssuite ausführen und `apps/web/dist/` erzeugen.
3. Das zuvor laufende Bundle in ein datiertes Sicherungsverzeichnis auf dem Hosting kopieren, bevor es ersetzt wird.
4. Das geprüfte frühere Bundle ausrollen und `pnpm smoke:web` erneut ausführen.
5. Die Rücknahme mit Ursache, betroffener Version und Ergebnis dokumentieren. Datenbankmigrationen und gespeicherte Daten werden dabei nicht verändert.

## Datenbank und Storage

- Supabase Point-in-Time-Recovery, Backups und Storage-Wiederherstellung werden ausschließlich in der Supabase-Verwaltung und mit einem abgestimmten Wiederherstellungsfenster ausgeführt.
- Ein Restore erfolgt nie in die laufende Produktion ohne vorherigen Test in einer isolierten Umgebung und ohne explizite Freigabe, da er Daten überschreiben kann.
- Jede Wiederherstellungsübung dokumentiert Zeitpunkt, Wiederherstellungsziel, gemessene Dauer, Datenabgleich und verbleibende Abweichungen.

## Regelmässiger Recovery-Drill

Quartalsweise: eine anonymisierte, isolierte Wiederherstellungsprobe ausführen; Web-Smoke, Mandantentrennung, Authentifizierung und Stichproben auf Tickets/Anhänge prüfen; Ergebnis, RPO und RTO in den Release Notes oder Betriebsprotokoll festhalten.
