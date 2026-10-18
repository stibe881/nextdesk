# Umsetzungsstatus

_Stand: 18. Oktober 2026_

## Produktiv bereitgestellt

- **Web:** nextDesk läuft produktiv unter [app.nextdesk.ch](https://app.nextdesk.ch/) auf Hetzner. Die Web-App verlangt vor jeder Inhaltsansicht eine Anmeldung und arbeitet mandantenisoliert über Supabase-RLS, serverseitige Edge Functions und rollenbasierte Berechtigungen.
- **Mandantenverwaltung:** Plattform-Eigentümer verwalten Mandanten; Mandantenadministratoren verwalten nur ihren eigenen Mandanten, darunter Personen, Rollen, SSO, Corporate Design, Datenschutz, Funktionsschalter und Pilotzeiträume. Normale Nutzende erhalten keine Mandantenauswahl.
- **Tickets und Prozesse:** Direkte Ticketbearbeitung, Anfragende, Kategorien und Unterkategorien, Agentenzuweisung, Chatkommunikation, Übergaben, Verknüpfungen, Vergleiche, Freigaben, Import/Export, Ticketakte, Vorlagen, Qualitätsprüfung, Kundenfeedback, kontrollierte Einzel- und Massenabschlüsse sowie auditierte Auto-Close-Vorschauen sind implementiert.
- **Wissen und Assets:** Die Wissensdatenbank unterstützt Kategorien, Revisionen, Freigaben und Sichtbarkeitsgrenzen. Asset- und Intune-Daten sind mandantenautorisiert durchsuchbar; QR-/Barcode-Lookup ist im Web und in der iOS-Quellbasis vorhanden.
- **Automationen und Betrieb:** Tenant-Automationsrichtlinien liefern Vorschauen für Nachfassaufgaben, Schliesskandidaten, Duplikate, Datenhygiene, Qualität, Compliance und Betriebsberichte. Automatische Schliessungen bleiben manuell bestätigt, serverseitig erneut geprüft und auditiert. Retention-Richtlinien, Onboarding, Performancebudgets, Recovery-Runbook und Release Notes sind vorhanden; automatische Löschung und unbeaufsichtigte Scheduler sind bewusst nicht aktiv.
- **Sicherheits- und Feature-Gates:** SSO-Mitgliedschaften, Rollenverwaltung, Wissensfreigaben, letzter Mandantenadministrator, Ticketmodule, Wissen, Assets, SLA-Verwaltung, Reporting und Pilotabläufe sind serverseitig fail-closed abgesichert. Ein Umschalten oder Ändern eines Piloten aktualisiert die Webfreigabe unverzüglich; die iOS-Quellbasis aktualisiert sie bei Mandantenwechsel und Rückkehr in den Vordergrund.

## Mobile iOS

- Die Expo-iOS-App besitzt die Bundle-ID `ch.grossict.nextdesk`, den nativen PKCE-SSO-Rückweg `ch.grossict.nextdesk://auth/callback`, SecureStore/Keychain-Sitzungen, optionalen Geräteschutz, Haptik, sichere Fotoanhänge, Entwürfe, Favoriten, Tastaturvermeidung, globale Suche, Wissen, Assets und Scanner.
- Offline werden keine Ticketdetails, Kommunikation, Anfragendendaten, Anhänge, Assets oder Wissensinhalte gespeichert. Ausschliesslich auf iOS kann eine maximal zwölf Stunden alte, verschlüsselte und schreibgeschützte Ticketlisten-Metadatenansicht bei eindeutig erkanntem Offlinezustand erscheinen. Sie wird bei Abmeldung, Benutzerwechsel oder lokaler Bereinigung vollständig gelöscht.
- Der bestätigte letzte TestFlight-Upload ist Build **10021** (`dcf75910-fafa-41c4-bf65-b0ebe32bedde`) aus iOS-Quellcommit `30480ba`, übermittelt mit Submission `a30b4323-74ba-4c84-a3e4-74a616716dca`. Er enthält die Tippkorrektur der SSO-Taste aus Build 10020 (`3a4c514`) sowie die Korrektur der Keychain-Schlüssel: SecureStore lehnte Schlüssel mit „:“ ab („Invalid key provided to SecureStore“), wodurch der native SSO-Start scheiterte. Die reale iPhone-Abnahme von SSO-Rückkehr, Kamera, Geräteschutz und Offlinefallback steht weiterhin aus. Neuere iOS-Commits (`ac30768`: Mein Tag, Wiedervorlagen, Lösungsbestätigung) sind noch in keinem Build.

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
