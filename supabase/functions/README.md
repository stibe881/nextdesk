# Phase-2 Edge Functions

Die vier Funktionen verwenden die aktuelle `@supabase/server`-Hülle im Modus `auth: 'user'`. `verify_jwt` bleibt in `supabase/config.toml` für jede Funktion aktiviert. Damit akzeptieren sie nur Supabase-User-JWTs auf dem `Authorization`-Header; Publishable- und Secret-Keys dürfen nicht als Bearer-Token verwendet werden.

| Funktion                   | Zweck                                                                                               | Autorisierung                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `create-tenant`            | Legt Mandant, Standardrollen, Abteilungen und Erstadministrator in einer DB-Transaktion an.         | Aktiver Plattformbetreiber mit verifiziertem User-JWT auf `aal2`; der aktuelle MFA-Nachweis wird anschliessend auditierbar gespeichert. |
| `invite-tenant-member`     | Bereitet Einladung vor, versendet die Auth-Einladung und legt eine noch inaktive Mitgliedschaft an. | `user.manage` im Zielmandanten.                                                                                                         |
| `accept-tenant-invitation` | Aktiviert die genau zur aktuellen Benutzer-ID gehörende Einladung und weist die Requester-Rolle zu. | Der eingeladene, authentifizierte Benutzer.                                                                                             |
| `manage-tenant`            | Aktualisiert Einstellungen, Teams, Abteilungsmitgliedschaften oder widerruft eine offene Einladung. | Je nach Aktion `tenant.settings.manage`, `team.manage` oder `department.manage`/`user.manage` im Zielmandanten.                         |

## SLA-Automation

`sla-automation` ist ein **nicht öffentlicher, scheduler-geschützter** Hintergrundendpunkt. Er prüft bis zu 100 offene Tickets pro Lauf auf überschrittene Erstreaktions- und Lösungsziele. Für jeden neu erkannten Verstoß schreibt die atomare Datenbankfunktion `apply_sla_breach` genau ein SLA-Ereignis, Timeline-Ereignis, Audit-Ereignis, bei Lösungszielen eine Eskalation sowie eine Benachrichtigung an die zugewiesene Person.

- **Aufruf:** `POST https://<project-ref>.supabase.co/functions/v1/sla-automation`
- **Header:** `X-NextDesk-Automation-Secret: <SLA_AUTOMATION_SECRET>`
- **Body:** `{"dryRun":false,"limit":100}`; mit `dryRun:true` erfolgt keine Änderung.
- **Authentisierung:** `verify_jwt = false` ist absichtlich gesetzt. Der Endpunkt akzeptiert stattdessen ausschließlich das geheime Header-Token und antwortet ohne CORS-Freigabe.
- **Idempotenz:** Migrationen `0028` und `0029` sichern pro Ticket und Breach-Typ eine einmalige, transaktionale Verarbeitung. Ein Cron-Retry erzeugt keine doppelte Eskalation oder Benachrichtigung.

### Produktive Aktivierung

1. In Supabase unter **Edge Functions → Secrets** ein zufälliges Secret als `SLA_AUTOMATION_SECRET` hinterlegen.
2. In Hetzner Webhosting L dasselbe Secret ausschließlich im geschützten Cron-Kontext speichern – nicht in der Website, im Git-Repository oder in einer URL.
3. Einen Cronjob im 5-Minuten-Takt einrichten, der den obigen `POST` mit dem Secret-Header und dem JSON-Body ausführt.
4. Den ersten Aufruf mit `dryRun:true` prüfen, danach einen echten Lauf starten und die erzeugten Audit-Ereignisse validieren.

Bis die zwei Secret-Speicher und der Hetzner-Cronjob eingerichtet sind, antwortet die Funktion absichtlich mit `503 sla_automation_unavailable` und ändert keine Ticketdaten.

## Erforderliche Secrets und Einstellungen

Supabase stellt `SUPABASE_URL`, Publishable-/Secret-Keys und JWT-Material für die Server-Hülle bereit. Zusätzlich müssen Umgebungswerte gesetzt werden:

- `CORS_ALLOWED_ORIGINS`: kommagetrennte, exakte Web-Origins wie `https://acme.tickethub.ch,https://admin.tickethub.ch`. Ein Wildcard-Origin ist absichtlich nicht vorgesehen.
- `TENANT_INVITATION_REDIRECT_URL`: eine in Supabase Auth erlaubte URL für Einladungslinks. Sie wird nicht aus dem Clientrequest übernommen.

Die Supabase-Redirect-Allowlist enthält Web-, Expo-Development-, EAS-Preview- sowie Produktions-Universal-/App-Link-URLs. Die Funktionen werden erst nach `supabase db push` mit `supabase functions deploy <name>` bereitgestellt. Ein Service-Role-Schlüssel gehört nie in Web- oder Mobile-Bundles.

## Bekannte Betriebsgrenze

Die SQL-Transaktionen sind lokal getestet. Die Funktionen sind ohne verbundenes Supabase-Projekt nicht deployt und noch nicht gegen Supabase Auth oder eine echte Mailzustellung ausgeführt.
