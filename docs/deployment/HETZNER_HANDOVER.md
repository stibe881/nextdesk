# Hetzner-Webhosting-L: Übergabe für TicketHub

**Gewählte Architektur:** React-Web-App und spätere Node-Integrations-API auf Hetzner Webhosting L; Supabase bleibt der Daten-, Authentifizierungs- und RLS-Kern in Zürich.

## Bereits eingerichtet

- GitHub-Deploy-Umgebung: `hetzner-production`
- GitHub Actions Workflow: `.github/workflows/deploy-hetzner.yml`
- SSH-Hostvariable: `www662.your-server.de`
- SSH-Portvariable: `222`
- GitHub-Secrets: `HETZNER_SSH_PRIVATE_KEY` und `HETZNER_SSH_KNOWN_HOSTS`
- Supabase Auth-Redirect-Allowlist: `https://app.nextdesk.ch/`
- Dedizierter öffentlicher Deploy-Schlüssel: [`nextdesk-hetzner-deploy-key.pub`](nextdesk-hetzner-deploy-key.pub)

## Noch einmalig in konsoleH ausführen

1. Im Webhosting-L-Paket die Subdomains anlegen:
   - `app.nextdesk.ch` → Zielverzeichnis `public_html/nextdesk.ch/app`
   - `api.nextdesk.ch` → Zielverzeichnis `public_html/nextdesk.ch/api`
2. Für `app.nextdesk.ch` ein Let's-Encrypt-Zertifikat im **SSL Manager** aktivieren.
3. Unter **Einstellungen → Logindaten → Haupt-FTP-Benutzer → Public SSH Keys** den Inhalt von [`nextdesk-hetzner-deploy-key.pub`](nextdesk-hetzner-deploy-key.pub) hinzufügen.
4. Den **Haupt-FTP-/SSH-Benutzernamen** mitteilen. Kein Passwort senden.

## Was danach automatisiert wird

Nach dem SSH-Benutzernamen setze ich in GitHub die beiden letzten Umgebungsvariablen:

| Variable           | Erwarteter Wert                                         |
| ------------------ | ------------------------------------------------------- |
| `HETZNER_SSH_USER` | Haupt-FTP-/SSH-Benutzername                             |
| `HETZNER_WEB_ROOT` | `/usr/www/users/<benutzer>/public_html/nextdesk.ch/app` |

Danach kann der Workflow **Deploy TicketHub to Hetzner Webhosting L** über GitHub Actions manuell ausgeführt werden. Er prüft TypeScript, erstellt den Vite-Build mit Basis-Pfad `/` und synchronisiert ausschliesslich `apps/web/dist` in das App-Zielverzeichnis.

## Sicherheitsgrenzen

- Der private Deploy-Schlüssel liegt nur als GitHub-Environment-Secret vor; niemals im Repository oder Browser.
- Die Hostidentität ist als `known_hosts`-Secret fest hinterlegt; der Workflow akzeptiert keinen unbekannten SSH-Host.
- `rsync --delete` löscht nur Inhalte im ausdrücklich gesetzten App-Zielverzeichnis. Daher darf `HETZNER_WEB_ROOT` **nicht** auf `public_html` oder den Domain-Stamm gesetzt werden.
- Die künftige Node-Anwendung wird auf der getrennten Subdomain `api.nextdesk.ch` betrieben. Sie erhält Secrets als konsoleH-Umgebungsvariablen, nie über Vite.
