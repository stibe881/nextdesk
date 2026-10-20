# nextDesk – Release Notes: Wissensartikelimport und «1. Hilfe»

- **Datum:** 20. Oktober 2026
- **Produktiv-Commit:** `64bad4e954e95bea0d9d92288f0807ab2dfddf73`
- **Bereich:** Weboberfläche und einmaliger, mandantengebundener Wissensartikelimport

## Ausgeliefert

### Wissensartikelimport

Der zuvor analysierte XML-Export wurde einmalig und idempotent in den vorgesehenen Mandanten importiert. Die Bestandsprüfung nach dem Import bestätigt:

- 27 Wissenskategorien
- 64 Wissensartikel mit je einer Revision
- 37 veröffentlichte und 27 als Entwurf gespeicherte Artikel
- alle importierten Artikel sind intern sichtbar

Der Import hat keine bestehenden Artikel überschrieben. Externe Legacy-Webadressen wurden nicht übernommen.

### Überarbeitete «1. Hilfe»

Der bisherige Navigationspunkt «Wissen» heisst nun **«1. Hilfe»**. Die Bezeichnung wird auch in der Designvorschau verwendet.

Die Wissensoberfläche wurde als ruhige, lesefreundliche Bibliothek überarbeitet:

- klarer Bibliothekskopf mit Suche, Trefferzahl und direkter Artikelerstellung
- kompakte Artikelkarten mit Status, Sichtbarkeit, Auszug und eindeutiger Leseaktion
- grosszügige, gut lesbare Artikelansicht mit formatiertem Markdown, Codeblöcken, Listen und Zitaten
- responsives Layout für schmale Ansichten
- kategoriebasierte Artikelerfassung mit sichtbaren Auswahlchips statt Mehrfachauswahlliste
- Live-Vorschau für neue und bearbeitete Artikel
- sichtbarer Freigabestatus im Editor sowie clientseitige Begrenzung auf höchstens 12 Kategorien

Die bestehenden Berechtigungen, der interne/externe Sichtbarkeitsmechanismus und der serverseitige Freigabeprozess bleiben unverändert. Raw-HTML wird weiterhin nicht ausgeführt.

## Produktivfreigabe

- **Web-Backup:** `/usr/www/users/jqviwy/backups/nextdesk-20261020T094536Z-64bad4e`
- **Auslieferung:** geprüftes Bundle aus `apps/web/dist/` auf das Hetzner-Webziel
- **Smoke-Test:** erfolgreich
- **Datenbank/Edge Functions:** keine Migration und keine Function-Auslieferung in diesem Release

## Verifikation

Erfolgreich ausgeführt:

```text
pnpm check
pnpm test:schema
pnpm test:db
pnpm test:edge
pnpm check:edge
pnpm format:check
pnpm --filter @nextdesk/web build:hetzner
pnpm smoke:web
```

## Rücknahmegrenze

Die Weboberfläche kann durch Wiederherstellen des genannten statischen Web-Backups zurückgenommen werden. Der XML-Import verändert bestehende Importdaten nicht rückwirkend; ein Datenrückbau erfolgt nicht automatisch.
