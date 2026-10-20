# nextDesk – Release Note: Arbeitsplatz vor Übersicht

- **Datum:** 20. Oktober 2026, 16:20 UTC
- **Produktiv-Commit:** `499a451f9632f4fcb480e1a5b37f0a235f85df91`
- **Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T162005Z-499a451`
- **Umgebung:** Produktion `https://app.nextdesk.ch`

## Ausgeliefert

«Arbeitsplatz» erscheint für berechtigte Agent:innen jetzt als erster verfügbarer Punkt im Arbeitsbereich direkt oberhalb von «Übersicht». Die bisherige Reihenfolge aller weiteren Punkte bleibt erhalten.

Ist der Arbeitsplatz für einen Mandanten nicht verfügbar, beginnt die Navigation weiterhin bei «Übersicht». Reine Anfragende sehen und erreichen unverändert ausschliesslich Übersicht, Tickets und bei aktivierter Funktion Mein Portal.

## Sicherheit und Datenwirkung

Die Änderung betrifft ausschliesslich die Reihenfolge bereits berechtigter Navigationseinträge. Sie verändert keine Rollen, Funktionsfreigaben, Mandantenzuordnungen, Daten oder API-Aufrufe.

Es wurden keine Datenbankmigrationen, Edge Functions, externen Integrationen oder Hintergrundaufgaben veröffentlicht.

## Validierung und Auslieferung

Erfolgreich ausgeführt wurden `pnpm check`, `pnpm test:schema`, PostgreSQL-Migrations- und RLS-Regressionen, `pnpm check:edge`, 39 Deno-Edge-Tests, Formatprüfung, 46 Webtests, der Hetzner-Produktionsbuild und `git diff --check`.

Vor der Auslieferung wurde das laufende Webbundle unter dem oben genannten Pfad gesichert. Der Produktions-Smoke-Test war erfolgreich. Die öffentliche Produktion referenziert `assets/index-B1PgxJlG.js`, das mit HTTP 200 erreichbar ist.

## Rücknahmeweg

Bei einer notwendigen Rücknahme kann ausschliesslich das Webbundle aus `/usr/www/users/jqviwy/backups/nextdesk-20261020T162005Z-499a451` auf das Hetzner-Webziel zurückkopiert und danach `pnpm smoke:web` wiederholt werden. Eine Datenbankrücknahme ist nicht erforderlich.
