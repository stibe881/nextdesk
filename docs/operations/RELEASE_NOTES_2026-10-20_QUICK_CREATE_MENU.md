# nextDesk – Release Note: Zentrales Erfassungsmenü

- **Datum:** 20. Oktober 2026, 14:39 UTC
- **Produktiv-Commit:** `48dfa4c8f30168d38b8e818b2d152ee1b13af66f`
- **Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T143909Z-48dfa4c`
- **Umgebung:** Produktion `https://app.nextdesk.ch`

## Ausgeliefert

Der bisherige breite Header-Button «Ticket erfassen» wurde durch einen kompakten Plus-Auslöser ersetzt. Das Menü zeigt im verfügbaren Mandanten- und Berechtigungskontext:

- Ticket erfassen
- Fall erfassen
- Wiedervorlage erfassen
- Wissensartikel erfassen

Die Auswahl wechselt direkt in den passenden Bereich und öffnet dort das vorhandene Erfassungsformular. Aktionen für Fälle und Wissensartikel erscheinen nur bei berechtigter Ticketarbeit und aktivierter Funktion. Wiedervorlagen folgen ihrer bestehenden Funktionsfreigabe. Die serverseitigen Rechte- und Mandantenprüfungen bleiben für jede tatsächliche Anlage unverändert massgebend.

Das Menü ist per Tastatur bedienbar: Escape schliesst es mit Rückkehr zum Plus-Auslöser, Pfeiltasten wechseln zwischen den Aktionen, Tab und Shift+Tab verlassen es mit eindeutiger Fokusweitergabe. Formimpulse werden nach Übernahme verbraucht, damit nach einem Abbruch und späterer Rückkehr kein unerwartetes leeres Formular erneut geöffnet wird.

Beim bewussten Mandantenwechsel werden Berechtigung, Funktionsstatus, Menü und offene Erfassungsimpulse sofort fail-closed zurückgesetzt. Zusätzlich trägt jeder Formimpuls die auslösende Mandanten-ID und wird ausschliesslich an denselben aktiven Mandanten ausgeliefert.

Die Corporate-Design-Vorschau zeigt ebenfalls den kompakten Plus-Auslöser.

## Umfang und Sicherheit

Dieses Release enthält nur Webclient, Styles, fokussierte Regressionen sowie Plan- und Lieferdokumentation. Es wurden keine Datenbankmigrationen, Edge Functions, Rollen, RLS-Policies, Scheduler, externen Integrationen oder automatischen Anlagen verändert.

## Validierung und Auslieferung

Erfolgreich ausgeführt wurden `pnpm check`, `pnpm test:db`, `pnpm format:check`, Web-Typecheck, fokussierte Webregressionen, der Hetzner-Produktionsbuild, die Performancebudget-Prüfung, der unauthentifizierte Browser-Test und `git diff --check`.

Mehrere unabhängige Read-only-Reviews prüften Menülogik, Formularübergaben, Tastaturführung, Rechtekontext und die Mandantenwechsel-Rennbedingung. Festgestellte Befunde wurden vor der Auslieferung korrigiert und anschliessend erneut geprüft.

Vor der Auslieferung wurde das laufende Webbundle unter dem oben genannten Backup-Pfad gesichert. Der Produktions-Smoke-Test war erfolgreich. Die öffentliche Produktionsseite referenziert `assets/index-D8pNQAYj.js`; das Bundle liefert HTTP 200.

## Rücknahmeweg

Bei einer notwendigen Rücknahme kann ausschliesslich das Webbundle aus `/usr/www/users/jqviwy/backups/nextdesk-20261020T143909Z-48dfa4c` auf das Hetzner-Webziel zurückkopiert und danach `pnpm smoke:web` wiederholt werden. Eine Datenbankrücknahme ist nicht erforderlich.
