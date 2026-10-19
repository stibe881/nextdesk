# Release Notes – nextDesk

- **Version / Commit:** `ae8871e` (`feat: refine tenant functions management`)
- **Datum und Uhrzeit (UTC):** 2026-10-19 18:40 UTC
- **Verantwortlich:** Manus
- **Umgebung:** Produktion `https://app.nextdesk.ch`

## Nutzerwirkung

- Einstellungen → Funktionen ist nach Arbeitsablauf, Portalen, Kommunikation, Integrationen und KI gegliedert und mit Suche sowie Statusfilter versehen.
- Jede Funktionskarte führt direkt zur passenden Konfiguration: Exchange Online, Intune, SLA-Regeln und SSO.
- Sichtbare Pilotlaufzeiten, Pilot-Hinweise und Pilotstatus wurden vollständig entfernt.
- Deaktivierte Funktionen laden keine zugehörige Browserkonfiguration mehr.

## Sicherheit und Mandantentrennung

- `assets.management` wird im Intune-Synchronisationsworker serverseitig fail-closed geprüft.
- `automation.sla` wird sowohl in der Ticketautomations-API als auch im geheimnisgeschützten SLA-Worker serverseitig fail-closed geprüft.
- Die JWT-Anforderungen blieben unverändert: `ticket-automation` erfordert JWT, die beiden geheimnisgeschützten Schedulerfunktionen nicht.
- Es wurde kein Scheduler eingerichtet und keine Automatisierung heimlich aktiviert.

## Datenbank und Edge Functions

- Migrationen: keine
- Edge Functions: `intune-asset-sync` v8, `ticket-automation` v7, `sla-automation` v8

## Prüfungen

- `pnpm check`: erfolgreich
- `pnpm test:schema` / `pnpm test:db`: erfolgreich
- Web-Build: `pnpm --filter @nextdesk/web build:hetzner` erfolgreich
- Produktion-Smoketest: erfolgreich
- Öffentliche Portalantwort: HTTPS 200

## Bekannte Einschränkungen

- Zeitgesteuerte SLA-Automationen bleiben inaktiv, bis ein geheimnisgeschützter Scheduler bewusst eingerichtet wird.
- Intune-Synchronisation wird erst für Mandanten mit aktivierter Asset-Verwaltung und vollständig eingerichteter Microsoft-Graph-Konfiguration ausgeführt.

## Rücknahmeweg

- Vorheriger geprüfter Commit: `ae8871e^`
- Web-Rollback: gesicherter Stand unter `/usr/www/users/jqviwy/nextdesk-release-backups/20261019T184023Z`
- Datenbankrücknahme: nicht erforderlich
