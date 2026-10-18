# API-Vertrag: Agentenwerkbank und Anfragendenportal

**Stand:** Welle 4
**Produkt:** nextDesk  
**Endpunkte:** `POST /functions/v1/agent-workbench` und `POST /functions/v1/requester-portal`

Dieser Vertrag beschreibt ausschliesslich mandantenlokale Funktionen. Beide Endpunkte verwenden `withSupabase` mit Benutzeranmeldung. Es werden **keine** externen Provider, E-Mails, Push-Nachrichten, Webhooks, Scheduler oder KI-Aufrufe ausgelöst.

## Gemeinsamer Transportvertrag

- `Content-Type` muss `application/json` sein; die maximale Request-Grösse beträgt **64 KiB**.
- `tenantId` ist immer eine UUID. Eine aktive Mitgliedschaft im aktiven Mandanten wird serverseitig geprüft. Fehler oder unvollständige Feature-Informationen sind **fail-closed**.
- CORS wird ausschliesslich für `https://app.nextdesk.ch` ausgegeben. Aufrufe ohne `Origin` sind zulässig; eine andere vorhandene Origin erhält `403`.
- Antworten haben den Umschlag `{ data: ... }`; Fehler haben `{ error: { code, message } }`.
- IDs sind UUIDs, Zeitpunkte ISO-8601-Strings mit Zeitzone. Nicht erwähnte Felder in einem Request sind ungültig.

```ts
type ApiError = { error: { code: string; message: string } };
type ApiSuccess<T> = { data: T };
type UUID = string;
type ISODateTime = string;
type IncidentStatus =
  "investigating" | "identified" | "monitoring" | "resolved";
type ReopenStatus = "pending" | "accepted" | "declined";
```

| HTTP | Code                                                                              | Bedeutung                                                                          |
| ---: | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
|  400 | `invalid_request`                                                                 | JSON, Aktion, UUID, Datentyp oder Feldwert ist ungültig.                           |
|  401 | `authentication_required`                                                         | Es liegt keine gültige Benutzeranmeldung vor.                                      |
|  403 | `origin_not_allowed`                                                              | Eine nicht erlaubte Browser-Origin wurde gesendet.                                 |
|  403 | `tenant_membership_required`                                                      | Keine aktive Mitgliedschaft im angegebenen Mandanten.                              |
|  403 | `permission_denied` / `tenant_permission_required` / `ticket_permission_required` | Die erforderliche Berechtigung fehlt.                                              |
|  403 | `agent_ticket_permission_required`                                                | Die Person ist kein Agent mit aktiven Ticketrechten.                               |
|  403 | `agent_workbench_feature_disabled` / `requester_portal_feature_disabled`          | Das jeweilige Feature ist nicht aktiv.                                             |
|  403 | `requester_department_view_feature_disabled`                                      | `requester.department-view` ist für die Abteilungsansicht nicht aktiv.             |
|  403 | `knowledge_base_feature_disabled`                                                 | `knowledge.base` ist für einen Wissensentwurf nicht aktiv.                         |
|  404 | `ticket_not_available`                                                            | Ticket existiert nicht oder ist für die Person nicht verfügbar.                    |
|  404 | `watcher_not_found`                                                               | Die beobachtende Person ist für das eigene Ticket nicht hinterlegt.                |
|  409 | `conflict`                                                                        | Eindeutigkeitskonflikt.                                                            |
|  413 | `request_too_large`                                                               | Request ist grösser als 64 KiB.                                                    |
|  415 | `unsupported_media_type`                                                          | `Content-Type: application/json` fehlt.                                            |
|  422 | `invalid_data` / `inactive_tenant_member`                                         | Eine Datenbankregel lehnt die Daten ab oder die beobachtende Person ist inaktiv.   |
|  500 | `operation_failed` / `invalid_stored_data`                                        | Die Aktion oder die sichere Prüfung gespeicherter Daten ist fehlgeschlagen.        |
|  503 | `authorization_check_failed` / `tenant_feature_lookup_failed`                     | Mitgliedschaft, Berechtigung oder Feature-Gate konnte nicht sicher geprüft werden. |
|  503 | `agent_workbench_not_configured` / `requester_portal_not_configured`              | Die zugehörige Migration ist nicht verfügbar oder inkompatibel.                    |

`405 method_not_allowed` gilt für alle Methoden ausser `POST` und `OPTIONS`.

## `agent-workbench`

**Feature-Gate:** `agent.workbench`  
**Grundberechtigung:** aktive Mandantenmitgliedschaft **und** mindestens ein aktives Ticket-Agentenrecht (`ticket.read.department`, `ticket.read.assigned`, `ticket.update` oder `ticket.internal_notes.read`). Die Prüfung erfolgt serverseitig über `is_tenant_ticket_agent`.

> Alle Vorschläge bleiben Vorschläge: Diese Function weist nie automatisch zu, schliesst nicht, merged nicht, ändert keine Rolle und setzt keinen Agentenstatus. Auch `decideReopenRequest` ändert den Ticketstatus nicht automatisch.

```ts
type Macro = {
  id: UUID;
  name: string;
  template_id: UUID | null;
  response_text: string | null;
  category_id: UUID | null;
  subcategory_id: UUID | null;
  priority_id: UUID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
};
type Mention = {
  id: UUID;
  ticket_id: UUID;
  comment_id: UUID | null;
  mentioned_user_id: UUID;
  author_id: UUID;
  read_at: ISODateTime | null;
  created_at: ISODateTime;
};
type Delegation = {
  id: UUID;
  agent_id: UUID;
  delegate_id: UUID;
  starts_at: ISODateTime;
  ends_at: ISODateTime;
  ended_at: ISODateTime | null;
  note: string | null;
};
type IncidentNotice = {
  id: UUID;
  title: string;
  description: string;
  status: IncidentStatus;
  category_id: UUID | null;
  department_id: UUID | null;
  starts_at: ISODateTime;
  resolved_at: ISODateTime | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
};
type ReopenRequest = {
  id: UUID;
  ticket_id: UUID;
  requested_by: UUID;
  reason: string;
  status: ReopenStatus;
  decided_by: UUID | null;
  decided_at: ISODateTime | null;
  created_at: ISODateTime;
};
type AgentTicketContext = {
  ticket: object;
  requesterTickets: object[];
  assets: object[];
  assetHistory: object[];
  resolutionConfirmations: object[];
  requesterAvailability: string | null;
  watchers: string[];
};
```

| Aktion                     | Request                                                                                                                                                                                                             | Erfolg                                                                                                                                                 | Zusätzliche serverseitige Berechtigung                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listMacros`               | `{ type: "listMacros"; tenantId: UUID }`                                                                                                                                                                            | `200 { data: { macros: Macro[] } }`                                                                                                                    | `ticket.template.manage` als Mandantenrecht                                                                                                           |
| `saveMacro`                | `{ type: "saveMacro"; tenantId: UUID; macroId?: UUID; name: string; responseText?: string \| null; templateId?: UUID \| null; categoryId?: UUID \| null; subcategoryId?: UUID \| null; priorityId?: UUID \| null }` | `201` beim Erstellen, sonst `200`; `{ data: { macro: Macro } }`                                                                                        | `ticket.template.manage`; Status, Schliessen und Zuweisung sind absichtlich nicht möglich                                                             |
| `previewMacro`             | `{ type: "previewMacro"; tenantId: UUID; macroId?: UUID; ticketId?: UUID; responseText?: string \| null; categoryId?: UUID \| null; subcategoryId?: UUID \| null; priorityId?: UUID \| null }`                      | `200 { data: { preview: Pick<Macro, "response_text" \| "category_id" \| "subcategory_id" \| "priority_id">; applied: false } }`                        | Bei `ticketId`: `ticket.update` für dessen Abteilung                                                                                                  |
| `listMentions`             | `{ type: "listMentions"; tenantId: UUID; onlyMine?: boolean }`                                                                                                                                                      | `200 { data: { mentions: Mention[] } }`                                                                                                                | Eigene Erwähnungen; berechtigte Agenten sehen gemäss RLS interne Notizen                                                                              |
| `markMentionRead`          | `{ type: "markMentionRead"; tenantId: UUID; mentionId: UUID }`                                                                                                                                                      | `200 { data: { mention: Pick<Mention, "id" \| "read_at">; changed: boolean } }`                                                                        | Nur die erwähnte Person                                                                                                                               |
| `createMentions`           | `{ type: "createMentions"; tenantId: UUID; ticketId: UUID; commentId: UUID; mentionedUserIds: UUID[] }`                                                                                                             | `201 { data: { mentions: Array<Pick<Mention, "id" \| "mentioned_user_id" \| "created_at">> } }`                                                        | `ticket.internal_notes.read`; Notiz muss intern sein, alle erwähnten Personen müssen aktive Mitglieder desselben Mandanten sein                       |
| `listDelegations`          | `{ type: "listDelegations"; tenantId: UUID; agentId?: UUID }`                                                                                                                                                       | `200 { data: { delegations: Delegation[] } }`                                                                                                          | Eigene Stellvertretungen; fremde Agenten nur mit `ticket.manage`                                                                                      |
| `saveDelegation`           | `{ type: "saveDelegation"; tenantId: UUID; delegationId?: UUID; agentId?: UUID; delegateId: UUID; startsAt: ISODateTime; endsAt: ISODateTime; note?: string \| null }`                                              | `201` beim Erstellen, sonst `200`; `{ data: { delegation: Delegation } }`                                                                              | Eigene Stellvertretung; fremde nur `ticket.manage`; beide Personen aktive Mitglieder, Zeitraum positiv                                                |
| `endDelegation`            | `{ type: "endDelegation"; tenantId: UUID; delegationId: UUID }`                                                                                                                                                     | `200 { data: { delegation: Pick<Delegation, "id" \| "ended_at">; changed: boolean } }`                                                                 | Eigene Stellvertretung oder `ticket.manage`                                                                                                           |
| `suggestAssignees`         | `{ type: "suggestAssignees"; tenantId: UUID; ticketId: UUID }`                                                                                                                                                      | `200 { data: { suggestions: Array<{ userId: UUID; score: number; reasons: string[]; automaticAssignment: false }>; notice: string } }`                 | `ticket.update`; berücksichtigt offene Tickets, Kategorieerfahrung und aktive Abwesenheit/Stellvertretung; weist nie zu                               |
| `teamQueues`               | `{ type: "teamQueues"; tenantId: UUID }`                                                                                                                                                                            | `200 { data: { queues: Array<{ departmentId: UUID; teamId: UUID \| null; openTickets: number }> } }`                                                   | Agentengrundberechtigung                                                                                                                              |
| `myMetrics`                | `{ type: "myMetrics"; tenantId: UUID }`                                                                                                                                                                             | `200 { data: { metrics: { open: number; solvedToday: number; medianFirstResponseMinutes: number \| null; dueFollowUps: number } } }`                   | Nur Kennzahlen der angemeldeten Person                                                                                                                |
| `ticketContext`            | `{ type: "ticketContext"; tenantId: UUID; ticketId: UUID }`                                                                                                                                                         | `200 { data: AgentTicketContext }`                                                                                                                     | `ticket.read.department`; Erreichbarkeit nur der anfragenden Person, Beobachtende nur als Anzeigenamen; alle Abfragen sind tenant- und ticketgebunden |
| `knowledgeDraftFromTicket` | `{ type: "knowledgeDraftFromTicket"; tenantId: UUID; ticketId: UUID; title?: string; body?: string }`                                                                                                               | `201 { data: { article: { id: UUID; title: string; slug: string; status: "review"; current_revision: 1 }; reviewRequested: true; published: false } }` | `ticket.update`, `knowledge.manage` und Feature `knowledge.base`; legt nur internen Entwurf mit Prüfantrag an, nie Veröffentlichung                   |
| `listIncidentNotices`      | `{ type: "listIncidentNotices"; tenantId: UUID }`                                                                                                                                                                   | `200 { data: { notices: IncidentNotice[] } }`                                                                                                          | Agentengrundberechtigung                                                                                                                              |
| `saveIncidentNotice`       | `{ type: "saveIncidentNotice"; tenantId: UUID; noticeId?: UUID; title: string; description: string; status: IncidentStatus; startsAt?: ISODateTime; categoryId?: UUID \| null; departmentId?: UUID \| null }`       | `201` beim Erstellen, sonst `200`; `{ data: { notice: IncidentNotice } }`                                                                              | `ticket.manage`; `resolved_at` wird nur bei `resolved` gesetzt                                                                                        |
| `listReopenRequests`       | `{ type: "listReopenRequests"; tenantId: UUID }`                                                                                                                                                                    | `200 { data: { reopenRequests: ReopenRequest[] } }`                                                                                                    | RLS beschränkt auf betroffene Person oder zuständige Agenten                                                                                          |
| `decideReopenRequest`      | `{ type: "decideReopenRequest"; tenantId: UUID; reopenRequestId: UUID; decision: "accepted" \| "declined" }`                                                                                                        | `200 { data: { reopenRequest: ReopenRequest; ticketReopened: false; notice: string } }`                                                                | `ticket.update` in der Ticketabteilung; einmalige Entscheidung, auditierter Entscheid ohne automatische Statusänderung                                |

Die schreibenden Aktionen `saveMacro`, `markMentionRead`, `createMentions`, `saveDelegation`, `endDelegation`, `knowledgeDraftFromTicket`, `saveIncidentNotice` und `decideReopenRequest` schreiben einen Audit-Eintrag. Tabellenauslöser ergänzen zusätzlich Änderungen der neuen Welle-3-Entitäten.

## `requester-portal`

**Feature-Gate:** `requester.portal`  
**Grundberechtigung:** jede aktive Person im Mandanten. Alle ticketbezogenen Aktionen beschränken sich auf Tickets, bei denen die Person `requester_id` oder `affected_user_id` ist. Interne Notizen und fremde Personen werden nicht exportiert oder angezeigt.

```ts
type PortalIncidentNotice = Pick<
  IncidentNotice,
  | "id"
  | "title"
  | "description"
  | "status"
  | "category_id"
  | "department_id"
  | "starts_at"
  | "resolved_at"
  | "updated_at"
>;
type PublicTimelineItem =
  | { type: "event"; id: UUID; eventType: string; occurredAt: ISODateTime }
  | {
      type: "comment";
      id: UUID;
      body: string;
      occurredAt: ISODateTime;
      authorDisplayName: string | null;
    };
type TicketWatcher = {
  userId: UUID;
  displayName: string | null;
  createdAt: ISODateTime | null;
};
type DepartmentTicket = {
  ticketNumber: string;
  title: string;
  statusLabel: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
};
```

| Aktion                  | Request                                                                            | Erfolg                                                                                                                                                            | Daten- und Berechtigungsgrenze                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeIncidentNotices` | `{ type: "activeIncidentNotices"; tenantId: UUID }`                                | `200 { data: { notices: PortalIncidentNotice[] } }`                                                                                                               | Aktive Mandantenperson; nur nicht aufgelöste, mandantenlokale Meldungen                                                                                                             |
| `myTicketTimeline`      | `{ type: "myTicketTimeline"; tenantId: UUID; ticketId: UUID }`                     | `200 { data: { timeline: PublicTimelineItem[] } }`                                                                                                                | Nur eigenes/betroffenes Ticket; nur externe Kommentare und explizit öffentliche Ereignistypen                                                                                       |
| `slaExpectation`        | `{ type: "slaExpectation"; tenantId: UUID; ticketId: UUID }`                       | `200 { data: { expectation: { responseDueAt: ISODateTime \| null; resolutionDueAt: ISODateTime \| null; message: string } } }`                                    | Nur eigenes/betroffenes Ticket; bei fehlenden SLA-Daten neutrale Meldung                                                                                                            |
| `myDevices`             | `{ type: "myDevices"; tenantId: UUID }`                                            | `200 { data: { devices: object[]; available: boolean } }`                                                                                                         | Nur aktuell eigene Asset-Zuordnungen; bei deaktiviertem `assets.management`: leere Liste und `available: false`                                                                     |
| `myApprovals`           | `{ type: "myApprovals"; tenantId: UUID }`                                          | `200 { data: { approvals: Array<{ id: UUID; ticket_id: UUID; approval_kind: string; reason: string; requested_at: ISODateTime; required_approvals: number }> } }` | Nur eigene offene `ticket_approval_requests`                                                                                                                                        |
| `requestReopen`         | `{ type: "requestReopen"; tenantId: UUID; ticketId: UUID; reason: string }`        | `201 { data: { reopenRequest: Pick<ReopenRequest, "id" \| "ticket_id" \| "reason" \| "status" \| "created_at">; ticketChanged: false } }`                         | Nur eigenes/betroffenes gelöstes oder geschlossenes Ticket; eine offene eigene Anfrage pro Ticket; ändert das Ticket nie                                                            |
| `exportMyData`          | `{ type: "exportMyData"; tenantId: UUID }`                                         | `200 { data: { exportedAt: ISODateTime; profile: object \| null; tickets: object[]; comments: Array<object & { authorDisplayName: string \| null }> } }`          | Nur eigenes Profil, eigene/betroffene Tickets und deren externe Kommentare; keine internen Notizen, E-Mail-Adressen oder fremden Personen ausser Anzeigenamen                       |
| `listTicketWatchers`    | `{ type: "listTicketWatchers"; tenantId: UUID; ticketId: UUID }`                   | `200 { data: { watchers: TicketWatcher[] } }`                                                                                                                     | Nur eigenes/betroffenes Ticket; nur aktive Personen desselben Mandanten                                                                                                             |
| `addTicketWatcher`      | `{ type: "addTicketWatcher"; tenantId: UUID; ticketId: UUID; watcherId: UUID }`    | `201 { data: { watcher: Pick<TicketWatcher, "userId" \| "createdAt"> } }`                                                                                         | Nur eigenes/betroffenes Ticket; die beobachtende Person muss aktiv und im selben Mandanten sein; keine Zuweisung                                                                    |
| `removeTicketWatcher`   | `{ type: "removeTicketWatcher"; tenantId: UUID; ticketId: UUID; watcherId: UUID }` | `200 { data: { removedWatcherId: UUID } }`                                                                                                                        | Nur eigenes/betroffenes Ticket; entfernt nur den Beobachtungseintrag, keine Ticketdaten                                                                                             |
| `searchColleagues`      | `{ type: "searchColleagues"; tenantId: UUID; query: string (2–80 Zeichen) }`       | `200 { data: { people: { userId: UUID; displayName: string }[] } }` (höchstens 20)                                                                                | Nur aktive Personen desselben Mandanten ausser der aufrufenden Person; ausschliesslich Anzeigenamen, keine E-Mail-Adressen, Rollen oder Abteilungen                                 |
| `getMyAvailability`     | `{ type: "getMyAvailability"; tenantId: UUID }`                                    | `200 { data: { availability: string \| null } }`                                                                                                                  | Liest nur die eigene `workspace_preferences.preferences.availability`                                                                                                               |
| `setMyAvailability`     | `{ type: "setMyAvailability"; tenantId: UUID; availability: string \| null }`      | `200 { data: { availability: string \| null } }`                                                                                                                  | Text bis 300 Zeichen; `null` entfernt nur den Schlüssel `availability`, andere Präferenzen bleiben erhalten                                                                         |
| `departmentTickets`     | `{ type: "departmentTickets"; tenantId: UUID }`                                    | `200 { data: { tickets: DepartmentTicket[] } }`                                                                                                                   | Zusätzliches Feature `requester.department-view`; nur die eigene hinterlegte Personenverzeichnis-Abteilung, nur Nummer, Titel, Status-Label sowie Erstell- und Aktualisierungsdatum |

`requestReopen`, `addTicketWatcher` und `removeTicketWatcher` werden in `audit_logs` protokolliert. Die spätere Entscheidung verbleibt bei einem berechtigten Agenten in `agent-workbench:decideReopenRequest`.
