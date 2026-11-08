// Network checks for expiry monitoring.
//
// Certificates (Supabase Edge Runtime / Deno):
// - `Deno.connectTls()` completes a handshake but `TlsConn.handshake()` only
//   exposes the ALPN protocol, never the peer certificate. It is therefore
//   only used as reachability/trust probe.
// - `node:tls` (`tls.connect().getPeerCertificate()`) returns the served
//   certificate (valid_to, issuer, subjectaltname, serialNumber) in current
//   Deno versions. This is the primary method ("tls"). It is used with
//   `rejectUnauthorized: false` so expired or untrusted certificates can still
//   be read.
// - If the runtime does not implement getPeerCertificate (older Edge Runtime
//   builds return undefined/empty objects or throw), we fall back to
//   certificate transparency via crt.sh ("ct"): the most recently issued
//   currently valid certificate covering the host is taken as the deployed
//   one, and a `Deno.connectTls` handshake that fails with an expiry error
//   marks it expired. This is a heuristic – a renewed but not yet deployed
//   certificate would be reported as valid.
//
// Domains: RDAP via https://rdap.org/domain/<name> (redirects to the
// registry). Some registries (e.g. .ch/.li at SWITCH) publish no expiration
// event; such domains end up with status «Fehler» and an explanatory message.

import tls from "node:tls";

import {
  type CertificateInfo,
  certificateFromPeer,
  parseRdapDomain,
  pickTransparencyCertificate,
  type RdapInfo,
} from "./expiry.ts";

const TIMEOUT_MS = 10_000;
const USER_AGENT = "nextDesk-Expiry-Monitoring/1.0 (+https://app.nextdesk.ch)";

export type CertificateCheck =
  | {
    ok: true;
    method: "tls" | "ct";
    certificate: CertificateInfo;
    trusted: boolean | null;
    note: string | null;
  }
  | { ok: false; error: string };

export type DomainCheck =
  | { ok: true; info: RdapInfo & { expiresAt: string } }
  | { ok: false; error: string };

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

function isIpAddress(host: string): boolean {
  return /^[0-9.]+$/.test(host) || host.includes(":");
}

/** Reads the served certificate with node:tls; null when unsupported. */
export function readPeerCertificate(
  host: string,
  port: number,
): Promise<{ certificate: CertificateInfo; trusted: boolean; authError: string | null } | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    // deno-lint-ignore no-explicit-any
    let socket: any;
    const finish = (
      value: { certificate: CertificateInfo; trusted: boolean; authError: string | null } | null,
      error?: unknown,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.destroy();
      } catch {
        // ignore
      }
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(null, new Error("Zeitüberschreitung beim TLS-Verbindungsaufbau")), TIMEOUT_MS);
    try {
      socket = tls.connect(
        {
          host,
          port,
          servername: isIpAddress(host) ? undefined : host,
          rejectUnauthorized: false,
        },
        () => {
          try {
            const peer = typeof socket.getPeerCertificate === "function"
              ? socket.getPeerCertificate()
              : null;
            const certificate = certificateFromPeer(peer);
            finish(
              certificate
                ? {
                  certificate,
                  trusted: socket.authorized === true,
                  authError: socket.authorizationError ? String(socket.authorizationError) : null,
                }
                : null,
            );
          } catch {
            finish(null);
          }
        },
      );
      socket.on("error", (error: unknown) => finish(null, error));
    } catch (error) {
      finish(null, error);
    }
  });
}

/** Handshake probe: null when trusted, otherwise the error text. */
async function probeHandshake(host: string, port: number): Promise<string | null> {
  let conn: Deno.TlsConn | null = null;
  const timer = setTimeout(() => {
    try {
      conn?.close();
    } catch {
      // ignore
    }
  }, TIMEOUT_MS);
  try {
    conn = await Deno.connectTls({ hostname: host, port });
    await conn.handshake();
    return null;
  } catch (error) {
    return errorText(error);
  } finally {
    clearTimeout(timer);
    try {
      conn?.close();
    } catch {
      // ignore
    }
  }
}

async function fetchJson(url: string): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS * 2);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json, application/rdap+json", "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function transparencyLookup(host: string, now: number): Promise<CertificateInfo | null> {
  const queries = [host];
  const parent = host.split(".").slice(1).join(".");
  if (parent.includes(".")) queries.push(`*.${parent}`);
  for (const query of queries) {
    const { status, body } = await fetchJson(
      `https://crt.sh/?q=${encodeURIComponent(query)}&output=json&deduplicate=Y`,
    );
    if (status !== 200) continue;
    const certificate = pickTransparencyCertificate(body, host, now);
    if (certificate) return certificate;
  }
  return null;
}

export async function checkCertificate(host: string, port: number): Promise<CertificateCheck> {
  let tlsError: string | null = null;
  try {
    const peer = await readPeerCertificate(host, port);
    if (peer) {
      return {
        ok: true,
        method: "tls",
        certificate: peer.certificate,
        trusted: peer.trusted,
        note: peer.trusted ? null : `Zertifikat nicht vertrauenswürdig: ${peer.authError ?? "unbekannt"}`.slice(0, 300),
      };
    }
  } catch (error) {
    tlsError = errorText(error);
  }

  // Fallback: certificate transparency plus handshake probe.
  const now = Date.now();
  const [handshakeError, certificate] = await Promise.all([
    tlsError ? Promise.resolve(tlsError) : probeHandshake(host, port),
    transparencyLookup(host, now).catch(() => null),
  ]);
  if (!certificate) {
    return {
      ok: false,
      error: handshakeError
        ? `TLS-Verbindung fehlgeschlagen: ${handshakeError}`.slice(0, 500)
        : "Das Zertifikat konnte weder direkt noch über Certificate Transparency ermittelt werden.",
    };
  }
  const expiredByHandshake = handshakeError !== null && /expired|abgelaufen/i.test(handshakeError);
  return {
    ok: true,
    method: "ct",
    certificate: expiredByHandshake && Date.parse(certificate.expiresAt) > now
      ? { ...certificate, expiresAt: new Date(now).toISOString() }
      : certificate,
    trusted: handshakeError === null,
    note: handshakeError ? `TLS-Prüfung: ${handshakeError}`.slice(0, 300) : null,
  };
}

export async function checkDomain(name: string): Promise<DomainCheck> {
  try {
    const { status, body } = await fetchJson(`https://rdap.org/domain/${encodeURIComponent(name)}`);
    if (status === 404) return { ok: false, error: "Die Domain wurde über RDAP nicht gefunden (nicht registriert oder die Endung bietet kein RDAP)." };
    if (status !== 200) return { ok: false, error: `RDAP-Abfrage fehlgeschlagen (HTTP ${status}).` };
    const info = parseRdapDomain(body);
    if (!info) return { ok: false, error: "Die RDAP-Antwort ist unvollständig." };
    if (!info.expiresAt) {
      return {
        ok: false,
        error: "Die Registry veröffentlicht kein Ablaufdatum über RDAP (z. B. .ch/.li). Bitte beim Registrar prüfen.",
      };
    }
    return { ok: true, info: { ...info, expiresAt: info.expiresAt } };
  } catch (error) {
    return { ok: false, error: `RDAP-Abfrage fehlgeschlagen: ${errorText(error)}`.slice(0, 500) };
  }
}
