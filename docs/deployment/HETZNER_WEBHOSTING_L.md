# TicketHub auf Hetzner Webhosting L

## Was Webhosting L direkt übernehmen kann

Hetzner Webhosting L kann die React-Weboberfläche ausliefern, eigene Domains und TLS verwalten, SSH-Zugang bereitstellen sowie Node.js-Anwendungen dauerhaft pro Domain betreiben. Node.js wird in konsoleH für eine Domain aktiviert; dabei werden andere Webanwendungen wie PHP oder statisches HTML auf **dieser** Domain deaktiviert. Für TicketHub ist daher eine Trennung in `app.<domain>` für die React-App und `api.<domain>` für ein Node-Backend sinnvoll.[1] [2]

Webhosting L besitzt keinen Root-Zugang und kein Docker. Die vorhandene Supabase-Architektur ist deshalb nicht unverändert auf Webhosting L übertragbar: Sie beruht auf PostgreSQL, datenbankseitigem RLS, PostgreSQL-Funktionen, Supabase Auth, Private Storage, Realtime und Edge Functions. Hetzners Webhosting-Dokumentation nennt Apache, PHP/CGI und optionales Node.js, aber keine selbst verwaltbare PostgreSQL-/Supabase-Laufzeit.[1] [2]

## Zwei gangbare Zielbilder

### Empfohlen: Hetzner für Web und Node-API, Supabase weiterhin als Daten- und Identitätskern

Die React-Anwendung und ein Node-Backend laufen auf Hetzner. Das Backend kapselt alle privilegierten Aktionen, etwa Plattform-Eigentümerverwaltung, GitHub-Deploy-Auslösung und Integrationen. Supabase in Zürich bleibt für PostgreSQL-RLS, Auth und Storage bestehen. Damit bleiben die vorhandenen Migrationen, Berechtigungsmodell und Mandantenisolation nutzbar.

Diese Variante erfüllt **nicht** den Wunsch, jeden Dienst von Supabase zu Hetzner zu verschieben. Sie ist jedoch die einzige Variante, die auf Webhosting L ohne Neuimplementierung des sicherheitskritischen Backends realistisch und risikoarm betrieben werden kann.

### Vollständiger Hetzner-Umzug: Backend neu bauen oder Hetzner-Server einsetzen

Für einen echten Komplettumzug gibt es zwei Untervarianten:

- **Neuimplementierung für Webhosting L:** Node.js-/PHP-API, MySQL-kompatibles Datenmodell, serverseitig erzwungene Berechtigungsschicht, eigenes Auth-System, private Dateispeicherung, Audit, Hintergrundjobs und Realtime-Ersatz. PostgreSQL-RLS und die bestehenden Edge Functions lassen sich nicht direkt übernehmen.
- **Hetzner Cloud-/Managed-Server statt Webhosting L:** Docker-basiertes Setup mit PostgreSQL und gegebenenfalls selbst gehosteten Supabase-Komponenten. Das bewahrt PostgreSQL und erlaubt Jobs, Storage-Adapter sowie eine vollständige API-Laufzeit, erhöht aber Betriebs-, Backup- und Security-Verantwortung.

Für ein mandantenfähiges ITSM-System mit internen Kommentaren, Rollen, Audit und Plattform-Eigentümern ist Webhosting L als alleiniger Backend-Standort nur nach einer vollständigen Backend-Neuentwicklung angemessen.

## Deployment auf Webhosting L

Für die empfohlene Übergangsarchitektur:

1. `app.<domain>` liefert den mit Vite erzeugten statischen Ordner `apps/web/dist` über Apache aus.
2. `api.<domain>` erhält in konsoleH die Node.js-Konfiguration mit einem langlebigen Node-Prozess. Nur diese Subdomain wird für Node.js aktiviert.
3. Der Node-Prozess erhält seine Secrets ausschließlich als konsoleH-Umgebungsvariablen. Dazu zählen Supabase-Service-Role-Key, GitHub-Dispatch-Token, CORS-Origin und E-Mail-/Integrationssecrets. Sie gehören nie in das React-Bundle oder Git.
4. GitHub Actions baut die Website und lädt das Ergebnis per SFTP/SSH auf `app.<domain>` hoch. SSH ist bei Webhosting L verfügbar, läuft über Port `222` und sollte mit einem SSH-Key des Haupt-FTP-Benutzers abgesichert werden.[3]
5. Wiederkehrende, kurze Aufgaben laufen über konsoleH-Cronjobs. Das Mindestintervall beträgt eine Minute; ressourcenintensive Jobs können beendet werden. Dauerhafte Worker, Malware-Scans oder eine Queue gehören daher nicht in Webhosting L.[4]

## GitHub-Update-Button unter Hetzner

Der Button in der Plattform-Eigentümerkonsole bleibt ein serverseitiger Aufruf:

1. Der Plattform-Eigentümer ruft nach MFA eine Node-API-Route auf.
2. Die Node-API prüft Plattformrolle und MFA-Session.
3. Die API triggert mit einem serverseitigen Fine-grained GitHub-Token den Workflow `deploy-pages.yml` oder einen neuen Workflow `deploy-hetzner.yml`.
4. GitHub Actions baut das Projekt und überträgt die Artefakte per SFTP/SSH an Hetzner.
5. Der Backend-Endpunkt protokolliert den Deploy im Plattform-Audit.

Der GitHub-Token wird als Umgebungsvariable der Node-Anwendung gespeichert, nicht in der Plattformkonsole. Der bisherige Supabase-Edge-Function-Entwurf kann dieselbe GitHub-Workflow-Auslösung übernehmen, solange Supabase noch der Backend-Kern bleibt.

## Zugangsdaten und Entscheidung für die Umsetzung

Für eine tatsächliche Hetzner-Bereitstellung werden benötigt:

- Ziel-Domain und gewünschte Subdomains (`app` und optional `api`),
- Zugriff auf konsoleH oder ein temporärer SSH-Key des Haupt-FTP-Benutzers,
- Freigabe der Zielarchitektur: **Übergangsarchitektur mit Supabase** oder **vollständige Backend-Neuentwicklung auf Webhosting L**,
- bei einem GitHub-Deploy: ein Fine-grained Token mit begrenztem Workflow-Dispatch-Recht und ein SSH-/SFTP-Deploy-Key.

## References

[1]: https://docs.hetzner.com/managed/webhosting/overview/ "Hetzner Web hosting S, M, L, XL overview"
[2]: https://docs.hetzner.com/managed/administration-on-konsoleh/nodejs/ "Hetzner Node.js configuration"
[3]: https://docs.hetzner.com/managed/administration-on-konsoleh/access-details/ssh/ "Hetzner SSH access for managed products"
[4]: https://docs.hetzner.com/managed/administration-on-konsoleh/cronmanager/ "Hetzner Cron Job Manager"
