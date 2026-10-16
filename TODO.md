# Liefer-Backlog

- [x] **Phase-1-Architektur und Projektgrenzen.** Monorepo, React-/Expo-Zielstruktur, Mandanten- und Abteilungskonzept, RLS-Strategie, Entra-Konzept, Hostingrichtung, Risiken und MVP-Abgrenzung sind dokumentiert. Die Architektur muss den Produktnamen konfigurierbar halten und `de-CH`, `Europe/Zurich` sowie UTC im Datenmodell berücksichtigen.

- [ ] **Produktive Supabase-Grundlage.** Die Migrationen werden gegen getrennte Entwicklungs-, Staging- und Produktionsprojekte in Zürich angewendet. Es existieren Seeds und automatisierte Tests, die Mandant A/B, ICT/Infrastruktur, eigene Tickets, interne Kommentare, Rollenentzug, Supportzugriff, unbekannte Domains und Ticketnummern als echte RLS-Fälle prüfen.

- [ ] **Plattform-Eigentümerkonsole.** Ein MFA-geschützter Plattform-Eigentümer sieht alle Mandanten, kann Mandanten mit Slug, Namen und Start-Abteilungen anlegen sowie Name und Status eines Mandanten bearbeiten oder archivieren. Diese Rechte liegen ausschliesslich in einer user-authentifizierten Edge Function und werden im Plattform-Audit protokolliert. Ein separater Button kann den GitHub-Pages-Workflow nur über einen serverseitigen, minimal berechtigten GitHub-Dispatch-Token anstossen; er zeigt ohne eingerichtetes Secret einen eindeutigen Konfigurationsstatus. Ein Mandanteneigentümer ist dagegen eine aktive Mitgliedschaft mit der Rolle `Tenant administrator` und verwaltet nur seinen Mandanten.

- [ ] **Web- und Mobile-App-Start.** Es gibt eine startbare Vite-React-App und eine startbare Expo-Router-App mit geteilter TypeScript-Geschäftslogik, gesichertem Login, Mandantenwechsel, Cache- und Realtime-Reset sowie Rollen-gesteuerter Navigation. Der erste Web-Lieferstand zeigt eine responsive operative Übersicht mit Navigation, Zeitraum- und Queue-Auswahl; ohne konfigurierte Publishable-Supabase-Werte ist der lokale Preview-Modus sichtbar ausgewiesen. Mit konfigurierten Publishable-Werten verlangt das Web einen Magic-Link-Login, listet nur aktive Mitgliedschaften und zeigt nur RLS-autorisierte Tickets im gewählten Mandantenkontext. Web und Mobile dürfen keine Service-Role-Schlüssel enthalten.

- [ ] **Ticket-MVP.** Berechtigte Benutzer erstellen Tickets; Agenten bearbeiten nur erlaubte Abteilungen. Listen, Detailansicht, Filter, Suche, Status, Priorität, Zuweisung, externe Antworten, standardmässig interne Notizen, Verlauf und Audit funktionieren mit echten Daten.

- [ ] **Sichere Anhänge.** Dateien werden privat hochgeladen, auf Schadsoftware geprüft, nur autorisiert über signierte URL ausgegeben und sind weder mandanten- noch abteilungsübergreifend erreichbar.

- [ ] **Kunden- und Self-Service-Rechte.** Der Zugriff kann je Kundenorganisation ein- oder ausgeschaltet werden. Jeder externe Benutzer hat explizit die Rolle „nur eigene Tickets“ oder „alle Tickets der Kundenorganisation“; diese Regel wird sowohl serverseitig als auch in RLS umgesetzt.

- [ ] **Wissensdatenbank.** Supporter erstellen direkt aus Tickets interne oder externe Lösungsartikel. Kategorien, Versionierung, Freigabe, Suche und Sichtbarkeitsprüfung funktionieren im Web und Mobile.

- [ ] **Entra und Microsoft 365.** Mandantenspezifisches OIDC/SAML, PKCE-geeignete Expo-Redirects, Mapping ohne automatische beliebige Mitgliedschaft, Graph-Postfächer, minimale Berechtigungen und Audit-Events funktionieren mit Test-Tenants.

- [ ] **Betrieb.** CI führt Lint, Typcheck, Tests und Sicherheitsprüfungen aus. Deployment, DNS, Zertifikate, Secrets, Migrationen, Monitoring, Backups, RPO/RTO und Rollback sind dokumentiert und getestet.

- [ ] **Hetzner-Webhosting-L-Auslieferung.** Die Web-App wird als Vite-Produktionsbuild mit Basis-Pfad `/` über eine kontrollierte Hetzner-Subdomain ausgeliefert. Ein manueller GitHub-Workflow verwendet ausschliesslich GitHub-Secrets für SSH-Key und bekannte Hostidentität sowie Repository-Variablen für Host, Port `222`, Benutzer und Zielpfad. Vor Umschaltung sind DNS, TLS, Supabase-Auth-Site-URL und Redirect-Allowlist auf die Hetzner-Domain angepasst. Supabase bleibt für PostgreSQL-RLS, Auth, Storage und Edge Functions in Zürich aktiv; ein Node-Prozess auf `api.<domain>` wird erst für serverseitige Integrationen aktiviert.
