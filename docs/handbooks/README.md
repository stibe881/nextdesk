# Handbücher

| Datei                | Titel                        | Sichtbar für                            |
| -------------------- | ---------------------------- | --------------------------------------- |
| `mitarbeitende.md`   | Handbuch für Mitarbeitende   | alle aktiven Mitglieder eines Mandanten |
| `agenten.md`         | Handbuch für Agenten         | Agenten und Administratoren             |
| `administratoren.md` | Handbuch für Administratoren | Mandantenadministratoren                |
| `installation.md`    | Installationsanleitung       | Mandantenadministratoren                |

## Zwei Fassungen: duzen und siezen

Jedes Handbuch gibt es zweimal. Die **du-Fassung** (Standard) liegt in
`docs/handbooks/*.md`, die **förmliche Fassung** in `docs/handbooks/sie/*.md`. Der
Mandantenadministrator wählt die Anrede unter **Einstellungen → Design →
Anrede**; die Edge Function `handbooks` liefert die passende Fassung aus.

- Beide Fassungen haben dieselben Überschriften und Bilder. Sonst bricht
  `pnpm handbooks:build` mit einem Fehler ab.
- Ändere immer beide Dateien und setze `updated` in beiden.
- Förmliche Anreden stehen nur in `sie/` (`node scripts/verify-formality.mjs
--only=docs/handbooks/` prüft die du-Fassung).

## So funktioniert die Auslieferung

1. Die Markdown-Dateien (du und `sie/`) und die Bilder in `images/` sind die
   einzige Quelle.
2. `pnpm handbooks:build` bündelt beide Fassungen in `handbooks.bundle.json`
   (die förmliche Fassung je Handbuch unter `sie`).
3. Nach dem Merge lädt die Datenbank das Paket des gemergten Commits:
   `select public.request_handbook_sync('<sha>');`, danach
   `select public.apply_handbook_sync(<id>, '<sha>');`. Die Tabellen
   `handbook_documents` und `handbook_images` sind nur für den Service-Role-Zugang
   lesbar (Migrationen 0246 und 0328; die förmliche Fassung liegt in den Spalten
   `*_sie`, solange sie fehlt, liefert die Function die du-Fassung).
4. Die Edge Function `handbooks` prüft bei jedem Aufruf die Mitgliedschaft und
   die wirksamen Rollen der angemeldeten Person
   (`supabase/functions/_shared/handbook-access.ts`) und liefert nur die
   erlaubten Handbücher in der Anrede des Mandanten
   (`tenant_settings.formality`) aus – in der Web-App unter **Persönliche Einstellungen
   → Handbücher**, in der iOS-App unter **Profil → Hilfe und Rechtliches**.

> Das Repository ist öffentlich: Die Markdown-Quellen sind auf GitHub für alle
> lesbar. Die Rollenprüfung steuert, was in nextDesk angezeigt wird, macht die
> Inhalte aber nicht geheim. Keine vertraulichen Angaben in die Handbücher
> schreiben.

## Pflege

- Text ändern (beide Fassungen) → `updated` im Front Matter anpassen →
  `pnpm handbooks:build`.
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
