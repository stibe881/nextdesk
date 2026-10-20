# Release Notes – Eintritte und Onboarding

**Datum:** 20. Oktober 2026  
**Commit:** `5ec8af8255bce471126a213187d8365a1179d756`  
**Migration:** `0090_employee_onboarding.sql`  
**Edge Function:** `onboarding`, Version 1, JWT-Prüfung aktiv  
**Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T125413Z-5ec8af8`

## Ausgeliefert

- Eigenständiger Menüpunkt **Eintritte** für planbare Mitarbeitendeneintritte statt offener Tickets.
- Pflichtangaben: Name, Eintrittsdatum, Abteilung/Angebot, Standort, Führungsperson, ICT-Verantwortung und Onboarding-Vorlage.
- Vorlagen **Standard**, **ICT**, **Schule** und **Verwaltung**. Alle enthalten die grundlegenden Aufgaben; ICT, Schule und Verwaltung ergänzen fachliche Vorbereitungsschritte.
- Aufgaben werden einmalig und serverseitig relativ zum Eintrittsdatum mit Fälligkeit, Verantwortlichkeit und Fortschrittsstatus angelegt.
- Führungspersonen und ICT sehen ihre jeweiligen Eintritte und Aufgaben; Personen mit Verwaltungsrecht sehen den gesamten Mandantenbestand.
- Eine Ausnahme oder Verzögerung erzeugt nie automatisch ein Ticket. Ein bewusst im Ticketbereich erstelltes Ticket kann über seine Ticketnummer mit einer konkreten Onboarding-Aufgabe verknüpft werden.
- Mandantentrennung, service-only Datenzugriff, Audit, zusammengesetzte tenantgebundene Fremdschlüssel und JWT-Schutz sind aktiv.

## Prüfungen und Auslieferung

- Schema- und Berechtigungskatalogprüfung erfolgreich.
- Lokale PostgreSQL-16-Migrations- und RLS-Regression erfolgreich.
- Edge-Typprüfung sowie 31 Edge-Regressionen erfolgreich.
- Web-Typprüfung, Webtests und Hetzner-Produktionsbuild erfolgreich.
- Hetzner-Auslieferung mit datiertem Backup und Produktions-Smoke-Test erfolgreich.

## Rücknahmegrenze

Die Migration ist additiv und wird nicht durch Löschen historischer Migrationen zurückgenommen. Eine Rücknahme des Webbundles erfolgt über das genannte Backup oder einen zuvor geprüften Git-Commit; bereits erfasste Eintritte, Aufgaben und bewusste Ticketverknüpfungen bleiben dabei unverändert.
