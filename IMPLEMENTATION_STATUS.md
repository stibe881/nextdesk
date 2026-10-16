# Umsetzungsstatus

## Vorhanden

- pnpm-Workspaces und Turborepo-Grundkonfiguration.
- Gemeinsame Pakete für Typen, Konfiguration, Zod-Ticketvalidierung und Berechtigungskatalog.
- Mandanten- und scopegebundene Referenzlogik für Berechtigungszuschüsse samt Unit-Tests.
- Sechs versionierte Supabase-Migrationen für Plattform, Mandanten, RBAC, Kundenorganisationen, Ticketkern, atomare Nummernreservierung und Core-RLS.
- Die Härtungsmigration erzwingt mandantenkonsistente Fremdschlüssel, trennt Plattformrollen von Mandantenrollen, verlangt aktive Abteilungsmitgliedschaften für Ticket-Agentenrechte, sperrt nicht freigegebene Clientpfade und seedet den Berechtigungskatalog.
- Vollständige Phase-1-Dokumente, Mermaid-Architekturdiagramm und priorisiertes Backlog.

## Ausgeführte Prüfungen

- `pnpm check`: vier TypeScript-Pakete erfolgreich typgeprüft; sieben Berechtigungs- und drei Validierungs-Unit-Tests erfolgreich.
- `pnpm test:schema`: sechs Migrationen, zwölf Sicherheits-/Schemasignaturen und 23 TypeScript-/SQL-Berechtigungscodes auf Konsistenz geprüft.
- `pnpm test:db`: ein temporäres PostgreSQL-16-Cluster mit minimalem `auth.uid()`-Shim startet, wendet alle Migrationen an und prüft Cross-Tenant-FKs, aktivierte RLS, gesperrte Ticketnummern-RPC, ICT-/Infrastruktur-Trennung, eigene Tickets, interne Kommentare und Mandant-A/B-Isolation.

Der Datenbanktest ist **kein** Test gegen eine echte Supabase-Instanz. Auth-JWT-Claims werden durch einen minimalen lokalen Shim nachgebildet; Storage, Realtime, Edge Functions, Supabase Auth, Domainauflösung und die Supabase-Rollenverwaltung sind noch nicht verifiziert.

## Noch nicht implementiert

Es gibt noch keine startbare Vite-Webanwendung, Expo-App, Supabase-Projektverbindung, produktiven Seeds, Edge Functions, Storage-Policies, Realtime-Kanäle, SSO-/Graph-Integration, E-Mail-Verarbeitung, Push, SLA, Workflows, Wissensdatenbank, Assets, Reporting, CI oder produktives Deployment.

## Nächster verbindlicher Meilenstein

Phase 2 beginnt mit einem echten Supabase-Entwicklungsprojekt in `eu-central-2`, einem erneuten Lauf der Migrationen gegen Supabase und erweiterten RLS-Integrationstests. Erst danach wird die Web-/Mobile-Authentifizierung angeschlossen.
