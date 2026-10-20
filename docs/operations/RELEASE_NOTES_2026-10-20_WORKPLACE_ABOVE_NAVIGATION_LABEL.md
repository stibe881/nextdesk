# Release Note: Arbeitsplatz vor Arbeitsbereich

**Datum:** 20. Oktober 2026
**Produkt:** nextDesk Web
**Code-Commit:** `1ca5cda` (`fix: Arbeitsplatz vor Arbeitsbereich platzieren`)
**Datenbankmigrationen:** keine
**Edge-Function-Änderungen:** keine
**Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T191056Z-1ca5cda`

## Ausgeliefert

- Der Navigationspunkt «Arbeitsplatz» steht für berechtigte Personen direkt unter der Mandantenmarke.
- Die Überschrift «Arbeitsbereich» und alle übrigen verfügbaren Bereiche beginnen erst darunter.
- «Arbeitsplatz» erscheint nicht zusätzlich innerhalb der Liste unter «Arbeitsbereich».
- Bei fehlender Arbeitsplatzfreigabe, beispielsweise für reine Anfragende, wird kein leerer Platzhalter angezeigt.

## Validierung

- Vollständige Repository-Suite erfolgreich: `pnpm check`, `pnpm test:schema`, `pnpm test:db`, `pnpm check:edge`, `pnpm test:edge`, `pnpm format:check`, vollständige Webtests, Hetzner-Build, Performance-Budget und `git diff --check`.
- Vollständige Webtests erfolgreich: 20 Testdateien, 80 Tests.
- Die gezielte Regression prüft die Trennung des Arbeitsplatzes von den verbleibenden Arbeitsbereichen sowie die eingeschränkte Navigation ohne Arbeitsplatz.
- Unabhängiger Read-only-Review ohne Befund zu Rollen- und Featurefilterung, Doppelrendering oder Desktop-/Mobil-Layout.
- Öffentlicher Release-Smoke-Test erfolgreich; das neue JavaScript-Bundle `assets/index-I0h49IDU.js` antwortet mit HTTP 200.

## Rücknahme

1. Bei einem reinen Webproblem kann das Webbundle aus dem oben genannten Backup nach `/usr/www/users/jqviwy/app/` zurückgespielt werden.
2. Es gibt keine Datenbank- oder Edge-Function-Änderung, die zurückgenommen werden müsste.
3. Für einen Code-Rollback steht der vorherige Hauptstand `e20e9bf` bereit.
