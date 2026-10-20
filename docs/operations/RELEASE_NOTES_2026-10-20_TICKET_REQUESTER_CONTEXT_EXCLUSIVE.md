# nextDesk – Release Notes: Exklusive Abteilung-/Angebotsanzeige

**Datum:** 20. Oktober 2026

**Produktionscommit:** `e4afd06e4f9b1e0039151d27337eff9ef26f4ac9`

**Webrelease (UTC):** 2026-10-20T08:09:54Z

## Auslieferung

In der Ticketdetailkarte «Abteilung / Angebot» wird nur noch ein vorhandener Kontext angezeigt:

- Ist eine Abteilung hinterlegt, erscheint nur die Abteilung.
- Ist keine Abteilung, aber ein Angebot hinterlegt, erscheint nur das Angebot.
- Sind beide Werte leer, bleiben beide Eingabemöglichkeiten verfügbar.
- Bei historisch vorhandenen beiden Werten hat die Abteilung in der Darstellung Vorrang.

Damit verschwindet die leere Angebotszeile bei einer vorhandenen Abteilung, ohne die bestehende direkte Bearbeitung zu verändern.

## Verifikation

- Vollständige nextDesk-Qualitätssuite, Datenbankregression, Formatprüfung und Hetzner-Produktionsbuild erfolgreich.
- Die Exklusivitätsregel wurde zusätzlich statisch geprüft.
- Der nextDesk-Web-Smoke-Test ist erfolgreich.
- Vorheriges Bundle gesichert als `app-before-20261020T080954Z-e4afd06`.

## Rücknahme

Die Änderung betrifft nur die Darstellung und direkte Eingabe im Web. Die gesicherte vorherige Webversion kann ohne Datenbankänderung wiederhergestellt werden.
