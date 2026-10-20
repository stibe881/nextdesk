# nextDesk – Release Notes: globale Suche

**Datum:** 20. Oktober 2026
**Produktiv-Commit:** `0698842f7d71af9ddda41d0c924a70bf5e4be0e3`
**Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T134943Z-0698842`

## Ausgeliefert

Die Suche in der Kopfzeile der Übersicht ist nun eine globale Volltextsuche für den aktiven Mandanten. Sie findet berechtigte Treffer aus Tickets, persönlichen Wiedervorlagen, Wissensartikeln, Veranstaltungsräumen im navigierbaren Planungsfenster und Eintritten. Treffer führen direkt zu ihrem Ziel; je nach Bereich wird der weiterhin berechtigte Eintrag gezielt nachgeladen oder sichtbar hervorgehoben.

## Zugriffsschutz und Datenminimierung

Die PostgreSQL-Funktion `search_global_workspace` prüft aktive Mandantenmitgliedschaft und die bestehenden fachlichen Rechte bei jeder Suche. Tickets werden über die bestehende Ticketleseregel, Wiedervorlagen ausschliesslich über die eigene Zuordnung, Wissen über Sichtbarkeit, aktive Kundenorganisation und Funktionsschalter gefiltert. Raumaufträge verlangen `event.spaces.request` oder `event.spaces.manage`. Eintritte sind für Verwaltung, Ersteller:in, Führungsperson und ICT-Verantwortung sichtbar. Die Suchantwort enthält nur Daten, die für die Navigation erforderlich sind, keine vollständigen Beschreibungen oder Aufgabenlisten.

Zusätzlich wurde der Veranstaltungsräume-Arbeitsbereich fail-closed gegen Lesezugriffe ohne Raum-Berechtigung gehärtet. Onboarding-Ausnahmetickets werden nur noch bei aktueller Ticketleseberechtigung der handelnden Person verknüpft und angezeigt.

## Technische Auslieferung

- Additive Supabase-Migration `0092_global_workspace_fulltext_search` erfolgreich angewendet.
- `global-search` Version 1, `event-spaces` Version 2, `onboarding` Version 2 und `experience-hub` Version 5 sind aktiv und JWT-geschützt.
- Webbundle aus `apps/web/dist` nach Hetzner ausgerollt; die Produktivseite referenziert `assets/index-DGTm9Ef6.js` und dieses Bundle liefert HTTP 200.
- `pnpm check`, Schema-, Datenbank-, Edge- und Webtests, Formatprüfung sowie Produktionsbuild erfolgreich. Zwei unabhängige Sicherheitsreviews wurden durchgeführt; die initialen Befunde zu Raum-Leserechten, Onboarding-Beteiligung und Ticketverknüpfung wurden vor dem Release korrigiert. Die finale Gegenprüfung ergab keine offenen sicherheitsrelevanten Befunde.
- Produktions-Smoke-Test erfolgreich.

## Rücknahmegrenze

Die Datenbankmigration ergänzt ausschliesslich Suchindizes und die serverseitige Suchfunktion. Eine Web-Rücknahme kann über das angegebene Hetzner-Backup erfolgen. Die additive Migration wird nicht durch Löschen historischer Migrationen zurückgenommen.
