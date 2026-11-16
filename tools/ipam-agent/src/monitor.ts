/**
 * Monitoring checks (Überwachung): nextDesk delivers the checks with `hello`;
 * the agent runs each on its own interval (Ping, TCP port, HTTP) and reports
 * the results in batches (`monitorReport`). nextDesk decides about warning,
 * outage and incidents; the agent only measures.
 */

import { execFile } from "node:child_process";
import { resolve4, resolve6 } from "node:dns/promises";
import { Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";

import type { NextdeskClient } from "./client.ts";
import type { LocalConfig } from "./config.ts";
import { log } from "./log.ts";
import { canonicalIp } from "./net.ts";
import { parsePingOutput, pingArgs, type Platform } from "./parsers.ts";
import { openSession, snmpGet, type SnmpValue } from "./snmp.ts";

export type Check = {
  id: string;
  kind: "ping" | "tcp" | "http" | "snmp" | "cert" | "dns";
  host: string | null;
  port: number | null;
  url: string | null;
  snmpMetric: "uptime" | "traffic" | "value" | null;
  snmpOid: string | null;
  snmpIndex: number | null;
  scale: number;
  /** DNS: address the name must resolve to (optional). */
  expect: string | null;
  intervalSeconds: number;
  timeoutMs: number;
};

export type CheckResult = {
  id: string;
  at: string;
  ok: boolean;
  value: number | null;
  value2?: number | null;
  message: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST =
  /^(?=.{1,253}$)[a-z0-9_](?:[a-z0-9_-]{0,62}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,62}[a-z0-9_])?)*$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : null;
}

/** An IP address or host name that is safe as a command argument. */
export function safeHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\.$/, "");
  const ip = canonicalIp(trimmed);
  if (ip) return ip;
  return HOST.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** Checks from `hello`; anything unusable is dropped. */
export function parseChecks(value: unknown): Check[] {
  if (!Array.isArray(value)) return [];
  const checks = new Map<string, Check>();
  for (const entry of value.slice(0, 20000)) {
    if (
      !isObject(entry) ||
      typeof entry.id !== "string" ||
      !UUID.test(entry.id)
    )
      continue;
    const intervalSeconds = integer(entry.intervalSeconds, 30, 86400) ?? 60;
    const timeoutMs = integer(entry.timeoutMs, 500, 30000) ?? 5000;
    const base = {
      id: entry.id.toLowerCase(),
      intervalSeconds,
      timeoutMs,
      snmpMetric: null,
      snmpOid: null,
      snmpIndex: null,
      scale: 1,
      expect: null,
    };
    if (entry.kind === "http") {
      let url: URL;
      try {
        url = new URL(String(entry.url));
      } catch {
        continue;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      checks.set(base.id, {
        ...base,
        kind: "http",
        host: null,
        port: null,
        url: url.href,
      });
      continue;
    }
    const host = safeHost(entry.host);
    if (!host) continue;
    if (entry.kind === "ping") {
      checks.set(base.id, {
        ...base,
        kind: "ping",
        host,
        port: null,
        url: null,
      });
    } else if (entry.kind === "tcp") {
      const port = integer(entry.port, 1, 65535);
      if (port)
        checks.set(base.id, { ...base, kind: "tcp", host, port, url: null });
    } else if (entry.kind === "cert") {
      checks.set(base.id, {
        ...base,
        kind: "cert",
        host,
        port: integer(entry.port, 1, 65535) ?? 443,
        url: null,
      });
    } else if (entry.kind === "dns") {
      checks.set(base.id, {
        ...base,
        kind: "dns",
        host,
        port: null,
        url: null,
        expect:
          typeof entry.expect === "string"
            ? canonicalIp(entry.expect.trim())
            : null,
      });
    } else if (entry.kind === "snmp") {
      const scale =
        typeof entry.scale === "number" &&
        entry.scale > 0 &&
        entry.scale <= 1e12
          ? entry.scale
          : 1;
      const snmpBase = {
        ...base,
        kind: "snmp" as const,
        host,
        port: null,
        url: null,
        scale,
      };
      if (entry.snmpMetric === "uptime") {
        checks.set(base.id, { ...snmpBase, snmpMetric: "uptime" });
      } else if (entry.snmpMetric === "traffic") {
        const snmpIndex = integer(entry.snmpIndex, 1, 2147483647);
        if (snmpIndex)
          checks.set(base.id, {
            ...snmpBase,
            snmpMetric: "traffic",
            snmpIndex,
          });
      } else if (
        entry.snmpMetric === "value" &&
        typeof entry.snmpOid === "string" &&
        /^1(\.\d{1,10}){2,60}$/.test(entry.snmpOid)
      ) {
        checks.set(base.id, {
          ...snmpBase,
          snmpMetric: "value",
          snmpOid: entry.snmpOid,
        });
      }
    }
  }
  return [...checks.values()];
}

function round(ms: number): number {
  return Math.round(ms * 100) / 100;
}

function pingOnce(
  platform: Platform,
  host: string,
  timeoutMs: number,
): Promise<{ alive: boolean; timeMs: number | null }> {
  return new Promise((resolve) => {
    const started = performance.now();
    execFile(
      platform === "win32" ? "ping.exe" : "ping",
      pingArgs(platform, host, timeoutMs),
      { timeout: timeoutMs + 3000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (_error, stdout) => {
        const parsed = parsePingOutput(String(stdout ?? ""));
        resolve({
          alive: parsed.alive,
          // «time<1ms» has no exact value: fall back to the measured duration.
          timeMs: parsed.alive
            ? (parsed.timeMs ?? round(performance.now() - started))
            : null,
        });
      },
    );
  });
}

async function checkPing(platform: Platform, check: Check): Promise<Outcome> {
  // One lost packet is not an outage: a second attempt follows at once.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await pingOnce(platform, check.host!, check.timeoutMs);
    if (result.alive) return { ok: true, value: result.timeMs, message: null };
  }
  return { ok: false, value: null, message: "Keine Antwort auf Ping" };
}

function checkTcp(check: Check): Promise<Outcome> {
  return new Promise((resolve) => {
    const started = performance.now();
    const socket = new Socket();
    let settled = false;
    const finish = (outcome: Outcome) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(outcome);
    };
    socket.setTimeout(check.timeoutMs);
    socket.once("connect", () =>
      finish({
        ok: true,
        value: round(performance.now() - started),
        message: null,
      }),
    );
    socket.once("timeout", () =>
      finish({
        ok: false,
        value: null,
        message: `Port ${check.port}: keine Antwort (Zeitüberschreitung)`,
      }),
    );
    socket.once("error", (error: NodeJS.ErrnoException) =>
      finish({
        ok: false,
        value: null,
        message:
          error.code === "ECONNREFUSED"
            ? `Port ${check.port} geschlossen`
            : `Port ${check.port}: ${error.code ?? "Verbindungsfehler"}`,
      }),
    );
    socket.connect(check.port!, check.host!);
  });
}

async function checkHttp(check: Check): Promise<Outcome> {
  const started = performance.now();
  try {
    const response = await fetch(check.url!, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "nextdesk-monitoring" },
      signal: AbortSignal.timeout(check.timeoutMs),
    });
    const value = round(performance.now() - started);
    await response.body?.cancel().catch(() => undefined);
    return response.status < 400
      ? { ok: true, value, message: `HTTP ${response.status}` }
      : { ok: false, value, message: `HTTP ${response.status}` };
  } catch (error) {
    const cause =
      error instanceof Error && isObject(error.cause)
        ? String(error.cause.code ?? "")
        : "";
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false,
      value: null,
      message: timedOut
        ? "Zeitüberschreitung"
        : `Keine Verbindung${cause ? ` (${cause})` : ""}`,
    };
  }
}

type Outcome = {
  ok: boolean;
  value: number | null;
  value2?: number | null;
  message: string | null;
};

const SNMP_OID = {
  sysUpTime: "1.3.6.1.2.1.1.3.0",
  ifOperStatus: "1.3.6.1.2.1.2.2.1.8",
  ifInOctets: "1.3.6.1.2.1.2.2.1.10",
  ifOutOctets: "1.3.6.1.2.1.2.2.1.16",
  ifHCInOctets: "1.3.6.1.2.1.31.1.1.1.6",
  ifHCOutOctets: "1.3.6.1.2.1.31.1.1.1.10",
};

/** Number from an SNMP value (Integer, Gauge, Counter, TimeTicks, Counter64, numeric text). */
export function snmpNumber(entry: SnmpValue): number | null {
  if (!entry) return null;
  const value = entry.value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Uint8Array) {
    // Counter64 (type 70) arrives as up to 8 raw bytes.
    if (entry.type === 70) {
      if (value.length === 0 || value.length > 8) return null;
      let number = 0n;
      for (const byte of value) number = (number << 8n) | BigInt(byte);
      return Number(number);
    }
    const text = Buffer.from(value).toString("latin1").trim();
    return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null;
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim()))
    return Number(value.trim());
  return null;
}

export type CounterSample = {
  at: number;
  input: number;
  output: number;
  bits: 32 | 64;
};

/**
 * Bits per second between two readings of the octet counters. Null when no
 * rate can be derived: first reading, device restart (counter went down on a
 * 64-bit counter) or an implausible gap.
 */
export function trafficRate(
  previous: CounterSample | undefined,
  current: CounterSample,
): { input: number; output: number } | null {
  if (!previous || previous.bits !== current.bits) return null;
  const seconds = (current.at - previous.at) / 1000;
  if (seconds < 1 || seconds > 6 * 3600) return null;
  const delta = (now: number, before: number): number | null => {
    if (now >= before) return now - before;
    // A 32-bit counter wraps at 2^32; a 64-bit counter only falls on restart.
    return current.bits === 32 ? now + 2 ** 32 - before : null;
  };
  const input = delta(current.input, previous.input);
  const output = delta(current.output, previous.output);
  if (input === null || output === null) return null;
  return {
    input: round((input * 8) / seconds),
    output: round((output * 8) / seconds),
  };
}

async function checkSnmp(
  local: LocalConfig,
  check: Check,
  counters: Map<string, CounterSample>,
): Promise<Outcome> {
  const session = openSession(local, check.host!);
  try {
    if (check.snmpMetric === "uptime") {
      const [ticks] = await snmpGet(session, [SNMP_OID.sysUpTime]);
      const value = snmpNumber(ticks ?? null);
      return value === null
        ? { ok: false, value: null, message: "Keine Laufzeit erhalten" }
        : { ok: true, value: Math.round(value / 100), message: null };
    }
    if (check.snmpMetric === "value") {
      const [entry] = await snmpGet(session, [check.snmpOid!]);
      const value = snmpNumber(entry ?? null);
      return value === null
        ? {
            ok: false,
            value: null,
            message: entry
              ? "Der Wert ist keine Zahl"
              : "Die OID gibt es auf dem Gerät nicht",
          }
        : { ok: true, value: round(value * check.scale), message: null };
    }
    const index = check.snmpIndex!;
    const [status, hcIn, hcOut, in32, out32] = await snmpGet(session, [
      `${SNMP_OID.ifOperStatus}.${index}`,
      `${SNMP_OID.ifHCInOctets}.${index}`,
      `${SNMP_OID.ifHCOutOctets}.${index}`,
      `${SNMP_OID.ifInOctets}.${index}`,
      `${SNMP_OID.ifOutOctets}.${index}`,
    ]);
    const at = Date.now();
    const highIn = snmpNumber(hcIn ?? null);
    const highOut = snmpNumber(hcOut ?? null);
    const lowIn = snmpNumber(in32 ?? null);
    const lowOut = snmpNumber(out32 ?? null);
    const reading: CounterSample | null =
      highIn !== null && highOut !== null
        ? { at, input: highIn, output: highOut, bits: 64 }
        : lowIn !== null && lowOut !== null
          ? { at, input: lowIn, output: lowOut, bits: 32 }
          : null;
    if (!reading) {
      counters.delete(check.id);
      return {
        ok: false,
        value: null,
        message: "Den Port gibt es auf dem Gerät nicht",
      };
    }
    const rate = trafficRate(counters.get(check.id), reading);
    counters.set(check.id, reading);
    const operStatus = snmpNumber(status ?? null);
    if (operStatus !== null && operStatus !== 1) {
      return {
        ok: false,
        value: null,
        message: "Port ist nicht verbunden (down)",
      };
    }
    return {
      ok: true,
      value: rate?.input ?? null,
      value2: rate?.output ?? null,
      message: null,
    };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      value: null,
      message: /timed? ?out/i.test(text)
        ? "Keine SNMP-Antwort (Zeitüberschreitung)"
        : `SNMP: ${text.slice(0, 160)}`,
    };
  } finally {
    session.close();
  }
}

/** Whole days until `validTo` (negative when expired). */
export function daysUntil(validTo: string, now: number): number | null {
  const at = Date.parse(validTo);
  return Number.isFinite(at) ? Math.floor((at - now) / 86_400_000) : null;
}

/**
 * Certificate served by host:port. A certificate of an internal CA is read
 * too (the probe does not judge trust), only expiry and reachability count.
 */
function checkCert(check: Check): Promise<Outcome> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: Outcome) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(outcome);
    };
    const host = check.host!;
    const socket = tlsConnect(
      {
        host,
        port: check.port ?? 443,
        rejectUnauthorized: false,
        // SNI only for names, not for IP addresses.
        ...(canonicalIp(host) ? {} : { servername: host }),
      },
      () => {
        const certificate = socket.getPeerCertificate();
        const days = certificate?.valid_to
          ? daysUntil(certificate.valid_to, Date.now())
          : null;
        if (days === null)
          return finish({
            ok: false,
            value: null,
            message: "Kein Zertifikat erhalten",
          });
        finish(
          days < 0
            ? {
                ok: false,
                value: days,
                message: "Das Zertifikat ist abgelaufen.",
              }
            : {
                ok: true,
                value: days,
                message: `Gültig bis ${new Date(certificate.valid_to).toISOString().slice(0, 10)}`,
              },
        );
      },
    );
    socket.setTimeout(check.timeoutMs, () =>
      finish({ ok: false, value: null, message: "Zeitüberschreitung" }),
    );
    socket.once("error", (error: NodeJS.ErrnoException) =>
      finish({
        ok: false,
        value: null,
        message: `TLS-Verbindung fehlgeschlagen (${error.code ?? "Fehler"})`,
      }),
    );
  });
}

async function checkDns(check: Check): Promise<Outcome> {
  const started = performance.now();
  const lookup = (resolver: (name: string) => Promise<string[]>) =>
    resolver(check.host!).catch(() => [] as string[]);
  const addresses = (await Promise.all([lookup(resolve4), lookup(resolve6)]))
    .flat()
    .map((address) => canonicalIp(address) ?? address);
  const value = round(performance.now() - started);
  if (!addresses.length)
    return {
      ok: false,
      value: null,
      message: "Der Name lässt sich nicht auflösen.",
    };
  if (check.expect && !addresses.includes(check.expect))
    return {
      ok: false,
      value,
      message: `Erwartet ${check.expect}, erhalten ${addresses.slice(0, 3).join(", ")}`,
    };
  return { ok: true, value, message: addresses.slice(0, 3).join(", ") };
}

export type CheckContext = {
  local: LocalConfig;
  counters: Map<string, CounterSample>;
};

export async function runCheck(
  platform: Platform,
  check: Check,
  context?: CheckContext,
): Promise<CheckResult> {
  const at = new Date().toISOString();
  let outcome: Outcome;
  try {
    outcome =
      check.kind === "ping"
        ? await checkPing(platform, check)
        : check.kind === "tcp"
          ? await checkTcp(check)
          : check.kind === "http"
            ? await checkHttp(check)
            : check.kind === "cert"
              ? await checkCert(check)
              : check.kind === "dns"
                ? await checkDns(check)
                : context
                  ? await checkSnmp(context.local, check, context.counters)
                  : {
                      ok: false,
                      value: null,
                      message: "SNMP ist nicht eingerichtet",
                    };
  } catch (error) {
    outcome = {
      ok: false,
      value: null,
      message: error instanceof Error ? error.message.slice(0, 200) : "Fehler",
    };
  }
  return { id: check.id, at, ...outcome };
}

/** After a start the first run of each check falls into this window. */
export const START_SPREAD_SECONDS = 60;

type Scheduled = { check: Check; nextAt: number; running: boolean };

/**
 * Keeps the schedule. New checks start spread over their first interval (at
 * most a minute) so that not all of them hit the network in the same second.
 */
export class Schedule {
  readonly #entries = new Map<string, Scheduled>();
  readonly #random: () => number;

  constructor(random: () => number = Math.random) {
    this.#random = random;
  }

  get size(): number {
    return this.#entries.size;
  }

  update(checks: readonly Check[], now: number): void {
    const seen = new Set<string>();
    for (const check of checks) {
      seen.add(check.id);
      const existing = this.#entries.get(check.id);
      if (existing) {
        const changed =
          existing.check.intervalSeconds !== check.intervalSeconds;
        existing.check = check;
        if (changed)
          existing.nextAt = Math.min(
            existing.nextAt,
            now + check.intervalSeconds * 1000,
          );
      } else {
        const spread =
          Math.min(check.intervalSeconds, START_SPREAD_SECONDS) * 1000;
        this.#entries.set(check.id, {
          check,
          nextAt: now + Math.floor(this.#random() * spread),
          running: false,
        });
      }
    }
    for (const id of this.#entries.keys())
      if (!seen.has(id)) this.#entries.delete(id);
  }

  /** Checks that are due; each is marked as running until `done`. */
  due(now: number, limit: number): Check[] {
    const result: Check[] = [];
    for (const entry of this.#entries.values()) {
      if (result.length >= limit) break;
      if (entry.running || entry.nextAt > now) continue;
      entry.running = true;
      // Next run from the plan, not from the end of this run (no drift);
      // after a long pause the missed runs are skipped.
      const interval = entry.check.intervalSeconds * 1000;
      entry.nextAt += interval;
      if (entry.nextAt <= now) entry.nextAt = now + interval;
      result.push(entry.check);
    }
    return result;
  }

  done(id: string): void {
    const entry = this.#entries.get(id);
    if (entry) entry.running = false;
  }
}

const MAX_PARALLEL = 64;
const MAX_BUFFER = 50000;
const REPORT_CHUNK = 2000;
const FLUSH_MS = 30_000;

export class Monitor {
  readonly #client: NextdeskClient;
  readonly #platform: Platform;
  readonly #context: CheckContext;
  readonly #schedule = new Schedule();
  #buffer: CheckResult[] = [];
  #active = 0;
  #tick: NodeJS.Timeout | null = null;
  #lastFlush = Date.now();
  #flushing = false;

  constructor(client: NextdeskClient, platform: Platform, local: LocalConfig) {
    this.#client = client;
    this.#platform = platform;
    this.#context = { local, counters: new Map() };
  }

  setChecks(checks: readonly Check[]): void {
    const before = this.#schedule.size;
    this.#schedule.update(checks, Date.now());
    if (before !== this.#schedule.size)
      log.info(`Überwachung: ${this.#schedule.size} Sensoren`);
    if (this.#schedule.size && !this.#tick) {
      this.#tick = setInterval(() => this.#run(), 1000);
    } else if (!this.#schedule.size && this.#tick) {
      clearInterval(this.#tick);
      this.#tick = null;
    }
  }

  #run(): void {
    const now = Date.now();
    for (const check of this.#schedule.due(now, MAX_PARALLEL - this.#active)) {
      this.#active += 1;
      void runCheck(this.#platform, check, this.#context)
        .then((result) => {
          this.#buffer.push(result);
          if (this.#buffer.length > MAX_BUFFER)
            this.#buffer.splice(0, this.#buffer.length - MAX_BUFFER);
        })
        .finally(() => {
          this.#active -= 1;
          this.#schedule.done(check.id);
        });
    }
    if (
      now - this.#lastFlush >= FLUSH_MS ||
      this.#buffer.length >= REPORT_CHUNK
    )
      void this.flush();
  }

  /** Sends the buffered results; they stay buffered when nextDesk is unreachable. */
  async flush(): Promise<void> {
    if (this.#flushing || !this.#buffer.length) return;
    this.#flushing = true;
    this.#lastFlush = Date.now();
    try {
      while (this.#buffer.length) {
        const chunk = this.#buffer.slice(0, REPORT_CHUNK);
        await this.#client.post({ action: "monitorReport", results: chunk }, 2);
        this.#buffer.splice(0, chunk.length);
      }
    } catch (error) {
      log.warn(
        `Überwachung: ${this.#buffer.length} Resultate noch nicht gemeldet`,
        error,
      );
    } finally {
      this.#flushing = false;
    }
  }

  async stop(): Promise<void> {
    if (this.#tick) clearInterval(this.#tick);
    this.#tick = null;
    await this.flush();
  }
}
