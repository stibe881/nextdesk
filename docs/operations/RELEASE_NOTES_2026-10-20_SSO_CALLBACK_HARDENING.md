# nextDesk – Release Note: Browser-SSO-Rückkehr gehärtet

- **Zeitpunkt (UTC):** 20. Oktober 2026, 09:22:57
- **Commit:** `d22493c64ac0610ec16cc8f7481277b51bfec0fd`
- **Umfang:** Web-SSO-Rückkehr für Entra/Microsoft

## Auslieferung

Die Webanwendung verarbeitet Auth-Rückgaben nun explizit und fail-closed. Während eines laufenden PKCE-Rücksprungs kann keine persistierte Alt-Sitzung den Mandanten- oder Einladungs-Bootstrap starten. Nach erfolgreichem Austausch wird ausschliesslich die explizit ausgetauschte Sitzung verwendet.

PKCE-Flow-IDs werden an die Rückkehr-URL angehängt, damit parallele oder wiederholte Anmeldeversuche den passenden Verifier verwenden. Fehlerhafte, unvollständige, leere oder doppelte Rückgabeparameter aus Query und Fragment führen zu einem sicheren lokalen Abmelden statt zu einer Wiederherstellung einer vorhandenen Sitzung. Sensitive Callbackparameter werden aus Browser-URL und Verlauf entfernt.

## Validierung

Erfolgreich ausgeführt wurden Projekt-, Schema-, Datenbank-, Edge-, Web-, Format- und Produktionsbuild-Prüfungen. Die Web-Callback-Regressionen decken erfolgreiche PKCE-Rückkehr, alte Sitzungen anderer und gleicher Identität, Fehler aus Query und Fragment, leere/doppelte Parameter, unvollständige Rückgaben, PKCE-Fehler sowie URL-Bereinigung ab. Der Produktions-Smoke-Test war erfolgreich.

## Rücknahme

Vor der Veröffentlichung wurde das vorherige Webbundle unter folgendem Hetzner-Pfad gesichert:

`/usr/www/users/jqviwy/backups/nextdesk-20261020T092257Z-d22493c`

Eine Rücknahme betrifft ausschliesslich das Webbundle. Es wurden keine Datenbankmigrationen und keine Edge-Function-Änderungen veröffentlicht.
