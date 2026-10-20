# nextDesk – Release Note: Kontextabhängige Ansichtsoptionen

- **Datum:** 20. Oktober 2026, 14:20 UTC
- **Produktiv-Commit:** `bf764b9eb103584af6ae0daf6a92e673707f12af`
- **Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T142040Z-bf764b9`
- **Umgebung:** Produktion `https://app.nextdesk.ch`

## Ausgeliefert

- Der Button «Ansicht» erscheint nur im Bereich **Tickets**.
- Dort stehen ausschliesslich die Ticketlistendichte und – bei aktivem Ticketdetail – die Listen-Detail-Ansicht zur Verfügung.
- Auf Übersicht, Wissen, Assets, Veranstaltungsräume, Eintritte und allen weiteren Bereichen ohne eigene wirksame Ansichtsoption wird kein leerer oder wirkungsloser Ansichtsbutton angezeigt.
- Farbschema, hoher Kontrast, Bewegungsreduktion und Startansicht bleiben ausschliesslich unter den persönlichen Einstellungen verfügbar.
- Ein bei einem Bereichswechsel noch offener seitenbezogener Dialog wird geschlossen.
- Der Dialog erhält beim Öffnen einen klaren Tastaturfokus, unterstützt `Esc`, hält den Tab-Fokus innerhalb des Dialogs und gibt den Fokus beim Schliessen an den passenden Auslöser zurück.

## Sicherheit und Betrieb

- Die Änderung betrifft ausschliesslich die Weboberfläche und lokale persönliche Präferenzen.
- Es wurden weder Daten noch Rollen, RLS-Regeln, Berechtigungen oder Mandantenscopes verändert.
- Es wurden keine Provider, Scheduler, Integrationen, Datenbankmigrationen oder Edge Functions aktiviert oder ausgeliefert.

## Validierung und Auslieferung

Erfolgreich ausgeführt: `pnpm check`, `pnpm test:schema`, `pnpm test:db`, `pnpm check:edge`, `pnpm test:edge`, `pnpm format:check`, Webtests, `git diff --check`, Hetzner-Produktionsbuild und Performancebudget-Prüfung.

Ein unabhängiger Read-only-Review hat zunächst eine wirkungslose Listen-Detail-Option ohne aktives Ticketdetail erkannt. Die Option wird nun nur bei wirksamem Kontext angeboten; die Regression deckt Ticketdetail, Vorschau beziehungsweise fehlende Ticketbearbeitung sowie sämtliche übrigen Bereiche ab. Die abschliessende Validierung war erfolgreich.

Vor der Auslieferung wurde das laufende Webbundle gesichert. Das neue Bundle wurde anschliessend auf Hetzner veröffentlicht. `pnpm smoke:web` war erfolgreich; die öffentliche Produktionsseite referenziert `assets/index-B5vqWUOr.js`, das mit HTTP 200 erreichbar ist.

## Rücknahmeweg

Bei einer notwendigen Rücknahme kann ausschliesslich das Webbundle aus dem oben genannten Hetzner-Backup wiederhergestellt und danach der Produktions-Smoke-Test wiederholt werden. Eine Datenbankrücknahme ist nicht erforderlich, weil dieses Release keine Datenbank- oder Edge-Function-Änderung enthält.
