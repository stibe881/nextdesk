import {
  buildIncidentMessages,
  isRecentIncidentMessage,
  parseIncidentAction,
} from "./incident-messages.ts";

const TENANT = "10000000-0000-4000-8000-000000000001";
const INCIDENT = "20000000-0000-4000-8000-000000000002";
const SERVICE = "30000000-0000-4000-8000-000000000003";
const NOTICE = "40000000-0000-4000-8000-000000000004";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("publishIncidentMessage follows the contract of the incident view", () => {
  const action = parseIncidentAction(
    {
      type: "publishIncidentMessage",
      tenantId: TENANT,
      monitoringIncidentId: INCIDENT.toUpperCase(),
      serviceIds: [SERVICE],
      state: "investigating",
      title: "  Mailserver gestört ",
      body: "Wir untersuchen das Problem.",
    },
    TENANT,
  );
  assert(action?.type === "publishIncidentMessage", "publish not parsed");
  assert(action.monitoringIncidentId === INCIDENT, "incident id not normalized");
  assert(action.title === "Mailserver gestört", "title not trimmed");
  assert(action.publicEnabled === true, "publish must be public by default");
  assert(action.serviceIds.length === 1, "service ids lost");

  for (const invalid of [
    { state: "broken" },
    { title: "x" },
    { body: "" },
    { serviceIds: [SERVICE, SERVICE] },
    { serviceIds: ["not-a-uuid"] },
    { monitoringIncidentId: "nope" },
    { extra: true },
  ]) {
    assert(
      parseIncidentAction(
        {
          type: "publishIncidentMessage",
          tenantId: TENANT,
          monitoringIncidentId: INCIDENT,
          serviceIds: [],
          state: "identified",
          title: "Störung",
          body: "Text der Meldung",
          ...invalid,
        },
        TENANT,
      ) === null,
      `invalid publish accepted: ${JSON.stringify(invalid)}`,
    );
  }
  // Ohne Monitoring-Störung und ohne Dienste ist eine Meldung zulässig.
  assert(
    parseIncidentAction(
      {
        type: "publishIncidentMessage",
        tenantId: TENANT,
        monitoringIncidentId: null,
        serviceIds: [],
        state: "identified",
        title: "Störung",
        body: "Text der Meldung",
        publicEnabled: false,
      },
      TENANT,
    )?.type === "publishIncidentMessage",
    "message without incident rejected",
  );
});

Deno.test("updateIncidentMessage and incidentMessages validate their fields", () => {
  const update = parseIncidentAction(
    {
      type: "updateIncidentMessage",
      tenantId: TENANT,
      messageId: NOTICE,
      state: "resolved",
      body: "Behoben.",
    },
    TENANT,
  );
  assert(update?.type === "updateIncidentMessage", "update not parsed");
  assert(!("title" in update) && !("serviceIds" in update), "absent fields kept");
  assert(
    parseIncidentAction(
      {
        type: "updateIncidentMessage",
        tenantId: TENANT,
        messageId: NOTICE,
        state: "resolved",
        body: "Behoben.",
        title: "",
      },
      TENANT,
    ) === null,
    "empty title accepted",
  );
  assert(
    parseIncidentAction(
      { type: "incidentMessages", tenantId: TENANT, monitoringIncidentId: INCIDENT },
      TENANT,
    )?.type === "incidentMessages",
    "incidentMessages not parsed",
  );
  assert(
    parseIncidentAction({ type: "incidentMessages", tenantId: TENANT }, TENANT) ===
      null,
    "incidentMessages without incident accepted",
  );
});

Deno.test("buildIncidentMessages maps notices, services and the update history", () => {
  const messages = buildIncidentMessages(
    [
      {
        id: NOTICE,
        title: "Mail gestört",
        description: "Behoben.",
        status: "resolved",
        public_enabled: true,
        monitoring_incident_id: INCIDENT,
        starts_at: "2026-11-10T08:00:00Z",
        resolved_at: "2026-11-10T10:00:00Z",
        created_at: "2026-11-10T08:00:00Z",
        updated_at: "2026-11-10T10:00:00Z",
      },
      { id: "kaputt" },
    ],
    [{ notice_id: NOTICE, service_id: SERVICE }],
    [
      {
        id: "50000000-0000-4000-8000-000000000001",
        notice_id: NOTICE,
        status: "investigating",
        title: "Mail gestört",
        body: "Wir untersuchen.",
        created_at: "2026-11-10T08:00:00Z",
      },
      {
        id: "50000000-0000-4000-8000-000000000002",
        notice_id: NOTICE,
        status: "resolved",
        title: "Mail gestört",
        body: "Behoben.",
        created_at: "2026-11-10T10:00:00Z",
      },
    ],
  );
  assert(messages.length === 1, "invalid row not skipped");
  const [message] = messages;
  assert(message.state === "resolved" && message.body === "Behoben.", "fields wrong");
  assert(message.serviceIds[0] === SERVICE, "services missing");
  assert(message.monitoringIncidentId === INCIDENT, "incident missing");
  assert(
    message.updates.length === 2 && message.updates[0].state === "resolved",
    "updates must be newest first",
  );
  const now = Date.parse("2026-11-11T00:00:00Z");
  assert(isRecentIncidentMessage(message, now), "resolved yesterday is recent");
  assert(
    !isRecentIncidentMessage(message, now + 20 * 86_400_000),
    "resolved 3 weeks ago is not recent",
  );
  assert(
    isRecentIncidentMessage({ state: "monitoring", resolvedAt: null }, now),
    "open message must be recent",
  );
});

Deno.test("service status contracts for incident messages, availability and maintenance automation", async () => {
  const [internal, publicSource, migration, mail] = await Promise.all([
    Deno.readTextFile(new URL("./index.ts", import.meta.url)),
    Deno.readTextFile(new URL("../service-status-public/index.ts", import.meta.url)),
    Deno.readTextFile(
      new URL(
        "../../migrations/0312_status_page_services_maintenance.sql",
        import.meta.url,
      ),
    ),
    Deno.readTextFile(
      new URL("../_shared/exchange-mail-processing.ts", import.meta.url),
    ),
  ]);
  for (const required of [
    "await requireIncidentPublisher(context.supabase, action.tenantId)",
    'admin.rpc("save_service_incident_notice"',
    '"service_incident_message.published"',
    "{ data: { messageId } }",
    "{ data: { messages } }",
  ]) {
    assert(internal.includes(required), `service-status lost: ${required}`);
  }
  // Schreibaktionen erst nach Mitgliedschaft und Feature-Prüfung.
  const handler = internal.slice(internal.indexOf("const handler = withSupabase"));
  assert(
    handler.indexOf("await requireAssetFeature(") <
      handler.indexOf("await saveIncidentMessage("),
    "incident writes must follow the feature gate",
  );
  for (const required of [
    '.eq("public_enabled", true)',
    "readPublicIncidents",
    "show_availability",
    "availability90",
  ]) {
    assert(publicSource.includes(required), `public status lost: ${required}`);
  }
  const publicIncidentType = publicSource.slice(
    publicSource.indexOf("type PublicIncident ="),
    publicSource.indexOf("const MAX_PUBLIC_INCIDENTS"),
  );
  for (const forbidden of ["id:", "tenant", "created_by", "monitoring"]) {
    assert(
      !publicIncidentType.includes(forbidden),
      `public incident exposes ${forbidden}`,
    );
  }
  for (const required of [
    "create or replace function public.service_status_maintenance_run(",
    "perform set_config('nextdesk.suppress_status_mail', 'on', true)",
    "and status = 'maintenance';",
    "'nextdesk-service-maintenance'",
    "'*/5 * * * *'",
    "create or replace function public.service_status_availability(",
    "create or replace function public.set_asset_services(",
    "create or replace trigger asset_services_sync_primary",
    "create or replace trigger assets_sync_service_links",
    "mail_messages_status_maintenance_unique",
  ]) {
    assert(migration.includes(required), `migration lost: ${required}`);
  }
  for (const forbidden of [/^\s*drop\s/im, /^\s*delete\s+from\s/im]) {
    // delete nur in Funktionskörpern (eingerückt), keine drop-Anweisungen.
    const topLevel = migration
      .split("\n")
      .filter((line) => !line.startsWith(" "))
      .join("\n");
    assert(!forbidden.test(topLevel), `migration contains ${forbidden}`);
  }
  assert(
    mail.includes("serviceIncidentMailContent") &&
      mail.includes("serviceMaintenanceMailContent"),
    "status mails for incidents and maintenance missing",
  );
});
