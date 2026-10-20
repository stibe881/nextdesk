# Release Note: Vollständige Ticketformularvorschau

**Datum:** 20. Oktober 2026
**Produkt:** nextDesk Web
**Code-Commit:** `7830312` (`fix: show standard ticket form in preview`)
**Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T174238Z-7830312`

## Ausgeliefert

- Unter **Einstellungen → Ticketfelder** zeigt die Vorschau nun immer den vollständigen Aufbau der Ticketerfassung – auch wenn keine zusätzlichen Felder konfiguriert sind.
- Sichtbar sind die Bereiche **Ticket erfassen**, **Ticket einordnen** und **Anliegen** mit anfragender Person, Betreff, Abteilung / Angebot, Ticketvorlage, möglicher Agentenzuweisung, Kategorie, Unterkategorie, Priorität und Beschreibung.
- Felder, die im tatsächlichen Formular nur bei passenden Daten oder nach einer Auswahl erscheinen, sind klar als **situationsabhängig** markiert. Optionale Felder bleiben ebenfalls erkennbar.
- Zusätzliche konfigurierbare Felder stehen weiterhin nach dem Standardformular in der gespeicherten Abschnitts- und Feldreihenfolge.
- Pflichtfelder sind in der Vorschau sowohl visuell als auch für Screenreader verständlich gekennzeichnet.

## Sicherheit und Mandantentrennung

- Die Änderung betrifft ausschliesslich die nicht interaktive Darstellungslogik im Formular-Editor. Die Vorschau legt keine Tickets an, speichert keine Werte und löst keine API-, Datenbank- oder Rechteprüfung aus.
- Es gibt keine Datenbankmigration, keine Edge-Function-Änderung, keine neue externe Integration und keine Hintergrundverarbeitung.

## Validierung

- Vollständige Repository-Suite erfolgreich: `pnpm check`, `pnpm test:schema`, `pnpm test:db`, `pnpm check:edge`, `pnpm test:edge`, `pnpm format:check`, `git diff --check`, Hetzner-Webbuild und Performance-Budget.
- Die neue fokussierte Regression prüft die vollständigen Standardfelder sowie die Kennzeichnung der situationsabhängigen Felder.
- Ein unabhängiger Read-only-Review führte zu Nachbesserungen bei Kontextkennzeichnung, Auswahlplatzhaltern und Screenreader-Informationen für Pflichtfelder.
- Hetzner-Webrelease durchgeführt. `pnpm smoke:web` war erfolgreich; die öffentliche Produktion liefert `assets/index-BJObuaUs.js` mit HTTP 200.

## Rücknahme

Bei Bedarf kann ausschliesslich das Webbundle aus dem oben genannten Backup nach `/usr/www/users/jqviwy/app/` zurückgespielt und danach `pnpm smoke:web` wiederholt werden. Eine Datenbankrücknahme ist nicht erforderlich.
