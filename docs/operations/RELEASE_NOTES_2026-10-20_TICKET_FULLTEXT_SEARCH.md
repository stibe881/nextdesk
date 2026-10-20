# nextDesk – Release Note: Ticket-Volltextsuche

**Datum:** 20. Oktober 2026
**Git-Commit:** `4c7b5f3`
**Datenbankmigration:** `0093_ticket_fulltext_filter_search`
**Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T140839Z-4c7b5f3`

## Ausgeliefert

- Der Bereich **Tickets** enthält oberhalb von Filter und Sortierung eine eigene Volltextsuche.
- Die Suche findet Ticketnummer, Betreff und Beschreibung mit deutschem PostgreSQL-Volltextindex.
- Bestehende Filter für Agent, Status, Ticketabteilung und Priorität sowie die Sortierung bleiben erhalten und wirken gemeinsam mit dem Suchbegriff.
- Leere oder einstellige Begriffe werden client- und serverseitig ignoriert; maximal zwölf Begriffe mit je höchstens 120 Zeichen werden verarbeitet.
- Die Ergebnismenge bleibt auf leseberechtigte Tickets des aktiven Mandanten beschränkt. Beschreibungen werden über die Listen-RPC nicht zusätzlich zurückgegeben.

## Sicherheit und Betrieb

- Die bestehende berechtigungsgesicherte Listen-RPC wurde additiv erweitert; `SECURITY DEFINER`, fester Suchpfad, Mandantenscope und `can_read_ticket` bleiben verbindlich.
- Direkte Aufrufe durch `anon` und `public` bleiben gesperrt; nur `authenticated` besitzt das Ausführungsrecht.
- Es gibt keinen Scheduler, keine automatische Ticketanlage, keine externe Integration und keine Datenmutation durch die Suche.

## Validierung

Erfolgreich ausgeführt: Projekt-Typ- und Regressionstests, Schema- und Berechtigungskatalogprüfung, Datenbank-/RLS-Regressionen, Edge-Prüfungen, Webtests, Produktionsbuild, Formatprüfung sowie `pnpm smoke:web`.

Die öffentliche Produktionsseite referenziert nach dem Release `assets/index-DXOpbzMK.js`; das Bundle liefert HTTP 200. Die produktive Ticketlisten-RPC ist vorhanden.

## Rücknahmegrenze

Das Webbundle kann anhand des oben angegebenen Backups zurückgerollt werden. Migration 0093 ist additiv und wird nicht durch Löschen historischer Datenbankmigrationen zurückgenommen.
