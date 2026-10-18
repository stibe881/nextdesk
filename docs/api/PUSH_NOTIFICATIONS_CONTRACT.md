# Push-Benachrichtigungen – Vertrag (Stand 18.10.2026)

Dieser Vertrag ist verbindlich für Datenbank (Migration `0060_push_notifications.sql`), Edge Functions (`push-notifications`, `push-dispatch`, `_shared/apns.ts`), die iOS-App (`/home/ubuntu/nextdeskios`) und das Web (`apps/web`).

## Grundsätze

- Zustellung **direkt über Apple Push Notification service (APNs)** mit Token-Authentifizierung (ES256-JWT aus einem `.p8`-Schlüssel). Kein Expo Push Service, kein weiterer Drittanbieter. Einziger zusätzlicher Empfänger von Push-Inhalten ist Apple.
- Fail-closed: Mandanten-Feature `notifications.push` (Katalogeintrag, `default_enabled = false`, für alle bestehenden Mandanten deaktiviert angelegt). Ohne aktives Feature werden weder Geräte registriert noch Pushes eingereiht oder gesendet. Die Abmeldung eines Geräts ist immer erlaubt.
- Datensparsam: Push-Texte enthalten standardmässig nur Ereignisart und bei ticketgebundenen Benachrichtigungen die Ticketnummer, nie Nachrichtentexte, Beschreibungen, Namen oder E-Mail-Adressen. Der Ticketbetreff erscheint nur, wenn der Mandant `contentLevel = "subject"` gewählt hat.
- Der Versand bleibt ereignisgetrieben (Datenbank-Trigger → `pg_net` → `push-dispatch`). Fällige Wiedervorlagen werden zusätzlich jede Minute durch `pg_cron` in In-App-Benachrichtigungen überführt. Fehlgeschlagene Sendungen werden beim nächsten Ereignis höchstens bis zu drei Versuche erneut versucht.
- Selbstauslösung wird nie gemeldet (Akteur = Empfänger → keine Benachrichtigung).
- Die In-App-Benachrichtigungen (`public.ticket_notifications`) bleiben die Quelle. Jeder Push gehört zu genau einer In-App-Benachrichtigung.

## APNs-Secrets (nur in Supabase Edge-Function-Secrets, nie in Git/Chat)

| Secret             | Inhalt                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `APNS_KEY_ID`      | Key ID des APNs-Schlüssels (10 Zeichen)                                                                                                     |
| `APNS_TEAM_ID`     | Apple Developer Team ID (10 Zeichen)                                                                                                        |
| `APNS_PRIVATE_KEY` | Vollständiger Inhalt der `.p8`-Datei inklusive `-----BEGIN PRIVATE KEY-----`/`-----END PRIVATE KEY-----` (Zeilenumbrüche oder `\n` erlaubt) |

Bundle-ID / `apns-topic`: `ch.grossict.nextdesk`. Hosts: `production` → `https://api.push.apple.com`, `development` → `https://api.sandbox.push.apple.com`. TestFlight und App Store verwenden `production`.

## Benachrichtigungsarten (In-App `kind`) und Push-Kategorien

| `ticket_notifications.kind`            | Push-Kategorie    | Empfänger                                                                                                         | Auslöser                                                                                                      |
| -------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ticket.assigned`                      | `assigned`        | neu zugewiesener Agent                                                                                            | `tickets` INSERT mit Agent oder UPDATE von `assigned_agent_id` auf einen anderen, nicht leeren Wert           |
| `ticket.requester_reply`               | `requester_reply` | zugewiesener Agent                                                                                                | `ticket_comments` INSERT, `visibility = 'external'`, Autor ist `null`, `requester_id` oder `affected_user_id` |
| `ticket.support_reply`                 | `support_reply`   | `requester_id` (falls Konto und aktives Mitglied)                                                                 | `ticket_comments` INSERT, `visibility = 'external'`, Autor ist nicht die anfragende/betroffene Person         |
| `ticket.mention`                       | `mention`         | `mentioned_user_id`                                                                                               | `ticket_mentions` INSERT                                                                                      |
| `ticket.resolved`                      | `resolved`        | `requester_id`                                                                                                    | `tickets` UPDATE, `resolved_at` wechselt von `null` auf einen Wert                                            |
| `ticket.approval.requested`            | `approval`        | aktive Mitglieder mit `ticket.approval.decide` für Mandant/Abteilung des Tickets, ohne Anfragesteller, maximal 25 | `ticket_approval_requests` INSERT mit offenem Status                                                          |
| `ticket.escalation_opened` (bestehend) | `escalation`      | bestehende Logik                                                                                                  | bestehend                                                                                                     |
| `ticket.sla.*` (bestehend)             | `sla`             | bestehende Logik                                                                                                  | bestehend                                                                                                     |
| `ticket.follow_up_due`                 | `follow_up`       | Eigentümer der aktiven, ticketgebundenen Wiedervorlage                                                            | `nextdesk-follow-up-reminders` bei Fälligkeit, höchstens einmal                                               |

In-App-`payload` enthält höchstens `ticketNumber` sowie technische IDs (z. B. `commentId`, `approvalId`). `ticket.follow_up_due` enthält zusätzlich `followUpId`, `title` und `dueAt`; Titel und Fälligkeit bleiben innerhalb von nextDesk und gelangen nicht in die APNs-Nutzlast.

Agentenkategorien: `assigned`, `requester_reply`, `mention`, `sla`, `escalation`, `approval`, `follow_up`. Anfragendenkategorien: `support_reply`, `resolved`, `approval`. Der Server liefert pro Person `applicableCategories` (Agent = Person besitzt im Mandanten mindestens eine Agentenberechtigung wie `ticket.read.assigned` oder `ticket.read.department`, sonst Anfragendenkategorien).

## Datenmodell (Migrationen 0060 und 0063)

- `public.push_devices` – `id`, `tenant_id`, `user_id`, `platform` (`ios`), `apns_token` (hex, eindeutig über alle Zeilen; eine Registrierung übernimmt den Token), `apns_environment` (`production`/`development`), `app_version`, `app_build`, `device_name` (max. 80, nur Modellbezeichnung), `enabled`, `disabled_reason`, `last_registered_at`, `last_sent_at`, `created_at`, `updated_at`. RLS: Lesen nur eigene Zeilen als aktives Mitglied; keine direkten Schreibrechte für `anon`/`authenticated`.
- `public.push_preferences` – PK (`tenant_id`, `user_id`), `enabled_categories text[]` (Standard: alle neun Kategorien), `quiet_hours_enabled` (Standard `false`), `quiet_start smallint` (Stunde 0–23, Standard 22), `quiet_end smallint` (Standard 7), `timezone` (Standard `Europe/Zurich`), `last_test_at`, `updated_at`. RLS: Lesen nur eigene Zeile; Schreiben nur über Function.
- `public.push_outbox` – `id`, `tenant_id`, `user_id`, `notification_id` (eindeutig, FK `ticket_notifications` cascade), `status` (`pending`/`sending`/`sent`/`failed`/`skipped`), `attempts`, `last_error` (nur Code, max. 200), `created_at`, `claimed_at`, `sent_at`. RLS aktiv, keine Policies (nur Service).
- Privates Schema `push_private` mit Singleton `dispatch_config` (`dispatch_secret`, zufällig bei Anwendung erzeugt, nie in Git; `function_url`). Keine Rechte für `anon`/`authenticated`.
- Mandanteneinstellung in `tenant_features.configuration` des Features `notifications.push`: `{ "contentLevel": "minimal" | "subject" }`, Standard `minimal`.
- Trigger auf `ticket_notifications` INSERT reiht nur ein, wenn Feature aktiv (fail-closed, identische Semantik wie `_shared/tenant-features.ts` inklusive Pilotablauf), Empfänger aktives Mitglied, mindestens ein aktives Gerät im Mandanten und Kategorie in den Präferenzen aktiv. Ein Statement-Trigger auf `push_outbox` ruft pro Statement einmal `net.http_post` auf `push-dispatch` mit Header `x-nextdesk-push-secret` auf. Fehlt `pg_net` (lokale Tests), wird kein Aufruf ausgeführt und nichts schlägt fehl.
- Benachrichtigungs-Trigger dürfen die eigentliche Ticketoperation nie zum Scheitern bringen.
- RPCs nur für `service_role`: `push_verify_dispatch_secret(text)`, `push_claim_outbox(int)` (FOR UPDATE SKIP LOCKED, holt `pending` und über fünf Minuten alte `sending`, Versuche < 3, prüft Mitgliedschaft und Feature beim Versand erneut, liefert Ticketnummer, optional Betreff, aktive Geräte und Ruhezeitstatus).

## Fällige Wiedervorlagen (Migration 0063)

- `experience_follow_ups.reminder_sent_at` verhindert doppelte Erinnerungen. Eine Änderung von `due_at` oder das Wiedereröffnen einer erledigten Wiedervorlage setzt den Wert zurück.
- Der idempotente `pg_cron`-Auftrag `nextdesk-follow-up-reminders` führt jede Minute `select public.follow_up_send_due_reminders();` aus. Ohne verfügbares oder erlaubtes `pg_cron` bleibt die Migration anwendbar.
- Die Funktion verarbeitet höchstens 500 fällige, offene Wiedervorlagen mit `FOR UPDATE SKIP LOCKED`. Einträge, die länger als 24 Stunden überfällig sind, sowie ticketlose Wiedervorlagen werden ohne Benachrichtigung als verarbeitet markiert. Nur ticketgebundene Einträge erzeugen `ticket.follow_up_due`; die bestehende Push-Pipeline prüft weiterhin Mitgliedschaft, Feature, Gerät, Kategorie, Arbeitszeit und Ruhezeit.

## Edge Function `push-notifications` (angemeldet, CORS wie bestehende Functions)

Alle Anfragen: `POST`, JSON `{ "type": ..., ... }`, unbekannte Felder → 400. Antworten `{ data }` oder `{ error: { code } }`.

| `type`                 | Felder                                                                                                         | Antwort `data`                                                                                                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getStatus`            | `tenantId`                                                                                                     | `{ featureEnabled, apnsConfigured, contentLevel, applicableCategories: string[], preferences: { enabledCategories, quietHoursEnabled, quietStart, quietEnd, timezone }, devices: [{ id, deviceName, appVersion, appBuild, enabled, disabledReason, lastRegisteredAt, lastSentAt }] }` |
| `registerDevice`       | `tenantId`, `token` (hex 64–200), `environment`, `appVersion?`, `appBuild?`, `deviceName?`                     | `{ device }` – verlangt aktives Feature; übernimmt einen bestehenden Token; höchstens zehn Geräte pro Person und Mandant (ältestes entfällt)                                                                                                                                          |
| `unregisterDevice`     | `tenantId` und entweder `token` oder `deviceId`                                                                | `{ removed: boolean }` – immer erlaubt, nur eigene Geräte                                                                                                                                                                                                                             |
| `updatePreferences`    | `tenantId`, `enabledCategories`, `quietHoursEnabled`, `quietStart`, `quietEnd`, `timezone` (gültige IANA-Zone) | `{ preferences }`                                                                                                                                                                                                                                                                     |
| `sendTest`             | `tenantId`                                                                                                     | `{ results: [{ deviceId, status: "sent" \| "failed" \| "disabled", code? }] }` – höchstens einmal pro 60 Sekunden; erzeugt keine In-App-Benachrichtigung                                                                                                                              |
| `getTenantSettings`    | `tenantId`                                                                                                     | `{ featureEnabled, apnsConfigured, contentLevel, registeredDevices: number }` – nur Mandantenadministration                                                                                                                                                                           |
| `updateTenantSettings` | `tenantId`, `contentLevel`                                                                                     | `{ contentLevel }` – nur Mandantenadministration, auditiert                                                                                                                                                                                                                           |

Fehlercodes u. a.: `invalid_request`, `not_authenticated`, `tenant_access_denied`, `feature_disabled`, `apns_not_configured`, `rate_limited`, `device_not_found`, `forbidden`.

`apnsConfigured` ist nur ein Boolean (Secrets vorhanden und syntaktisch gültig); niemals Werte oder Teile davon ausgeben.

## Edge Function `push-dispatch` (intern)

`verify_jwt = false`; akzeptiert nur `POST` mit gültigem `x-nextdesk-push-secret`. Holt per `push_claim_outbox(50)` ein, sendet je Gerät an APNs und schliesst Zeilen ab: 200 → `sent`; 410 oder 400 `BadDeviceToken`/`DeviceTokenNotForTopic`/`Unregistered` → Gerät deaktivieren; 429/5xx → wieder `pending` bis drei Versuche, dann `failed`; fehlende Secrets → `skipped` (`apns_not_configured`); Ruhezeit → `skipped` (`quiet_hours`). Mehr als drei Einträge derselben Person in einem Durchlauf → ein Sammel-Push.

## APNs-Nutzlast

```json
{
  "aps": {
    "alert": {
      "title": "Ticket zugewiesen",
      "body": "ICT-2026-000002 wurde dir zugewiesen."
    },
    "sound": "default",
    "thread-id": "<ticketId>"
  },
  "body": {
    "nextdeskV": 1,
    "tenantId": "<uuid>",
    "ticketId": "<uuid>",
    "notificationId": "<uuid>",
    "kind": "ticket.assigned"
  }
}
```

Header: `apns-topic: ch.grossict.nextdesk`, `apns-push-type: alert`, `apns-priority: 10`, `apns-expiration` = jetzt + 24 h, `apns-collapse-id` = Notification-ID (max. 64 Byte). Die eigenen Daten stehen unter `body`, damit `expo-notifications` sie als `notification.request.content.data` bereitstellt. Sammel-Push: `body.kind = "summary"`, ohne `ticketId`.

| Kategorie       | Titel                | Text (minimal)                                         | Text mit Betreff                                     |
| --------------- | -------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| assigned        | Ticket zugewiesen    | `{nr}` wurde dir zugewiesen.                           | `{nr}` wurde dir zugewiesen: `{betreff}`             |
| requester_reply | Neue Nachricht       | Neue Antwort der anfragenden Person in `{nr}`.         | … in `{nr}`: `{betreff}`                             |
| support_reply   | Antwort vom Support  | Es gibt eine neue Antwort zu deinem Ticket `{nr}`.     | … `{nr}`: `{betreff}`                                |
| mention         | Du wurdest erwähnt   | Du wurdest in `{nr}` in einer internen Notiz erwähnt.  | … `{nr}`: `{betreff}`                                |
| resolved        | Ticket gelöst        | `{nr}` wurde gelöst. Bitte bestätige die Lösung.       | `{nr}` wurde gelöst: `{betreff}`                     |
| approval        | Freigabe benötigt    | Für `{nr}` wird deine Freigabe benötigt.               | … `{nr}`: `{betreff}`                                |
| escalation      | Ticket eskaliert     | `{nr}` wurde eskaliert.                                | `{nr}` wurde eskaliert: `{betreff}`                  |
| sla             | SLA-Hinweis          | Für `{nr}` ist eine SLA-Frist betroffen.               | … `{nr}`: `{betreff}`                                |
| follow_up       | Wiedervorlage fällig | Eine Wiedervorlage ist fällig.                         | Eine Wiedervorlage zu `{nr}` ist fällig: `{betreff}` |
| summary         | nextDesk             | `{n}` neue Hinweise zu deinen Tickets.                 | gleich                                               |
| test            | nextDesk             | Testmitteilung: Push-Benachrichtigungen funktionieren. | gleich                                               |

Betreff im Push höchstens 80 Zeichen, sonst gekürzt mit „…“.

## iOS-App

- Plugin `expo-notifications` mit `mode: "production"` in `app.config.ts` (die Berechtigung `aps-environment` ist bereits signiert vorhanden).
- Einstellungen nur über Home → Profil → „Benachrichtigungen“ (kein neuer Tab). Hauptschalter, Status, Kategorien gemäss `applicableCategories`, Ruhezeit (volle Stunden), „Testmitteilung senden“.
- Registrierung nur nach aktivem Einschalten durch die Person (iOS-Berechtigungsdialog erst dann). Token über `Notifications.getDevicePushTokenAsync()`; Token-Wechsel neu registrieren.
- Antippen: Daten aus `content.data`, Rückfall `trigger.payload.body`; nur bei aktiver Sitzung und passendem Mandanten zu `/ticket/<ticketId>` navigieren, sonst nichts tun; In-App-Benachrichtigung über `notification-center` `markRead` als gelesen markieren. Kaltstart über `getLastNotificationResponseAsync`.
- Abmeldung: Gerät best effort mit Zeitlimit abmelden; die Abmeldung darf dadurch nie blockieren. Anmeldung, SSO, PKCE und Keychain-Logik bleiben unverändert.
- Feature-Gate `notifications.push` über `tenant-feature-flags` (fail-closed).

## Web

- Mandanteneinstellungen → Funktionsschalter „Push-Benachrichtigungen“: direkt dort Inhaltsstufe (Nur Ticketnummer – empfohlen / Ticketnummer und Betreff), APNs-Status, Anzahl registrierter Geräte, Hinweis zum Datenfluss über Apple.
- Benachrichtigungszentrale: deutsche Bezeichnungen für alle Arten oben, Klick öffnet das Ticket.
- Persönliche Einstellungen: Liste der eigenen registrierten iOS-Geräte mit Entfernen.
