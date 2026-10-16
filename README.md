# NextDesk / TicketHub

NextDesk ist das Quellcode-Repository für **TicketHub**, eine mandantenfähige ITSM-Plattform für Web, iOS und Android. Der sichtbare Produktname ist eine Plattformkonfiguration und nicht an den Repository-Namen gebunden.

> **Stand:** Phase 1 und die lokale Phase-2-Plattformbasis sind angelegt. Die startbare Vite-/React-Webanwendung liefert eine responsive Operationsübersicht, Magic-Link-Anmeldung, aktiven Mandantenwechsel und RLS-gebundene Ticketabfragen. Solange keine Publishable-Supabase-Konfiguration vorhanden ist, bleibt der Offline-Preview-Modus sichtbar. Die Expo-App und die Verbindung zu einem echten Supabase-Projekt folgen.

## Permanente Website

Die statische Operationsübersicht wird bei jedem Push auf `main` über GitHub Pages bereitgestellt: [https://stibe881.github.io/nextdesk/](https://stibe881.github.io/nextdesk/). Details zur Auslieferung stehen im [Deploymentkonzept](DEPLOYMENT.md).

## Ziele

- Strikte Datenisolation zwischen Mandanten und Abteilungen.
- React/Vite-Webanwendung und Expo/React-Native-App mit geteilter Domänenlogik.
- Supabase Cloud in `eu-central-2` (Zürich) für PostgreSQL, Auth, Storage, Realtime und Edge Functions.
- Serverseitige Autorisierung mit PostgreSQL Row Level Security (RLS).
- Schweizer Schreibweise, `de-CH` als Standardsprache, `Europe/Zurich` als Standardzeitzone und UTC für gespeicherte Zeitpunkte.

## Struktur

```text
apps/                 Web- und Expo-Anwendungen
  web/                Vite-/React-Operationsdashboard mit Magic Link, Mandantenkontext und Publishable-Supabase-Grenze
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
NEXTDESK_APP_URL=https://app.nextdesk.ch/ \
NEXTDESK_SUPABASE_URL=https://<projekt-ref>.supabase.co \
pnpm smoke:web
pnpm dev:web
```

`pnpm check` führt den TypeScript-Check, die Unit-Tests und statische Migrations-/Katalogprüfungen aus. `pnpm test:db` startet zusätzlich ein temporäres PostgreSQL-16-Cluster und führt alle versionierten Migrationen mit einem minimalen Auth-Shim aus. `pnpm smoke:web` prüft eine ausgelieferte Web-App, ihr JavaScript-Bundle sowie – bei gesetzter Supabase-URL – den CORS-Preflight der Audit-Function. `pnpm dev:web` startet das lokale Dashboard auf Port 5173. Die Prüfungen ersetzen keine vollständige Anmeldung mit einem echten Benutzer oder eine Supabase-Staging-Abnahme.

## Web-Konfiguration

Für den Live-Modus kopiert man `apps/web/.env.example` nach `apps/web/.env.local` und trägt ausschliesslich `VITE_SUPABASE_URL` sowie `VITE_SUPABASE_PUBLISHABLE_KEY` ein. Der Publishable-Key darf im Browser verwendet werden; ein Service-Role- oder Secret-Key darf dort niemals stehen. Im Supabase-Projekt muss zusätzlich `https://stibe881.github.io/nextdesk/` als erlaubte Auth-Redirect-URL für Magic Links hinterlegt werden.

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
