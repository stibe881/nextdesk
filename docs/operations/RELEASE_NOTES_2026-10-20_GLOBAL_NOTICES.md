# nextDesk – Release Notes: globale Hinweise

- **Produktivzeitpunkt:** 20. Oktober 2026, 08:54:28 UTC
- **Web-Commit:** `ad7b179d1736b1c4e45bf76b1a895db4155d68f6`
- **Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T085428Z-ad7b179`

## Änderung

Schwebende globale nextDesk-Hinweise im Arbeitsbereich werden nach fünf Sekunden automatisch ausgeblendet. Dazu gehören Erfolgs- und Fehlerhinweise wie «Ticketstatus aktualisiert», «Benachrichtigungen aktualisiert» und Wiedervorlagen-Hinweise.

Der Schliessen-Button bleibt verfügbar. Validierungsmeldungen direkt bei Formularfeldern werden nicht automatisch ausgeblendet, damit erforderliche Korrekturen sichtbar bleiben.

## Auslieferung und Prüfung

Die Webanwendung wurde auf Hetzner ausgerollt. Die vollständige Projekt-, Schema-, Datenbank-, Format- und Produktionsbuild-Prüfung war erfolgreich. Der anschliessende Produktions-Smoke-Test war erfolgreich.

## Datenwirkung und Rücknahme

Es wurden keine Datenbankmigrationen und keine Edge-Functions geändert. Eine Rücknahme erfolgt durch Wiederherstellen des oben genannten Web-Backups oder durch Ausrollen eines früheren geprüften Webbundles.
