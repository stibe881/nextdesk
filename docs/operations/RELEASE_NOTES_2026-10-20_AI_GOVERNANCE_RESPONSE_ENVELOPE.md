# Release Note: KI-Governance-Antworthülle

**Datum:** 20. Oktober 2026  
**Produkt:** nextDesk Web  
**Code-Commit:** `6f616c0` (`fix(web): parse AI governance response envelope`)  
**Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T182230Z-6f616c0`

## Ausgeliefert

- Die Anthropic-Konfiguration unter **Einstellungen → Funktionen → KI-Assistent konfigurieren** wertet die erfolgreiche, JWT-geschützte Antwort von `ai-assist` nun korrekt über ihre Hülle `{ data: { provider: "Anthropic", approval } }` aus.
- Dadurch wird eine erfolgreiche Antwort nicht mehr fälschlich als nicht verfügbare Governance angezeigt.
- Der Client validiert zusätzlich den erwarteten Anbieter, die beiden Freigabeschalter und die zulässigen Zwecke strikt. Fehlende oder fremde Antworten bleiben im sicheren Fehlerpfad.

## Sicherheit und Mandantentrennung

- Es werden weder Anthropic noch eine KI-Funktion automatisch aktiviert. Auch die Freigabe für externe Artikelinhalte bleibt unverändert und weiterhin eine bewusste Mandantenentscheidung.
- Keine Artikelinhalte, Prompts oder Providerzugänge wurden übertragen, gespeichert oder geändert.
- Die serverseitige JWT-, Mitgliedschafts- und Mandantenadministrationsprüfung von `ai-assist` blieb unverändert.

## Datenbank und Edge Functions

- Migrationen: keine.
- Edge Functions: keine Änderung und kein Function-Release.

## Validierung

- Die produktiven Protokolle bestätigten für `ai-assist` den erwarteten CORS-Preflight mit HTTP 204 sowie die Governance-Abfrage mit HTTP 200. Der Fehler lag ausschliesslich in der clientseitigen Auswertung der gültigen Antwort.
- Vollständige Repository-Suite erfolgreich: `pnpm check`, `pnpm test:schema`, `pnpm test:db`, `pnpm check:edge`, `pnpm test:edge`, `pnpm format:check`, `git diff --check`, Hetzner-Webbuild und Performance-Budget.
- Nach einem unabhängigen Read-only-Review wurden die Anbieterprüfung ergänzt und die fokussierte Parserregression, der Web-Typecheck sowie der Hetzner-Webbuild erneut erfolgreich ausgeführt.
- Der öffentliche Produktions-Smoketest `pnpm smoke:web` war erfolgreich. Die Produktion liefert `assets/index-Cl84tjNp.js` mit HTTP 200.

## Rücknahme

Bei Bedarf kann ausschliesslich das Webbundle aus dem oben genannten Backup nach `/usr/www/users/jqviwy/app/` zurückgespielt und danach `pnpm smoke:web` wiederholt werden. Eine Datenbankrücknahme ist nicht erforderlich.
