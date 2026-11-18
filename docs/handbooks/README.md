# Handbücher

| Datei                | Titel                        | Sichtbar für                            |
| -------------------- | ---------------------------- | --------------------------------------- |
| `mitarbeitende.md`   | Handbuch für Mitarbeitende   | alle aktiven Mitglieder eines Mandanten |
| `agenten.md`         | Handbuch für Agenten         | Agenten und Administratoren             |
| `administratoren.md` | Handbuch für Administratoren | Mandantenadministratoren                |
| `installation.md`    | Installationsanleitung       | Mandantenadministratoren                |

## So funktioniert die Auslieferung

1. Die Markdown-Dateien und die Bilder in `images/` sind die einzige Quelle.
2. `pnpm handbooks:build` bündelt sie in `handbooks.bundle.json`.
3. Nach dem Merge lädt die Datenbank das Paket des gemergten Commits:
   `select public.request_handbook_sync('<sha>');`, danach
   `select public.apply_handbook_sync(<id>, '<sha>');`. Die Tabellen
   `handbook_documents` und `handbook_images` sind nur für den Service-Role-Zugang
   lesbar (Migration 0246).
4. Die Edge Function `handbooks` prüft bei jedem Aufruf die Mitgliedschaft und
   die wirksamen Rollen der angemeldeten Person
   (`supabase/functions/_shared/handbook-access.ts`) und liefert nur die
   erlaubten Handbücher aus – in der Web-App unter **Persönliche Einstellungen
   → Handbücher**, in der iOS-App unter **Profil → Hilfe und Rechtliches**.

## «Wie mache ich …?» und Wissensartikel

Jedes Handbuch endet mit dem Abschnitt `## Wie mache ich …?`. Jede
`### Wie …?`-Überschrift darin ist eine in sich geschlossene Anleitung und
wird beim Sync zusätzlich als **Wissensartikel** in jedem Mandanten
veröffentlicht (Tabelle `handbook_articles`, Funktion
`public.sync_handbook_articles`, Migration 0255):

| Handbuch             | Sichtbarkeit des Artikels                   |
| -------------------- | ------------------------------------------- |
| `mitarbeitende.md`   | **extern** (für Mitarbeitende)              |
| `agenten.md`         | **intern** (für Agenten und Administration) |
| `administratoren.md` | **intern**                                  |
| `installation.md`    | **intern**                                  |

Regeln:

- Eine Überschrift = ein Artikel; Titel 3–240 Zeichen und je Handbuch eindeutig.
  Der Artikel-Slug (`hb-<handbuch>-<titel>`) ergibt sich aus dem Titel – eine
  Umbenennung archiviert den alten und legt einen neuen Artikel an.
- Keine Bilder in diesen Abschnitten (`pnpm handbooks:build` bricht ab). Der
  Text vor der ersten `###`-Überschrift dient nur dem Handbuchleser.
- Der Text jedes Artikels muss ohne das restliche Handbuch verständlich sein
  (Menüpfad und Rolle nennen).
- Ein Artikel wird bei Inhalts-, Titel- oder Sichtbarkeitsänderung als neue
  veröffentlichte Revision eingespielt und überschreibt Änderungen, die ein
  Mandant am Artikel selbst vorgenommen hat. Entfällt eine Überschrift, wird der
  Artikel in allen Mandanten archiviert. Eigene Artikel der Mandanten bleiben
  unberührt, neue Mandanten erhalten die Artikel automatisch.

> Das Repository ist öffentlich: Die Markdown-Quellen sind auf GitHub für alle
> lesbar. Die Rollenprüfung steuert, was in nextDesk angezeigt wird, macht die
> Inhalte aber nicht geheim. Keine vertraulichen Angaben in die Handbücher
> schreiben.

## Pflege

- Text ändern → `updated` im Front Matter anpassen → `pnpm handbooks:build`.
- Screenshots neu erzeugen → `pnpm handbooks:screenshots` (alle) oder
  `pnpm handbooks:screenshots -- --only ag-ticket-detail` (einzeln). Das Skript
  startet die Web-App mit einem simulierten Backend und Demo-Daten
  (`scripts/handbook-screenshots/`), es braucht weder Zugangsdaten noch echte
  Kundendaten.
- `pnpm test:schema` prüft, dass das generierte Modul aktuell ist, alle Bilder
  existieren und keine ungenutzten Bilder herumliegen.
- Nach dem Merge die Inhalte mit `request_handbook_sync`/`apply_handbook_sync` laden.

Front Matter jedes Handbuchs:

```yaml
---
title: Handbuch für Agenten
description: Kurzbeschreibung für die Übersicht im Profil
audienceLabel: Agenten
updated: 2026-11-08
---
```
