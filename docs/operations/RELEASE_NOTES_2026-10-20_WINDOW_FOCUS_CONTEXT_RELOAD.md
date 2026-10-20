# Release Note: Stabiler Mandantenkontext bei Fensterfokus

**Datum:** 20. Oktober 2026
**Produkt:** nextDesk Web
**Code-Commit:** `2105711` (`fix: Mandantenkontext bei Fensterfokus erhalten`)
**Datenbankmigrationen:** keine
**Edge-Function-Änderungen:** keine
**Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T190315Z-2105711`

## Ausgeliefert

- Ein erneutes Supabase-Auth-Ereignis derselben angemeldeten Person baut den nextDesk-Arbeitsbereich nicht mehr vollständig neu auf.
- Besonders beim Zurückkehren in das Browserfenster gemeldete `SIGNED_IN`-, `TOKEN_REFRESHED`- und `USER_UPDATED`-Ereignisse behalten Mandantenkontext, Navigation, geöffnete Bereiche und geladene Daten bei.
- Die interne Sitzungsreferenz wird aktualisiert; der Supabase-Client nutzt dadurch weiterhin die aktuellen Tokens, ohne reaktive Mandanten- und Funktionsabfragen erneut anzustossen.

## Sicherheit und Mandantentrennung

- Die erstmalige Sitzungsauflösung, eine Abmeldung und jeder Wechsel der Benutzer-ID setzen den gesamten Arbeitsbereich weiterhin kontrolliert zurück.
- Beim Reset werden Mandant, Berechtigungszustände, Funktionsfreigaben und kontextbezogene Daten wie bisher geleert.
- Der bestehende PKCE-/Callback-Schutz bleibt vor der Ereignisentscheidung aktiv. Alte oder verspätete Sitzungsereignisse können den durch einen Callback bestimmten Kontext nicht überschreiben.

## Validierung

- Vollständige Repository-Suite erfolgreich: `pnpm check`, `pnpm test:schema`, `pnpm test:db`, `pnpm check:edge`, `pnpm test:edge`, `pnpm format:check`, Hetzner-Build, Performance-Budget und `git diff --check`.
- Vollständige Webtests erfolgreich: 20 Testdateien, 78 Tests.
- Neue fokussierte Regressionen decken gleichbleibende Benutzer-ID bei `SIGNED_IN`, `TOKEN_REFRESHED` und `USER_UPDATED`, die Erstinitialisierung, Abmeldung und Benutzerwechsel ab.
- Unabhängiger Read-only-Review: keine Befunde zu Callback-Gate, Sitzungsreferenz oder Mandantentrennung.
- Öffentlicher Release-Smoke-Test erfolgreich; das neue JavaScript-Bundle `assets/index-ZhWLIuxQ.js` antwortet mit HTTP 200.

## Rücknahme

1. Bei einem reinen Webproblem kann das Webbundle aus dem oben genannten Backup nach `/usr/www/users/jqviwy/app/` zurückgespielt werden.
2. Es gibt keine Datenbank- oder Edge-Function-Änderung, die zurückgenommen werden müsste.
3. Für einen Code-Rollback steht der vorherige Hauptstand `2725c05` bereit.
