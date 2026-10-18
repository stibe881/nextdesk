# Umsetzungsstatus

_Stand: 18. Oktober 2026_

## Produktiv bereitgestellt

- 18.10.2026, 17:30 Uhr: Migrationen 0058 und 0059 sind produktiv. Edge Functions: agent-workbench v2, requester-portal v2, tenant-audit-log v6, health v1. Web-Commit 2df3cbb ist ausgerollt, Smoke-Test erfolgreich. Enthalten sind Agentenwerkbank, Anfragendenportal, durchsuchbarer Auditexport, Kopie und Erreichbarkeit, eine optionale Abteilungsansicht (standardmässig aus), die Branding-Live-Vorschau, Dashboard-Trends und Einführungshinweise.

- **Web:** nextDesk läuft produktiv unter [app.nextdesk.ch](https://app.nextdesk.ch/) auf Hetzner. Die Web-App verlangt vor jeder Inhaltsansicht eine Anmeldung und arbeitet mandantenisoliert über Supabase-RLS, serverseitige Edge Functions und rollenbasierte Berechtigungen.
- **Mandantenverwaltung:** Plattform-Eigentümer verwalten Mandanten; Mandantenadministratoren verwalten nur ihren eigenen Mandanten, darunter Personen, Rollen, SSO, Corporate Design, Datenschutz, Funktionsschalter und Pilotzeiträume. Normale Nutzende erhalten keine Mandantenauswahl.
- **Tickets und Prozesse:** Direkte Ticketbearbeitung, Anfragende, Kategorien und Unterkategorien, Agentenzuweisung, Chatkommunikation, Übergaben, Verknüpfungen, Vergleiche, Freigaben, Import/Export, Ticketakte, Vorlagen, Qualitätsprüfung, Kundenfeedback, kontrollierte Einzel- und Massenabschlüsse sowie auditierte Auto-Close-Vorschauen sind implementiert.
- **Wissen und Assets:** Die Wissensdatenbank unterstützt Kategorien, Revisionen, Freigaben und Sichtbarkeitsgrenzen. Asset- und Intune-Daten sind mandantenautorisiert durchsuchbar; QR-/Barcode-Lookup ist im Web und in der iOS-Quellbasis vorhanden.
- **Automationen und Betrieb:** Tenant-Automationsrichtlinien liefern Vorschauen für Nachfassaufgaben, Schliesskandidaten, Duplikate, Datenhygiene, Qualität, Compliance und Betriebsberichte. Automatische Schliessungen bleiben manuell bestätigt, serverseitig erneut geprüft und auditiert. Retention-Richtlinien, Onboarding, Performancebudgets, Recovery-Runbook und Release Notes sind vorhanden; automatische Löschung und unbeaufsichtigte Scheduler sind bewusst nicht aktiv.
- **Sicherheits- und Feature-Gates:** SSO-Mitgliedschaften, Rollenverwaltung, Wissensfreigaben, letzter Mandantenadministrator, Ticketmodule, Wissen, Assets, SLA-Verwaltung, Reporting und Pilotabläufe sind serverseitig fail-closed abgesichert. Ein Umschalten oder Ändern eines Piloten aktualisiert die Webfreigabe unverzüglich; die iOS-Quellbasis aktualisiert sie bei Mandantenwechsel und Rückkehr in den Vordergrund.

## Mobile iOS

- Die Expo-iOS-App besitzt die Bundle-ID `ch.grossict.nextdesk`, den nativen PKCE-SSO-Rückweg `ch.grossict.nextdesk://auth/callback`, SecureStore/Keychain-Sitzungen, optionalen Geräteschutz, Haptik, sichere Fotoanhänge, Entwürfe, Favoriten, Tastaturvermeidung, globale Suche, Wissen, Assets und Scanner.
- Offline werden keine Ticketdetails, Kommunikation, Anfragendendaten, Anhänge, Assets oder Wissensinhalte gespeichert. Ausschliesslich auf iOS kann eine maximal zwölf Stunden alte, verschlüsselte und schreibgeschützte Ticketlisten-Metadatenansicht bei eindeutig erkanntem Offlinezustand erscheinen. Sie wird bei Abmeldung, Benutzerwechsel oder lokaler Bereinigung vollständig gelöscht.
- Der bestätigte letzte TestFlight-Upload ist Build **10022** (`2298c990-9f6b-40d1-a1c8-98ebc5f0a6c1`) aus iOS-Quellcommit `ec02f11`, übermittelt mit Submission `78c384cc-fc91-4af1-9e90-01ddff8b5308`. Er enthält zusätzlich zu Build 10021 (`30480ba`, SSO- und Keychain-Korrekturen; die SSO-Anmeldung funktioniert laut realen Screenshots wieder) Mein Tag, Wiedervorlagen, Lösungsbestätigung, Wischaktionen, Störungsbanner, Kennzahlen, Erwähnungen, Zeitleiste, Wiedereröffnen, Vor-Ort-Modus, Erreichbarkeit, Abteilungsansicht, iPad-Layouts, den überarbeiteten Dark Mode mit Standard Hell und Profilumschaltung, den Schutz offener Eingaben vor Hintergrund-Neuladen samt deutschen Fehlermeldungen sowie den neuen Fotobereich mit direkter Kameraaufnahme, Vorschauraster und In-App-Betrachter. Die reale iPhone-Abnahme dieser Funktionen sowie von Kamera, Geräteschutz und Offlinefallback steht aus.

## Ausgeführte Qualitätsprüfungen

- Web: `pnpm check`, `pnpm test:schema`, `pnpm test:db`, `pnpm check:edge`, Hetzner-Produktionsbuild, Prettier-/Diff-Prüfung, Bundlebudget und Produktions-Smoke-Test.
- Datenbank: Lokale PostgreSQL-16-Regressionen prüfen Migrationen, RLS, Mandantentrennung, Rollen, Wissensfreigaben, Abschlussbestätigungen und Sicherheitsinvarianten.
- Mobile: `pnpm check`, `pnpm lint` und `git diff --check` für alle aktuell gelieferten Quelländerungen. Nativer SSO-, Kamera-, Tastatur- und Offlinebetrieb erfordert zusätzlich einen Test auf einem realen iPhone nach einem TestFlight-Build.

## Verbleibende externe oder reale Abnahmebedingungen

- **TestFlight-/iPhone-Abnahme:** Installation, Verarbeitung in TestFlight sowie ein realer iPhone-End-to-End-Test für SSO-Rückkehr, Eingabefelder, Kamera, Abschlussbestätigung, Geräteschutz und Offlineverhalten.
- **Entra-Verzeichnisabgleich:** Benötigt Microsoft Graph `User.Read.All`, sichere Edge-Function-Secrets und Admin-Consent jedes Kundenmandanten.
- **Intune-Synchronisation:** Benötigt Graph `DeviceManagementManagedDevices.Read.All`, serverseitige Secrets und den kundenseitigen Admin-Consent.
- **Weitere Integrationen:** E-Mail, Kalender, Teams/Slack, Monitoring, Webhooks/API-Schlüssel, KI und externe Provider benötigen jeweils deren Zugänge, Datenschutzfreigaben und Konfiguration.
- **Unbeaufsichtigte Abläufe:** SLA-Scheduler, automatische Löschung oder produktive Hintergrundjobs werden erst nach expliziter Betriebsfreigabe samt erforderlichen Secrets beziehungsweise Hosting-Konfiguration aktiviert.
- **GitHub-Workflow-Publish:** Die gehärteten Workflow-Dateien benötigen weiterhin eine wirksame GitHub-`workflow`-Berechtigung, bevor sie nach `main` veröffentlicht werden können.
