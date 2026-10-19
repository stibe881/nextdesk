# Release Notes – nextDesk

- **Version / Commit:** `ff5e687` – `feat: add authorized ticket list filters and sorting`
- **Datum und Uhrzeit (UTC):** 19. Oktober 2026, 17:47 UTC
- **Verantwortlich:** nextDesk Engineering
- **Umgebung:** Produktion `https://app.nextdesk.ch`

## Nutzerwirkung

- Die Ticketliste hat nun eine klar beschriftete Filter- und Sortierleiste für **Bearbeitende Person**, **Status**, **Abteilung** und **Priorität**.
- Alle vier Kriterien lassen sich einzeln oder kombiniert filtern; die Sortierung kann auf Aktualität, Bearbeitende Person, Status, Abteilung oder Priorität umgestellt und auf- bzw. absteigend gewählt werden.
- Die Kennzahlen-Kacheln aus der Übersicht stehen auch oben in der Ticketliste. Ein Klick übernimmt den entsprechenden Schnellfilter und zeigt dieselbe Menge wie die Kachel.
- Suche, Queue-Auswahl, Bereich, gespeicherte Ansichten und Mehrfachaktionen bleiben mit den neuen Filtern kombinierbar. Ein Zurücksetzen entfernt nur die aktiven Einschränkungen.
- Gespeicherte Ansichten enthalten die neuen Filter- und Sortierwerte. Ältere gespeicherte Ansichten bleiben ohne Nacharbeit verwendbar.

## Sicherheit und Mandantentrennung

- Die Ergebnismenge wird vor Sortierung und Pagination ausschliesslich serverseitig nach der bestehenden Ticket-Leseberechtigung bestimmt.
- Die Datenbankfunktion liefert keine Profil- oder E-Mail-Daten der Bearbeitenden Person. Namen für die Anzeige stammen ausschliesslich aus der separat JWT-geschützten, mandanten- und abteilungsberechtigten Agentenauflösung.
- Die Agentenauswahl schliesst Personen aus, die nur im Entra-Verzeichnis vorhanden sind: Agentinnen und Agenten benötigen weiterhin eine bewusste aktive Rollen- und Mitgliedschaftszuordnung.
- Die Funktion ist für `authenticated` ausführbar, nicht für `anon`. Eine Prüfung bestätigte zudem, dass ihre Rückgabesignatur und Definition keine Profilnamen oder `user_profiles` enthalten.

## Datenbank und Edge Functions

- **Migrationen:** `0076_authorized_ticket_list_sorting.sql` ergänzt die additive RPC `public.list_authorized_ticket_list_page`. Sie verändert keine bestehenden Tickets, Status, Zuordnungen oder gespeicherten Ansichten.
- **Edge Functions:** `ticket-agent-assignment` v12 ist JWT-geschützt aktiv. Sie stellt die berechtigte Agentenauswahl und erlaubte Anzeigenamen für die Ticketliste bereit.

## Prüfungen

- `pnpm check`: erfolgreich
- `pnpm test:schema` / `pnpm test:db`: erfolgreich, inklusive Mandanten-, RLS-, Filter-, Sortier- und Pagination-Regressionen
- Web-Build: `pnpm --filter @nextdesk/web build:hetzner` erfolgreich
- Produktion-Smoketest: erfolgreich nach Hetzner-Rollout
- Supabase-Prüfung: RPC vorhanden, `authenticated` darf ausführen, `anon` nicht

## Bekannte Einschränkungen

- Es werden weiterhin ausschliesslich Tickets angezeigt, für welche die eingeloggte Person bereits berechtigt ist. Kein Filter kann den Sichtbarkeitsbereich erweitern.
- Der E-Mail-Kanal wurde durch diesen Release nicht verändert.

## Rücknahmeweg

- Vorheriger geprüfter Commit: `93347a8`
- Web-Rollback: Eine datierte Kopie des vorigen Hetzner-Web-Bundles wurde unmittelbar vor dem Rollout erstellt.
- Datenbankrücknahme: nicht erforderlich; Migration 0076 ist additiv. Eine Entfernung oder Änderung der RPC erfolgt nur über eine separat geprüfte und freigegebene Migration.
