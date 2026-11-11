/**
 * Splits the result of a scan into reports that respect nextDesk's limits.
 * Order: topology (LLDP + MAC tables, per switch) → observations → DHCP (one
 * server per report) → DNS (whole zones) → final report with statistics.
 */

export type ObservationSource = "ping" | "arp" | "snmp" | "dhcp" | "ndp";

export type Observation = {
  address: string;
  source: ObservationSource;
  mac?: string;
  hostname?: string;
  vendor?: string;
  vrfId?: string | null;
  switchName?: string;
  switchPort?: string;
  vlan?: number;
};

export type MacTableEntry = {
  switchName: string;
  port: string;
  mac: string;
  vlan: number | null;
};

export type LldpNeighbor = {
  switchName: string;
  localPort: string;
  chassisMac: string | null;
  sysName: string | null;
  portId: string | null;
  mgmtAddress: string | null;
  capabilities: string[];
};

export type DhcpServerData = {
  server: string;
  scopes: Record<string, unknown>[];
  leases: Record<string, unknown>[];
};

export type DnsZoneData = {
  server: string;
  zone: string;
  records: Record<string, unknown>[];
};

export type ScanData = {
  observations: Observation[];
  macTable: MacTableEntry[];
  lldp: LldpNeighbor[];
  dhcp: DhcpServerData[];
  dns: DnsZoneData[];
};

export type ReportLimits = {
  observations: number;
  macTable: number;
  lldp: number;
  dhcpLeases: number;
  dnsRecords: number;
};

export const DEFAULT_LIMITS: ReportLimits = {
  observations: 5000,
  macTable: 20000,
  lldp: 2000,
  dhcpLeases: 20000,
  dnsRecords: 20000,
};

export type RunInfo = {
  key: string;
  trigger: "schedule" | "manual" | "startup";
  jobId: string | null;
};

export type Report = {
  action: "report";
  run: RunInfo & {
    final: boolean;
    stats?: Record<string, number>;
    errors?: string[];
  };
  observations?: Observation[];
  macTable?: MacTableEntry[];
  lldp?: LldpNeighbor[];
  dhcp?: DhcpServerData[];
  dns?: DnsZoneData[];
};

/** New run key: «2026-11-11T08:00:00.000Z-ab12cd». */
export function newRunKey(now = new Date()): string {
  return `${now.toISOString()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildReports(
  run: RunInfo,
  data: ScanData,
  stats: Record<string, number>,
  errors: string[],
  limits: ReportLimits = DEFAULT_LIMITS,
): { reports: Report[]; truncated: string[] } {
  const reports: Report[] = [];
  const truncated: string[] = [];
  const base = () => ({
    action: "report" as const,
    run: { ...run, final: false },
  });

  // Topology per switch (port statistics must see a whole switch).
  const switches = new Map<
    string,
    { macs: MacTableEntry[]; lldp: LldpNeighbor[] }
  >();
  for (const entry of data.macTable) {
    const group = switches.get(entry.switchName) ?? { macs: [], lldp: [] };
    group.macs.push(entry);
    switches.set(entry.switchName, group);
  }
  for (const entry of data.lldp) {
    const group = switches.get(entry.switchName) ?? { macs: [], lldp: [] };
    group.lldp.push(entry);
    switches.set(entry.switchName, group);
  }
  let current: Report | null = null;
  for (const [name, group] of switches) {
    let macs = group.macs;
    let lldp = group.lldp;
    if (macs.length > limits.macTable) {
      truncated.push(
        `MAC-Tabelle von ${name} gekürzt (${macs.length} Einträge)`,
      );
      macs = macs.slice(0, limits.macTable);
    }
    if (lldp.length > limits.lldp) {
      truncated.push(`LLDP-Nachbarn von ${name} gekürzt (${lldp.length})`);
      lldp = lldp.slice(0, limits.lldp);
    }
    if (
      !current ||
      (current.macTable?.length ?? 0) + macs.length > limits.macTable ||
      (current.lldp?.length ?? 0) + lldp.length > limits.lldp
    ) {
      current = { ...base(), macTable: [], lldp: [] };
      reports.push(current);
    }
    current.macTable!.push(...macs);
    current.lldp!.push(...lldp);
  }

  const chunk = Math.max(1, Math.min(limits.observations, 2000));
  for (let index = 0; index < data.observations.length; index += chunk) {
    reports.push({
      ...base(),
      observations: data.observations.slice(index, index + chunk),
    });
  }

  for (const server of data.dhcp) {
    let leases = server.leases;
    if (leases.length > limits.dhcpLeases) {
      truncated.push(
        `DHCP-Leases von ${server.server} gekürzt (${leases.length})`,
      );
      leases = leases.slice(0, limits.dhcpLeases);
    }
    reports.push({ ...base(), dhcp: [{ ...server, leases }] });
  }

  let dnsReport: Report | null = null;
  for (const zone of data.dns) {
    let records = zone.records;
    if (records.length > limits.dnsRecords) {
      truncated.push(
        `DNS-Zone ${zone.zone} gekürzt (${records.length} Records)`,
      );
      records = records.slice(0, limits.dnsRecords);
    }
    const used =
      dnsReport?.dns?.reduce((sum, entry) => sum + entry.records.length, 0) ??
      0;
    if (
      !dnsReport ||
      used + records.length > limits.dnsRecords ||
      (dnsReport.dns?.length ?? 0) >= 50
    ) {
      dnsReport = { ...base(), dns: [] };
      reports.push(dnsReport);
    }
    dnsReport.dns!.push({ ...zone, records });
  }

  const allErrors = [...errors, ...truncated]
    .slice(0, 50)
    .map((message) => message.slice(0, 300));
  const final: Report = {
    ...base(),
    run: { ...run, final: true, stats, errors: allErrors },
  };
  reports.push(final);
  return { reports, truncated };
}
