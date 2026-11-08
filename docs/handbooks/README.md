# Handbücher

| Datei                | Titel                          | Sichtbar für                            |
| -------------------- | ------------------------------ | --------------------------------------- |
| `mitarbeitende.md`   | Handbuch für Mitarbeitende     | alle aktiven Mitglieder eines Mandanten |
| `agenten.md`         | Handbuch für Agenten           | Agenten und Administratoren             |
| `administratoren.md` | Handbuch für Administratoren   | Mandantenadministratoren                |
| `installation.md`    | Installationsanleitung         | Mandantenadministratoren                |

## So funktioniert die Auslieferung

1. Die Markdown-Dateien und die Bilder in `images/` sind die einzige Quelle.
2. `pnpm handbooks:build` bündelt sie in
   `supabase/functions/handbooks/content.generated.ts`.
3. Die Edge Function `handbooks` prüft bei jedem Aufruf die Mitgliedschaft und
   die wirksamen Rollen der angemeldeten Person
   (`supabase/functions/_shared/handbook-access.ts`) und liefert nur die
   erlaubten Handbücher aus. Die Web-App zeigt sie unter **Persönliche
   Einstellungen → Handbücher** an; Bilder werden eingebettet mitgeliefert und
   sind nicht öffentlich abrufbar.

## Pflege

- Text ändern → `updated` im Front Matter anpassen → `pnpm handbooks:build`.
- Screenshots neu erzeugen → `pnpm handbooks:screenshots` (alle) oder
  `pnpm handbooks:screenshots -- --only ag-ticket-detail` (einzeln). Das Skript
  startet die Web-App mit einem simulierten Backend und Demo-Daten
  (`scripts/handbook-screenshots/`), es braucht weder Zugangsdaten noch echte
  Kundendaten.
- `pnpm test:schema` prüft, dass das generierte Modul aktuell ist, alle Bilder
  existieren und keine ungenutzten Bilder herumliegen.
- Nach dem Merge die Function `handbooks` deployen.

Front Matter jedes Handbuchs:

```yaml
---
title: Handbuch für Agenten
description: Kurzbeschreibung für die Übersicht im Profil
audienceLabel: Agenten
updated: 2026-11-08
---
```
