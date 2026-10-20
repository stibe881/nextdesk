# nextDesk – Release Notes: Ticketkennzahlen-Layout

**Datum:** 20. Oktober 2026
**Produktiver Web-Commit:** `a48784a9eceec78e0897b236d9be56c171539c3c`
**Bereich:** Ticketübersicht

## Ausgeliefert

Die Informationszeilen der Ticketkennzahlenkarten sind nun klar getrennt:

- Der Vergleich mit der Vorperiode steht direkt unter dem Kennzahlenwert.
- Die erklärende Beschreibung steht in einer eigenen Zeile darunter.
- Die Reihenfolge gilt einheitlich für «Meine Tickets», «Nicht zugewiesene Tickets», «Offene Tickets» und «Gelöste Tickets».

## Auslieferung und Prüfung

- Das bestehende Hetzner-Webbundle wurde vor dem Release nach `/usr/www/users/jqviwy/app-backups/20261020T075631Z-before-a48784a` gesichert.
- Das Produktionsbundle wurde aus dem geprüften Commit `a48784a` ausgerollt.
- Web-TypeScript, vollständige Repository-Prüfkette, PostgreSQL-RLS-Regressionen, Deno-Checks, Formatprüfung und der Web-Smoke-Test waren erfolgreich.
- Es wurden keine Datenbankmigrationen, Edge Functions, Berechtigungen oder externen Integrationen verändert.
