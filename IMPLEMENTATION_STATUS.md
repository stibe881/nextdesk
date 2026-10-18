# Umsetzungsstatus

_Stand: 18. Oktober 2026_

## Produktiv bereitgestellt

- **Web:** nextDesk läuft produktiv unter [app.nextdesk.ch](https://app.nextdesk.ch/) auf Hetzner. Die Web-App verlangt vor jeder Inhaltsansicht eine Anmeldung und arbeitet mandantenisoliert über Supabase-RLS, serverseitige Edge Functions und rollenbasierte Berechtigungen.
- **Mandantenverwaltung:** Plattform-Eigentümer verwalten Mandanten; Mandantenadministratoren verwalten nur ihren eigenen Mandanten, darunter Personen, Rollen, SSO, Corporate Design, Datenschutz, Funktionsschalter und Pilotzeiträume. Normale Nutzende erhalten keine Mandantenauswahl.
- **Tickets und Prozesse:** Direkte Ticketbearbeitung, Anfragende, Kategorien und Unterkategorien, Agentenzuweisung, Chatkommunikation, Übergaben, Verknüpfungen, Vergleiche, Freigaben, Import/Export, Ticketakte, Vorlagen, Qualitätsprüfung, Kundenfeedback, kontrollierte Einzel- und Massenabschlüsse sowie auditierte Auto-Close-Vorschauen sind implementiert.
- **Wissen und Assets:** Die Wissensdatenbank unterstützt Kategorien, Revisionen, Freigaben und Sichtbarkeitsgrenzen. Asset- und Intune-Daten sind mandantenautorisiert durchsuchbar; QR-/Barcode-Lookup ist im Web und in der iOS-Quellbasis vorhanden.
- **Automationen und Betrieb:** Tenant-Automationsrichtlinien liefern Vorschauen für Nachfassaufgaben, Schliesskandidaten, Duplikate, Datenhygiene, Qualität, Compliance und Betriebsberichte. Automatische Schliessungen bleiben manuell bestätigt, serverseitig erneut geprüft und auditiert. Retention-Richtlinien, Onboarding, Performancebudgets, Recovery-Runbook und Release Notes sind vorhanden; automatische Löschung und unbeaufsichtigte Scheduler sind bewusst nicht aktiv.
- **Sicherheits- und Feature-Gates:** SSO-Mitgliedschaften, Rollenverwaltung, Wissensfreigaben, letzter Mandantenadministrator, Ticketmodule, Assets und Pilotabläufe sind serverseitig fail-closed abgesichert. Die iOS-Quellbasis verwendet dieselbe mandantenautorisierte Featureauflösung für Tabs, Deep Links, Scan, Assets, Wissen, Ticketdetails und globale Suche.

## Mobile iOS

- Die Expo-iOS-App besitzt die Bundle-ID `ch.grossict.nextdesk`, den nativen PKCE-SSO-Rückweg `ch.grossict.nextdesk://auth/callback`, SecureStore/Keychain-Sitzungen, optionalen Geräteschutz, Haptik, sichere Fotoanhänge, Entwürfe, Favoriten, Tastaturvermeidung, globale Suche, Wissen, Assets und Scanner.
- Offline werden keine Ticketdetails, Kommunikation, Anfragendendaten, Anhänge, Assets oder Wissensinhalte gespeichert. Ausschliesslich auf iOS kann eine maximal zwölf Stunden alte, verschlüsselte und schreibgeschützte Ticketlisten-Metadatenansicht bei eindeutig erkanntem Offlinezustand erscheinen. Sie wird bei Abmeldung, Benutzerwechsel oder lokaler Bereinigung vollständig gelöscht.
- Der bestätigte letzte TestFlight-Upload vor der aktuellen Quellserie war Build **10015**. Ein neuer beauftragter Produktionsbuild mit automatischer App-Store-Connect-Übermittlung läuft zum Zeitpunkt dieses Dokuments; sein Ergebnis wird erst nach der EAS-Bestätigung als veröffentlicht ausgewiesen.

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
