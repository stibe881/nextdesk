# Umsetzungsstatus

## Vorhanden

- pnpm-Workspaces und Turborepo-Grundkonfiguration.
- Gemeinsame Pakete für Typen, Konfiguration, Zod-Ticketvalidierung und Berechtigungskatalog.
- Mandanten- und scopegebundene Referenzlogik für Berechtigungszuschüsse samt Unit-Tests.
- Neun versionierte Supabase-Migrationen für Plattform, Mandanten, RBAC, Ticketkern, RLS-Härtung, Mandantenanlage, Einladungen, Teams, Mandanteneinstellungen und sichere Dashboardreferenzdaten.
- Direkte Clientzugriffe auf Rollen, Rollenzuweisungen, Einladungen und Ticketnummernsequenzen sind gesperrt; privilegierte Abläufe nutzen Security-Definer-RPCs mit expliziter Rollen- und Mandantenprüfung.
- Vier user-authentifizierte Edge Functions für Mandantenanlage, Mitglieder-Einladungen, Einladungsannahme und Verwaltungsaktionen sowie eine restriktive CORS-Konfiguration. Die Mandantenanlage verlangt einen verifizierten User-JWT mit `aal2`.
- Startbare Vite-/React-Webanwendung mit responsiver Operationsübersicht, Zeitraumauswahl, Queue-Filter, Ticket-Suche und einer browser-sicheren Supabase-Konfigurationsgrenze. Mit Publishable-Konfiguration verlangt sie einen Magic Link, lädt ausschliesslich aktive Mandantenmitgliedschaften und liest Tickets, Status, Prioritäten, Abteilungen sowie Ereignisse nur im RLS-autorisierten Mandantenkontext. Ohne `VITE_SUPABASE_URL` und `VITE_SUPABASE_PUBLISHABLE_KEY` wird der lokale Preview-Modus klar ausgewiesen.
- Vollständige Phase-1-Dokumente, Supabase-Konfigurationsanleitung, Mermaid-Architekturdiagramm und priorisiertes Backlog.
- Ein aktives, isoliertes Supabase-Entwicklungsprojekt in `eu-central-2` (Zürich) mit den Cloud-Migrationen `0001` bis `0006` sowie `0009`; 30 Tabellen und der Berechtigungskatalog wurden in der echten Instanz verifiziert.

## Ausgeführte Prüfungen

- `pnpm check`: vier TypeScript-Pakete erfolgreich typgeprüft; sieben Berechtigungs- und drei Validierungs-Unit-Tests erfolgreich.
- `pnpm test:schema`: neun Migrationen, 23 Sicherheits-/Schemasignaturen und 23 TypeScript-/SQL-Berechtigungscodes auf Konsistenz geprüft.
- `pnpm test:db`: ein temporäres PostgreSQL-16-Cluster mit minimalem `auth.uid()`-Shim startet, wendet alle Migrationen an und prüft Cross-Tenant-FKs, RLS, gesperrte Ticketnummern-RPC, Mandantenanlage mit MFA-Prüfung, Standardrollen, Einladungsannahme, Teams, Abteilungsmitgliedschaft, ICT-/Infrastruktur-Trennung, eigene Tickets, interne Kommentare, mandantengebundene Status-/Prioritätsreferenzen und Mandant-A/B-Isolation.
- `pnpm check:edge`: die vier Edge Functions werden mit Deno und dem `@supabase/server`-Importmapping typgeprüft.
- `pnpm --filter @nextdesk/web typecheck` und `pnpm --filter @nextdesk/web build`: das Web-Dashboard ist typgeprüft und als Vite-Produktionsbundle gebaut; öffentliche Vorschau, Routenmanifest und Zeit-/Queue-Interaktionen wurden geprüft.

Die Datenbank- und Function-Prüfungen ersetzen weiterhin keinen vollständigen Integrationstest. Das Supabase-Entwicklungsprojekt existiert und seine zuerst benötigten Migrationen sind angewendet, doch Auth-JWT-Claims, Storage, Realtime, Edge-Function-Deployment, Magic-Link-Mailzustellung, Auth-Redirects, Domains und die Supabase-Rollenverwaltung sind noch nicht gegen einen echten Benutzerfluss verifiziert.

## Noch nicht implementiert

Es gibt noch keine Expo-App und noch keinen gegen reale Auth- und RLS-Daten geprüften Webfluss. Die Cloud-Migrationen `0007` und `0008`, Edge-Function-Deployment, Storage-Policies, Realtime-Kanäle, SSO-/Graph-Integration, E-Mail-Verarbeitung, Push, SLA, Workflows, Wissensdatenbank, Assets, Reporting und produktives Backend-Deployment fehlen ebenfalls.

## Nächster verbindlicher Meilenstein

Phase 3 ergänzt die Web-App um verifizierte Auth-, Mandanten- und Supabase-Datenzugriffe sowie eine Expo-App mit gleicher Navigationsgrundlage. Als nächstes werden die ausstehenden Cloud-Migrationen, Function-Secrets, Auth-Redirects und Edge Functions gegen das vorhandene Entwicklungsprojekt ausgerollt.
