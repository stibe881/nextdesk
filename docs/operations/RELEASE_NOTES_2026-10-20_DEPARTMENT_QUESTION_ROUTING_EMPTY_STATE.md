# Release Note: Ruhige Einstellungen ohne nicht verfügbare Abteilungsrückfragen

**Datum:** 20. Oktober 2026  
**Produkt:** nextDesk Web  
**Code-Commit:** `1f369e8` (`fix: hide unavailable department question routing`)  
**Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T171234Z-1f369e8`

## Ausgeliefert

- Die Konfiguration «Abteilungsleitungen» unter Einstellungen → Abteilungen wird vollständig ausgeblendet, wenn die Abteilungsrückfragen im aktiven Mandanten nicht erreichbar sind.
- Während der Datenabfrage und bei verfügbaren Abteilungsleitungen bleiben die bestehende Bedienoberfläche und die Aktualisierungsaktion unverändert.
- Die grosse, nicht bedienbare Fehlermeldung erscheint nicht mehr als Arbeitsfläche in den Einstellungen.
- Die Änderung betrifft ausschliesslich die Weboberfläche. Es gibt keine Datenbankmigration, Function-Änderung, Rechteänderung oder Hintergrundverarbeitung.

## Validierung

- Vollständige Repository-Suite erfolgreich: Typecheck, Webtests, Schema- und Datenbanktests, Edge-Check/-Tests, Formatprüfung, Hetzner-Build, Performance-Budget und `git diff --check`.
- Fokussierte Regression für die Sichtbarkeitsregel erfolgreich.
- Hetzner-Webrelease durchgeführt; öffentlicher Release-Smoke-Test und neues Bundle: HTTP 200.

## Rücknahme

Bei Bedarf das Webbundle aus dem oben genannten Backup nach `/usr/www/users/jqviwy/app/` zurückspielen.
