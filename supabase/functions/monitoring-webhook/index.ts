import { withSupabase } from "@supabase/server";
import {
  buildEvent,
  classifyStatus,
  type DeviceCandidate,
  externalKey,
  matchDevice,
  MAX_BODY_BYTES,
  opensAlert,
  parseBody,
  parseQuery,
  type PrtgEvent,
  type ServiceStatus,
  shouldComment,
  targetServiceStatus,
  ticketDescription,
  ticketSubject,
  TOKEN_PATTERN,
  updateComment,
} from "./prtg.ts";

/**
 * PRTG monitoring webhook («Execute HTTP Action»).
 *
 * - Deploy with `[functions.monitoring-webhook] verify_jwt = false`: PRTG
 *   cannot send a Supabase JWT. The caller authenticates with the per-tenant
 *   token (`?token=…` or header `x-nextdesk-token`), which is stored only as
 *   SHA-256 hash in `monitoring_integrations.token_hash`.
 * - Down (and Warning if configured) opens one ticket per monitored object,
 *   repeated messages become throttled internal comments, Up resolves the
 *   alert, optionally the ticket, and restores the service status.
 */

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

type Integration = {
  id: string;
  tenant_id: string;
  enabled: boolean;
  department_id: string | null;
  team_id: string | null;
  create_on: "down" | "down_and_warning";
  auto_resolve: boolean;
  set_service_status: boolean;
  priority_key: string | null;
};

type Alert = {
  id: string;
  ticket_id: string | null;
  service_id: string | null;
  service_ids: string[] | null;
  service_statuses: Record<string, string> | null;
  asset_id: string | null;
  last_status: string | null;
  last_comment_at: string | null;
  opened_at: string;
  event_count: number;
  service_status_applied: "degraded" | "partial_outage" | null;
};

const SERVICE_EMAIL = "monitoring-service@app.nextdesk.ch";
const SERVICE_NAME = "nextDesk Monitoring";
const encoder = new TextEncoder();

function reply(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

async function ensureServiceIdentity(admin: Admin): Promise<string> {
  const existing = await admin
    .from("monitoring_service_identity")
    .select("user_id")
    .eq("singleton", true)
    .maybeSingle();
  if (existing.error) throw new Error("service_identity_lookup_failed");
  let userId = asString(existing.data?.user_id);
  if (userId) return userId;

  const created = await admin.auth.admin.createUser({
    email: SERVICE_EMAIL,
    email_confirm: true,
    password: `N!m${crypto.randomUUID()}A`,
    app_metadata: { nextdesk_service_identity: "monitoring" },
    user_metadata: { display_name: SERVICE_NAME },
  });
  userId = asString(created?.data?.user?.id);
  if (!userId) {
    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const found = Array.isArray(users?.data?.users)
      ? users.data.users.find(
          (user: Row) =>
            typeof user?.email === "string" &&
            user.email.toLowerCase() === SERVICE_EMAIL,
        )
      : null;
    userId = asString(found?.id);
  }
  if (!userId) throw new Error("service_identity_create_failed");
  const profile = await admin
    .from("user_profiles")
    .upsert({ id: userId, display_name: SERVICE_NAME }, { onConflict: "id" });
  if (profile.error) throw new Error("service_identity_profile_failed");
  await admin.from("monitoring_service_identity").upsert(
    { singleton: true, user_id: userId },
    {
      onConflict: "singleton",
      ignoreDuplicates: true,
    },
  );
  const stored = await admin
    .from("monitoring_service_identity")
    .select("user_id")
    .eq("singleton", true)
    .maybeSingle();
  const storedId = asString(stored.data?.user_id);
  if (!storedId) throw new Error("service_identity_store_failed");
  return storedId;
}

async function loadDevices(
  admin: Admin,
  tenantId: string,
): Promise<DeviceCandidate[]> {
  const infra = await admin
    .from("asset_infrastructure")
    .select("asset_id, hostname, ip_address, prtg_object_id")
    .eq("tenant_id", tenantId)
    .limit(5000);
  if (infra.error) throw new Error("device_lookup_failed");
  const rows = (infra.data ?? []) as Row[];
  if (!rows.length) return [];
  const assets = await admin
    .from("assets")
    .select("id, name, service_id")
    .eq("tenant_id", tenantId)
    .in(
      "id",
      rows.map((row) => String(row.asset_id)),
    );
  if (assets.error) throw new Error("device_lookup_failed");
  const links = await admin
    .from("asset_services")
    .select("asset_id, service_id")
    .eq("tenant_id", tenantId)
    .limit(20000);
  if (links.error) throw new Error("device_lookup_failed");
  const servicesByAsset = new Map<string, Set<string>>();
  for (const link of (links.data ?? []) as Row[]) {
    const key = String(link.asset_id);
    const set = servicesByAsset.get(key) ?? new Set<string>();
    set.add(String(link.service_id));
    servicesByAsset.set(key, set);
  }
  const byId = new Map(
    ((assets.data ?? []) as Row[]).map((row) => [String(row.id), row]),
  );
  return rows.flatMap((row) => {
    const asset = byId.get(String(row.asset_id));
    if (!asset) return [];
    return [
      {
        assetId: String(asset.id),
        name: String(asset.name ?? ""),
        hostname: asString(row.hostname),
        ipAddress: asString(row.ip_address),
        prtgObjectId: asString(row.prtg_object_id),
        // The primary service plus every additional one of the device.
        serviceIds: [
          ...new Set([
            ...(asString(asset.service_id) ? [asString(asset.service_id)!] : []),
            ...(servicesByAsset.get(String(asset.id)) ?? []),
          ]),
        ],
      },
    ];
  });
}

async function addComment(
  admin: Admin,
  ticketId: string,
  authorId: string,
  body: string,
): Promise<void> {
  const comment = await admin
    .from("ticket_comments")
    .insert({
      ticket_id: ticketId,
      author_id: authorId,
      visibility: "internal",
      body: body.slice(0, 50_000),
    })
    .select("id")
    .single();
  if (comment.error) throw new Error("comment_create_failed");
  await admin.from("ticket_events").insert({
    ticket_id: ticketId,
    actor_id: authorId,
    event_type: "comment.internal_added",
    payload: { source: "monitoring", provider: "prtg" },
  });
}

async function resolvePriority(
  admin: Admin,
  tenantId: string,
  configured: string | null,
): Promise<string | null> {
  const { data, error } = await admin
    .from("ticket_priorities")
    .select("id, key")
    .eq("tenant_id", tenantId);
  if (error) return null;
  const rows = (data ?? []) as Row[];
  for (const key of [configured, "high", "urgent", "normal"]) {
    const found = key ? rows.find((row) => row.key === key) : null;
    if (found) return String(found.id);
  }
  return rows[0] ? String(rows[0].id) : null;
}

/** The configured team with its department, while it is still active. */
async function resolveTeam(
  admin: Admin,
  tenantId: string,
  teamId: string | null,
): Promise<{ id: string; departmentId: string } | null> {
  if (!teamId) return null;
  const { data } = await admin
    .from("teams")
    .select("id, department_id")
    .eq("tenant_id", tenantId)
    .eq("id", teamId)
    .eq("active", true)
    .maybeSingle();
  return data && data.department_id
    ? { id: String(data.id), departmentId: String(data.department_id) }
    : null;
}

async function resolveDepartment(
  admin: Admin,
  tenantId: string,
  departmentId: string | null,
): Promise<{ id: string; key: string } | null> {
  if (departmentId) {
    const { data } = await admin
      .from("departments")
      .select("id, key")
      .eq("tenant_id", tenantId)
      .eq("id", departmentId)
      .eq("active", true)
      .maybeSingle();
    if (data) return { id: String(data.id), key: String(data.key) };
  }
  const { data } = await admin
    .from("departments")
    .select("id, key")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("key")
    .limit(1)
    .maybeSingle();
  return data ? { id: String(data.id), key: String(data.key) } : null;
}

async function createTicket(
  admin: Admin,
  integration: Integration,
  event: PrtgEvent,
  device: DeviceCandidate | null,
  serviceIdentityId: string,
): Promise<string> {
  const tenantId = integration.tenant_id;
  const team = await resolveTeam(admin, tenantId, integration.team_id);
  const [department, status, priorityId] = await Promise.all([
    // The team's department wins: a ticket's team must match its department.
    resolveDepartment(
      admin,
      tenantId,
      team?.departmentId ?? integration.department_id,
    ),
    admin
      .from("ticket_statuses")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("key", "new")
      .maybeSingle(),
    resolvePriority(admin, tenantId, integration.priority_key),
  ]);
  if (!department || status.error || !status.data || !priorityId) {
    throw new Error("ticket_defaults_unavailable");
  }
  const number = await admin.rpc("reserve_ticket_number", {
    p_tenant_id: tenantId,
    p_department_id: department.id,
    p_prefix: department.key.slice(0, 8),
  });
  if (number.error || typeof number.data !== "string") {
    throw new Error("ticket_number_failed");
  }
  const ticket = await admin
    .from("tickets")
    .insert({
      tenant_id: tenantId,
      department_id: department.id,
      assigned_team_id: team && team.departmentId === department.id ? team.id : null,
      ticket_number: number.data,
      subject: ticketSubject(event),
      description: ticketDescription(event, device?.name ?? null),
      status_id: status.data.id,
      priority_id: priorityId,
      requester_id: serviceIdentityId,
      // tickets.source allows portal, email, api, automation, phone.
      source: "automation",
    })
    .select("id, ticket_number")
    .single();
  if (ticket.error || !ticket.data) throw new Error("ticket_create_failed");
  const ticketId = String(ticket.data.id);
  await admin.from("ticket_events").insert({
    ticket_id: ticketId,
    actor_id: serviceIdentityId,
    event_type: "ticket.created",
    payload: { source: "monitoring", provider: "prtg" },
  });
  if (device) {
    await admin.from("ticket_assets").insert({
      tenant_id: tenantId,
      ticket_id: ticketId,
      asset_id: device.assetId,
      linked_by: null,
    });
  }
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: serviceIdentityId,
    action: "monitoring.ticket.created",
    entity_type: "ticket",
    entity_id: ticketId,
    severity: "info",
    metadata: {
      provider: "prtg",
      ticketNumber: ticket.data.ticket_number,
      assetId: device?.assetId ?? null,
    },
  });
  return ticketId;
}

async function applyServiceStatus(
  admin: Admin,
  tenantId: string,
  serviceId: string,
  kind: PrtgEvent["kind"],
): Promise<"degraded" | "partial_outage" | null> {
  const { data, error } = await admin
    .from("services")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("id", serviceId)
    .maybeSingle();
  if (error || !data) return null;
  const target = targetServiceStatus(kind, data.status as ServiceStatus);
  if (!target) return null;
  // The services_status_history trigger records the status event.
  const updated = await admin
    .from("services")
    .update({ status: target })
    .eq("tenant_id", tenantId)
    .eq("id", serviceId)
    .eq("status", data.status);
  return updated.error ? null : target;
}

/** Services of an alert: the stored list, else the legacy single service. */
function alertServiceIds(alert: Alert): string[] {
  const ids = alert.service_ids ?? [];
  return ids.length ? ids : alert.service_id ? [alert.service_id] : [];
}

/** Status monitoring applied per service; the legacy single value is kept. */
function alertServiceStatuses(alert: Alert): Record<string, string> {
  const stored = alert.service_statuses ?? {};
  if (Object.keys(stored).length) return { ...stored };
  return alert.service_id && alert.service_status_applied
    ? { [alert.service_id]: alert.service_status_applied }
    : {};
}

async function applyServiceStatuses(
  admin: Admin,
  tenantId: string,
  serviceIds: string[],
  kind: PrtgEvent["kind"],
  current: Record<string, string>,
): Promise<Record<string, string>> {
  const next = { ...current };
  for (const serviceId of serviceIds) {
    const applied = await applyServiceStatus(admin, tenantId, serviceId, kind);
    if (applied) next[serviceId] = applied;
  }
  return next;
}

async function restoreServiceStatus(
  admin: Admin,
  tenantId: string,
  serviceId: string,
  resolvedAlertId: string,
): Promise<void> {
  const others = await admin
    .from("monitoring_alerts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("state", "open")
    .not(`service_statuses->>${serviceId}`, "is", null)
    .neq("id", resolvedAlertId)
    .limit(1);
  if (others.error || (others.data ?? []).length > 0) return;
  // Only undo what monitoring set; manual outages and maintenance stay.
  await admin
    .from("services")
    .update({ status: "operational" })
    .eq("tenant_id", tenantId)
    .eq("id", serviceId)
    .in("status", ["degraded", "partial_outage"]);
}

async function resolveTicket(
  admin: Admin,
  tenantId: string,
  ticketId: string,
  serviceIdentityId: string,
): Promise<boolean> {
  const [{ data: ticket }, { data: resolved }] = await Promise.all([
    admin
      .from("tickets")
      .select("id, status_id, assigned_agent_id, closed_at")
      .eq("tenant_id", tenantId)
      .eq("id", ticketId)
      .maybeSingle(),
    admin
      .from("ticket_statuses")
      .select("id, key, is_closed")
      .eq("tenant_id", tenantId)
      .eq("key", "resolved")
      .maybeSingle(),
  ]);
  if (!ticket || !resolved || ticket.closed_at) return false;
  if (ticket.status_id === resolved.id) return false;
  const { data: current } = await admin
    .from("ticket_statuses")
    .select("key")
    .eq("id", ticket.status_id)
    .maybeSingle();
  // Status rule: a ticket leaves «Neu» only with an assignee.
  if (current?.key === "new" && !ticket.assigned_agent_id) return false;
  const now = new Date().toISOString();
  const { error } = await admin
    .from("tickets")
    .update({
      status_id: resolved.id,
      closed_at: resolved.is_closed ? now : null,
      resolved_at: now,
      waiting_since: null,
    })
    .eq("tenant_id", tenantId)
    .eq("id", ticketId);
  if (error) return false;
  await admin.from("ticket_events").insert({
    ticket_id: ticketId,
    actor_id: serviceIdentityId,
    event_type: resolved.is_closed ? "ticket.closed" : "ticket.updated",
    payload: {
      changedFields: ["status"],
      source: "monitoring",
      statusTransition: {
        fromStatusId: ticket.status_id,
        toStatusKey: "resolved",
        isClosed: resolved.is_closed === true,
        occurredAt: now,
      },
    },
  });
  return true;
}

async function findOpenAlert(
  admin: Admin,
  tenantId: string,
  key: string,
): Promise<Alert | null> {
  const { data, error } = await admin
    .from("monitoring_alerts")
    .select(
      "id, ticket_id, service_id, service_ids, service_statuses, asset_id, last_status, last_comment_at, opened_at, event_count, service_status_applied",
    )
    .eq("tenant_id", tenantId)
    .eq("external_key", key)
    .eq("state", "open")
    .maybeSingle();
  if (error) throw new Error("alert_lookup_failed");
  return (data as Alert | null) ?? null;
}

export async function processEvent(
  admin: Admin,
  integration: Integration,
  event: PrtgEvent,
): Promise<string> {
  if (event.kind === "ignore") return "ignored";
  const tenantId = integration.tenant_id;
  const key = externalKey(event);
  const now = new Date();
  let alert = await findOpenAlert(admin, tenantId, key);

  if (!alert) {
    if (!opensAlert(event.kind, integration.create_on)) return "ignored";
    const device = matchDevice(event, await loadDevices(admin, tenantId));
    // The alert is claimed first: the partial unique index makes a second,
    // concurrent Down for the same object fall through to the comment path.
    const inserted = await admin
      .from("monitoring_alerts")
      .insert({
        tenant_id: tenantId,
        integration_id: integration.id,
        external_key: key,
        device_name: event.device ?? event.host,
        sensor_name: event.sensor,
        asset_id: device?.assetId ?? null,
        service_id: device?.serviceIds[0] ?? null,
        service_ids: device?.serviceIds ?? [],
        state: "open",
        last_status: event.status.slice(0, 80),
        last_message: event.message,
        opened_at: now.toISOString(),
        last_event_at: now.toISOString(),
      })
      .select("id")
      .single();
    if (inserted.error) {
      if (inserted.error.code !== "23505")
        throw new Error("alert_create_failed");
      alert = await findOpenAlert(admin, tenantId, key);
      if (!alert) return "ignored";
    } else {
      const alertId = String(inserted.data.id);
      let ticketId: string;
      try {
        const serviceIdentityId = await ensureServiceIdentity(admin);
        ticketId = await createTicket(
          admin,
          integration,
          event,
          device,
          serviceIdentityId,
        );
      } catch (failure) {
        // Release the claim so the next Down message retries the ticket.
        await admin
          .from("monitoring_alerts")
          .update({ state: "resolved", resolved_at: now.toISOString() })
          .eq("id", alertId);
        throw failure;
      }
      const statuses = integration.set_service_status
        ? await applyServiceStatuses(
            admin,
            tenantId,
            device?.serviceIds ?? [],
            event.kind,
            {},
          )
        : {};
      await admin
        .from("monitoring_alerts")
        .update({
          ticket_id: ticketId,
          service_statuses: statuses,
          service_status_applied: Object.values(statuses)[0] ?? null,
        })
        .eq("id", alertId);
      return "ticket_created";
    }
  }

  const serviceIdentityId = await ensureServiceIdentity(admin);
  if (event.kind === "up") {
    if (alert.ticket_id) {
      await addComment(
        admin,
        alert.ticket_id,
        serviceIdentityId,
        updateComment(event),
      );
    }
    await admin
      .from("monitoring_alerts")
      .update({
        state: "resolved",
        resolved_at: now.toISOString(),
        last_status: event.status.slice(0, 80),
        last_message: event.message,
        last_event_at: now.toISOString(),
        last_comment_at: now.toISOString(),
        event_count: alert.event_count + 1,
      })
      .eq("id", alert.id);
    if (integration.auto_resolve && alert.ticket_id) {
      await resolveTicket(admin, tenantId, alert.ticket_id, serviceIdentityId);
    }
    for (const serviceId of Object.keys(alertServiceStatuses(alert))) {
      await restoreServiceStatus(admin, tenantId, serviceId, alert.id);
    }
    return "resolved";
  }

  const previousKind = classifyStatus(alert.last_status);
  const comment =
    alert.ticket_id !== null &&
    shouldComment({
      lastCommentAt: alert.last_comment_at,
      openedAt: alert.opened_at,
      previousKind,
      kind: event.kind,
      now: now.getTime(),
    });
  if (comment && alert.ticket_id) {
    await addComment(
      admin,
      alert.ticket_id,
      serviceIdentityId,
      updateComment(event),
    );
  }
  let statuses = alertServiceStatuses(alert);
  if (integration.set_service_status) {
    statuses = await applyServiceStatuses(
      admin,
      tenantId,
      alertServiceIds(alert),
      event.kind,
      statuses,
    );
  }
  await admin
    .from("monitoring_alerts")
    .update({
      last_status: event.status.slice(0, 80),
      last_message: event.message,
      last_event_at: now.toISOString(),
      event_count: alert.event_count + 1,
      service_statuses: statuses,
      service_status_applied: Object.values(statuses)[0] ?? null,
      ...(comment ? { last_comment_at: now.toISOString() } : {}),
    })
    .eq("id", alert.id);
  return comment ? "comment_added" : "updated";
}

function runInBackground(work: Promise<unknown>): boolean {
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === "function") {
    runtime.waitUntil(work);
    return true;
  }
  return false;
}

const handler = withSupabase(
  { auth: "none", cors: "disabled" },
  async (request, context) => {
    if (request.method !== "POST" && request.method !== "GET") {
      return new Response(null, {
        status: 405,
        headers: { Allow: "GET, POST" },
      });
    }
    const url = new URL(request.url);
    const token =
      request.headers.get("x-nextdesk-token")?.trim() ||
      url.searchParams.get("token")?.trim() ||
      "";
    if (!TOKEN_PATTERN.test(token)) {
      return reply({ ok: false, error: "unauthorized" }, 401);
    }
    const length = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
      return reply({ ok: false, error: "payload_too_large" }, 413);
    }
    const body =
      request.method === "POST" ? await request.text().catch(() => null) : "";
    if (body === null || encoder.encode(body).length > MAX_BODY_BYTES) {
      return reply({ ok: false, error: "payload_too_large" }, 413);
    }

    const admin = context.supabaseAdmin;
    const { data: integration, error } = await admin
      .from("monitoring_integrations")
      .select(
        "id, tenant_id, enabled, department_id, team_id, create_on, auto_resolve, set_service_status, priority_key",
      )
      .eq("token_hash", await sha256Hex(token))
      .maybeSingle();
    if (error) return reply({ ok: false, error: "unavailable" }, 503);
    if (!integration) return reply({ ok: false, error: "unauthorized" }, 401);

    const fields = parseBody(body, request.headers.get("content-type"));
    const event = fields ? buildEvent(parseQuery(url), fields) : null;
    if (!event) return reply({ ok: false, error: "unusable_payload" }, 422);
    if (!(integration as Integration).enabled) {
      return reply({ ok: true, ignored: "disabled" });
    }

    await admin
      .from("monitoring_integrations")
      .update({ last_received_at: new Date().toISOString() })
      .eq("id", integration.id);

    const work = processEvent(admin, integration as Integration, event).catch(
      (failure) => {
        console.error(
          "monitoring_webhook_failed",
          failure instanceof Error ? failure.message : typeof failure,
        );
        return "failed";
      },
    );
    if (runInBackground(work)) return reply({ ok: true });
    const result = await work;
    return result === "failed"
      ? reply({ ok: false, error: "processing_failed" }, 500)
      : reply({ ok: true, result });
  },
);

export default { fetch: handler };
