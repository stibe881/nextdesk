# nextDesk – Release Note: Wiedervorlagen im Arbeitsplatz

- **Datum:** 20. Oktober 2026, 15:48 UTC
- **Produktiv-Commit:** `22bc81dbe54c8a9bb7bb03366abc6fd0f73249c3`
- **Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T154751Z-22bc81d`
- **Umgebung:** Produktion `https://app.nextdesk.ch`

## Ausgeliefert

Wiedervorlagen sind kein eigener Eintrag der Hauptnavigation mehr. Sie erscheinen als eigenes Register im Bereich «Arbeitsplatz». Alle bisherigen persönlichen Wiedervorlagen mit Ticketverknüpfung, Anlegen, Bearbeiten und Erledigen bleiben erhalten.

Die zentrale Erfassung, «Mein Tag», globale Suchtreffer und ältere gespeicherte Startansichten führen in den Arbeitsplatz direkt zum Register «Wiedervorlagen». Eine gespeicherte frühere Startansicht wird erst nach abgeschlossener Sitzungs-, Mandanten-, Berechtigungs- und Funktionsprüfung sicher angewendet.

## Rollen und Mandantentrennung

Reine Anfragende sehen weiterhin ausschliesslich Übersicht, Tickets und gegebenenfalls Mein Portal. Sie können Wiedervorlagen weder über Navigation, direkte Webzustände, globale Suche, PostgREST noch die zugrundeliegende Datenbank lesen, erstellen oder erledigen.

Migration `0094_follow_up_agent_authorization` ist produktiv angewendet. Sie führt die gemeinsame Funktion `can_work_tickets_in_tenant` ein, härtet alle RLS-Policies für Wiedervorlagen und begrenzt den Wiedervorlagenzweig der globalen Suche zusätzlich auf aktive Ticketarbeit im jeweiligen Mandanten. Berechtigte Agent:innen behalten die vollständige persönliche Wiedervorlagenfunktion; Schreibversuche in fremden Mandanten bleiben gesperrt.

Die bereits produktive `experience-hub`-Function arbeitet mit dem aufrufenden Benutzerkontext. Die neue RLS-Schicht schützt daher auch den bestehenden Function-Stand fail-closed. Die ergänzte, früher abweisende Function-Prüfung liegt im Commit und ist getestet; ihr separater Supabase-Function-Austausch konnte in dieser Umgebung ohne Deployberechtigung nicht ausgeführt werden. Daraus entsteht keine Rechteausweitung, weil die produktiven RLS-Policies sämtliche Datenoperationen weiterhin verweigern.

## Validierung und Auslieferung

Erfolgreich ausgeführt wurden `pnpm check`, `pnpm test:schema`, PostgreSQL-Migrations- und RLS-Regressionen, `pnpm check:edge`, 38 Deno-Edge-Tests, Web-Typecheck, 44 Webtests, Formatprüfung, Hetzner-Produktionsbuild, Performancebudget und `git diff --check`.

Ein unabhängiger Read-only-Review fand zunächst fehlende Positiv- und Update-Regressionen. Diese wurden ergänzt: Agent:innen können eigene Wiedervorlagen lesen, anlegen und erledigen; reine Anfragende können eigene Einträge nicht ändern; fremde Mandanten bleiben gesperrt. Die Edge-Tests decken den erlaubten, verweigerten und fail-closed Autorisierungspfad ab.

Das vorherige Webbundle wurde gesichert. Der Produktions-Smoke-Test war erfolgreich; die öffentliche Produktion liefert `assets/index-DLfl9FPu.js` mit HTTP 200.

## Rücknahmeweg

Bei einer notwendigen Rücknahme kann ausschliesslich das Webbundle aus `/usr/www/users/jqviwy/backups/nextdesk-20261020T154751Z-22bc81d` auf das Hetzner-Webziel zurückkopiert und danach `pnpm smoke:web` wiederholt werden.

Die Datenbankmigration bleibt aus Sicherheitsgründen bestehen. Eine Änderung der neuen RLS-Policies erfolgt nur über eine separat geprüfte additive Folge-Migration.
