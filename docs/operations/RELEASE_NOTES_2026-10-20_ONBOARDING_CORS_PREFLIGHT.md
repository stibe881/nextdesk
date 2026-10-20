# nextDesk – Release Note: Eintritte-CORS-Preflight

- **Datum:** 20. Oktober 2026, 16:03 UTC
- **Produktiv-Commit:** `15e9783cf22422cc28f56a29779551ef03c9bc0a`
- **Edge Function:** `onboarding` Version 3, aktiv
- **Umgebung:** Produktion `https://app.nextdesk.ch`

## Ausgeliefert

Der Eintritte-Bereich kann seinen Browser-CORS-Preflight nun vor der Benutzer-Middleware beantworten. Dadurch erreicht die anschliessende angemeldete POST-Anfrage die bestehende Onboarding-Logik statt bereits beim OPTIONS-Preflight am Gateway abgewiesen zu werden.

Die Änderung betrifft ausschliesslich die Edge Function `onboarding`. Es gab keine Datenbankmigration und keine Webauslieferung.

## Sicherheit und Mandantentrennung

Für `onboarding` ist die Gateway-JWT-Prüfung gezielt deaktiviert, damit ein tokenloser Browser-Preflight an die Function gelangen kann. Der äussere Function-Einstieg erlaubt anonym ausschliesslich `OPTIONS` und setzt CORS-Header nur bei `https://app.nextdesk.ch`.

Andere Methoden werden abgewiesen. Eine POST ohne `Authorization` wird mit `401` verworfen. Jede POST mit einem Header durchläuft weiterhin die kryptografische `withSupabase`-Benutzerprüfung sowie die bestehenden aktiven Mandantenmitgliedschafts- und Onboardingberechtigungen. Dadurch entstehen weder ein anonymer Lese- noch ein anonymer Schreibpfad und keine Lockerung der Mandantentrennung.

## Validierung und Auslieferung

Erfolgreich ausgeführt wurden:

- `pnpm check`
- `pnpm test:schema`
- `pnpm test:db`
- `pnpm check:edge`
- `pnpm test:edge` mit 39 erfolgreichen Deno-Tests
- `pnpm format:check`
- `git diff --check`

Ein erster unabhängiger Read-only-Review erkannte korrekt, dass ein OPTIONS-Zweig innerhalb von `withSupabase` wegen der davorliegenden Authentisierung nicht erreichbar wäre. Der Fix wurde daraufhin vor die Middleware verschoben, mit einer expliziten anonymen POST-Sperre ergänzt und durch einen zweiten unabhängigen Read-only-Sicherheitsreview ohne Befund bestätigt.

Der Produktions-Smoketest bestätigte:

- erlaubter Preflight von `https://app.nextdesk.ch`: `204` mit eingeschränkten CORS-Headern;
- Preflight einer fremden Origin: `204` ohne `Access-Control-Allow-Origin`;
- anonyme POST von der erlaubten Origin: `401` mit generischer Authentisierungsantwort.

## Rücknahmeweg

Falls eine Rücknahme nötig wird, ist der Hotfix-Commit `15e9783` zu revertieren und die zuvor aktive `onboarding`-Function-Version 2 mit aktivierter Gateway-JWT-Prüfung erneut auszurollen. Eine Datenbankrücknahme ist nicht erforderlich. Dieser Rücknahmeweg stellt den früheren Zustand wieder her, behebt jedoch den Browser-Preflight nicht.
