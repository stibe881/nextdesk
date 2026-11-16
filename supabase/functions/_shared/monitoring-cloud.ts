/**
 * Checks nextDesk runs itself, without a probe: HTTP, certificate and DNS for
 * targets reachable from the internet. Internal targets belong to a probe;
 * addresses in private or special ranges are refused here, so a sensor can
 * never be used to reach services inside the hosting network.
 */

import { checkCertificate } from "../expiry-monitoring/checks.ts";

export type CloudCheck = {
  id: string;
  tenantId: string;
  kind: "http" | "cert" | "dns";
  host: string | null;
  port: number | null;
  url: string | null;
  expect: string | null;
  timeoutMs: number;
};

export type CloudOutcome = { ok: boolean; value: number | null; message: string | null };

const HOST =
  /^(?=.{1,253}$)[a-z0-9_]([a-z0-9_-]{0,62}[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]{0,62}[a-z0-9_])?)*$/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rows of monitoring_cloud_checks_due; anything unusable is dropped. */
export function parseCloudChecks(value: unknown): CloudCheck[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isObject(entry) || typeof entry.id !== "string" || typeof entry.tenantId !== "string") return [];
    if (entry.kind !== "http" && entry.kind !== "cert" && entry.kind !== "dns") return [];
    return [{
      id: entry.id,
      tenantId: entry.tenantId,
      kind: entry.kind,
      host: typeof entry.host === "string" ? entry.host.trim().toLowerCase() : null,
      port: typeof entry.port === "number" ? entry.port : null,
      url: typeof entry.url === "string" ? entry.url : null,
      expect: typeof entry.expect === "string" ? entry.expect.trim().toLowerCase() : null,
      timeoutMs: typeof entry.timeoutMs === "number" ? Math.min(Math.max(entry.timeoutMs, 500), 15000) : 5000,
    }];
  });
}

/**
 * True for addresses on the public internet. Private, loopback, link-local,
 * carrier-grade NAT, multicast, documentation and metadata ranges are not.
 */
export function isPublicAddress(address: string): boolean {
  const text = address.trim().toLowerCase();
  const v4 = IPV4.exec(text);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, b, Number(v4[3]), Number(v4[4])].some((part) => part > 255)) return false;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && (Number(v4[3]) === 0 || Number(v4[3]) === 2)))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && Number(v4[3]) === 100))) return false;
    if (a === 203 && b === 0 && Number(v4[3]) === 113) return false;
    return true;
  }
  if (!text.includes(":") || !/^[0-9a-f:.]+$/.test(text)) return false;
  // IPv4-mapped addresses are judged by their IPv4 part.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (mapped) return isPublicAddress(mapped[1]!);
  if (text === "::" || text === "::1") return false;
  const first = parseInt(text.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (first === 0x2001 && /^2001:0?db8:/.test(text)) return false; // documentation
  if (first === 0) return false;
  return true;
}

type Resolver = (name: string) => Promise<string[]>;

async function dohLookup(name: string, type: "A" | "AAAA"): Promise<string[]> {
  const response = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(5000) },
  );
  if (!response.ok) return [];
  const body = await response.json().catch(() => null);
  const wanted = type === "A" ? 1 : 28;
  return isObject(body) && Array.isArray(body.Answer)
    ? body.Answer.flatMap((answer) =>
      isObject(answer) && answer.type === wanted && typeof answer.data === "string" ? [answer.data] : []
    )
    : [];
}

/** A and AAAA records: system resolver, else DNS over HTTPS. */
export const resolveAddresses: Resolver = async (name) => {
  const lookup = async (type: "A" | "AAAA") => {
    try {
      return await Deno.resolveDns(name, type);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return [];
      return await dohLookup(name, type).catch(() => []);
    }
  };
  const [a, aaaa] = await Promise.all([lookup("A"), lookup("AAAA")]);
  return [...a, ...aaaa].map((address) => address.toLowerCase());
};

/**
 * The public addresses of a host, or the German reason why it must not be
 * checked from the cloud.
 */
export async function publicTarget(host: string, resolve: Resolver = resolveAddresses): Promise<string[] | string> {
  const name = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (IPV4.test(name) || name.includes(":")) {
    return isPublicAddress(name) ? [name] : "Interne Adressen misst nur eine Sonde, nicht die Cloud.";
  }
  if (!HOST.test(name) || !name.includes(".")) return "Der Hostname ist ungültig.";
  const addresses = await resolve(name);
  if (!addresses.length) return "Der Name lässt sich nicht auflösen.";
  return addresses.every(isPublicAddress)
    ? addresses
    : "Der Name zeigt auf eine interne Adresse. Interne Ziele misst nur eine Sonde.";
}

const round = (ms: number) => Math.round(ms * 100) / 100;

async function runHttp(check: CloudCheck, resolve: Resolver): Promise<CloudOutcome> {
  let url: URL;
  try {
    url = new URL(check.url ?? "");
  } catch {
    return { ok: false, value: null, message: "Die Adresse ist ungültig." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, value: null, message: "Die Adresse ist ungültig." };
  }
  const target = await publicTarget(url.hostname, resolve);
  if (typeof target === "string") return { ok: false, value: null, message: target };
  const started = performance.now();
  try {
    // Redirects are not followed: the target of a redirect is not checked.
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": "nextdesk-monitoring" },
      signal: AbortSignal.timeout(check.timeoutMs),
    });
    const value = round(performance.now() - started);
    await response.body?.cancel().catch(() => undefined);
    return { ok: response.status < 400, value, message: `HTTP ${response.status}` };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return { ok: false, value: null, message: timedOut ? "Zeitüberschreitung" : "Keine Verbindung" };
  }
}

/** Whole days until `expiresAt` (negative when expired). */
export function daysUntil(expiresAt: string, now: number): number | null {
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) ? Math.floor((at - now) / 86_400_000) : null;
}

async function runCert(check: CloudCheck, resolve: Resolver): Promise<CloudOutcome> {
  if (!check.host) return { ok: false, value: null, message: "Das Ziel fehlt." };
  const target = await publicTarget(check.host, resolve);
  if (typeof target === "string") return { ok: false, value: null, message: target };
  const result = await checkCertificate(check.host, check.port ?? 443);
  if (!result.ok) return { ok: false, value: null, message: result.error.slice(0, 300) };
  const days = daysUntil(result.certificate.expiresAt, Date.now());
  if (days === null) return { ok: false, value: null, message: "Das Ablaufdatum ist nicht lesbar." };
  if (days < 0) return { ok: false, value: days, message: "Das Zertifikat ist abgelaufen." };
  if (result.trusted === false) {
    return { ok: false, value: days, message: (result.note ?? "Zertifikat nicht vertrauenswürdig").slice(0, 300) };
  }
  return { ok: true, value: days, message: `Gültig bis ${result.certificate.expiresAt.slice(0, 10)}` };
}

async function runDns(check: CloudCheck, resolve: Resolver): Promise<CloudOutcome> {
  if (!check.host || !HOST.test(check.host)) return { ok: false, value: null, message: "Der Name ist ungültig." };
  const started = performance.now();
  const addresses = await resolve(check.host);
  const value = round(performance.now() - started);
  if (!addresses.length) return { ok: false, value: null, message: "Der Name lässt sich nicht auflösen." };
  if (check.expect && !addresses.includes(check.expect)) {
    return { ok: false, value, message: `Erwartet ${check.expect}, erhalten ${addresses.slice(0, 3).join(", ")}` };
  }
  return { ok: true, value, message: addresses.slice(0, 3).join(", ") };
}

export async function runCloudCheck(check: CloudCheck, resolve: Resolver = resolveAddresses): Promise<CloudOutcome> {
  try {
    if (check.kind === "http") return await runHttp(check, resolve);
    if (check.kind === "cert") return await runCert(check, resolve);
    return await runDns(check, resolve);
  } catch (error) {
    return { ok: false, value: null, message: (error instanceof Error ? error.message : "Fehler").slice(0, 200) };
  }
}

/** Runs `worker` for all items with limited concurrency. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!);
    }
  }));
  return results;
}
