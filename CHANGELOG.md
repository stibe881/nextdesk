# Changelog

Dieses Projekt verwendet eine vereinfachte Form von Keep a Changelog.

## [Unreleased]

### Added

- Phase-1-Monorepo mit pnpm Workspaces und Turborepo.
- Gemeinsamer Berechtigungskatalog, scopegebundene Referenzauswertung und Unit-Tests für zentrale Isolation.
- Acht versionierte Kernmigrationen für Plattform, Mandanten, RBAC, Ticketing, Core-RLS, Mandantenanlage, Einladungen und Mandantenadministration.
- PostgreSQL-16-Testharness mit Auth-Shim für Migrationen, mandantenübergreifende Fremdschlüssel, RLS, Mandantenanlage, Einladungen, Teams und Einstellungen.
- User-authentifizierte Edge Functions für Mandantenanlage, Mitglieder-Einladungen, Einladungsannahme und Verwaltungsaktionen inklusive restriktivem CORS-Konzept.
- Architektur-, Datenmodell-, Sicherheits-, SSO-, Mobile-, API-, Supabase-, Deployment- und Roadmap-Dokumentation.
- Berücksichtigung interner Kommentare als Standard, Kundenportalrollen, KB-Erstellung aus Tickets und plattformabhängigem Remote Support als Produktanforderungen.
- Vite-/React-Operationsdashboard mit Magic-Link-Anmeldung, Auswahl aktiver Mandantenmitgliedschaften, RLS-gebundenen Dashboardabfragen und deutlich getrenntem Offline-Preview.
- Neunte Migration für Status-, Prioritäts- und Kategorie-Lesepolicies im aktiven Mandantenkontext sowie lokale PostgreSQL-Tests für diese Referenzdatenisolation.
- Isoliertes Supabase-Entwicklungsprojekt in Zürich (`eu-central-2`) angelegt; Migrationen `0001` bis `0006` sowie `0009` und 30 RLS-geschützte Tabellen in der echten Cloud-Instanz geprüft.

### Security

- RLS auf allen sensiblen Kern- und Berechtigungstabellen aktiviert.
- Direkte Clientzugriffe auf Rollen, Rollenrechte, Rollenzuweisungen, Einladungen und Ticketnummernsequenzen gesperrt.
- Tenant-/Department-Konsistenz durch zusammengesetzte Fremdschlüssel und Assignment-Validierung erzwungen.
- Ticketnummernreservierung für `anon` und `authenticated` als direkte RPC gesperrt.
- Mandantenanlage verlangt einen `aal2`-verifizierten Plattformbetreiber; Einladungen werden erst nach einer nutzergebundenen Annahme aktiv, lassen sich widerrufen und reaktivieren keine historischen Rollen.
- Der Browser-Client besitzt ausschliesslich den Publishable-Key; sichtbare Dashboardmetadaten werden pro Abfrage durch aktive Mitgliedschaft und RLS begrenzt.

### Not yet released

- Kein gegen echte Auth-, RLS- und Mailzustände geprüfter Benutzerfluss; die Cloud-Migrationen `0007`/`0008`, Edge Functions, Auth-Redirects und die Funktionsecrets stehen noch aus.
