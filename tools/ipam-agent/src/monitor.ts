/**
 * Monitoring checks (Überwachung): nextDesk delivers the checks with `hello`;
 * the agent runs each on its own interval (Ping, TCP port, HTTP) and reports
 * the results in batches (`monitorReport`). nextDesk decides about warning,
 * outage and incidents; the agent only measures.
 */

import { execFile } from "node:child_process";
import { Socket } from "node:net";

import type { NextdeskClient } from "./client.ts";
import { log } from "./log.ts";
import { canonicalIp } from "./net.ts";
import { parsePingOutput, pingArgs, type Platform } from "./parsers.ts";

export type Check = {
  id: string;
  kind: "ping" | "tcp" | "http";
  host: string | null;
  port: number | null;
  url: string | null;
  intervalSeconds: number;
  timeoutMs: number;
};

export type CheckResult = {
  id: string;
  at: string;
  ok: boolean;
  value: number | null;
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
    const base = { id: entry.id.toLowerCase(), intervalSeconds, timeoutMs };
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

type Outcome = { ok: boolean; value: number | null; message: string | null };

export async function runCheck(
  platform: Platform,
  check: Check,
): Promise<CheckResult> {
  const at = new Date().toISOString();
  let outcome: Outcome;
  try {
    outcome =
      check.kind === "ping"
        ? await checkPing(platform, check)
        : check.kind === "tcp"
          ? await checkTcp(check)
          : await checkHttp(check);
  } catch (error) {
    outcome = {
      ok: false,
      value: null,
      message: error instanceof Error ? error.message.slice(0, 200) : "Fehler",
    };
  }
  return { id: check.id, at, ...outcome };
}

type Scheduled = { check: Check; nextAt: number; running: boolean };

/**
 * Keeps the schedule. New checks start spread over their first interval (at
 * most 30 s) so that not all of them hit the network in the same second.
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
        const spread = Math.min(check.intervalSeconds, 30) * 1000;
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
  readonly #schedule = new Schedule();
  #buffer: CheckResult[] = [];
  #active = 0;
  #tick: NodeJS.Timeout | null = null;
  #lastFlush = Date.now();
  #flushing = false;

  constructor(client: NextdeskClient, platform: Platform) {
    this.#client = client;
    this.#platform = platform;
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
      void runCheck(this.#platform, check)
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
