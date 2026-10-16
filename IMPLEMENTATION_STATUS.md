# Umsetzungsstatus

## Vorhanden

- pnpm-Workspaces und Turborepo-Grundkonfiguration.
- Gemeinsame Pakete für Typen, Konfiguration, Zod-Ticketvalidierung und Berechtigungskatalog.
- Mandanten- und scopegebundene Referenzlogik für Berechtigungszuschüsse samt Unit-Tests.
- Acht versionierte Supabase-Migrationen für Plattform, Mandanten, RBAC, Ticketkern, RLS-Härtung, Mandantenanlage, Einladungen, Teams und Mandanteneinstellungen.
- Direkte Clientzugriffe auf Rollen, Rollenzuweisungen, Einladungen und Ticketnummernsequenzen sind gesperrt; privilegierte Abläufe nutzen Security-Definer-RPCs mit expliziter Rollen- und Mandantenprüfung.
- Vier user-authentifizierte Edge Functions für Mandantenanlage, Mitglieder-Einladungen, Einladungsannahme und Verwaltungsaktionen sowie eine restriktive CORS-Konfiguration. Die Mandantenanlage verlangt einen verifizierten User-JWT mit `aal2`.
- Startbare Vite-/React-Webanwendung mit responsiver Operationsübersicht, Zeitraumauswahl, Queue-Filter, Ticket-Suche und einer browser-sicheren Supabase-Konfigurationsgrenze. Ohne `VITE_SUPABASE_URL` und `VITE_SUPABASE_PUBLISHABLE_KEY` wird der lokale Preview-Modus klar ausgewiesen.
- Vollständige Phase-1-Dokumente, Supabase-Konfigurationsanleitung, Mermaid-Architekturdiagramm und priorisiertes Backlog.

## Ausgeführte Prüfungen

- `pnpm check`: vier TypeScript-Pakete erfolgreich typgeprüft; sieben Berechtigungs- und drei Validierungs-Unit-Tests erfolgreich.
- `pnpm test:schema`: acht Migrationen, 20 Sicherheits-/Schemasignaturen und 23 TypeScript-/SQL-Berechtigungscodes auf Konsistenz geprüft.
- `pnpm test:db`: ein temporäres PostgreSQL-16-Cluster mit minimalem `auth.uid()`-Shim startet, wendet alle Migrationen an und prüft Cross-Tenant-FKs, RLS, gesperrte Ticketnummern-RPC, Mandantenanlage mit MFA-Prüfung, Standardrollen, Einladungsannahme, Teams, Abteilungsmitgliedschaft, ICT-/Infrastruktur-Trennung, eigene Tickets, interne Kommentare und Mandant-A/B-Isolation.
- `pnpm check:edge`: die vier Edge Functions werden mit Deno und dem `@supabase/server`-Importmapping typgeprüft.
- `pnpm --filter @nextdesk/web typecheck` und `pnpm --filter @nextdesk/web build`: das Web-Dashboard ist typgeprüft und als Vite-Produktionsbundle gebaut; öffentliche Vorschau, Routenmanifest und Zeit-/Queue-Interaktionen wurden geprüft.

Die Datenbank- und Function-Prüfungen sind **kein** Test gegen eine echte Supabase-Instanz. Auth-JWT-Claims werden lokal nachgebildet; Storage, Realtime, Edge-Function-Deployment, Supabase Auth, Mailzustellung, Domains und die Supabase-Rollenverwaltung sind noch nicht verifiziert.

## Noch nicht implementiert

Es gibt noch keine Expo-App, keine verbundene Supabase-Cloud-Umgebung, keine echten Dashboard-RLS-Daten, Storage-Policies, Realtime-Kanäle, SSO-/Graph-Integration, E-Mail-Verarbeitung, Push, SLA, Workflows, Wissensdatenbank, Assets, Reporting, CI oder produktives Deployment.

## Nächster verbindlicher Meilenstein

Phase 3 ergänzt die Web-App um Auth-, Mandanten- und Supabase-Datenzugriff sowie eine Expo-App mit gleicher Navigationsgrundlage. Parallel bleibt die Verbindung zu einem echten Supabase-Entwicklungsprojekt in `eu-central-2` erforderlich, bevor die Backendbausteine bereitgestellt oder genutzt werden können.
