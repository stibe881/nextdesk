// Context, measures, campaigns and IOC list of security cases (migration
// 0313). The caller's access to the case is checked in index.ts before any
// of these run; reads of other modules go through their own functions with
// the caller's token (person_overview, intune-actions, shop), so their
// permission checks apply.

import { defang, isPrivateIp } from "../_shared/phishing-analysis.ts";
import {
  extractIndicators,
  isIpLiteral,
  networkCandidates,
  parseIocHits,
} from "../_shared/phishing-campaigns.ts";
import { tenantReferenceDomains } from "../_shared/phishing-report-intake.ts";
import { entraGraphAccessToken } from "../_shared/entra-graph-token.ts";
import { readIntuneGraphCredentials } from "../_shared/intune-managed-devices-graph.ts";
import { SoftwareDeployError } from "../_shared/intune-software-graph.ts";
import {
  ENTRA_ACTION_LABELS,
  EntraActionError,
  type EntraActionErrorCode,
  entraActionErrorMessage,
  type EntraSecurityAction,
  runEntraSecurityAction,
} from "../_shared/security-entra-actions.ts";

// deno-lint-ignore no-explicit-any
type Client = any;
type Row = Record<string, unknown>;

export type Measure =
  | "intune_sync"
  | "intune_defender_scan"
  | "entra_revoke_sessions"
  | "entra_force_password_change";
export const MEASURES: readonly Measure[] = [
  "intune_sync",
  "intune_defender_scan",
  "entra_revoke_sessions",
  "entra_force_password_change",
];
export const MEASURE_LABELS: Record<Measure | "replacement_order", string> = {
  intune_sync: "Gerät synchronisieren",
  intune_defender_scan: "Defender-Schnellscan",
  entra_revoke_sessions: ENTRA_ACTION_LABELS.revokeSessions,
  entra_force_password_change: ENTRA_ACTION_LABELS.forcePasswordChange,
  replacement_order: "Ersatzgerät bestellt",
};
const INTUNE_ACTION: Record<"intune_sync" | "intune_defender_scan", string> = {
  intune_sync: "syncDevice",
  intune_defender_scan: "windowsDefenderScan",
};
const ENTRA_ACTION: Record<"entra_revoke_sessions" | "entra_force_password_change", EntraSecurityAction> = {
  entra_revoke_sessions: "revokeSessions",
  entra_force_password_change: "forcePasswordChange",
};

export class IntelError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

// ---------------------------------------------------------------------------
// Calls to other edge functions with the caller's token

export type FunctionCall = (
  name: string,
  body: Row,
) => Promise<{ ok: boolean; status: number; data: Row | null; message: string | null }>;

export function functionCaller(request: Request): FunctionCall {
  return async (name, body) => {
    const base = Deno.env.get("SUPABASE_URL");
    const authorization = request.headers.get("authorization");
    const apikey = request.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!base || !authorization) {
      return { ok: false, status: 503, data: null, message: null };
    }
    try {
      const response = await fetch(`${base.replace(/\/$/, "")}/functions/v1/${name}`, {
        method: "POST",
        headers: { Authorization: authorization, apikey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
      });
      const payload: unknown = await response.json().catch(() => null);
      const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
      return {
        ok: response.ok,
        status: response.status,
        data: isRecord(payload) && isRecord(payload.data) ? payload.data : null,
        message: text(error?.message),
      };
    } catch {
      return { ok: false, status: 503, data: null, message: null };
    }
  };
}

// ---------------------------------------------------------------------------
// People of a case

export type CasePerson = { key: string; userId: string | null; email: string | null };

/** Every reporter once: key = user id, otherwise the e-mail address. */
export function uniquePeople(reports: readonly Row[]): CasePerson[] {
  const people = new Map<string, CasePerson>();
  for (const row of reports) {
    const userId = text(row.reporter_id)?.toLowerCase() ?? null;
    const email = text(row.reporter_email)?.toLowerCase() ?? null;
    const key = userId ?? email;
    if (!key || people.has(key)) continue;
    people.set(key, { key, userId, email });
  }
  return [...people.values()];
}

export async function casePeople(admin: Client, tenantId: string, ticketId: string) {
  const { data } = await admin.from("phishing_reports").select("reporter_id, reporter_email")
    .eq("tenant_id", tenantId).eq("ticket_id", ticketId).order("created_at").limit(300);
  return uniquePeople((data ?? []) as Row[]);
}

function likePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** person_overview (agents only, readable data only) under the caller. */
async function personOverview(
  client: Client,
  admin: Client,
  tenantId: string,
  person: CasePerson,
): Promise<Row | null> {
  const args: Row = {
    p_tenant_id: tenantId,
    p_entra_object_id: null,
    p_requester_contact_id: null,
    p_user_id: person.userId,
  };
  if (!person.userId && person.email) {
    const entra = await admin.from("tenant_entra_directory_people").select("entra_object_id")
      .eq("tenant_id", tenantId).ilike("email", likePattern(person.email))
      .order("inactive_at", { ascending: true, nullsFirst: true }).limit(1).maybeSingle();
    const entraId = text((entra.data as Row | null)?.entra_object_id);
    if (entraId) {
      args.p_entra_object_id = entraId;
    } else {
      const found = await admin.rpc("find_auth_user_id_by_email", { p_email: person.email });
      if (typeof found.data === "string") {
        args.p_user_id = found.data;
      } else {
        const contact = await admin.from("ticket_requesters").select("id")
          .eq("tenant_id", tenantId).ilike("email", likePattern(person.email)).limit(1).maybeSingle();
        const contactId = text((contact.data as Row | null)?.id);
        if (!contactId) return null;
        args.p_requester_contact_id = contactId;
      }
    }
  }
  const { data, error } = await client.rpc("person_overview", args);
  return error || !isRecord(data) ? null : data;
}

// ---------------------------------------------------------------------------
// Context (point 12)

function entraAvailability(admin: Client, tenantId: string): Promise<string | null> {
  if (!readIntuneGraphCredentials()) {
    return Promise.resolve("Die Entra-Anbindung ist nicht eingerichtet. Massnahmen bitte im Entra Admin Center ausführen.");
  }
  return admin.rpc("intune_device_action_entra_tenant", { p_tenant_id: tenantId }).then(
    (result: { data: unknown; error: unknown }) =>
      !result.error && typeof result.data === "string"
        ? null
        : "Für diesen Mandanten ist keine aktive Intune-/Entra-Verbindung eingerichtet. Massnahmen bitte im Entra Admin Center ausführen.",
    () => "Die Entra-Anbindung konnte nicht geprüft werden.",
  );
}

export async function caseContext(
  admin: Client,
  client: Client,
  call: FunctionCall,
  tenantId: string,
  ticketId: string,
) {
  const [people, reports, clicks] = await Promise.all([
    casePeople(admin, tenantId, ticketId),
    admin.from("phishing_reports").select("analysis, risk_score").eq("tenant_id", tenantId)
      .eq("ticket_id", ticketId).order("risk_score", { ascending: false }).limit(20),
    admin.from("security_click_questions").select("email, answer").eq("ticket_id", ticketId),
  ]);
  const clicked = new Set(((clicks.data ?? []) as Row[])
    .filter((row) => row.answer === "yes").map((row) => String(row.email).toLowerCase()));

  const persons = [];
  const assetIds: string[] = [];
  for (const person of people.slice(0, 10)) {
    const overview = await personOverview(client, admin, tenantId, person);
    const profile = isRecord(overview?.person) ? overview.person : {};
    const devices = Array.isArray(overview?.devices) ? rows(overview?.devices) : null;
    let email = person.email ?? text(profile.email)?.toLowerCase() ?? null;
    if (!email && person.userId) {
      const user = await admin.auth.admin.getUserById(person.userId).catch(() => null);
      email = text(user?.data?.user?.email)?.toLowerCase() ?? null;
    }
    for (const device of devices ?? []) {
      const id = text(device.id);
      if (id) assetIds.push(id);
    }
    persons.push({
      key: person.key,
      name: text(profile.displayName) ?? email ?? "Unbekannte Person",
      email,
      userId: text(profile.userId) ?? person.userId,
      entraObjectId: text(profile.entraObjectId),
      jobTitle: text(profile.jobTitle),
      department: text(profile.department),
      managerName: text(profile.managerName),
      lastSignInAt: text(profile.lastSignInAt),
      accountEnabled: typeof profile.accountEnabled === "boolean" ? profile.accountEnabled : null,
      clicked: email ? clicked.has(email) : false,
      found: overview !== null,
      devicesVisible: devices !== null,
      devices: (devices ?? []).slice(0, 20).map((device) => ({
        id: String(device.id),
        name: text(device.name) ?? "Gerät",
        assetTag: text(device.assetTag),
        operatingSystem: text(device.operatingSystem),
        complianceState: text(device.complianceState),
        lastSyncAt: text(device.lastSyncAt),
        source: text(device.source),
        network: [] as Row[],
        intuneActions: [] as string[],
      })),
    });
  }

  // IP addresses of the devices (IPAM) and the available Intune actions.
  const uniqueAssets = [...new Set(assetIds)].slice(0, 100);
  let intuneMessage: string | null = null;
  if (uniqueAssets.length) {
    const [network, intune] = await Promise.all([
      admin.rpc("security_asset_network", { p_tenant_id: tenantId, p_asset_ids: uniqueAssets }),
      call("intune-actions", { type: "listAssetActions", tenantId, assetIds: uniqueAssets }),
    ]);
    const byAsset = new Map<string, Row[]>();
    for (const entry of rows(network.data)) {
      const id = String(entry.assetId);
      byAsset.set(id, [...(byAsset.get(id) ?? []), entry]);
    }
    const actions = new Map<string, string[]>();
    if (intune.ok && intune.data) {
      for (const device of rows(intune.data.devices)) {
        actions.set(
          String(device.assetId),
          (Array.isArray(device.actions) ? device.actions : [])
            .filter((entry): entry is string => entry === "syncDevice" || entry === "windowsDefenderScan"),
        );
      }
      if (intune.data.connectionReady === false) {
        intuneMessage = "Die Intune-Anbindung ist für diesen Mandanten nicht aktiv.";
      }
    } else {
      intuneMessage = intune.message ?? "Intune-Aktionen sind nicht verfügbar.";
    }
    for (const person of persons) {
      for (const device of person.devices) {
        device.network = (byAsset.get(device.id) ?? []).slice(0, 10);
        device.intuneActions = actions.get(device.id) ?? [];
      }
    }
  }

  // Sending IPs and hosts of the mail against the IP management.
  const ips = new Set<string>();
  const hosts = new Set<string>();
  for (const report of (reports.data ?? []) as Row[]) {
    const candidates = networkCandidates(report.analysis);
    candidates.ips.forEach((entry) => ips.add(entry));
    candidates.hosts.forEach((entry) => hosts.add(entry));
  }
  const matches = await admin.rpc("security_ipam_matches", {
    p_tenant_id: tenantId,
    p_ips: [...ips].slice(0, 30),
    p_hosts: [...hosts].slice(0, 40),
  });
  const matchByValue = new Map(rows(matches.data).map((entry) => [String(entry.value).toLowerCase(), entry]));
  const indicators = [
    ...[...ips].map((value) => ({ value, kind: "ip" as const })),
    ...[...hosts].map((value) => ({ value, kind: "host" as const })),
  ].map((entry) => {
    const match = matchByValue.get(entry.value.toLowerCase()) ?? null;
    const privateAddress = entry.kind === "ip" && isIpLiteral(entry.value) && isPrivateIp(entry.value);
    return {
      value: defang(entry.value),
      kind: entry.kind,
      internal: match !== null || privateAddress,
      privateAddress,
      match,
    };
  }).filter((entry) => entry.internal);

  return {
    people: persons,
    indicators,
    measures: {
      intuneMessage,
      entraMessage: await entraAvailability(admin, tenantId),
    },
  };
}

// ---------------------------------------------------------------------------
// Measures (point 13) and replacement order (point 14)

async function logMeasure(
  admin: Client,
  input: {
    tenantId: string;
    ticketId: string;
    actorId: string;
    measure: Measure | "replacement_order";
    target: string | null;
    status: "succeeded" | "failed";
    message: string | null;
    referenceId?: string | null;
  },
) {
  await admin.from("security_case_measures").insert({
    tenant_id: input.tenantId,
    ticket_id: input.ticketId,
    measure: input.measure,
    target_label: input.target?.slice(0, 300) ?? null,
    status: input.status,
    message: input.message?.slice(0, 500) ?? null,
    reference_id: input.referenceId ?? null,
    actor_id: input.actorId,
  });
  await admin.from("ticket_events").insert({
    ticket_id: input.ticketId,
    actor_id: input.actorId,
    event_type: "ticket.security_measure",
    payload: {
      measure: input.measure,
      label: MEASURE_LABELS[input.measure],
      target: input.target?.slice(0, 200) ?? null,
      status: input.status,
    },
  });
}

function entraTokenErrorCode(error: unknown): EntraActionErrorCode {
  if (error instanceof SoftwareDeployError) {
    if (error.code === "provider_not_configured") return "provider_not_configured";
    if (error.code === "consent_missing") return "consent_missing";
    if (error.code === "rate_limited") return "rate_limited";
  }
  return "provider_unavailable";
}

export async function runMeasure(
  admin: Client,
  client: Client,
  call: FunctionCall,
  actorId: string,
  input: {
    tenantId: string;
    ticketId: string;
    measure: Measure;
    personKey: string;
    assetId: string | null;
  },
): Promise<{ status: "succeeded" | "failed"; message: string }> {
  const people = await casePeople(admin, input.tenantId, input.ticketId);
  const person = people.find((entry) => entry.key === input.personKey);
  if (!person) {
    throw new IntelError(404, "person_not_in_case", "Die Person hat diesen Fall nicht gemeldet.");
  }
  let status: "succeeded" | "failed" = "failed";
  let message = "";
  let target: string | null = person.email;

  if (input.measure === "intune_sync" || input.measure === "intune_defender_scan") {
    if (!input.assetId) throw new IntelError(422, "invalid_request", "Bitte ein Gerät wählen.");
    const asset = await admin.from("assets").select("name").eq("tenant_id", input.tenantId)
      .eq("id", input.assetId).maybeSingle();
    target = text((asset.data as Row | null)?.name) ?? "Gerät";
    const result = await call("intune-actions", {
      type: "runAction",
      tenantId: input.tenantId,
      assetId: input.assetId,
      ticketId: null,
      action: INTUNE_ACTION[input.measure],
      confirmed: true,
    });
    status = result.ok ? "succeeded" : "failed";
    message = result.ok
      ? `${MEASURE_LABELS[input.measure]} für «${target}» wurde an Intune übermittelt.`
      : result.message ?? "Die Intune-Aktion konnte nicht ausgeführt werden.";
  } else {
    const action = ENTRA_ACTION[input.measure];
    const overview = await personOverview(client, admin, input.tenantId, person);
    const profile = isRecord(overview?.person) ? overview.person : {};
    const objectId = text(profile.entraObjectId);
    target = text(profile.displayName) ?? person.email;
    if (!objectId) {
      message = entraActionErrorMessage("invalid_user", action);
    } else {
      try {
        const token = await entraGraphAccessToken(admin, input.tenantId).catch((error) => {
          throw new EntraActionError(entraTokenErrorCode(error));
        });
        await runEntraSecurityAction(action, objectId, token);
        status = "succeeded";
        message = action === "revokeSessions"
          ? `Alle Sitzungen von ${target ?? "der Person"} wurden widerrufen. Die Person muss sich neu anmelden.`
          : `${target ?? "Die Person"} muss das Passwort bei der nächsten Anmeldung ändern.`;
      } catch (error) {
        message = entraActionErrorMessage(
          error instanceof EntraActionError ? error.code : "provider_unavailable",
          action,
        );
      }
    }
  }
  await logMeasure(admin, {
    tenantId: input.tenantId,
    ticketId: input.ticketId,
    actorId,
    measure: input.measure,
    target,
    status,
    message,
  });
  return { status, message };
}

export async function replacementCatalog(call: FunctionCall, tenantId: string) {
  const result = await call("shop", { type: "listCatalog", tenantId });
  if (!result.ok || !result.data) {
    throw new IntelError(
      result.status === 403 ? 403 : 503,
      "shop_unavailable",
      result.message ?? "Der Shop ist nicht verfügbar.",
    );
  }
  return {
    items: rows(result.data.items)
      .filter((item) => item.active !== false && item.kind === "order")
      .slice(0, 200)
      .map((item) => ({
        id: String(item.id),
        name: text(item.name) ?? "Artikel",
        category: Array.isArray(item.categoryNames) ? text(item.categoryNames[0]) : text(item.category),
        requiresApproval: item.requiresApproval === true,
      })),
  };
}

export async function orderReplacement(
  admin: Client,
  client: Client,
  call: FunctionCall,
  actorId: string,
  input: {
    tenantId: string;
    ticketId: string;
    ticketNumber: string;
    personKey: string;
    catalogItemId: string;
    comment: string | null;
  },
): Promise<{ status: "succeeded" | "failed"; message: string; orderId: string | null }> {
  const people = await casePeople(admin, input.tenantId, input.ticketId);
  const person = people.find((entry) => entry.key === input.personKey);
  if (!person) {
    throw new IntelError(404, "person_not_in_case", "Die Person hat diesen Fall nicht gemeldet.");
  }
  let requesterId = person.userId;
  if (!requesterId && person.email) {
    const found = await admin.rpc("find_auth_user_id_by_email", { p_email: person.email });
    if (typeof found.data === "string") requesterId = found.data;
  }
  if (!requesterId) {
    const overview = await personOverview(client, admin, input.tenantId, person);
    const entraId = isRecord(overview?.person) ? text(overview.person.entraObjectId) : null;
    if (entraId) requesterId = `entra:${entraId}`;
  }
  if (!requesterId) {
    throw new IntelError(422, "person_unknown", "Für diese Person ist kein Konto bekannt; die Bestellung ist nicht möglich.");
  }
  const note = `Ersatzgerät aus Sicherheitsfall ${input.ticketNumber}`;
  const result = await call("shop", {
    type: "submitOrder",
    tenantId: input.tenantId,
    clientRequestId: crypto.randomUUID(),
    lines: [{ catalogItemId: input.catalogItemId, quantity: 1 }],
    reason: note,
    comment: input.comment ? `${note}: ${input.comment}`.slice(0, 2000) : note,
    requesterId,
    deliveryMethod: "desk",
  });
  const orderId = text(result.data?.orderId);
  let message: string;
  if (result.ok && orderId) {
    const order = await admin.from("shop_orders").select("order_number, status")
      .eq("tenant_id", input.tenantId).eq("id", orderId).maybeSingle();
    const number = text((order.data as Row | null)?.order_number);
    message = (order.data as Row | null)?.status === "pending_approval"
      ? `Bestellung ${number ?? ""} wurde erfasst. Der Artikel verlangt eine Genehmigung; diese wurde angefordert.`
      : `Bestellung ${number ?? ""} wurde ohne Genehmigung erfasst.`;
  } else {
    message = result.message ?? "Die Bestellung konnte nicht erfasst werden.";
  }
  const status = result.ok && orderId ? "succeeded" : "failed";
  message = message.replace(/\s+/g, " ").trim();
  await logMeasure(admin, {
    tenantId: input.tenantId,
    ticketId: input.ticketId,
    actorId,
    measure: "replacement_order",
    target: person.email,
    status,
    message,
    referenceId: orderId,
  });
  return { status, message, orderId };
}

export async function caseMeasures(admin: Client, ticketId: string) {
  const { data } = await admin.from("security_case_measures")
    .select("id, measure, target_label, status, message, actor_id, created_at")
    .eq("ticket_id", ticketId).order("created_at", { ascending: false }).limit(50);
  const list = (data ?? []) as Row[];
  const actorIds = [...new Set(list.map((row) => text(row.actor_id)).filter((id): id is string => !!id))];
  const actors = actorIds.length
    ? ((await admin.from("user_profiles").select("id, display_name").in("id", actorIds)).data ?? []) as Row[]
    : [];
  const names = new Map(actors.map((row) => [String(row.id), text(row.display_name)]));
  return list.map((row) => ({
    id: String(row.id),
    measure: String(row.measure),
    label: MEASURE_LABELS[row.measure as Measure] ?? String(row.measure),
    target: text(row.target_label),
    status: row.status === "succeeded" ? "succeeded" : "failed",
    message: text(row.message),
    actorName: names.get(text(row.actor_id) ?? "") ?? null,
    createdAt: text(row.created_at),
  }));
}

// ---------------------------------------------------------------------------
// Campaigns and IOC (point 15)

export async function caseCampaign(admin: Client, tenantId: string, campaignId: string | null, ticketId: string) {
  if (!campaignId) return null;
  const [campaign, cases] = await Promise.all([
    admin.from("security_campaigns").select("*").eq("tenant_id", tenantId).eq("id", campaignId).maybeSingle(),
    admin.from("security_cases").select("ticket_id, state, verdict, created_at, tickets(ticket_number)")
      .eq("tenant_id", tenantId).eq("campaign_id", campaignId)
      .order("created_at", { ascending: false }).limit(20),
  ]);
  const row = campaign.data as Row | null;
  if (!row) return null;
  return {
    id: String(row.id),
    senderDomain: text(row.sender_domain) ? defang(String(row.sender_domain)) : null,
    subjectKey: text(row.subject_key),
    linkDomains: (Array.isArray(row.link_domains) ? row.link_domains : []).map((entry) => defang(String(entry))),
    reports: Number(row.report_count ?? 0),
    reporters: Number(row.reporter_count ?? 0),
    caseCount: Number(row.case_count ?? 0),
    firstSeenAt: text(row.first_seen_at),
    lastSeenAt: text(row.last_seen_at),
    cases: ((cases.data ?? []) as Row[]).filter((entry) => entry.ticket_id !== ticketId).map((entry) => {
      const ticket = (Array.isArray(entry.tickets) ? entry.tickets[0] : entry.tickets) as Row | null;
      return {
        ticketId: String(entry.ticket_id),
        ticketNumber: text(ticket?.ticket_number),
        state: String(entry.state),
        verdict: text(entry.verdict),
      };
    }),
  };
}

export function caseIocHits(value: unknown) {
  return parseIocHits(value).map((hit) => ({ ...hit, value: defang(hit.value) }));
}

export async function listCampaigns(admin: Client, tenantId: string) {
  const { data } = await admin.from("security_campaigns").select("*").eq("tenant_id", tenantId)
    .gt("case_count", 0).order("last_seen_at", { ascending: false }).limit(60);
  const campaigns = (data ?? []) as Row[];
  const ids = campaigns.map((row) => String(row.id));
  const cases = ids.length
    ? ((await admin.from("security_cases")
      .select("ticket_id, campaign_id, state, verdict, tickets(ticket_number)")
      .eq("tenant_id", tenantId).in("campaign_id", ids).limit(1000)).data ?? []) as Row[]
    : [];
  return {
    campaigns: campaigns.map((row) => ({
      id: String(row.id),
      senderDomain: text(row.sender_domain) ? defang(String(row.sender_domain)) : null,
      subjectKey: text(row.subject_key),
      linkDomains: (Array.isArray(row.link_domains) ? row.link_domains : []).map((entry) => defang(String(entry))),
      reports: Number(row.report_count ?? 0),
      reporters: Number(row.reporter_count ?? 0),
      caseCount: Number(row.case_count ?? 0),
      firstSeenAt: text(row.first_seen_at),
      lastSeenAt: text(row.last_seen_at),
      cases: cases.filter((entry) => entry.campaign_id === row.id).slice(0, 20).map((entry) => {
        const ticket = (Array.isArray(entry.tickets) ? entry.tickets[0] : entry.tickets) as Row | null;
        return {
          ticketId: String(entry.ticket_id),
          ticketNumber: text(ticket?.ticket_number),
          state: String(entry.state),
          verdict: text(entry.verdict),
        };
      }),
    })),
  };
}

export async function listIocs(
  admin: Client,
  tenantId: string,
  status: "active" | "harmless" | "all",
  query: string | null,
) {
  let request = admin.from("security_iocs")
    .select("id, kind, value, verdict, status, source_ticket_id, case_count, hit_count, first_seen_at, last_seen_at, last_hit_at, status_changed_at, tickets:source_ticket_id(ticket_number)")
    .eq("tenant_id", tenantId);
  if (status !== "all") request = request.eq("status", status);
  if (query) request = request.ilike("value", `%${likePattern(query.toLowerCase())}%`);
  const { data, error } = await request.order("last_seen_at", { ascending: false }).limit(300);
  if (error) throw new IntelError(503, "unavailable", "Die IOC-Liste ist gerade nicht verfügbar.");
  return {
    iocs: ((data ?? []) as Row[]).map((row) => {
      const ticket = (Array.isArray(row.tickets) ? row.tickets[0] : row.tickets) as Row | null;
      return {
        id: String(row.id),
        kind: String(row.kind),
        value: defang(String(row.value)),
        verdict: String(row.verdict),
        status: row.status === "harmless" ? "harmless" : "active",
        sourceTicketId: text(row.source_ticket_id),
        sourceTicketNumber: text(ticket?.ticket_number),
        caseCount: Number(row.case_count ?? 0),
        hitCount: Number(row.hit_count ?? 0),
        lastSeenAt: text(row.last_seen_at),
        lastHitAt: text(row.last_hit_at),
      };
    }),
  };
}

export async function setIocStatus(
  admin: Client,
  actorId: string,
  tenantId: string,
  iocId: string,
  status: "active" | "harmless",
) {
  const { data, error } = await admin.from("security_iocs").update({
    status,
    status_changed_by: actorId,
    status_changed_at: new Date().toISOString(),
  }).eq("tenant_id", tenantId).eq("id", iocId).select("id");
  if (error) throw new IntelError(503, "unavailable", "Der Eintrag konnte nicht gespeichert werden.");
  if (!data?.length) throw new IntelError(404, "ioc_not_found", "Der Eintrag wurde nicht gefunden.");
}

/** IOCs of a case once it has a verdict (not for «harmless»). */
export async function recordCaseIocs(
  admin: Client,
  tenantId: string,
  ticketId: string,
  verdict: string,
): Promise<number> {
  if (verdict === "harmless") return 0;
  const { data } = await admin.from("phishing_reports").select("analysis")
    .eq("tenant_id", tenantId).eq("ticket_id", ticketId).limit(50);
  const reference = await tenantReferenceDomains(admin, tenantId).catch(() => []);
  const seen = new Map<string, { kind: string; value: string }>();
  for (const row of (data ?? []) as Row[]) {
    for (const indicator of extractIndicators(row.analysis, reference)) {
      seen.set(`${indicator.kind}:${indicator.value}`, indicator);
    }
  }
  if (!seen.size) return 0;
  const result = await admin.rpc("security_iocs_record", {
    p_tenant_id: tenantId,
    p_ticket_id: ticketId,
    p_verdict: verdict,
    p_indicators: [...seen.values()].slice(0, 200),
  });
  return typeof result.data === "number" ? result.data : 0;
}
