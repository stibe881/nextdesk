# Hinweise für Claude

## Handbücher bei jeder Änderung mitpflegen

Die rollenspezifischen Handbücher liegen in `docs/handbooks/` und werden in der
Web-App unter **Persönliche Einstellungen → Handbücher** und in der iOS-App
unter **Profil → Hilfe und Rechtliches** (`mobile/app/(tabs)/handbook/[id].tsx`)
nur den berechtigten Rollen ausgeliefert (Edge Function `handbooks`, Regel in
`supabase/functions/_shared/handbook-access.ts`).

| Handbuch                            | Zielgruppe                      | Betroffen bei Änderungen an …                                                                                        |
| ----------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `docs/handbooks/mitarbeitende.md`   | alle Mitglieder eines Mandanten | Anmeldung, Mitarbeitenden-Navigation, Ticket erfassen, eigene Tickets, Wissen/Self-Service, Shop, Profil, Mobile-App |
| `docs/handbooks/agenten.md`         | Agenten (Ticketbearbeitung)     | Übersicht, Arbeitsplatz, Ticketliste/Kanban, Ticketdetail, Antworten, Wissen, Berichte, Teamführung                  |
| `docs/handbooks/administratoren.md` | Mandantenadministratoren        | `tenant-admin-settings.tsx` und alle dort eingebundenen Einstellungen, Rollen, Benutzer, SLA, Module                 |
| `docs/handbooks/installation.md`    | Mandantenadministratoren        | Deployment, Supabase, SSO, Exchange, Entra, Intune, Push, Monitoring, Umgebungsvariablen                             |

Bei **jeder** Änderung an Funktionen, Beschriftungen, Navigation, Berechtigungen
oder Einrichtungsschritten:

1. Prüfen, welche Handbücher betroffen sind (Tabelle oben), und den Text im
   selben Pull Request anpassen. Front-Matter-Feld `updated` auf das heutige
   Datum setzen.
2. Wenn sich ein abgebildeter Bildschirm sichtbar ändert, die Screenshots neu
   erzeugen: `pnpm handbooks:screenshots` (ggf. `-- --only <name>`). Neue
   Bildschirme brauchen Demo-Daten in
   `scripts/handbook-screenshots/mock-backend.cjs`.
3. `pnpm handbooks:build` ausführen. Das erzeugt
   `docs/handbooks/handbooks.bundle.json`; `pnpm test:schema` schlägt fehl,
   solange das Paket nicht zur Quelle passt.
4. Nach dem Merge die Inhalte in die Datenbank laden (Commit-SHA von `main`):
   `select public.request_handbook_sync('<sha>');` und danach mit der
   zurückgegebenen ID `select public.apply_handbook_sync(<id>, '<sha>');`.
   Die Edge Function `handbooks` muss nur bei Codeänderungen neu deployt werden.

Die App stellt nur einen Markdown-Ausschnitt dar
(`mobile/lib/handbooks-model.ts`: Überschriften `##`/`###`, Absätze, Listen,
Zitate, Tabellen, Codeblöcke, Bilder, **fett**, _kursiv_, `Code`). Neue
Markdown-Elemente dort ergänzen.

Wenn keine Anpassung nötig ist, das im Pull Request kurz begründen.
