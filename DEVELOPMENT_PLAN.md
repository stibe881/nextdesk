# Priorisierter Entwicklungsplan

## P1/P2-Programm vom 19. Oktober 2026

**Status: M0 abgeschlossen.** Die kanonische Quellbasis ist `origin/main` auf `4630abecdd424d68dcfd8ea1d0e85b37224136c4` mit Migrationen bis 0080. Neun nicht committe lokale Webänderungen wurden einzeln klassifiziert; sie sind bereits enthalten oder durch den aktuelleren Remote-Stand ersetzt und werden nicht nochmals übernommen. Die verbindliche Reconciliation und die serielle Migrationsfolge 0081 bis 0089 sind in `docs/operations/P1P2_M0_RECONCILIATION_2026-10-19.md` festgehalten.

Die nachfolgenden Lieferpakete werden isoliert und in dieser Reihenfolge umgesetzt: Owner-Schutz und nicht aktiver Deploy-Entwurf, kontrollierte Ticketautomation, strukturierte Assetpflege mit gesperrter Intune-Run-Control, Entra-Verzeichnis/SSO/Agentenreservationen sowie die nachgelagerte iOS-Bedienbarkeit. Externe Provider, Produktiv-Dispatches, Retention-Löschungen, unbeaufsichtigte Scheduler und neue Expo-/EAS-Builds benötigen weiterhin jeweils eine separate Freigabe und werden in diesen Lieferpaketen nicht aktiviert.

**P1.1 Entra-Verzeichniskonfiguration: produktiv abgeschlossen.** Migration 0081, die JWT-geschützten Edge Functions `tenant-admin-settings` und `entra-directory-sync` sowie die Weboberfläche sind produktiv ausgerollt und per RLS-/RPC-Rechteprüfung, Function-Status und Web-Smoke-Test verifiziert. Die Konfiguration wird ausschliesslich aus einer aktiven, tenant-spezifischen Azure-SSO-URL abgeleitet und ist über service-role-only RPCs, Auditierung, Verbindungstest, pro-Mandant-Lease sowie Konfigurationsgenerationen gegen parallele SSO-Änderungen abgesichert. Die Mandantenadministration kann den Connector speichern, deaktiviert testen und erst danach einen manuellen Abgleich auslösen. Ein echter Kundensync wird erst durch die bewusste Bedienung im Mandanten ausgelöst; ein regelmässiger Scheduler bleibt bis zu einer separaten Freigabe deaktiviert.

**P1.5 Assetpflege und lokaler Intune-Preflight: produktiv abgeschlossen.** Migrationen 0083 und 0084 ergänzen die Intune-Run-Control um einen rein lokalen, auditierten und idempotenten Preflight samt Historie und kontrollierter Wiederholung. Der Preflight kontaktiert keinen Provider, fordert keine Tokens an und aktiviert weder Synchronisation noch Scheduler. Fallverantwortliche werden als aktive Mandantenmitglieder ausgewählt und auf Datenbankebene gegen inaktive Zuordnungen geschützt. Die Web-Assetpflege erfasst Inventar-, Serien-, Hersteller-, Modell- und Betriebssystemdaten strukturiert; die mobile Assetdetailansicht verdichtet Inventar, Geräte- und Betriebsstatus. Direkte Browserzugriffe respektieren `assets.management`, einen allfälligen Pilotablauf sowie eine aktive Mandantenmitgliedschaft; externe Gerätekennungen, Identifier, Geräte-Snapshots und Personenbezüge liegen ausschliesslich in Service-Role-Tabellen. Migration 0083 bereinigt alte `external_device_id`-Metadatenkopien und bewahrt fallunterschiedliche Altdubletten sicher als mehrdeutige private Lookupresultate statt den Upgrade zu blockieren oder einen beliebigen Treffer zu zeigen. QR-/Barcode-Lookups laufen ausschliesslich über den autorisierten, mandantengebundenen Serverpfad. `asset-registry`, `service-assets` und der fail-closed Worker `intune-asset-sync` sind jeweils als JWT-geschützte Edge Function Version 9 aktiv. Das Webbundle wurde kontrolliert auf Hetzner ausgerollt und per Smoke-Test bestätigt. Ein neuer Expo-/EAS-Build und jeder echte Intune-Abgleich bleiben bewusst ausserhalb dieses Pakets.

**P1.3 Entra-SSO-Provisionierung und Offboarding: lokal geprüft, Release ausstehend.** Die mobile App löst nach einer verifizierten Azure-Anmeldung einmalig die serverseitige Mandantenprüfung und gegebenenfalls die normale Personenprovisionierung aus, bevor sie einen Arbeitsbereich als nicht bestätigbar meldet. Gespeicherte, nicht mehr zugelassene Arbeitsbereiche werden weiterhin fail-closed verworfen; das Laden der Einstellungen löst keine Provisionierung aus. Migration 0085 serialisiert sowohl Entra-SSO-Claims als auch die aktuelle E-Mail-Einladungsannahme mit Einladungwiderrufen und verhindert Reaktivierungen entfernter Personen. Der Browserannahmepfad beansprucht die konkrete Einladung und Mitgliedschaft zuerst über eine gelockte Service-Role-RPC; ein zwischenzeitlicher Widerruf gewinnt stets und blockiert nachgelagerte Rollen. Sowohl die alte wie die aktuelle Einladungsverwaltung behandeln gesendete wie bereits angenommene Einladungen als Offboarding-Ziel und beenden bei einem Widerruf atomar die Mitgliedschaft und alle Rollen, einschliesslich nachweisbar aus einer Entra-Agentenvormerkung entstandener Rollen. Der dafür notwendige Provenance-Ausnahmezustand ist transaktionslokal und nur innerhalb bereits berechtigungsgeprüfter Offboarding- oder Re-Invite-RPCs gesetzt; er erlaubt ausschliesslich ein Ablaufdatum, nie eine neue Rolle oder Reaktivierung. Die Korrektur ist durch PostgreSQL-, Deno- und mobile TypeScript-/Vitest-Regressionen geprüft; der produktive Supabase-Release und ein ausdrücklich freigegebener iOS-Build stehen noch aus.

## Phase 1 – Architektur und Fundament

**Status: abgeschlossen.** Monorepo, Architektur, Datenmodell, Berechtigungskatalog, sechs Kernmigrationen, Diagramm und Referenztests sind vorhanden. Die Migrationen und die zentralen RLS-Szenarien wurden in einem isolierten PostgreSQL-16-Cluster mit Auth-Shim ausgeführt. CI und eine Prüfung gegen eine echte Supabase-Instanz gehören zu Phase 2.

## Phase 2 – Sichere Plattformbasis

**Status: lokal implementiert, Cloud-Anbindung offen.** Es gibt migrationsbasierte Mandantenanlage, Einladungen, Widerruf, Teams, Abteilungsmitgliedschaften und Mandanteneinstellungen sowie vier user-authentifizierte Edge Functions. Die Mandantenanlage verlangt `aal2`; PostgreSQL-16-Integrationstests prüfen die zentralen Transaktionen, Rollenauslauf und RLS-Szenarien mit einem Auth-Shim.

1. Supabase-Projekte für Entwicklung, Staging und Produktion in `eu-central-2` anlegen.
2. Migrationen, Secrets und Edge Functions gegen die echte Supabase-Entwicklungsumgebung bereitstellen.
3. Seeds für zwei Mandanten (ICT/Infrastruktur) ergänzen und die lokale RLS-Suite gegen Supabase Auth, Storage und Realtime erweitern.
4. Auth, Session-Refresh, Plattformoperatoren und temporären Supportzugriff mit echten Session-/MFA-Claims fertigstellen.

## Phase 3 – Anwendungen und Designsystem

**Status: Web-Grundlage lokal implementiert, Cloud-Anbindung offen.** Eine startbare Vite-/React-Operationsübersicht mit responsivem Designsystem, Navigation, Zeitraumauswahl, Queue-Filterung und Suchfeld ist vorhanden. Mit Publishable-Supabase-Konfiguration bietet sie Magic-Link-Anmeldung, Session-Refresh, Auswahl aktiver Mandantenmitgliedschaften und RLS-gebundene Abfragen für Tickets, Abteilungen, Status, Prioritäten und Ereignisse. Ohne Cloud-Konfiguration bleibt der Preview-Modus ausdrücklich markiert; die Anwendung enthält keine Service-Role-Konfiguration.

1. TanStack Query/Table und i18n im Web ergänzen sowie den lokalen Live-Datenadapter gegen ein echtes Supabase-Entwicklungsprojekt prüfen.
2. Expo Router, NativeWind, SecureStore und Deep-Link-Basis starten.
3. Den vorhandenen Auth- und Mandantenkontext als geteilte Logik an die Expo-App anbinden.
4. Dashboard, Navigation und Zugriffsgrenzen gegen echte RLS-Daten, Auth-Redirects und Sessionabläufe validieren.

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
