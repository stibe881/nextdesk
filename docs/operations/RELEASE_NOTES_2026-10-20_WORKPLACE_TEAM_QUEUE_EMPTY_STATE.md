# Release Note: Ruhiger Arbeitsplatz ohne nicht verfügbare Team-Warteschlangen

**Datum:** 20. Oktober 2026  
**Produkt:** nextDesk Web  
**Code-Commit:** `0c8924c` (`fix: hide unavailable workplace team queues`)  
**Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T170808Z-0c8924c`

## Ausgeliefert

- Der Arbeitsplatz blendet den Bereich «Team-Warteschlangen» vollständig aus, wenn der aktive Mandant keine solchen Warteschlangen anbietet.
- Während der Datenabfrage bleibt die vorhandene Ladeanzeige bestehen. Bei verfügbaren Warteschlangen bleiben Liste, Rechteprüfung und Navigation unverändert.
- Der nicht bedienbare Hinweis «Team-Warteschlangen sind für diesen Mandanten derzeit nicht verfügbar» erscheint nicht mehr als grosse Arbeitsfläche.
- Die Änderung betrifft ausschliesslich die Weboberfläche. Es gibt keine Datenbankmigration, Function-Änderung, Rechteänderung oder Hintergrundverarbeitung.

## Validierung

- Vollständige Repository-Suite erfolgreich: Typecheck, Webtests, Schema- und Datenbanktests, Edge-Check/-Tests, Formatprüfung, Hetzner-Build, Performance-Budget und `git diff --check`.
- Fokussierte Regression für die Sichtbarkeitsregel erfolgreich.
- Hetzner-Webrelease durchgeführt; öffentlicher Release-Smoke-Test und neues Bundle: HTTP 200.

## Rücknahme

Bei Bedarf das Webbundle aus dem oben genannten Backup nach `/usr/www/users/jqviwy/app/` zurückspielen.
