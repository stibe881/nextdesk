# Hosting und Deployment

## Zielumgebung

Die React-Webanwendung wird als statischer Vite-Build auf einem HTTPS-fähigen Hosting betrieben. Supabase übernimmt PostgreSQL, Auth, Storage, Realtime und Edge Functions in `eu-central-2`. Ein Edge-/Reverse-Proxy vor dem statischen Hosting ist für verifizierte Kundendomains, automatische Zertifikate, sichere Redirects, Rate Limiting und Hostname-Validierung vorgesehen. Im MVP sind nur kontrollierte Subdomains unter der Betreiber-Domain aktiv; Custom Domains folgen nach der Verifikations- und Zertifikatsimplementierung.

## Umgebungen

Es gibt drei getrennte Supabase-Projekte und eigene Konfigurationen: `development`, `staging` und `production`. Produktion enthält keine Testmandanten. Jede Umgebung besitzt getrennte Auth-Redirects, Buckets, Secrets, Push-Credentials, Graph-App-Registrierungen und Mailverbindungen.

## CI/CD

Pull Requests führen mindestens Dependency-Install, Formatprüfung, TypeScript-Check, Unit-Tests, Migration-Lint und später RLS-/API-/E2E-Tests aus. Ein Merge nach `main` liefert Staging; ein getaggtes, freigegebenes Release promotet gezielt nach Produktion. Datenbankmigrationen werden vor dem Web-Deploy in einer kontrollierten Reihenfolge angewendet. Rücknahmen erfolgen als Vorwärtsmigration oder als zuvor getesteter Restore, nicht durch unkontrolliertes Löschen von Produktionsdaten.

## Hetzner Webhosting L

Die gewählte Übergangsarchitektur stellt die Vite-Web-App auf Hetzner Webhosting L bereit; Supabase in `eu-central-2` bleibt für PostgreSQL-RLS, Auth, Storage, Realtime und Edge Functions zuständig. Der manuelle Workflow [`.github/workflows/deploy-hetzner.yml`](.github/workflows/deploy-hetzner.yml) baut mit Basis-Pfad `/` und lädt ausschliesslich `apps/web/dist` per SSH auf die konfigurierte Zielsubdomain. Der SSH-Port ist bei konsoleH `222`; Host, Benutzer, Zielpfad, privater Deploy-Key und der verifizierte `known_hosts`-Eintrag liegen ausschliesslich als GitHub-Variablen beziehungsweise -Secrets vor.

Vor der Umschaltung werden DNS und TLS der Zielsubdomain eingerichtet und die Site-URL sowie Redirect-Allowlist des Supabase-Projekts auf diese Domain ergänzt. Eine spätere Node.js-Anwendung auf einer getrennten `api.<domain>`-Subdomain kapselt nur serverseitige Integrationen; sie erhält keine Datenbank- oder GitHub-Geheimnisse im Browser. Das vollständige Entscheidungspapier liegt unter [`docs/deployment/HETZNER_WEBHOSTING_L.md`](docs/deployment/HETZNER_WEBHOSTING_L.md).

## Bisheriges Dashboard auf GitHub Pages

Die aktuelle öffentliche Operationsübersicht wird statisch über GitHub Pages unter `https://stibe881.github.io/nextdesk/` ausgeliefert. Der Workflow [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) baut bei jedem Push auf `main` mit `pnpm --filter @nextdesk/web build:pages`, lädt ausschliesslich `apps/web/dist` als Artefakt hoch und veröffentlicht dieses über die offizielle Pages-Deployment-Action.

Der Pages-Build verwendet bewusst den Basis-Pfad `/nextdesk/`. Die statische Website enthält weder eine Service-Role noch andere geheime Werte. Solange keine browser-sicheren Publishable-Supabase-Werte in einer geeigneten Build-Umgebung gesetzt sind, bleibt der sichtbare Offline-Preview-Hinweis aktiv. GitHub Pages ersetzt keine produktive Auth-, API-, Storage- oder Realtime-Laufzeit; diese Komponenten verbleiben bei Supabase beziehungsweise einem späteren kontrollierten Hosting.

## Mobile-Auslieferung

EAS Build, EAS Submit und EAS Update werden erst konfiguriert, wenn die Expo-App vorhanden ist. EAS Update ist auf JavaScript- und Asset-Änderungen begrenzt, die mit dem vorhandenen nativen Runtime-Build kompatibel sind. Änderungen an nativen Modulen, Berechtigungen oder App-Konfigurationen erzwingen neue iOS-/Android-Builds. TestFlight und Google Play Testing sind verpflichtende Vorstufen.

## Hintergrundaufgaben und Observability

Geplante Aufgaben dürfen nicht von einem statischen Hostingprozess abhängen. Job-Ausführung benötigt einen Scheduler oder serverlose Trigger, eine idempotente Datenbank-Queue und Dead-Letter-/Retry-Information. Logs verknüpfen Request-ID, Mandant, Funktion und Audit-Event, ohne Ticketinhalte oder Tokens ungeschützt abzulegen. Monitoring überwacht Auth-Fehler, Migrationen, Function-Fehler, Warteschlangen, Storage, API-Rate, TLS-Domains und Backup-Ergebnisse.

## Backup und Recovery

Vor Produktionsfreigabe werden RPO und RTO mit dem tatsächlichen Supabase-Plan festgelegt. Das Runbook umfasst PostgreSQL/PITR, Storage-Sicherung, Secret-/Konfigurationsinventar, Wiederherstellung in isolierter Umgebung und einen nachweisbaren Recovery-Test. Bis diese Werte vereinbart und getestet sind, besitzt die Plattform keine Produktivfreigabe.
