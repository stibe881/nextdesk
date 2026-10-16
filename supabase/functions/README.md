# Phase-2 Edge Functions

Die vier Funktionen verwenden die aktuelle `@supabase/server`-Hülle im Modus `auth: 'user'`. `verify_jwt` bleibt in `supabase/config.toml` für jede Funktion aktiviert. Damit akzeptieren sie nur Supabase-User-JWTs auf dem `Authorization`-Header; Publishable- und Secret-Keys dürfen nicht als Bearer-Token verwendet werden.

| Funktion                   | Zweck                                                                                               | Autorisierung                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `create-tenant`            | Legt Mandant, Standardrollen, Abteilungen und Erstadministrator in einer DB-Transaktion an.         | Aktiver Plattformbetreiber mit verifiziertem User-JWT auf `aal2`; der aktuelle MFA-Nachweis wird anschliessend auditierbar gespeichert. |
| `invite-tenant-member`     | Bereitet Einladung vor, versendet die Auth-Einladung und legt eine noch inaktive Mitgliedschaft an. | `user.manage` im Zielmandanten.                                                                                                         |
| `accept-tenant-invitation` | Aktiviert die genau zur aktuellen Benutzer-ID gehörende Einladung und weist die Requester-Rolle zu. | Der eingeladene, authentifizierte Benutzer.                                                                                             |
| `manage-tenant`            | Aktualisiert Einstellungen, Teams, Abteilungsmitgliedschaften oder widerruft eine offene Einladung. | Je nach Aktion `tenant.settings.manage`, `team.manage` oder `department.manage`/`user.manage` im Zielmandanten.                         |

## Erforderliche Secrets und Einstellungen

Supabase stellt `SUPABASE_URL`, Publishable-/Secret-Keys und JWT-Material für die Server-Hülle bereit. Zusätzlich müssen Umgebungswerte gesetzt werden:

- `CORS_ALLOWED_ORIGINS`: kommagetrennte, exakte Web-Origins wie `https://acme.tickethub.ch,https://admin.tickethub.ch`. Ein Wildcard-Origin ist absichtlich nicht vorgesehen.
- `TENANT_INVITATION_REDIRECT_URL`: eine in Supabase Auth erlaubte URL für Einladungslinks. Sie wird nicht aus dem Clientrequest übernommen.

Die Supabase-Redirect-Allowlist enthält Web-, Expo-Development-, EAS-Preview- sowie Produktions-Universal-/App-Link-URLs. Die Funktionen werden erst nach `supabase db push` mit `supabase functions deploy <name>` bereitgestellt. Ein Service-Role-Schlüssel gehört nie in Web- oder Mobile-Bundles.

## Bekannte Betriebsgrenze

Die SQL-Transaktionen sind lokal getestet. Die Funktionen sind ohne verbundenes Supabase-Projekt nicht deployt und noch nicht gegen Supabase Auth oder eine echte Mailzustellung ausgeführt.
