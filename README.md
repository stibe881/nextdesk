# NextDesk / TicketHub

NextDesk ist das Quellcode-Repository für **TicketHub**, eine mandantenfähige ITSM-Plattform für Web, iOS und Android. Der sichtbare Produktname ist eine Plattformkonfiguration und nicht an den Repository-Namen gebunden.

> **Stand:** Phase 1 ist angelegt: Architektur, Monorepo, gemeinsamer Berechtigungskern und Supabase-Kernmigrationen. Die produktiven React- und Expo-Anwendungen folgen in Phase 3. Es gibt noch keine lauffähige Web- oder Mobile-App und keine verbundene Supabase-Instanz.

## Ziele

- Strikte Datenisolation zwischen Mandanten und Abteilungen.
- React/Vite-Webanwendung und Expo/React-Native-App mit geteilter Domänenlogik.
- Supabase Cloud in `eu-central-2` (Zürich) für PostgreSQL, Auth, Storage, Realtime und Edge Functions.
- Serverseitige Autorisierung mit PostgreSQL Row Level Security (RLS).
- Schweizer Schreibweise, `de-CH` als Standardsprache, `Europe/Zurich` als Standardzeitzone und UTC für gespeicherte Zeitpunkte.

## Struktur

```text
apps/                 Web- und Expo-Anwendungen (Phase 3)
packages/             Gemeinsame TypeScript-Logik
  config/             Produkt- und Lokalisierungsstandards
  permissions/        Berechtigungskatalog und referenzierbare Auswertung
  types/              Domänenverträge
  validation/         Zod-Validierungen
supabase/migrations/  Versionierte PostgreSQL-Migrationen
supabase/tests/       Datenbank- und RLS-Tests (wird in Phase 2 ergänzt)
docs/                 Diagramme und vertiefende Architekturunterlagen
```

## Lokale Checks

Voraussetzungen: Node.js 22+ und pnpm 11.25+.

```bash
pnpm install
pnpm check
pnpm test:db
```

`pnpm check` führt den TypeScript-Check, die Unit-Tests und statische Migrations-/Katalogprüfungen aus. `pnpm test:db` startet zusätzlich ein temporäres PostgreSQL-16-Cluster und führt die sechs Migrationen mit einem minimalen Auth-Shim aus. Es ersetzt keine Prüfung gegen eine echte Supabase-Instanz; diese folgt in Phase 2.

## Wichtige Dokumente

- [Technische Architektur](ARCHITECTURE.md)
- [Datenbankmodell](DATABASE.md)
- [Sicherheits- und RLS-Konzept](SECURITY.md)
- [SSO-Konzept](SSO.md)
- [Supabase-Konfiguration](SUPABASE.md)
- [Deploymentkonzept](DEPLOYMENT.md)
- [Priorisierter Entwicklungsplan](DEVELOPMENT_PLAN.md)
- [Umsetzungsstatus](IMPLEMENTATION_STATUS.md)
- [Offene Arbeitsergebnisse](TODO.md)

## Lizenz und Umgang mit Secrets

Es werden keine Secrets eingecheckt. Für lokale Konfigurationen ist später eine nicht versionierte `.env`-Datei vorgesehen; `.env.example` enthält dann ausschliesslich Namen und sichere Platzhalter.
