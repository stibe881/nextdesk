// Darstellung der IPAM-Treffer (Funktion ipam-sync: ticketLookup,
// assetNetwork) im Ticket: Antwort prüfen und Texte aufbereiten.

type Row = Record<string, unknown>;

export type NetworkFinding = {
  id: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  firstSeenAt: string | null;
};

export type NetworkAddress = {
  id: string;
  address: string;
  status: string;
  hostname: string | null;
  dnsName: string | null;
  macAddress: string | null;
  vendor: string | null;
  deviceType: string | null;
  switchName: string | null;
  switchPort: string | null;
  lastSeenAt: string | null;
  lastSeenSource: string | null;
  intuneDeviceId: string | null;
  prtgDeviceId: string | null;
  owner: string | null;
  intuneUser: string | null;
  asset: { id: string; name: string; assetTag: string | null } | null;
  prefix: { id: string; prefix: string; gateway: string | null } | null;
  vlan: { number: number; name: string } | null;
  site: string | null;
  vrf: string | null;
  matchedBy: string[];
  findings: NetworkFinding[];
  /** Dienste der Adresse bzw. des Geräts (nur ticketLookup). */
  services: { id: string; name: string }[];
};

export type NetworkPrefix = {
  id: string;
  prefix: string;
  matched: string;
  status: string;
  description: string | null;
  vlan: { number: number; name: string } | null;
  site: string | null;
  percent: number | null;
};

export type NetworkLookup = {
  addresses: NetworkAddress[];
  prefixes: NetworkPrefix[];
  /** Schon mit dem Ticket verknüpfte Geräte und Dienste (ticketLookup). */
  linkedAssetIds: string[];
  linkedServiceIds: string[];
};

function asRecord(value: unknown): Row | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Row)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function rows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((row): row is Row => row !== null)
    : [];
}

function vlanOf(value: unknown): { number: number; name: string } | null {
  const vlan = asRecord(value);
  return vlan && typeof vlan.number === "number"
    ? { number: vlan.number, name: str(vlan.name) ?? "" }
    : null;
}

const SEVERITIES = new Set(["info", "warning", "critical"]);

export function parseNetworkAddress(row: Row): NetworkAddress | null {
  const id = str(row.id);
  const address = str(row.address);
  if (!id || !address) return null;
  const asset = asRecord(row.asset);
  const prefix = asRecord(row.prefix);
  const owner = asRecord(row.owner);
  return {
    id,
    address,
    status: str(row.status) ?? "active",
    hostname: str(row.hostname),
    dnsName: str(row.dns_name),
    macAddress: str(row.mac_address),
    vendor: str(row.vendor),
    deviceType: str(row.device_type),
    switchName: str(row.switch_name),
    switchPort: str(row.switch_port),
    lastSeenAt: str(row.last_seen_at),
    lastSeenSource: str(row.last_seen_source),
    intuneDeviceId: str(row.intune_device_id),
    prtgDeviceId: str(row.prtg_device_id),
    owner: owner ? str(owner.name) : null,
    intuneUser: str(row.intune_user),
    asset:
      asset && str(asset.id) && str(asset.name)
        ? {
            id: str(asset.id)!,
            name: str(asset.name)!,
            assetTag: str(asset.asset_tag),
          }
        : null,
    prefix:
      prefix && str(prefix.id) && str(prefix.prefix)
        ? {
            id: str(prefix.id)!,
            prefix: str(prefix.prefix)!,
            gateway: str(prefix.gateway),
          }
        : null,
    vlan: vlanOf(row.vlan),
    site: str(asRecord(row.site)?.name),
    vrf: str(asRecord(row.vrf)?.name),
    matchedBy: Array.isArray(row.matched_by)
      ? row.matched_by.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    services: rows(row.services).flatMap((service) => {
      const serviceId = str(service.id);
      const name = str(service.name);
      return serviceId && name ? [{ id: serviceId, name }] : [];
    }),
    findings: rows(row.findings).flatMap((finding) => {
      const findingId = str(finding.id);
      const kind = str(finding.kind);
      const severity = str(finding.severity) ?? "warning";
      if (!findingId || !kind || !SEVERITIES.has(severity)) return [];
      return [
        {
          id: findingId,
          kind,
          severity: severity as NetworkFinding["severity"],
          firstSeenAt: str(finding.first_seen_at),
        },
      ];
    }),
  };
}

export function parseNetworkLookup(value: unknown): NetworkLookup | null {
  const data = asRecord(value);
  if (!data || !Array.isArray(data.addresses)) return null;
  const ids = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
  return {
    linkedAssetIds: ids(data.linkedAssetIds),
    linkedServiceIds: ids(data.linkedServiceIds),
    addresses: rows(data.addresses)
      .map(parseNetworkAddress)
      .filter((entry): entry is NetworkAddress => entry !== null),
    prefixes: rows(data.prefixes).flatMap((row) => {
      const id = str(row.id);
      const prefix = str(row.prefix);
      if (!id || !prefix) return [];
      const capacity = Number(row.capacity ?? 0);
      const used = Number(row.used ?? 0) + Number(row.dhcp_size ?? 0);
      return [
        {
          id,
          prefix,
          matched: str(row.matched) ?? prefix,
          status: str(row.status) ?? "active",
          description: str(row.description),
          vlan: vlanOf(row.vlan),
          site: str(asRecord(row.site)?.name),
          percent:
            capacity > 0
              ? Math.min(100, Math.round((used / capacity) * 100))
              : null,
        },
      ];
    }),
  };
}

const STATUS_LABELS: Record<string, string> = {
  active: "Aktiv",
  reserved: "Reserviert",
  dhcp: "DHCP",
  deprecated: "Veraltet",
  container: "Container",
};

export function addressStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function addressStatusTone(
  status: string,
): "success" | "info" | "neutral" | "warning" {
  if (status === "active") return "success";
  if (status === "reserved" || status === "dhcp") return "info";
  if (status === "deprecated") return "warning";
  return "neutral";
}

const FINDING_LABELS: Record<string, string> = {
  ghost: "Unbekanntes Gerät im Netz",
  conflict: "IP-Konflikt",
  foreign_mac: "Fremde MAC auf reservierter IP",
  dns_mismatch: "DNS stimmt nicht überein",
  stale: "Lange nicht gesehen",
  utilization: "Subnetz fast voll",
  outside_prefix: "Ausserhalb des Subnetzes",
  coverage: "Nicht in PRTG überwacht",
};

export function findingLabel(kind: string): string {
  return FINDING_LABELS[kind] ?? kind;
}

/** «gerade eben», «vor 5 Min.», «vor 3 Std.», «vor 4 Tagen», sonst Datum. */
export function lastSeenLabel(value: string | null, now = Date.now()): string {
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
  return new Intl.DateTimeFormat("de-CH", { dateStyle: "medium" }).format(
    new Date(time),
  );
}

/** Kurzzeile «VLAN 30 Drucker · 10.20.30.0/24 · Baar». */
export function networkContextLine(entry: {
  vlan: { number: number; name: string } | null;
  prefix?: { prefix: string } | null;
  site: string | null;
}): string {
  return [
    entry.vlan
      ? `VLAN ${entry.vlan.number}${entry.vlan.name ? ` ${entry.vlan.name}` : ""}`
      : null,
    entry.prefix?.prefix ?? null,
    entry.site,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Was die Netzwerk-Box für eine Adresse ans Ticket hängen kann. */
export function linkOptions(
  entry: NetworkAddress,
  lookup: Pick<NetworkLookup, "linkedAssetIds" | "linkedServiceIds">,
): {
  asset: { id: string; name: string; linked: boolean } | null;
  services: { id: string; name: string; linked: boolean }[];
} {
  return {
    asset: entry.asset
      ? {
          id: entry.asset.id,
          name: entry.asset.name,
          linked: lookup.linkedAssetIds.includes(entry.asset.id),
        }
      : null,
    services: entry.services.map((service) => ({
      ...service,
      linked: lookup.linkedServiceIds.includes(service.id),
    })),
  };
}
