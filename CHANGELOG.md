# Changelog

Dieses Projekt verwendet eine vereinfachte Form von Keep a Changelog.

## [Unreleased]

### Added

- Phase-1-Monorepo mit pnpm Workspaces und Turborepo.
- Gemeinsamer Berechtigungskatalog, scopegebundene Referenzauswertung und Unit-Tests für zentrale Isolation.
- Sechs versionierte Kernmigrationen für Plattform, Mandanten, RBAC, Ticketing, Core-RLS und eine explizite Härtungsstufe.
- PostgreSQL-16-Testharness mit Auth-Shim für Migrationen, mandantenübergreifende Fremdschlüssel, RLS und Kommentarzugriff.
- Architektur-, Datenmodell-, Sicherheits-, SSO-, Mobile-, API-, Deployment- und Roadmap-Dokumentation.
- Berücksichtigung interner Kommentare als Standard, Kundenportalrollen, KB-Erstellung aus Tickets und plattformabhängigem Remote Support als Produktanforderungen.

### Security

- RLS auf allen sensiblen Kern- und Berechtigungstabellen aktiviert.
- Direkte Clientzugriffe auf Rollen, Rollenrechte, Rollenzuweisungen und Ticketnummernsequenzen gesperrt.
- Tenant-/Department-Konsistenz durch zusammengesetzte Fremdschlüssel und Assignment-Validierung erzwungen.
- Ticketnummernreservierung für `anon` und `authenticated` als direkte RPC gesperrt.

### Not yet released

- Keine produktiven Apps, keine Supabase-Umgebung und keine Benutzerfunktionen.
