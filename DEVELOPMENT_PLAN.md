# Priorisierter Entwicklungsplan

## Phase 1 – Architektur und Fundament

**Status: abgeschlossen.** Monorepo, Architektur, Datenmodell, Berechtigungskatalog, sechs Kernmigrationen, Diagramm und Referenztests sind vorhanden. Die Migrationen und die zentralen RLS-Szenarien wurden in einem isolierten PostgreSQL-16-Cluster mit Auth-Shim ausgeführt. CI und eine Prüfung gegen eine echte Supabase-Instanz gehören zu Phase 2.

## Phase 2 – Sichere Plattformbasis

**Status: lokal implementiert, Cloud-Anbindung offen.** Es gibt migrationsbasierte Mandantenanlage, Einladungen, Widerruf, Teams, Abteilungsmitgliedschaften und Mandanteneinstellungen sowie vier user-authentifizierte Edge Functions. Die Mandantenanlage verlangt `aal2`; PostgreSQL-16-Integrationstests prüfen die zentralen Transaktionen, Rollenauslauf und RLS-Szenarien mit einem Auth-Shim.

1. Supabase-Projekte für Entwicklung, Staging und Produktion in `eu-central-2` anlegen.
2. Migrationen, Secrets und Edge Functions gegen die echte Supabase-Entwicklungsumgebung bereitstellen.
3. Seeds für zwei Mandanten (ICT/Infrastruktur) ergänzen und die lokale RLS-Suite gegen Supabase Auth, Storage und Realtime erweitern.
4. Auth, Session-Refresh, Plattformoperatoren und temporären Supportzugriff mit echten Session-/MFA-Claims fertigstellen.

## Phase 3 – Anwendungen und Designsystem

1. Vite/React, Tailwind, shadcn/ui, TanStack Query/Table und i18n im Web starten.
2. Expo Router, NativeWind, SecureStore und Deep-Link-Basis starten.
3. Gemeinsamen Auth- und Mandantenkontext an beide Apps anbinden.
4. Dashboard, Navigation und Zugriffsgrenzen mit echten RLS-Daten aufbauen.

## Phase 4 – Ticket-MVP

Ticket-Erstellung über einen geprüften Command, Nummernvergabe, Status, Priorität, Kategorien, Listen, Filter, Detailansicht, externe Antworten, interne Notizen, Zuweisung, Audit und Attachment-Scan-Gate liefern.

## Phase 5 – Self-Service und Wissen

Servicekatalog, dynamische Formulare, Kundenportalrechte, aus Tickets erstellbare Knowledge-Base-Artikel und Suche umsetzen.

## Phase 6 – Identität und Microsoft

Mandantenspezifisches Entra-SSO, Mapping von Gruppen/Rollen/Abteilungen, Microsoft Graph für Shared Mailboxes und optional Teams implementieren. Jede Verbindung wird zuerst gegen ein Sandbox- oder Test-Tenant getestet.

## Phase 7 – Steuerung und Automatisierung

SLA, Genehmigungen, Automatisierungen, Push, Jobs, Zeiterfassung und Assets liefern.

## Phase 8 – Branding, Domains und Reporting

Theme Editor, verifizierte Custom Domains, Dashboards, Exporte, Berichte und Betriebsmetriken ergänzen.

## Phase 9 – Härtung und Freigabe

Last-, RLS-, API-, Accessibility-, mobile und Recovery-Tests. Erst danach: Produktionsdomain, Monitoring, Backups, Store-Release und Abnahme.

## Offene Entscheidungen und Risiken

| Entscheidung/Risiko         | Auswirkung                                                                                                  | Nächste Entscheidung                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Supabase-Plan und SAML      | App-SAML ist gemäss aktueller Dokumentation ab Pro verfügbar; Planfeatures vor Beschaffung nochmals prüfen. | Pro als Minimum bestätigen oder Team wählen.                                                                |
| Kundendomains               | Ein statisches Hosting stellt Zertifikate meist nicht selbst aus.                                           | Reverse Proxy/CDN mit automatisiertem Zertifikatsmanagement wählen; MVP nutzt nur kontrollierte Subdomains. |
| Mandantenadmin-Sicht        | Vollständige Ticketeinsicht ist nicht immer gewünscht.                                                      | Standard als konfigurierbare Rolle behalten; bei Bedarf Verwaltungsrolle ohne Ticketleserecht definieren.   |
| Externe Datenübermittlungen | Expo, Microsoft, Mail und Monitoring können Daten ausserhalb der Schweiz verarbeiten.                       | Verzeichnis der Auftragsbearbeiter und DPA/TIA vor Go-live erstellen.                                       |
| Offline-Daten               | Mobile Cache kann Rechteentzug unterlaufen.                                                                 | Offline nur verschlüsselt, befristet, tenantgetrennt und mit serverseitiger Widerrufssperre.                |
