// Netzwerkdaten eines Geräts aus der IP-Adressverwaltung (Funktion
// ipam-sync, Aktion assetNetwork) für die Karte «Netzwerk» im Assetdetail.

type RecordValue = Record<string, unknown>;

export type MobileNetworkFinding = {
  id: string;
  kind: string;
  severity: "info" | "warning" | "critical";
};

export type MobileNetworkAddress = {
  id: string;
  address: string;
  status: string;
  hostname: string | null;
  dnsName: string | null;
  macAddress: string | null;
  switchName: string | null;
  switchPort: string | null;
  lastSeenAt: string | null;
  prefix: string | null;
  gateway: string | null;
  vlan: { number: number; name: string } | null;
  site: string | null;
  findings: MobileNetworkFinding[];
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function records(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

const SEVERITIES = new Set(["info", "warning", "critical"]);

/** Liest die Antwort; null, wenn sie nicht wie erwartet aussieht. */
export function parseMobileAssetNetwork(
  response: unknown,
): MobileNetworkAddress[] | null {
  const data =
    isRecord(response) && isRecord(response.data) ? response.data : null;
  if (!data || !Array.isArray(data.addresses)) return null;
  return records(data.addresses).flatMap((row) => {
    const id = text(row.id);
    const address = text(row.address);
    if (!id || !address) return [];
    const prefix = isRecord(row.prefix) ? row.prefix : null;
    const vlan = isRecord(row.vlan) ? row.vlan : null;
    const site = isRecord(row.site) ? row.site : null;
    return [
      {
        id,
        address,
        status: text(row.status) ?? "active",
        hostname: text(row.hostname),
        dnsName: text(row.dns_name),
        macAddress: text(row.mac_address),
        switchName: text(row.switch_name),
        switchPort: text(row.switch_port),
        lastSeenAt: text(row.last_seen_at),
        prefix: prefix ? text(prefix.prefix) : null,
        gateway: prefix ? text(prefix.gateway) : null,
        vlan:
          vlan && typeof vlan.number === "number"
            ? { number: vlan.number, name: text(vlan.name) ?? "" }
            : null,
        site: site ? text(site.name) : null,
        findings: records(row.findings).flatMap((finding) => {
          const findingId = text(finding.id);
          const kind = text(finding.kind);
          const severity = text(finding.severity) ?? "warning";
          return findingId && kind && SEVERITIES.has(severity)
            ? [
                {
                  id: findingId,
                  kind,
                  severity: severity as MobileNetworkFinding["severity"],
                },
              ]
            : [];
        }),
      },
    ];
  });
}

const STATUS: Record<string, string> = {
  active: "Aktiv",
  reserved: "Reserviert",
  dhcp: "DHCP",
  deprecated: "Veraltet",
};

const FINDINGS: Record<string, string> = {
  ghost: "Unbekanntes Gerät im Netz",
  conflict: "IP-Konflikt",
  foreign_mac: "Fremde MAC auf dieser IP",
  dns_mismatch: "DNS stimmt nicht überein",
  stale: "Lange nicht gesehen",
  utilization: "Subnetz fast voll",
  outside_prefix: "Ausserhalb des Subnetzes",
  coverage: "Nicht in PRTG überwacht",
};

export function mobileAddressStatusLabel(status: string): string {
  return STATUS[status] ?? status;
}

export function mobileFindingLabel(kind: string): string {
  return FINDINGS[kind] ?? kind;
}

/** «gerade eben», «vor 5 Min.», «vor 3 Std.», «vor 4 Tagen», sonst Datum. */
export function mobileLastSeenLabel(
  value: string | null,
  now = Date.now(),
): string {
  if (!value) return "nie";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "unbekannt";
  const minutes = Math.round((now - time) / 60_000);
  if (minutes < 2) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  if (days === 1) return "vor 1 Tag";
  if (days < 30) return `vor ${days} Tagen`;
  return new Date(time).toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Zeilen für die Karte (Bezeichnung, Wert); leere Werte entfallen. */
export function mobileNetworkRows(
  entry: MobileNetworkAddress,
  now = Date.now(),
): [string, string][] {
  const rows: [string, string | null][] = [
    ["IP-Adresse", entry.address],
    ["Status", mobileAddressStatusLabel(entry.status)],
    ["Hostname", entry.hostname],
    ["DNS-Name", entry.dnsName],
    [
      "VLAN",
      entry.vlan
        ? `${entry.vlan.number}${entry.vlan.name ? ` · ${entry.vlan.name}` : ""}`
        : null,
    ],
    ["Subnetz", entry.prefix],
    ["Gateway", entry.gateway],
    ["Standort", entry.site],
    [
      "Switch-Port",
      entry.switchName
        ? `${entry.switchName}${entry.switchPort ? ` ${entry.switchPort}` : ""}`
        : null,
    ],
    ["MAC", entry.macAddress],
    ["Zuletzt gesehen", mobileLastSeenLabel(entry.lastSeenAt, now)],
  ];
  return rows.filter((row): row is [string, string] => Boolean(row[1]));
}
