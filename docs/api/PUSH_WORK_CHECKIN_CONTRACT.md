# Vertrag: Push-Arbeitszeit-Check-in (nextDesk)

Stand 18.10.2026. Verbindlich für Datenbank, Edge Function `push-notifications`, iOS-App und Web.

## Anforderung (Nutzerwortlaut sinngemäss)

- Jeden Abend ab 17:00 Uhr erhält niemand mehr Push-Benachrichtigungen.
- Startet man die App ab 06:00 Uhr morgens, fragt sie, ob man eingecheckt werden soll.
- Nach dem Einchecken sind Push-Benachrichtigungen aktiv und werden um 17:00 Uhr automatisch wieder deaktiviert.

## Regeln

- Mandantenkonfiguration im bestehenden `tenant_feature_flags.configuration` der Funktion `notifications.push` (zusätzlich zu `contentLevel`):
  - `checkInRequired` boolean, Standard `true` (gilt auch, wenn der Schlüssel fehlt)
  - `workStartHour` Ganzzahl 0–23, Standard `6`
  - `workEndHour` Ganzzahl 1–24, Standard `17`, muss grösser als `workStartHour` sein
- Zeitzone: `push_preferences.timezone` der Person, sonst `Europe/Zurich`. Ungültige Zeitzone fällt auf `Europe/Zurich` zurück.
- Lokales Datum und lokale Stunde werden in dieser Zeitzone berechnet. Arbeitsfenster: `workStartHour <= lokale Stunde < workEndHour`.
- Push ist für eine Person **aktiv**, wenn `checkInRequired = false` ist, oder wenn das Arbeitsfenster offen ist **und** für das heutige lokale Datum `checked_in_at` gesetzt und `checked_out_at` leer ist.
- Um `workEndHour` endet die Aktivität automatisch (kein Job nötig, reine Zeitprüfung beim Versand). Am nächsten Tag ist ein neuer Check-in nötig.
- Ist Push nicht aktiv, wird der Outbox-Eintrag beim Beanspruchen mit `status = 'skipped'`, `last_error = 'off_shift'` übersprungen. Die In-App-Benachrichtigung bleibt bestehen. Es wird nichts nachgeliefert.
- Einchecken ist nur innerhalb des Arbeitsfensters möglich. Auschecken jederzeit (idempotent). „Heute nicht“ (Ablehnen) unterdrückt die Nachfrage für den heutigen lokalen Tag.
- Testpushes (`sendTest`) bleiben vom Check-in unabhängig.

## Datenbank (Migration `0062_push_work_checkins.sql`)

- Tabelle `public.push_work_checkins`:
  - `tenant_id uuid not null`, `user_id uuid not null`, `work_date date not null`
  - `checked_in_at timestamptz`, `checked_out_at timestamptz`, `declined_at timestamptz`
  - `created_at`, `updated_at` (Trigger `set_updated_at`)
  - Primärschlüssel `(tenant_id, user_id, work_date)`
  - Fremdschlüssel `(tenant_id, user_id)` → `public.tenant_memberships (tenant_id, user_id)` `on delete cascade`
  - RLS aktiviert **und erzwungen**. Policy: `authenticated` darf nur eigene Zeilen lesen (`user_id = auth.uid()`). Schreiben ausschliesslich `service_role`. Keine Rechte für `anon`.
- Funktion `public.push_work_state(p_tenant_id uuid, p_user_id uuid) returns jsonb`, `security definer`, `set search_path = pg_catalog, public, pg_temp`, nur `service_role` ausführbar. Rückgabe-Schlüssel:
  `required, startHour, endHour, timezone, localDate (YYYY-MM-DD), localHour, withinWindow, checkedInAt, checkedOutAt, declinedAt, checkedIn (checked_in_at gesetzt und checked_out_at leer), active`.
- `public.push_claim_outbox(integer)` wird per `create or replace` 1:1 übernommen und nur um diesen Block ergänzt (nach der Geräteprüfung, vor der Ruhezeitberechnung):
  wenn `coalesce((public.push_work_state(v_row.tenant_id, v_row.user_id) ->> 'active')::boolean, false)` nicht wahr ist → `skipped`/`off_shift`, `continue`. Fehler in `push_work_state` gelten als nicht aktiv (fail-closed).
- `push_outbox.last_error` muss `off_shift` zulassen (aktuelles Constraint: Länge 1–200, passt).

## Edge Function `push-notifications` (bestehend, erweitern)

Typ `WorkHours` (camelCase, in allen Antworten identisch):

```ts
type WorkHours = {
  required: boolean;
  startHour: number;
  endHour: number;
  timezone: string;
  localDate: string;
  withinWindow: boolean;
  checkedIn: boolean;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  declinedAt: string | null;
  active: boolean;
  promptDue: boolean;
};
```

`promptDue = featureEnabled && required && withinWindow && checkedInAt === null && declinedAt === null && (Anzahl aktiver Geräte der Person) > 0`.

- `getStatus` → zusätzlich `data.workHours: WorkHours`.
- Neu `{ type: "checkIn", tenantId }` → `requireFeature`; wenn nicht erforderlich `409 check_in_not_required`; ausserhalb Fenster `409 outside_work_hours`; Upsert der heutigen Zeile mit `checked_in_at = now()`, `checked_out_at = null`, `declined_at = null`. Antwort `{ data: { workHours } }`.
- Neu `{ type: "checkOut", tenantId }` → `requireFeature`; setzt `checked_out_at = now()` auf der heutigen Zeile, falls eingecheckt; sonst unverändert. Antwort `{ data: { workHours } }`.
- Neu `{ type: "declineCheckIn", tenantId }` → `requireFeature`; setzt `declined_at = now()` auf der heutigen Zeile, nur wenn nicht eingecheckt (Zeile ggf. anlegen). Antwort `{ data: { workHours } }`.
- `getTenantSettings` → zusätzlich `data.workHours: { checkInRequired, workStartHour, workEndHour }`.
- `updateTenantSettings` → `contentLevel` bleibt Pflicht; optional `checkInRequired` (boolean), `workStartHour`, `workEndHour` (Ganzzahlen, Regeln oben; ungültig `400 invalid_request`). Die Konfiguration wird **zusammengeführt**, nicht ersetzt. Audit-Metadaten enthalten die neuen Werte. Antwort `{ data: { contentLevel, workHours: { checkInRequired, workStartHour, workEndHour } } }`.
- Mitgliedschaftsprüfung wie bisher; Check-in-Aktionen betreffen ausschliesslich die handelnde Person.

## iOS-App

- Komponente `components/push-checkin-prompt.tsx`, eingebunden im angemeldeten Tab-Layout `app/(tabs)/_layout.tsx` (nicht im Root-Layout, Anmeldung unverändert lassen).
- Beim Start und bei jedem Wechsel in den Vordergrund (höchstens einmal pro Minute) `getStatus` laden; anzeigen, wenn `workHours.promptDue` wahr ist **und** dieses Gerät für Push registriert ist.
- Darstellung als eigene, absolut positionierte Abdeckfläche mit Karte (kein `react-native` `Modal`), Theme-Farben über die vorhandenen Theme-Hooks (keine hartcodierten Farben), Haptik wie im Rest der App.
  - Titel „Guten Morgen“ bzw. tageszeitabhängig „Einchecken?“; Text „Möchtest du dich einchecken? Dann erhältst du heute bis 17:00 Uhr Push-Benachrichtigungen.“ (Uhrzeit aus `endHour`).
  - Primär „Einchecken“, sekundär „Heute nicht“.
- Einstellungen `app/notifications.tsx`: Abschnitt „Arbeitszeit“ mit Status („Eingecheckt – Push aktiv bis 17:00 Uhr“, „Nicht eingecheckt“, „Ausserhalb der Arbeitszeit (06:00–17:00 Uhr)“) und Knopf „Einchecken“ bzw. „Auschecken“.
- Fehlermeldungen `outside_work_hours`, `check_in_not_required` in `lib/nextdesk-error-messages.ts` deutsch übersetzen.

## Web

- Mandantenadministration, Bereich Push: Schalter „Check-in für Push erforderlich“ sowie Auswahl Beginn/Ende (volle Stunden), Speichern über `updateTenantSettings`.
- Persönliche Einstellungen, Bereich Push-Geräte: heutiger Status und Knöpfe „Einchecken“/„Auschecken“.

## Sprache

Deutsch, Schweizer Schreibweise (kein ß), korrekte Umlaute. Produktname nextDesk.
