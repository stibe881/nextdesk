import { withSupabase } from "@supabase/server";
import {
  type AgentConfig,
  type AgentReport,
  agentIdFromToken,
  DEFAULT_AGENT_CONFIG,
  type DiscoveryPlan,
  JOB_KINDS,
  LIMITS,
  mergeObservations,
  parseAgentConfig,
  parseContext,
  parseDnsContext,
  parseReport,
  planDnsFindings,
  planObservations,
  resolveMacLocations,
  sha256Hex,
  timingSafeEqualHex,
} from "../_shared/ipam-discovery.ts";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

/**
 * Endpoint for the on-prem nextDesk network agent (`tools/ipam-agent`).
 *
 * - Deploy with `[functions.ipam-agent] verify_jwt = false`: the agent has no
 *   Supabase session. It authenticates with `Authorization: Bearer <token>`.
 *   The token names the agent («ndip_<agent id>_<secret>»); only its SHA-256
 *   is stored and compared in constant time.
 * - Rate limit per agent (requests per minute, in the database) and a small
 *   per-isolate throttle for failed logins per client address.
 * - Actions: `hello` (version/hostname, returns config, subnets and pending
 *   jobs), `report` (observations, MAC tables, LLDP, DHCP, DNS in chunks),
 *   `jobResult` (outcome of a job).
 */

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

type Agent = {
  id: string;
  tenant_id: string;
  name: string;
  token_hash: string;
  status: "active" | "disabled" | "revoked";
  config: unknown;
};

const REQUESTS_PER_MINUTE = 120;
const FAILED_AUTH_LIMIT = 20;
const FAILED_AUTH_WINDOW_MS = 5 * 60 * 1000;
const CONTEXT_CHUNK = 1000;
const WRITE_CHUNK = 1000;
const encoder = new TextEncoder();
const failedAuth = new Map<string, { count: number; since: number }>();

function reply(body: Record<string, unknown>, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || request.headers.get("cf-connecting-ip") || "unknown").slice(0, 64);
}

function authThrottled(key: string): boolean {
  const entry = failedAuth.get(key);
  if (!entry) return false;
  if (Date.now() - entry.since > FAILED_AUTH_WINDOW_MS) {
    failedAuth.delete(key);
    return false;
  }
  return entry.count >= FAILED_AUTH_LIMIT;
}

function recordFailedAuth(key: string): void {
  const now = Date.now();
  const entry = failedAuth.get(key);
  if (!entry || now - entry.since > FAILED_AUTH_WINDOW_MS) {
    failedAuth.set(key, { count: 1, since: now });
  } else {
    entry.count += 1;
  }
  if (failedAuth.size > 5000) failedAuth.clear();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shortText(value: unknown, max: number, pattern?: RegExp): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  if (!trimmed) return null;
  return pattern && !pattern.test(trimmed) ? null : trimmed;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function agentConfig(agent: Agent): AgentConfig {
  const parsed = parseAgentConfig(agent.config);
  return parsed.ok ? parsed.config : { ...DEFAULT_AGENT_CONFIG };
}

// ---------------------------------------------------------------------------
// hello

async function hello(admin: Admin, agent: Agent, body: Record<string, unknown>): Promise<Response> {
  const info = isObject(body.agent) ? body.agent : {};
  const capabilities: Record<string, boolean> = {};
  if (isObject(info.capabilities)) {
    for (const [key, value] of Object.entries(info.capabilities).slice(0, 20)) {
      if (/^[a-z][a-zA-Z0-9]{0,30}$/.test(key) && typeof value === "boolean") capabilities[key] = value;
    }
  }
  const update: Row = {
    version: shortText(info.version, 40, /^[0-9A-Za-z.+_-]+$/),
    hostname: shortText(info.hostname, 253, /^[0-9A-Za-z._-]+$/),
    platform: shortText(info.platform, 40, /^[0-9A-Za-z._-]+$/),
    capabilities,
    updated_at: new Date().toISOString(),
  };
  const { error: updateError } = await admin.from("ipam_agents").update(update).eq("id", agent.id);
  if (updateError) return reply({ ok: false, error: "unavailable" }, 503);

  const config = agentConfig(agent);
  let prefixQuery = admin
    .from("ipam_prefixes")
    .select("id, prefix, vrf_id, status")
    .eq("tenant_id", agent.tenant_id)
    .order("prefix")
    .limit(1000);
  if (config.scanAllActive) {
    prefixQuery = prefixQuery.eq("status", "active");
    prefixQuery = config.vrfId ? prefixQuery.eq("vrf_id", config.vrfId) : prefixQuery.is("vrf_id", null);
  } else {
    prefixQuery = prefixQuery.in("id", config.prefixIds.length ? config.prefixIds : ["00000000-0000-0000-0000-000000000000"]);
  }
  const { data: prefixes, error: prefixError } = await prefixQuery;
  if (prefixError) return reply({ ok: false, error: "unavailable" }, 503);
  const subnets = ((prefixes ?? []) as Row[]).flatMap((row) => {
    const prefix = String(row.prefix ?? "");
    const [, length] = prefix.split("/");
    const family = prefix.includes(":") ? 6 : 4;
    return [{
      prefixId: String(row.id),
      prefix,
      vrfId: typeof row.vrf_id === "string" ? row.vrf_id : null,
      family,
      // Ping sweep only for IPv4 up to /16; IPv6 comes from neighbour tables.
      sweep: family === 4 && Number(length) >= 16,
    }];
  });

  const { data: claimed, error: claimError } = await admin.rpc("ipam_agent_claim_jobs", {
    p_agent_id: agent.id,
    p_limit: 20,
  });
  if (claimError) return reply({ ok: false, error: "unavailable" }, 503);
  const jobs: Row[] = [];
  for (const job of (claimed ?? []) as Row[]) {
    if (job.kind !== "scan_now" && !config.allowWrites) {
      await admin.from("ipam_agent_jobs").update({
        status: "failed",
        error: "Schreibende Aufträge sind für diesen Agenten nicht freigegeben.",
        finished_at: new Date().toISOString(),
      }).eq("id", job.id);
      continue;
    }
    jobs.push({ id: job.id, kind: job.kind, payload: job.payload ?? {} });
  }

  return reply({
    ok: true,
    agent: { id: agent.id, name: agent.name },
    config: {
      scheduleMinutes: config.scheduleMinutes,
      pingTimeoutMs: config.pingTimeoutMs,
      pingConcurrency: config.pingConcurrency,
      snmpTargets: config.snmpTargets,
      dhcpServers: config.dhcpServers,
      dnsServers: config.dnsServers,
      dnsZones: config.dnsZones,
      allowWrites: config.allowWrites,
    },
    subnets,
    jobs,
    pollSeconds: 60,
    serverTime: new Date().toISOString(),
    limits: {
      observations: LIMITS.observations,
      macTable: LIMITS.macTable,
      lldp: LIMITS.lldp,
      dhcpLeases: LIMITS.dhcpLeases,
      dnsRecords: LIMITS.dnsRecords,
      bodyBytes: LIMITS.bodyBytes,
    },
  });
}

// ---------------------------------------------------------------------------
// report

async function applyPlan(admin: Admin, agent: Agent, plan: DiscoveryPlan) {
  const { data, error } = await admin.rpc("ipam_discovery_apply", {
    p_tenant_id: agent.tenant_id,
    p_agent_id: agent.id,
    p_plan: plan,
  });
  if (error) throw new Error("apply_failed");
  const result = isObject(data) ? data : {};
  return {
    opened: Number(result.opened ?? 0),
    resolved: Number(result.resolved ?? 0),
  };
}

async function recordRun(admin: Admin, agent: Agent, report: AgentReport, now: string): Promise<void> {
  const { data: existing } = await admin
    .from("ipam_agent_runs")
    .select("id, stats, errors, report_count")
    .eq("agent_id", agent.id)
    .eq("run_key", report.run.key)
    .maybeSingle();
  const stats: Record<string, number> = isObject(existing?.stats) ? { ...existing.stats } as Record<string, number> : {};
  for (const [key, value] of Object.entries(report.run.stats)) {
    stats[key] = (typeof stats[key] === "number" ? stats[key] : 0) + value;
  }
  const errors = [...(Array.isArray(existing?.errors) ? existing.errors : []), ...report.run.errors].slice(-50);
  const row: Row = {
    stats,
    errors,
    report_count: Number(existing?.report_count ?? 0) + 1,
    ...(report.run.final ? { finished_at: now } : {}),
  };
  if (existing) {
    await admin.from("ipam_agent_runs").update(row).eq("id", existing.id);
  } else {
    await admin.from("ipam_agent_runs").insert({
      tenant_id: agent.tenant_id,
      agent_id: agent.id,
      run_key: report.run.key,
      trigger: report.run.trigger,
      job_id: report.run.jobId,
      started_at: now,
      ...row,
    });
  }
}

async function ingestTopology(admin: Admin, agent: Agent, report: AgentReport, now: string) {
  const { locations, ipHints } = resolveMacLocations(report.macTable, report.lldp);
  for (const batch of chunks(locations, WRITE_CHUNK)) {
    const { error } = await admin.from("ipam_mac_locations").upsert(
      batch.map((location) => ({
        tenant_id: agent.tenant_id,
        mac: location.mac,
        switch_name: location.switchName,
        switch_port: location.switchPort,
        vlan: location.vlan,
        source: location.source,
        agent_id: agent.id,
        seen_at: now,
      })),
      { onConflict: "tenant_id,mac" },
    );
    if (error) throw new Error("mac_locations_failed");
  }
  return { locations: locations.length, ipHints };
}

async function ingestObservations(
  admin: Admin,
  agent: Agent,
  report: AgentReport,
  ipHints: ReturnType<typeof resolveMacLocations>["ipHints"],
) {
  const merged = mergeObservations(report.observations, ipHints);
  const vrfIds = [...new Set(merged.flatMap((item) => (item.vrfId ? [item.vrfId] : [])))];
  const knownVrfs = new Set<string>();
  if (vrfIds.length) {
    const { data, error } = await admin.from("ipam_vrfs").select("id").eq("tenant_id", agent.tenant_id).in("id", vrfIds);
    if (error) throw new Error("vrf_lookup_failed");
    for (const row of (data ?? []) as Row[]) knownVrfs.add(String(row.id));
  }
  const groups = new Map<string | null, typeof merged>();
  for (const item of merged) {
    if (item.vrfId && !knownVrfs.has(item.vrfId)) continue;
    const list = groups.get(item.vrfId) ?? [];
    list.push(item);
    groups.set(item.vrfId, list);
  }
  let opened = 0;
  let resolved = 0;
  for (const [vrfId, items] of groups) {
    for (const batch of chunks(items, CONTEXT_CHUNK)) {
      const macs = [...new Set(batch.flatMap((item) => item.macs))];
      const { data, error } = await admin.rpc("ipam_discovery_context", {
        p_tenant_id: agent.tenant_id,
        p_vrf_id: vrfId,
        p_addresses: batch.map((item) => item.address),
        p_macs: macs,
      });
      if (error) throw new Error("context_failed");
      const context = parseContext(data);
      const plan = planObservations({
        vrfId,
        runKey: report.run.key,
        observations: batch,
        contexts: context.addresses,
        macLocations: context.macLocations,
      });
      const result = await applyPlan(admin, agent, plan);
      opened += result.opened;
      resolved += result.resolved;
    }
  }
  return { observations: merged.length, opened, resolved };
}

async function ingestDhcp(admin: Admin, agent: Agent, report: AgentReport, now: string) {
  let scopes = 0;
  let leases = 0;
  for (const server of report.dhcp) {
    const { data: scopeRows, error: scopeError } = await admin
      .from("ipam_dhcp_scopes")
      .upsert(
        server.scopes.map((scope) => ({
          tenant_id: agent.tenant_id,
          agent_id: agent.id,
          server: server.server,
          scope_id: scope.scopeId,
          subnet_mask: scope.subnetMask,
          name: scope.name,
          description: scope.description,
          state: scope.state,
          start_range: scope.startRange,
          end_range: scope.endRange,
          lease_duration_seconds: scope.leaseDurationSeconds,
          addresses_in_use: scope.inUse,
          addresses_free: scope.free,
          addresses_reserved: scope.reserved,
          seen_at: now,
        })),
        { onConflict: "tenant_id,server,scope_id" },
      )
      .select("id, scope_id");
    if (scopeError) throw new Error("dhcp_scopes_failed");
    const scopeRefs = new Map<string, string>();
    for (const row of (scopeRows ?? []) as Row[]) {
      scopeRefs.set(String(row.scope_id).replace(/\/32$/, ""), String(row.id));
    }
    const rows = server.leases.flatMap((lease) => {
      const scopeRef = scopeRefs.get(lease.scopeId);
      return scopeRef
        ? [{
          tenant_id: agent.tenant_id,
          scope_ref: scopeRef,
          server: server.server,
          address: lease.address,
          mac: lease.mac,
          client_id: lease.clientId,
          hostname: lease.hostname,
          state: lease.state,
          expires_at: lease.expiresAt,
          reservation: lease.reservation,
          reservation_name: lease.reservationName,
          seen_at: now,
        }]
        : [];
    });
    for (const batch of chunks(rows, WRITE_CHUNK)) {
      const { error } = await admin.from("ipam_dhcp_leases").upsert(batch, { onConflict: "tenant_id,server,address" });
      if (error) throw new Error("dhcp_leases_failed");
    }
    // Each server is reported completely: what was not reported is gone.
    if (scopeRefs.size) {
      await admin.from("ipam_dhcp_leases").delete()
        .eq("tenant_id", agent.tenant_id)
        .in("scope_ref", [...scopeRefs.values()])
        .lt("seen_at", now);
    }
    await admin.from("ipam_dhcp_scopes").delete()
      .eq("tenant_id", agent.tenant_id)
      .eq("server", server.server)
      .lt("seen_at", now);
    scopes += server.scopes.length;
    leases += rows.length;
  }
  return { scopes, leases };
}

async function ingestDns(admin: Admin, agent: Agent, report: AgentReport, now: string) {
  let records = 0;
  for (const zone of report.dns) {
    for (const batch of chunks(zone.records, WRITE_CHUNK)) {
      const { error } = await admin.from("ipam_dns_records").upsert(
        batch.map((record) => ({
          tenant_id: agent.tenant_id,
          agent_id: agent.id,
          server: zone.server,
          zone: zone.zone,
          name: record.name,
          type: record.type,
          value: record.value,
          address: record.address,
          ttl: record.ttl,
          seen_at: now,
        })),
        { onConflict: "tenant_id,server,zone,name,type,value" },
      );
      if (error) throw new Error("dns_records_failed");
    }
    // Each zone is reported completely.
    await admin.from("ipam_dns_records").delete()
      .eq("tenant_id", agent.tenant_id)
      .eq("server", zone.server)
      .eq("zone", zone.zone)
      .lt("seen_at", now);
    records += zone.records.length;
  }
  const { data, error } = await admin.rpc("ipam_dns_context", { p_tenant_id: agent.tenant_id });
  if (error) throw new Error("dns_context_failed");
  const result = await applyPlan(admin, agent, planDnsFindings(parseDnsContext(data)));
  return { records, ...result };
}

async function handleReport(admin: Admin, agent: Agent, body: Record<string, unknown>): Promise<Response> {
  const parsed = parseReport(body);
  if (!parsed.ok) return reply({ ok: false, error: parsed.code }, 422);
  const report = parsed.report;
  const now = new Date().toISOString();
  const summary: Record<string, unknown> = { skipped: report.skipped };
  let opened = 0;
  let resolved = 0;
  try {
    await recordRun(admin, agent, report, now);
    const topology = await ingestTopology(admin, agent, report, now);
    summary.macLocations = topology.locations;
    if (report.observations.length || topology.ipHints.length) {
      const result = await ingestObservations(admin, agent, report, topology.ipHints);
      summary.observations = result.observations;
      opened += result.opened;
      resolved += result.resolved;
    }
    if (report.dhcp.length) {
      const result = await ingestDhcp(admin, agent, report, now);
      summary.dhcpScopes = result.scopes;
      summary.dhcpLeases = result.leases;
    }
    if (report.dns.length) {
      const result = await ingestDns(admin, agent, report, now);
      summary.dnsRecords = result.records;
      opened += result.opened;
      resolved += result.resolved;
    }
    if (report.dhcp.length || report.run.final) {
      const { data } = await admin.rpc("ipam_discovery_housekeeping", { p_tenant_id: agent.tenant_id });
      if (isObject(data)) {
        opened += Number(data.opened ?? 0);
        resolved += Number(data.resolved ?? 0);
      }
    }
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : "processing_failed";
    console.error("ipam_agent_report_failed", message);
    await admin.from("ipam_agents").update({ last_error: `Verarbeitung fehlgeschlagen (${message}).` })
      .eq("id", agent.id);
    return reply({ ok: false, error: "processing_failed" }, 500);
  }
  await admin.from("ipam_agents").update({
    last_report_at: now,
    last_error: report.run.errors[0] ?? null,
  }).eq("id", agent.id);
  return reply({ ok: true, processed: summary, findings: { opened, resolved } });
}

// ---------------------------------------------------------------------------
// jobResult

async function jobResult(admin: Admin, agent: Agent, body: Record<string, unknown>): Promise<Response> {
  const jobId = typeof body.jobId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.jobId)
    ? body.jobId.toLowerCase()
    : null;
  if (!jobId || typeof body.ok !== "boolean") return reply({ ok: false, error: "invalid_job_result" }, 422);
  const result = isObject(body.result) ? body.result : null;
  if (result && encoder.encode(JSON.stringify(result)).length > 16 * 1024) {
    return reply({ ok: false, error: "result_too_large" }, 413);
  }
  const error = body.ok ? null : shortText(body.error, 1000) ?? "Unbekannter Fehler.";
  const { data: job, error: updateError } = await admin
    .from("ipam_agent_jobs")
    .update({
      status: body.ok ? "done" : "failed",
      result,
      error,
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("agent_id", agent.id)
    .eq("status", "running")
    .select("id, kind, payload, address_id, approved_by")
    .maybeSingle();
  if (updateError) return reply({ ok: false, error: "unavailable" }, 503);
  if (!job) return reply({ ok: false, error: "job_not_running" }, 409);
  if (body.ok && job.address_id && (JOB_KINDS as readonly string[]).includes(String(job.kind)) &&
    job.kind !== "scan_now") {
    await admin.from("ipam_address_events").insert({
      tenant_id: agent.tenant_id,
      address_id: job.address_id,
      actor_id: job.approved_by ?? null,
      kind: String(job.kind).startsWith("dns_") ? "dns" : "updated",
      details: { job: job.kind, jobId: job.id, payload: job.payload, agent: agent.name },
    });
  }
  return reply({ ok: true });
}

// ---------------------------------------------------------------------------

const handler = withSupabase(
  { auth: "none", cors: "disabled" },
  async (request, context) => {
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }
    const client = clientKey(request);
    if (authThrottled(client)) {
      return reply({ ok: false, error: "too_many_attempts" }, 429, { "Retry-After": "300" });
    }
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    const agentId = agentIdFromToken(token);
    if (!agentId) {
      recordFailedAuth(client);
      return reply({ ok: false, error: "unauthorized" }, 401);
    }
    const length = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > LIMITS.bodyBytes) {
      return reply({ ok: false, error: "payload_too_large" }, 413);
    }

    const admin = context.supabaseAdmin;
    const { data: agent, error } = await admin
      .from("ipam_agents")
      .select("id, tenant_id, name, token_hash, status, config")
      .eq("id", agentId)
      .maybeSingle();
    if (error) return reply({ ok: false, error: "unavailable" }, 503);
    const hash = await sha256Hex(token);
    // Compare even when the agent is unknown so timing does not reveal ids.
    const expected = (agent as Agent | null)?.token_hash ?? "0".repeat(64);
    if (!timingSafeEqualHex(expected, hash) || !agent) {
      recordFailedAuth(client);
      return reply({ ok: false, error: "unauthorized" }, 401);
    }
    if ((agent as Agent).status !== "active") {
      return reply({ ok: false, error: "agent_disabled" }, 403);
    }
    const { data: allowed, error: touchError } = await admin.rpc("ipam_agent_touch", {
      p_agent_id: agent.id,
      p_limit: REQUESTS_PER_MINUTE,
    });
    if (touchError) return reply({ ok: false, error: "unavailable" }, 503);
    if (allowed !== true) return reply({ ok: false, error: "rate_limited" }, 429, { "Retry-After": "60" });

    const features = await resolveTenantFeatureStates(admin, agent.tenant_id, ["ipam.management"]);
    if (!features) return reply({ ok: false, error: "unavailable" }, 503);
    if (features["ipam.management"] !== true) {
      return reply({ ok: false, error: "feature_disabled" }, 403);
    }

    const text = await request.text().catch(() => null);
    if (text === null || encoder.encode(text).length > LIMITS.bodyBytes) {
      return reply({ ok: false, error: "payload_too_large" }, 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return reply({ ok: false, error: "invalid_json" }, 400);
    }
    if (!isObject(body)) return reply({ ok: false, error: "invalid_request" }, 422);
    switch (body.action) {
      case "hello":
        return await hello(admin, agent as Agent, body);
      case "report":
        return await handleReport(admin, agent as Agent, body);
      case "jobResult":
        return await jobResult(admin, agent as Agent, body);
      default:
        return reply({ ok: false, error: "unknown_action" }, 422);
    }
  },
);

export default { fetch: handler };
