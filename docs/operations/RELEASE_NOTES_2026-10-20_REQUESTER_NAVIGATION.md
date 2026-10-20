# nextDesk – Release Note: Navigation für reine Anfragende

- **Datum:** 20. Oktober 2026, 14:54 UTC
- **Produktiv-Commit:** `edfb092064a52bac18a9e6df286eb5c687073b73`
- **Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T145419Z-edfb092`
- **Umgebung:** Produktion `https://app.nextdesk.ch`

## Ausgeliefert

Personen ohne Ticketarbeitsberechtigung sehen im Arbeitsbereich ausschliesslich:

- Übersicht
- Tickets
- Mein Portal, sofern die Portal-Funktion im Mandanten aktiv ist

«Mein Portal» steht nicht mehr in der Hauptnavigation. Der Eintrag erscheint im unteren, durch die bestehende Trennlinie abgegrenzten Benutzerbereich unmittelbar oberhalb des Benutzerprofils.

Die Beschränkung greift zusätzlich ausserhalb der sichtbaren Navigation:

- Alle clientseitigen Bereichswechsel laufen über ein zentrales Rollen-Gate und leiten nicht erlaubte Ziele auf die Übersicht zurück.
- Die globale Suche zeigt reinen Anfragenden ausschliesslich Ticketresultate; bereits geladene Resultate werden bei einem Rollenwechsel synchron gefiltert.
- Das Tageswidget mit Wiedervorlagen, CSV-Import und CSV-Export sind für reine Anfragende nicht sichtbar.
- Das zentrale Plus-Menü bietet reinen Anfragenden ausschliesslich die Ticketerfassung.

Für berechtigte Agent:innen bleibt das übrige Arbeitsmenü erhalten. Ein gegebenenfalls freigegebenes «Mein Portal» verwendet ebenfalls die neue konsistente Platzierung im unteren Benutzerbereich.

## Sicherheit und Umfang

Die Änderung betrifft ausschliesslich den Webclient und ergänzt die bestehenden serverseitigen Rechte- und Mandantenprüfungen. Ticketzugriff, CSV-Endpunkte, RLS, Rollen, Funktionsschalter und Mandantentrennung bleiben serverseitig unverändert fail-closed massgebend.

Es wurden keine Datenbankmigrationen, Edge Functions, RLS-Policies, Rollen, Scheduler, externen Integrationen oder automatischen Anlagen verändert.

## Validierung und Auslieferung

Erfolgreich ausgeführt wurden die vollständige Projektsuite, PostgreSQL-Migrations- und RLS-Regressionen, Web-Typecheck, fokussierte Regressionen für Navigation, zentrale Erfassung und globale Suche, Formatprüfung, Hetzner-Produktionsbuild, Performancebudget, unauthentifizierter Browser-Test und `git diff --check`.

Zwei unabhängige Read-only-Reviews prüften Rollenpfade, globale Suche, Tageswidget, CSV-Steuerungen, zentrale Navigation und die responsive Footer-Struktur. Festgestellte Befunde wurden vor der Auslieferung korrigiert und danach erneut vollständig validiert.

Vor dem Release wurde das bestehende Webbundle gesichert. Der Produktions-Smoke-Test war erfolgreich. Die öffentliche Produktionsseite referenziert `assets/index-BIq5q49V.js`; das Bundle liefert HTTP 200.

## Rücknahmeweg

Bei einer notwendigen Rücknahme kann ausschliesslich das Webbundle aus `/usr/www/users/jqviwy/backups/nextdesk-20261020T145419Z-edfb092` auf das Hetzner-Webziel zurückkopiert und danach `pnpm smoke:web` wiederholt werden. Eine Datenbankrücknahme ist nicht erforderlich.
