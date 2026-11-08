// Pure logic for certificate and domain expiry monitoring: input parsing,
// RDAP and certificate-transparency parsing, status and ticket decisions.

export const DAY_MS = 86_400_000;

export type TargetKind = "certificate" | "domain";
export type ExpiryStatus = "valid" | "expiring" | "expired" | "error";
export type TicketStage = "warned" | "reminded";

const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Lowercase DNS name with at least two labels (no IP addresses, no wildcards). */
export function normalizeHostname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253) return null;
  const labels = host.split(".");
  if (labels.length < 2) return null;
  if (!labels.every((label) => HOST_LABEL.test(label))) return null;
  // Top-level label must not be purely numeric (rejects IPv4 addresses).
  if (/^[0-9]+$/.test(labels[labels.length - 1] ?? "")) return null;
  return host;
}

/**
 * Parses «host», «host:port» or a URL such as «https://host:8443/path».
 * Certificates default to port 443.
 */
export function parseCertificateTarget(
  value: unknown,
  port?: unknown,
): { host: string; port: number } | null {
  if (typeof value !== "string") return null;
  let raw = value.trim();
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  raw = raw.split(/[/?#]/)[0] ?? "";
  let parsedPort: number | null = null;
  const match = /^(.*):(\d{1,5})$/.exec(raw);
  if (match) {
    raw = match[1] ?? "";
    parsedPort = Number(match[2]);
  }
  if (port !== undefined && port !== null && port !== "") {
    const explicit = Number(port);
    if (!Number.isInteger(explicit)) return null;
    parsedPort = explicit;
  }
  const finalPort = parsedPort ?? 443;
  if (!Number.isInteger(finalPort) || finalPort < 1 || finalPort > 65535) {
    return null;
  }
  const host = normalizeHostname(raw);
  return host ? { host, port: finalPort } : null;
}

export function parseDomainTarget(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .split(/[/?#:]/)[0];
  return normalizeHostname(raw);
}

// RDAP --------------------------------------------------------------------

export type RdapInfo = {
  expiresAt: string | null;
  registrar: string | null;
  statuses: string[];
  ldhName: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function vcardName(entity: Record<string, unknown>): string | null {
  const card = entity.vcardArray;
  if (!Array.isArray(card) || !Array.isArray(card[1])) return null;
  for (const entry of card[1]) {
    if (Array.isArray(entry) && entry[0] === "fn" && typeof entry[3] === "string") {
      return entry[3].trim() || null;
    }
  }
  return null;
}

/** Reads expiration date, registrar and status from an RDAP domain response. */
export function parseRdapDomain(value: unknown): RdapInfo | null {
  if (!isRecord(value)) return null;
  if (value.objectClassName !== undefined && value.objectClassName !== "domain") {
    return null;
  }
  let expiresAt: string | null = null;
  if (Array.isArray(value.events)) {
    for (const event of value.events) {
      if (!isRecord(event)) continue;
      const action = typeof event.eventAction === "string"
        ? event.eventAction.toLowerCase()
        : "";
      if (action !== "expiration" && action !== "registration expiration") continue;
      if (typeof event.eventDate !== "string") continue;
      const time = Date.parse(event.eventDate);
      if (Number.isNaN(time)) continue;
      const iso = new Date(time).toISOString();
      if (!expiresAt || iso > expiresAt) expiresAt = iso;
    }
  }
  let registrar: string | null = null;
  if (Array.isArray(value.entities)) {
    for (const entity of value.entities) {
      if (!isRecord(entity) || !Array.isArray(entity.roles)) continue;
      if (!entity.roles.includes("registrar")) continue;
      registrar = vcardName(entity) ??
        (typeof entity.handle === "string" ? entity.handle : null);
      if (registrar) break;
    }
  }
  return {
    expiresAt,
    registrar: registrar ? registrar.slice(0, 300) : null,
    statuses: Array.isArray(value.status)
      ? value.status.filter((entry): entry is string => typeof entry === "string").slice(0, 20)
      : [],
    ldhName: typeof value.ldhName === "string" ? value.ldhName.toLowerCase() : null,
  };
}

// Certificates --------------------------------------------------------------

export type CertificateInfo = {
  expiresAt: string;
  notBefore: string | null;
  issuer: string | null;
  subject: string | null;
  san: string[];
  serial: string | null;
};

/** True when a certificate name (possibly «*.example.com») covers the host. */
export function nameCoversHost(name: string, host: string): boolean {
  const pattern = name.trim().toLowerCase().replace(/\.$/, "");
  if (!pattern) return false;
  if (pattern === host) return true;
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1);
    const rest = host.slice(0, host.length - suffix.length);
    return host.endsWith(suffix) && rest.length > 0 && !rest.includes(".");
  }
  return false;
}

/** crt.sh timestamps have no zone suffix; they are UTC. */
function ctDate(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const time = Date.parse(normalized);
  return Number.isNaN(time) ? null : time;
}

/**
 * Picks the certificate most likely deployed for the host from crt.sh JSON
 * (certificate transparency): among entries covering the host the most
 * recently issued one that is currently valid, otherwise the one that
 * expired last.
 */
export function pickTransparencyCertificate(
  value: unknown,
  host: string,
  now: number,
): CertificateInfo | null {
  if (!Array.isArray(value)) return null;
  type Candidate = CertificateInfo & { notBeforeMs: number; notAfterMs: number };
  const candidates: Candidate[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const names = [
      ...(typeof entry.name_value === "string" ? entry.name_value.split(/\s+/) : []),
      ...(typeof entry.common_name === "string" ? [entry.common_name] : []),
    ].map((name) => name.trim().toLowerCase()).filter(Boolean);
    if (!names.some((name) => nameCoversHost(name, host))) continue;
    const notBeforeMs = ctDate(entry.not_before);
    const notAfterMs = ctDate(entry.not_after);
    if (notBeforeMs === null || notAfterMs === null) continue;
    candidates.push({
      expiresAt: new Date(notAfterMs).toISOString(),
      notBefore: new Date(notBeforeMs).toISOString(),
      issuer: typeof entry.issuer_name === "string" ? entry.issuer_name.slice(0, 500) : null,
      subject: typeof entry.common_name === "string" ? `CN=${entry.common_name}`.slice(0, 500) : null,
      san: [...new Set(names)].slice(0, 200),
      serial: typeof entry.serial_number === "string" ? entry.serial_number.slice(0, 200) : null,
      notBeforeMs,
      notAfterMs,
    });
  }
  if (!candidates.length) return null;
  const current = candidates.filter((c) => c.notBeforeMs <= now && c.notAfterMs > now);
  const pool = current.length ? current : candidates;
  pool.sort((a, b) =>
    current.length
      ? b.notBeforeMs - a.notBeforeMs || b.notAfterMs - a.notAfterMs
      : b.notAfterMs - a.notAfterMs
  );
  const best = pool[0]!;
  const { notBeforeMs: _nb, notAfterMs: _na, ...info } = best;
  return info;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Parses OpenSSL-style dates such as «Dec  6 00:48:51 2026 GMT». */
export function parseOpensslDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})\s*(GMT|UTC)?$/.exec(
    value.trim(),
  );
  if (!match) {
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : new Date(time).toISOString();
  }
  const month = MONTHS[match[1]!.toLowerCase()];
  if (month === undefined) return null;
  return new Date(
    Date.UTC(
      Number(match[6]),
      month,
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
    ),
  ).toISOString();
}

function distinguishedName(value: unknown): string | null {
  if (typeof value === "string") return value.slice(0, 500) || null;
  if (!isRecord(value)) return null;
  const parts = ["CN", "O", "OU", "C"]
    .flatMap((key) => {
      const entry = value[key];
      const text = Array.isArray(entry) ? entry.join("+") : entry;
      return typeof text === "string" && text ? [`${key}=${text}`] : [];
    });
  return parts.length ? parts.join(", ").slice(0, 500) : null;
}

/** Converts a node:tls `getPeerCertificate()` result. */
export function certificateFromPeer(value: unknown): CertificateInfo | null {
  if (!isRecord(value)) return null;
  const expiresAt = parseOpensslDate(value.valid_to);
  if (!expiresAt) return null;
  const san = typeof value.subjectaltname === "string"
    ? value.subjectaltname
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => /^DNS:/i.test(entry))
      .map((entry) => entry.slice(4).toLowerCase())
    : [];
  return {
    expiresAt,
    notBefore: parseOpensslDate(value.valid_from),
    issuer: distinguishedName(value.issuer),
    subject: distinguishedName(value.subject),
    san: [...new Set(san)].slice(0, 200),
    serial: typeof value.serialNumber === "string" ? value.serialNumber.slice(0, 200) : null,
  };
}

// Decisions -----------------------------------------------------------------

export function daysUntil(expiresAt: string, now: number): number {
  return (Date.parse(expiresAt) - now) / DAY_MS;
}

export function classifyExpiry(
  expiresAt: string | null,
  now: number,
  warnDays: number,
): ExpiryStatus {
  if (!expiresAt || Number.isNaN(Date.parse(expiresAt))) return "error";
  const days = daysUntil(expiresAt, now);
  if (days <= 0) return "expired";
  if (days <= warnDays) return "expiring";
  return "valid";
}

export type ExpiryTicketState = {
  /** A monitoring ticket for this target is still open. */
  open: boolean;
  stage: TicketStage | null;
  /** Expiry date the last ticket was about. */
  expiresAt: string | null;
};

export type ExpiryAction =
  | { type: "none" }
  | { type: "create"; stage: TicketStage }
  | { type: "remind" }
  | { type: "renewed" };

function sameExpiry(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return Math.abs(Date.parse(a) - Date.parse(b)) < DAY_MS;
}

/**
 * Decides what happens after a check.
 * - A new expiry date later than the one ticketed means renewal: comment and
 *   resolve the open ticket.
 * - Inside warn_days one ticket per expiry date; inside reminder_days the open
 *   ticket gets a reminder and a higher priority (once), or a reminder ticket
 *   is created when the first one was closed without renewal.
 */
export function decideExpiryAction(input: {
  expiresAt: string | null;
  now: number;
  warnDays: number;
  reminderDays: number;
  ticket: ExpiryTicketState;
}): ExpiryAction {
  const { expiresAt, now, warnDays, reminderDays, ticket } = input;
  if (!expiresAt || Number.isNaN(Date.parse(expiresAt))) return { type: "none" };
  if (
    ticket.open &&
    ticket.expiresAt &&
    Date.parse(expiresAt) - Date.parse(ticket.expiresAt) >= DAY_MS
  ) {
    return { type: "renewed" };
  }
  const days = daysUntil(expiresAt, now);
  const ticketed = sameExpiry(ticket.expiresAt, expiresAt);
  if (days <= reminderDays) {
    if (ticketed && ticket.stage === "reminded") return { type: "none" };
    if (ticket.open && ticketed) return { type: "remind" };
    if (ticket.open) return { type: "none" };
    return { type: "create", stage: "reminded" };
  }
  if (days <= warnDays) {
    if (ticketed || ticket.open) return { type: "none" };
    return { type: "create", stage: "warned" };
  }
  return { type: "none" };
}

/**
 * Next check: daily while valid, every 6 hours inside the warning window (so
 * renewals are noticed quickly), after errors 3, 6, 12 then 24 hours.
 */
export function nextCheckDelayMs(status: ExpiryStatus, consecutiveErrors: number): number {
  const hour = 3_600_000;
  if (status === "error") return Math.min(24, 3 * 2 ** Math.max(0, consecutiveErrors - 1)) * hour;
  if (status === "valid") return 24 * hour;
  return 6 * hour;
}

// Ticket texts --------------------------------------------------------------

export type TargetText = {
  kind: TargetKind;
  host: string;
  port: number | null;
  label: string | null;
  assetName: string | null;
  serviceName: string | null;
};

export function targetLabel(target: Pick<TargetText, "kind" | "host" | "port">): string {
  return target.kind === "certificate" && target.port !== null && target.port !== 443
    ? `${target.host}:${target.port}`
    : target.host;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Zurich",
  });
}

function daysPhrase(days: number): string {
  const whole = Math.ceil(days);
  if (whole <= 0) return "abgelaufen";
  return whole === 1 ? "in 1 Tag" : `in ${whole} Tagen`;
}

export function expiryTicketSubject(
  target: TargetText,
  expiresAt: string,
  now: number,
): string {
  const what = target.kind === "certificate" ? "Zertifikat" : "Domain";
  const days = daysUntil(expiresAt, now);
  const state = days <= 0 ? "abgelaufen" : `läuft ab (${daysPhrase(days)})`;
  return `${what} ${state}: ${targetLabel(target)}`.slice(0, 300);
}

export type ExpiryDetails = {
  expiresAt: string;
  issuer: string | null;
  subject: string | null;
  san: string[];
  serial: string | null;
  registrar: string | null;
  statuses: string[];
  method: "tls" | "ct" | "rdap";
};

export function expiryTicketDescription(
  target: TargetText,
  details: ExpiryDetails,
  now: number,
  stage: TicketStage,
): string {
  const days = daysUntil(details.expiresAt, now);
  const lines: string[] = [];
  if (target.kind === "certificate") {
    lines.push(
      `Das TLS-Zertifikat von ${targetLabel(target)} ${
        days <= 0 ? "ist abgelaufen" : `läuft ${daysPhrase(days)} ab`
      } (${formatDate(details.expiresAt)}).`,
      "",
      `Aussteller: ${details.issuer ?? "unbekannt"}`,
    );
    if (details.subject) lines.push(`Inhaber: ${details.subject}`);
    if (details.san.length) {
      lines.push(`Alternative Namen (SAN): ${details.san.slice(0, 40).join(", ")}`);
    }
    if (details.serial) lines.push(`Seriennummer: ${details.serial}`);
    lines.push(
      `Ermittelt über: ${
        details.method === "tls"
          ? "TLS-Verbindung (ausgeliefertes Zertifikat)"
          : "Certificate Transparency (crt.sh, zuletzt ausgestelltes Zertifikat)"
      }`,
      "",
      "Erneuerung:",
      "1. Zertifikat beim Aussteller erneuern bzw. die automatische Erneuerung (z. B. ACME/Let's Encrypt) prüfen.",
      `2. Neues Zertifikat inkl. Zwischenzertifikaten auf ${targetLabel(target)} und allen weiteren Systemen mit denselben Namen einspielen.`,
      "3. Dienst neu laden. nextDesk erkennt die Erneuerung bei der nächsten Prüfung und schliesst dieses Ticket automatisch.",
    );
  } else {
    lines.push(
      `Die Registrierung der Domain ${target.host} ${
        days <= 0 ? "ist abgelaufen" : `läuft ${daysPhrase(days)} ab`
      } (${formatDate(details.expiresAt)}).`,
      "",
      `Registrar: ${details.registrar ?? "unbekannt"}`,
    );
    if (details.statuses.length) {
      lines.push(`RDAP-Status: ${details.statuses.join(", ")}`);
    }
    lines.push(
      "",
      "Erneuerung:",
      "1. Beim Registrar prüfen, ob die automatische Verlängerung aktiv ist und die Zahlungsangaben gültig sind.",
      "2. Domain verlängern. nextDesk erkennt das neue Ablaufdatum über RDAP und schliesst dieses Ticket automatisch.",
    );
  }
  if (target.label) lines.push("", `Bezeichnung: ${target.label}`);
  if (target.assetName) lines.push(`Verknüpftes Asset: ${target.assetName}`);
  if (target.serviceName) lines.push(`Verknüpfter Dienst: ${target.serviceName}`);
  if (stage === "reminded") {
    lines.push("", "Erinnerung: Die Frist ist kurz, die Priorität wurde erhöht.");
  }
  return lines.join("\n");
}

export function reminderComment(target: TargetText, expiresAt: string, now: number): string {
  const days = daysUntil(expiresAt, now);
  return `Erinnerung: ${target.kind === "certificate" ? "Das Zertifikat" : "Die Domain"} ${targetLabel(target)} ${
    days <= 0 ? "ist abgelaufen" : `läuft ${daysPhrase(days)} ab`
  } (${formatDate(expiresAt)}). Die Priorität wurde erhöht.`;
}

export function renewedComment(
  target: TargetText,
  previous: string | null,
  next: string,
): string {
  return `Erneuerung erkannt: ${target.kind === "certificate" ? "Das Zertifikat" : "Die Domain"} ${targetLabel(target)} ist neu gültig bis ${formatDate(next)}${
    previous ? ` (bisher ${formatDate(previous)})` : ""
  }.`;
}
