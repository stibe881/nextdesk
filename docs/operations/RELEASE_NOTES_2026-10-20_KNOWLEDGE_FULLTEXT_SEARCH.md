# nextDesk – Release Note: Wissensdatenbank-Volltextsuche

**Datum:** 20. Oktober 2026

**Git-Commit:** `28e857d`

**Datenbankmigration:** `0091_knowledge_fulltext_search.sql`

**Edge Function:** `knowledge-base`, Version 11, JWT geschützt
**Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T130905Z-28e857d`

## Ausgeliefert

Die Suche in der Wissensdatenbank ist nun eine serverseitige Volltextsuche. Sie berücksichtigt Artikeltitel, Zusammenfassungen und Artikelinhalt und ordnet Ergebnisse nach Relevanz. Die Eingabe erklärt dies als Suche über die gesamte Wissensdatenbank.

Für jede Wissensrevision wird ein revisionsgebundener Titel geführt. Dadurch sucht und zeigt eine externe Person ausschliesslich Titel und Inhalt der veröffentlichten Revision, auch wenn intern bereits ein neuer Entwurf existiert.

## Schutzgrenzen

- Die Suche ist mandantenisoliert und läuft ausschliesslich über eine serverseitige PostgreSQL-Funktion.
- Interne Personen können zulässige interne Inhalte durchsuchen.
- Externe Personen erhalten nur veröffentlichte externe Revisionen; organisationsgebundene Inhalte werden nur für eine aktive Organisation desselben Mandanten berücksichtigt.
- Autoren-, Ersteller- und Organisationskennungen werden nicht mehr in den allgemeinen Wissensantworten an den Browser zurückgegeben.
- Der Volltextindex und die Suchfunktion sind nicht für Browserrollen freigegeben; die JWT-geschützte `knowledge-base` Function bleibt der einzige Zugriffspfad.

## Validierung und Auslieferung

Die vollständige Projekt-, Schema-, Datenbank-, Edge-, Format- und Webbuild-Suite war erfolgreich. Die Produktionsmigration wurde angewendet, `knowledge-base` Version 11 als aktiv bestätigt und der Hetzner-Webrelease mit dem produktiven Smoke-Test verifiziert.

## Rücknahmegrenze

Die Migration ergänzt Revisionsdaten, Suchindex, Trigger und eine serverseitige Suchfunktion. Sie wird nicht durch das Löschen der historischen Migration zurückgenommen. Ein Web-Rollback verwendet das genannte Backup; eine Datenrücknahme wird nur nach abgestimmter Prüfung und Wiederherstellungsfenster vorgenommen.
