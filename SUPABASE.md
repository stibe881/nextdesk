# Benötigte Supabase-Konfiguration

## Projekte und Region

Es werden getrennte Projekte für Entwicklung, Staging und Produktion in **Central Europe (Zurich), `eu-central-2`** benötigt. Die Region wird beim Anlegen eines Projekts gewählt und vor dem ersten Migration-Deploy verifiziert. Entwicklungsdaten werden niemals in Produktion wiederverwendet.

## Auth

Die Auth-Site-URL, Redirect-Allowlist, E-Mail-Templates, Session-Lebensdauer und MFA-Vorgaben werden pro Umgebung gesetzt. Die Allowlist enthält ausschliesslich kontrollierte Web-Domains, Expo-Development-URLs, EAS-Preview-URLs, Universal Links und Android App Links. Für die veröffentlichte Web-Vorschau ist `https://stibe881.github.io/nextdesk/` als Magic-Link-Redirect einzutragen. Die Vite-Anwendung verwendet ausschliesslich `VITE_SUPABASE_URL` und `VITE_SUPABASE_PUBLISHABLE_KEY`; ein Service-Role-Key ist im Browser verboten. Die SAML-/Entra-Verbindung wird erst nach Wahl des Plans und mit Test-Tenants eingerichtet.

## Datenbank und RLS

`supabase db push` spielt die neun Migrationen in Reihenfolge ein. Danach werden Seedmandanten und die RLS-Suite ausgeführt. Tabellen im `public`-Schema bleiben entweder über RLS geschützt oder für `anon`/`authenticated` explizit gesperrt. Keine Edge Function vertraut einer vom Client übergebenen Mandanten-ID ohne serverseitige Ressourcen- und Rechteprüfung. Die zusätzliche Dashboardmigration legt mandantengebundene Lesepolicies für Status, Prioritäten und Kategorien an, damit ein RLS-autorisierter Ticketdatensatz seine sichtbaren Referenzlabels auflösen kann.

## Storage und Realtime

Vor Anhängen werden private Buckets, Pfadkonventionen, Upload-Policies, Malware-Scan-Gate und signierte Download-URLs angelegt. Realtime wird erst nach Policies und Kanal-Scopes für Mandanten und Tickets freigeschaltet. Beides ist noch nicht implementiert.

## Edge Functions

Die Funktionen `create-tenant`, `invite-tenant-member`, `accept-tenant-invitation` und `manage-tenant` haben `verify_jwt = true`. `create-tenant` verlangt zusätzlich einen `aal2`-User-JWT. `CORS_ALLOWED_ORIGINS` und `TENANT_INVITATION_REDIRECT_URL` sind als Function-Secrets zu setzen. Die detaillierte Bereitstellung steht unter [`supabase/functions/README.md`](supabase/functions/README.md).

## Betriebsfreigabe

Produktivsetzung setzt ein dokumentiertes Backup-/PITR-Konzept, Secrets-Rotation, Monitoring, Audit-Log-Retention, ein Verzeichnis externer Datenübermittlungen und einen bestandenen Recovery-Test voraus.
