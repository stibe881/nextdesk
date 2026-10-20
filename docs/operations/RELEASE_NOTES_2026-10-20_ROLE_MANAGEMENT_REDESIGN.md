# Release Note: Verständliche Rollen- und Zugriffsverwaltung

**Datum:** 20. Oktober 2026  
**Produkt:** nextDesk Web  
**Code-Commit:** `079268d` (`feat: simplify tenant role management`)  
**Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T173201Z-079268d`

## Ausgeliefert

- Die Seite **Einstellungen → Rollen** ist neu entlang des Arbeitsablaufs aufgebaut: Zugriff vergeben, Personen mit aktuellem Zugriff und anschliessend die Rollenbibliothek.
- Rollen werden bei Personen als verständliche Bezeichnungen angezeigt. Jede einzelne Rollenzuweisung kann direkt bei der betroffenen Person bestätigt entzogen werden.
- Systemrollen sind klar als geschützt erkennbar. Eigene Rollen lassen sich weiterhin erstellen, bearbeiten sowie aktivieren oder deaktivieren.
- Berechtigungen sind nach Fachbereichen wie Tickets, Wissensdatenbank, Assets, Planung, Zusammenarbeit, Auswertungen und Administration gruppiert. Verständliche Beschreibungen stehen im Vordergrund; technische Kennungen bleiben nur nach bewusstem Aufklappen sichtbar.
- Die Bestätigung für den endgültigen Rollenentzug ist eine oberste Modal-Schicht mit Backdrop, Fokusführung, Fokusfalle, Escape-Abbruch und Rückkehr zum auslösenden Button.

## Sicherheit und Mandantentrennung

- Die vorhandenen serverseitigen Rollenaktionen, Mandantenscope-Prüfungen, Rollenberechtigungen, Auditierung und der Schutz der Systemrollen wurden nicht verändert.
- Es gibt keine Datenbankmigration, keine Edge-Function-Änderung, keine neue externe Integration und keine Hintergrundverarbeitung.

## Validierung

- Vollständige Repository-Suite erfolgreich: `pnpm check`, `pnpm test:schema`, `pnpm test:db`, `pnpm check:edge`, `pnpm test:edge`, `pnpm format:check`, `git diff --check`, Hetzner-Webbuild und Performance-Budget.
- Die neue Regression deckt die Fachbereichszuordnung für alle kanonischen Berechtigungspräfixe ab.
- Zwei unabhängige Read-only-Reviews führten zu Nachbesserungen bei der vollständigen Fachbereichsgruppierung und der Modal-Zugänglichkeit.
- Hetzner-Webrelease durchgeführt. `pnpm smoke:web` war erfolgreich; die öffentliche Produktion liefert `assets/index-BMQuooGS.js` mit HTTP 200.

## Rücknahme

Bei Bedarf kann ausschliesslich das Webbundle aus dem oben genannten Backup nach `/usr/www/users/jqviwy/app/` zurückgespielt und danach `pnpm smoke:web` wiederholt werden. Eine Datenbankrücknahme ist nicht erforderlich.
