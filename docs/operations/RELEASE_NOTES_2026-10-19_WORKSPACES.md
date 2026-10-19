# Release Notes – nextDesk

- **Version / Commit:** `39dd70a` – `feat: separate service, asset and case workspaces`
- **Datum und Uhrzeit (UTC):** 19. Oktober 2026, 19:47 UTC
- **Verantwortlich:** Manus
- **Umgebung:** Produktion `https://app.nextdesk.ch`

## Nutzerwirkung

- Services, Assets und Fälle sind drei eigenständige Arbeitsbereiche. Die gemeinsame Datenquelle und die Navigation bleiben bei deaktiviertem oder abgelaufenem Asset-Management vollständig verborgen.
- Die SLA-Regelverwaltung und Eskalationen sind aus Services entfernt und für Mandantenadministrationen in den Einstellungen verfügbar, sofern SLA-Automatisierung wirksam freigegeben ist.
- Ticketarbeitsfläche und Ticketdetail sind klarer nach Kontext, Vorbereitung, Kommunikation, Nachbereitung und Steuerung gegliedert; schmale Detailansichten erhalten eine kompaktere Darstellung.

## Sicherheit und Mandantentrennung

- Der bestehende serverseitige `assets.management`-Gate bleibt vor jedem gemeinsamen Katalogzugriff und jeder Mutation fail-closed.
- SLA-Einstellungen verbleiben hinter Mandantenadministration, wirksamer `automation.sla`-Freigabe und den bestehenden serverseitigen SLA-Berechtigungen.
- E-Mail, Entra, Wissensdatenbank, Provider, Scheduler und Mandanten-Funktionsschalter wurden durch diesen Release nicht aktiviert oder verändert.

## Datenbank und Edge Functions

- Migrationen: keine.
- Edge Functions: keine.

## Prüfungen

- `pnpm check`: erfolgreich.
- `pnpm test:schema` / `pnpm test:db`: erfolgreich.
- `pnpm format:check`: erfolgreich.
- Web-Build: erfolgreich (`pnpm --filter @nextdesk/web build:hetzner`).
- Unabhängiger Read-only-Review: kein Blocker.
- Produktion-Smoketest: erfolgreich.
- Öffentliche HTTP-Prüfung: `https://app.nextdesk.ch` liefert HTTP 200.

## Bekannte Einschränkungen

- Asset-, Fälle- und Services-Bereiche erscheinen nur nach bewusster Aktivierung von Asset-Management für den jeweiligen Mandanten.
- SLA-Regeln bleiben ohne separat eingerichteten, geheimnisgeschützten Scheduler reine Konfiguration; dieser Release startet keinen Scheduler.

## Rücknahmeweg

- Vorheriger geprüfter Commit: `16c59a7`.
- Web-Rollback getestet / nicht erforderlich: datierte Rückfallkopie auf Hetzner unter `/usr/www/users/jqviwy/backups/nextdesk-web-20261019T194654Z` vorhanden.
- Datenbankrücknahme: keine.
