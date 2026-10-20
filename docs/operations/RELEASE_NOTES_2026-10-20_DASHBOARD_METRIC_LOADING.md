# nextDesk – Release Notes: Dashboard-Kennzahlenladezustand

**Datum:** 20. Oktober 2026

**Produktionscommit:** `74eb4d2fb6e605a5e229de1820d2ee4e1a83ed1f`

**Webrelease (UTC):** 2026-10-20T08:01:02Z

## Anlass

Bei der ersten Live-Abfrage zeigte das Dashboard kurz die Vorschauwerte der vier Ticketkennzahlen, bevor die tatsächlichen Mandantendaten eintrafen. Das konnte wie ein fehlerhafter Zählerstand wirken.

## Auslieferung

- Die vier Karten «Meine Tickets», «Nicht zugewiesene Tickets», «Offene Tickets» und «Gelöste Tickets» zeigen nun bis zu einem bestätigten Live-Snapshot gleich grosse Ladeflächen anstelle von Vorschau- oder Zwischenzahlen.
- Während dieses Zustands sind die Kennzahlenkarten nicht als Filter bedienbar. Dadurch kann keine Auswahl auf Grundlage noch nicht geladener Werte entstehen.
- Nach der Live-Antwort werden ausschliesslich die aktuellen mandantenspezifischen Zahlen, Beschreibungen und allfälligen Vorperiodenvergleiche angezeigt.
- Der Ladezustand ist als Status für Hilfstechnologien ausgezeichnet und respektiert die globale Einstellung für reduzierte Bewegung.

## Verifikation

- Vollständige Repository-Prüfkette erfolgreich: Typen, Datenbank-/Schema-/Edge-Tests, Prettier und Diff-Prüfung.
- Hetzner-Produktionsbundle erfolgreich erstellt und ausgerollt.
- Vorheriges Bundle gesichert als `app-before-20261020T080102Z-74eb4d2`.
- Produktiver Web-Smoke-Test erfolgreich; das ausgelieferte JavaScript enthält den Ladezustand.

## Rücknahme

Die Änderung betrifft nur das Webbundle. Bei einer Rücknahme kann das gesicherte Bundle wiederhergestellt werden; es sind keine Datenbankmigrationen, Providerschnittstellen, Scheduler oder Hintergrundläufe beteiligt.
