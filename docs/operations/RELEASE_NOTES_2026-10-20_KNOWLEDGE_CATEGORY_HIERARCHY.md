# nextDesk – Wissenskategorien hierarchisch organisiert

**Datum:** 20. Oktober 2026  
**Commit:** `8f6b24891af449333532ea51dc819c158cc22701`  
**Datenbankmigration:** `0088_knowledge_collection_hierarchy.sql`  
**Wissensdatenbank-API:** `knowledge-base`, Version 10, JWT-geschützt  
**Webrelease:** erfolgreich mit Produktions-Smoke-Test

## Ausgelieferte Änderung

Die bereits importierte Wissensdatenbank ist jetzt in eine klare, zweistufige Navigation gegliedert:

- `ICT intern` und `ICT öffentlich` sind die beiden sichtbaren Hauptkategorien.
- Die 27 bereits importierten Ordner sind jeweils als Unterkategorie zugeordnet.
- Alle 64 bestehenden Artikel-Kategoriezuordnungen wurden unverändert erhalten.
- In der Wissensdatenbank werden Kategorien als lesbarer Pfad angezeigt und beim Erstellen neuer Artikel können Haupt- oder Unterkategorien gewählt werden.
- Neue Kategorien lassen sich nur als Hauptkategorie oder als Unterkategorie einer Hauptkategorie anlegen.

## Sicherheits- und Datenregeln

- Der Zielmandant wird ausschliesslich aus der vollständigen Signatur des bereits importierten Wissensbestands bestimmt, nicht aus SSO- oder Domainkonfiguration.
- Die Migration bricht ohne Änderung ab, wenn nicht genau ein vollständiger Bestand mit 27 Ordnern und 64 Artikelzuordnungen erkannt wird.
- Die Datenbank erzwingt die Mandantentrennung auch für Kategorieneltern und unterbindet Selbstreferenzen sowie eine dritte Kategorienebene.
- Die Migration ist wiederholsicher: Ein erneuter Lauf erstellt keine weiteren Hauptkategorien, verändert keine Kategoriezeitstempel und schreibt keinen zweiten Importaudit-Eintrag.
- Die versionierte lokale Testfixture enthält nur Kategorienamen, Slugs und die Zuordnungsstruktur; Artikeltexte, Titel, Personen- und Linkdaten sind ausgeschlossen.

## Prüfung

Vor der Veröffentlichung waren vollständig erfolgreich:

- Projekt-Typprüfung und Webtests
- Schema-, Berechtigungs-, Datenbank- und Edge-Function-Prüfungen
- Datenbankregression mit der vollständigen sanitisierten Importstruktur, Wiederholungslauf und Mandantentrennungsgegenprobe
- Hetzner-Produktions-Smoke-Test
- Produktive Aggregatprüfung: 2 Hauptkategorien, 27 Unterkategorien, 64 eindeutige Artikel und 64 Artikelzuordnungen

## Sicherung und Rücknahmegrenze

Vor dem Webrelease wurde die vorherige Webversion gesichert unter:

`/usr/www/users/jqviwy/backups/nextdesk-20261020T114505Z-8f6b248`

Die Migration ist additiv. Eine Webrücknahme verändert die neue Datenhierarchie nicht. Eine Datenrücknahme darf weder durch Löschen der Migration noch durch unkontrolliertes Abflachen der Kategorien erfolgen, sondern benötigt ein abgestimmtes Wiederherstellungsfenster mit validierter Datensicherung.
