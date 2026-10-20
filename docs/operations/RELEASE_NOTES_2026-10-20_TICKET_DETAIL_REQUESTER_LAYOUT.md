# nextDesk – Release Notes: Ticketdetail-Anfragendenkontext

**Datum:** 20. Oktober 2026

**Produktionscommit:** `cc0b6568777d37397a6632553d493900576e639e`

**Webrelease (UTC):** 2026-10-20T08:04:30Z

## Auslieferung

Die Faktenübersicht eines Tickets beginnt nun mit dem Kontext der anfragenden Person:

1. Anfragende Person
2. Abteilung / Angebot
3. Status und Priorität
4. Zuweisung, Team und bearbeitende Abteilung
5. Erfassungszeitpunkt

Die bestehenden Direktbearbeitungen für Abteilung und Angebot, Status, Priorität, Zuweisung, Team und bearbeitende Abteilung bleiben unverändert. Auf schmalen Ansichten erscheinen die beiden Anfragendenfelder vor allen operativen Status- und Zuständigkeitsfeldern.

## Verifikation

- Web-Typecheck und Hetzner-Produktionsbuild erfolgreich.
- Die semantische Faktenreihenfolge wurde automatisiert geprüft.
- Der nextDesk-Web-Smoke-Test ist erfolgreich.
- Das veröffentlichte JavaScript-Bundle enthält die aktualisierte Faktenansicht.
- Vorheriges Bundle gesichert als `app-before-20261020T080430Z-cc0b656`.

## Rücknahme

Die Änderung betrifft nur die Reihenfolge der Webansicht. Die gesicherte vorherige Webversion kann ohne Datenbankänderung wiederhergestellt werden.
