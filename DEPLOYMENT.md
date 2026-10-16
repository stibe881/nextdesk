# Hosting und Deployment

## Zielumgebung

Die React-Webanwendung wird als statischer Vite-Build auf einem HTTPS-fähigen Hosting betrieben. Supabase übernimmt PostgreSQL, Auth, Storage, Realtime und Edge Functions in `eu-central-2`. Ein Edge-/Reverse-Proxy vor dem statischen Hosting ist für verifizierte Kundendomains, automatische Zertifikate, sichere Redirects, Rate Limiting und Hostname-Validierung vorgesehen. Im MVP sind nur kontrollierte Subdomains unter der Betreiber-Domain aktiv; Custom Domains folgen nach der Verifikations- und Zertifikatsimplementierung.

## Umgebungen

Es gibt drei getrennte Supabase-Projekte und eigene Konfigurationen: `development`, `staging` und `production`. Produktion enthält keine Testmandanten. Jede Umgebung besitzt getrennte Auth-Redirects, Buckets, Secrets, Push-Credentials, Graph-App-Registrierungen und Mailverbindungen.

## CI/CD

Pull Requests führen mindestens Dependency-Install, Formatprüfung, TypeScript-Check, Unit-Tests, Migration-Lint und später RLS-/API-/E2E-Tests aus. Ein Merge nach `main` liefert Staging; ein getaggtes, freigegebenes Release promotet gezielt nach Produktion. Datenbankmigrationen werden vor dem Web-Deploy in einer kontrollierten Reihenfolge angewendet. Rücknahmen erfolgen als Vorwärtsmigration oder als zuvor getesteter Restore, nicht durch unkontrolliertes Löschen von Produktionsdaten.

## Mobile-Auslieferung

EAS Build, EAS Submit und EAS Update werden erst konfiguriert, wenn die Expo-App vorhanden ist. EAS Update ist auf JavaScript- und Asset-Änderungen begrenzt, die mit dem vorhandenen nativen Runtime-Build kompatibel sind. Änderungen an nativen Modulen, Berechtigungen oder App-Konfigurationen erzwingen neue iOS-/Android-Builds. TestFlight und Google Play Testing sind verpflichtende Vorstufen.

## Hintergrundaufgaben und Observability

Geplante Aufgaben dürfen nicht von einem statischen Hostingprozess abhängen. Job-Ausführung benötigt einen Scheduler oder serverlose Trigger, eine idempotente Datenbank-Queue und Dead-Letter-/Retry-Information. Logs verknüpfen Request-ID, Mandant, Funktion und Audit-Event, ohne Ticketinhalte oder Tokens ungeschützt abzulegen. Monitoring überwacht Auth-Fehler, Migrationen, Function-Fehler, Warteschlangen, Storage, API-Rate, TLS-Domains und Backup-Ergebnisse.

## Backup und Recovery

Vor Produktionsfreigabe werden RPO und RTO mit dem tatsächlichen Supabase-Plan festgelegt. Das Runbook umfasst PostgreSQL/PITR, Storage-Sicherung, Secret-/Konfigurationsinventar, Wiederherstellung in isolierter Umgebung und einen nachweisbaren Recovery-Test. Bis diese Werte vereinbart und getestet sind, besitzt die Plattform keine Produktivfreigabe.
