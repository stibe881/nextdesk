/**
 * Parser for the «IP-Liste MASTER» workbook layout:
 *
 * - «Overview»: Lokation, Security Zone, IP Prefix, PL, Default GW, GW Device,
 *   VLAN ID, VLAN Name, IP-Helper, Beschreibung → sites, VLANs, prefixes.
 * - Subnet sheets («NORD_MGMT-10.1.64.0», «PUBLIC-IP NORD», …): one or more
 *   blocks, each starting with a CIDR row (CIDR, VLAN, name, note) and an
 *   «IP / Hostname / Funktion» header, then one row per address.
 * - Old sheets («OLD_VLAN1 - LAN», «VLAN11-iSCSI», …): column «IP» holds
 *   the last octet, other columns carry the subnet in their header
 *   («Server\n10.0.1.x»); each filled cell becomes an address.
 *
 * Decisions:
 * - Summary rows («… Summary», no VLAN and holding other prefixes) become
 *   containers; «Reserve» becomes reserved (a container tagged «reserve» if
 *   it holds other prefixes).
 * - *_OLD / «OLD» networks stay active (they are still in use) and get the tag
 *   «alt»; addresses from OLD_* sheets get the tag «alt» too.
 * - «DHCP» placeholder rows are not imported as addresses; their range becomes
 *   the DHCP range of the prefix. «Netzwerkkomponente» / «Reserviert» rows
 *   without hostname become reserved addresses.
 * - Template sheets, «Tabelle1», «Aula IP Liste» (holds a WLAN key) and the
 *   concept sheet are skipped. Cells that look like secrets are never taken.
 */

import {
  BatchBuilder,
  type Cell,
  type ImportBatch,
  type ImportOrigin,
  type ImportPrefix,
  type ParsedCidr,
  type PrefixStatus,
  type Workbook,
  cidrContains,
  cidrContainsIp,
  clip,
  finalizeBatch,
  firstLine,
  formatCidr,
  formatIp,
  inferDeviceType,
  uniqueDeviceType,
  isNetworkOrBroadcast,
  looksSecret,
  normalizeHeader,
  normalizeMac,
  oneLine,
  parseCidr,
  parseIp,
  parseLength,
  resolveRelativeIp,
  text,
} from "./ipam-import-model";

const IGNORED_SHEETS: [RegExp, string][] = [
  [/^template/i, "Vorlage"],
  [/^tabelle\d*$/i, "Leeres Hilfsblatt"],
  [
    /aula\s*ip\s*liste/i,
    "Enthält Zugangsdaten (WLAN-Schlüssel) – wird aus Sicherheitsgründen nie importiert",
  ],
  [/netzwerkkonzept/i, "Konzeptblatt ohne Adressen"],
];

const PLACEHOLDER_HELPER = /^(a\.b\.c\.d\s*)+$/i;
const NO_ZONE = /^(multiple|tbd|tdb|-)$/i;
const OLD_MARK = /(_old\b|\bold\b|\balt\b)/i;

type OverviewColumns = {
  site: number;
  zone: number;
  prefix: number;
  length: number;
  gateway: number;
  gatewayDevice: number;
  vlanId: number;
  vlanName: number;
  helper: number;
  description: number;
};

function findColumn(headers: string[], ...candidates: string[]): number {
  for (const candidate of candidates) {
    const index = headers.indexOf(candidate);
    if (index >= 0) return index;
  }
  return -1;
}

function overviewColumns(row: Cell[]): OverviewColumns | null {
  const headers = row.map(normalizeHeader);
  const columns: OverviewColumns = {
    site: findColumn(headers, "lokation", "standort", "site"),
    zone: findColumn(headers, "securityzone", "zone"),
    prefix: findColumn(headers, "ipprefix", "prefix", "netz"),
    length: findColumn(headers, "pl", "prefixlength", "maske", "mask"),
    gateway: findColumn(headers, "defaultgw", "gateway", "gw"),
    gatewayDevice: findColumn(headers, "gwdevice", "gatewaydevice"),
    vlanId: findColumn(headers, "vlanid", "vlan"),
    vlanName: findColumn(headers, "vlanname"),
    helper: findColumn(headers, "iphelper", "dhcphelper"),
    description: findColumn(headers, "beschreibung", "description"),
  };
  return columns.prefix >= 0 && columns.site >= 0 && columns.length >= 0
    ? columns
    : null;
}

const cell = (row: Cell[], index: number) =>
  index >= 0 ? text(row[index]) : null;

function vlanNumber(value: string | null): number | null {
  if (!value) return null;
  const match = /^(?:vlan\s*)?(\d{1,4})$/i.exec(value.trim());
  return match ? Number(match[1]) : null;
}

type OverviewEntry = {
  prefix: ImportPrefix;
  cidr: ParsedCidr;
  summary: boolean;
  reserve: boolean;
  noVlan: boolean;
};

function parseOverview(
  builder: BatchBuilder,
  sheet: string,
  rows: Cell[][],
): OverviewEntry[] {
  const headerIndex = rows.findIndex((row) => overviewColumns(row) !== null);
  if (headerIndex < 0) {
    builder.skipSheet(
      sheet,
      "Kopfzeile (Lokation, IP Prefix …) nicht gefunden",
    );
    return [];
  }
  const columns = overviewColumns(rows[headerIndex]!)!;
  const entries: OverviewEntry[] = [];
  let lastSite: string | null = null;
  rows.slice(headerIndex + 1).forEach((row, offset) => {
    const origin: ImportOrigin = { sheet, row: headerIndex + offset + 2 };
    if (row.every((value) => text(value) === null)) return;
    const siteText = cell(row, columns.site) ?? lastSite;
    const site = siteText && !/^multiple$/i.test(siteText) ? siteText : null;
    lastSite = siteText;
    const zone = cell(row, columns.zone);
    const description = cell(row, columns.description);
    const vlanName = oneLine(cell(row, columns.vlanName));
    const vlanText = cell(row, columns.vlanId);
    const vlan = vlanNumber(vlanText);
    if (site) builder.site(site, origin);
    if (vlan !== null) builder.vlan(site, vlan, vlanName, origin, description);

    const prefixText = cell(row, columns.prefix);
    if (!prefixText) {
      builder.issue(
        "info",
        "row",
        origin,
        vlan !== null
          ? `Kein IP-Prefix angegeben – nur VLAN ${vlan} übernommen.`
          : `Zeile ohne IP-Prefix übersprungen${description ? ` («${clip(description, 60)}»)` : ""}.`,
      );
      return;
    }
    const lengthCell = row[columns.length];
    let length = parseLength(lengthCell);
    const ip = parseIp(prefixText.split("/")[0] ?? null);
    if (prefixText.includes("/"))
      length = parseCidr(prefixText)?.length ?? length;
    if (!ip) {
      builder.issue(
        "error",
        "prefix",
        origin,
        `«${prefixText}» ist kein gültiges Netz.`,
      );
      return;
    }
    if (length === null) {
      builder.issue(
        "error",
        "prefix",
        origin,
        `${prefixText}: Präfixlänge fehlt («${lengthCell === null || lengthCell === undefined || lengthCell === "" ? "leer" : String(lengthCell)}») – Zeile übersprungen.`,
      );
      return;
    }
    const cidr = parseCidr(`${formatIp(ip)}/${length}`);
    if (!cidr) {
      builder.issue(
        "error",
        "prefix",
        origin,
        `${prefixText}/${length} ist kein gültiges Netz.`,
      );
      return;
    }
    const normalized = formatCidr(cidr);
    if (cidr.hostBits) {
      builder.issue(
        "warning",
        "prefix",
        origin,
        `${prefixText}/${length} ist keine Netzadresse – übernommen als ${normalized}.`,
      );
    }
    const label = [vlanName, description].filter(Boolean).join(" ");
    const summary = /summary/i.test(label);
    const reserve = /\breserve\b/i.test(description ?? "");
    const tags: string[] = [];
    if (OLD_MARK.test(label)) tags.push("alt");

    // Gateways: «.1», «.0.250», «10.0.0.250», several lines for transit nets.
    const gatewayLines = (cell(row, columns.gateway) ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const deviceLines = (cell(row, columns.gatewayDevice) ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const gateways = gatewayLines.map(
      (line) => resolveRelativeIp(cidr, line) ?? line,
    );
    const customFields: Record<string, string> = {};
    if (gateways.length > 1) {
      customFields.gateways = gateways
        .map((gateway, index) =>
          deviceLines[index] ? `${gateway} (${deviceLines[index]})` : gateway,
        )
        .join(", ");
    }
    const helperRaw = oneLine(cell(row, columns.helper));
    const helper =
      helperRaw && !PLACEHOLDER_HELPER.test(helperRaw.replace(/ \/ /g, " "))
        ? helperRaw
        : null;

    if (builder.findPrefix(null, normalized)) {
      builder.issue(
        "warning",
        "prefix",
        origin,
        `${normalized} ist doppelt aufgeführt – die erste Zeile gilt.`,
      );
      return;
    }
    const { prefix } = builder.prefix({
      prefix: normalized,
      vrf: null,
      site,
      vlanNumber: vlan,
      status: "active",
      securityZone: zone && !NO_ZONE.test(zone) ? zone : null,
      gateway:
        gateways[0] && parseIp(gateways[0])
          ? normalizeGateway(gateways[0])
          : null,
      gatewayDevice: deviceLines.length ? deviceLines.join(" / ") : null,
      dhcpHelper: looksSecret(helper) ? null : helper,
      dhcpStart: null,
      dhcpEnd: null,
      description: looksSecret(description) ? null : (description ?? vlanName),
      tags,
      customFields,
      origin,
    });
    if (gateways[0] && !parseIp(gateways[0])) {
      prefix.customFields.gateway_original = gateways[0];
      builder.issue(
        "warning",
        "prefix",
        origin,
        `Gateway «${gateways[0]}» ist keine Adresse und wird nicht übernommen.`,
        prefix.key,
      );
    }
    entries.push({ prefix, cidr, summary, reserve, noVlan: vlan === null });
  });

  // Status: summaries → container, «Reserve» → reserved (container if parent).
  for (const entry of entries) {
    const hasChildren = entries.some(
      (other) =>
        other !== entry &&
        other.cidr.length > entry.cidr.length &&
        cidrContains(entry.cidr, other.cidr),
    );
    let status: PrefixStatus = "active";
    if (entry.summary || (hasChildren && entry.noVlan && !entry.prefix.gateway))
      status = "container";
    if (entry.reserve) {
      status = hasChildren ? "container" : "reserved";
      if (hasChildren) entry.prefix.tags.push("reserve");
    }
    entry.prefix.status = status;
  }
  return entries;
}

function normalizeGateway(value: string): string | null {
  const ip = parseIp(value);
  return ip ? formatIp(ip) : null;
}

/** Site for a prefix from a subnet sheet: containing overview prefix, else sheet name. */
function siteFor(
  builder: BatchBuilder,
  overview: OverviewEntry[],
  cidr: ParsedCidr,
  sheet: string,
): string | null {
  const containing = overview
    .filter((entry) => entry.prefix.site && cidrContains(entry.cidr, cidr))
    .sort((a, b) => b.cidr.length - a.cidr.length)[0];
  if (containing) return containing.prefix.site;
  const tokens = sheet
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(
      (token) =>
        token.length >= 3 && !/^(IP|PUBLIC|OLD|VLAN|MGMT)$/.test(token),
    );
  const candidates = builder.batch.sites.filter((site) =>
    site.name
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .some((part) => tokens.includes(part)),
  );
  if (!candidates.length) return null;
  const counts = (name: string) =>
    builder.batch.prefixes.filter((prefix) => prefix.site === name).length;
  return candidates.sort((a, b) => counts(b.name) - counts(a.name))[0]!.name;
}

type BlockColumns = { hostname: number; function: number; extras: number[] };

function isIpRow(row: Cell[]): boolean {
  return parseIp(text(row[0] ?? null)) !== null;
}

/** Columns beyond hostname/function that hold data in ≥ 5 address rows (skips legends). */
function extraColumns(rows: Cell[][], used: number[]): number[] {
  const width = Math.max(0, ...rows.map((row) => row.length));
  const result: number[] = [];
  for (let column = 1; column < width; column++) {
    if (used.includes(column)) continue;
    const filled = rows.filter(
      (row) => isIpRow(row) && text(row[column] ?? null) !== null,
    ).length;
    if (filled >= 5) result.push(column);
  }
  return result;
}

const STATUS_WORDS = /^(reserviert|reserved|zugewiesen|assigned|frei|free)$/i;

function parseBlockSheet(
  builder: BatchBuilder,
  sheet: string,
  rows: Cell[][],
  overview: OverviewEntry[],
) {
  const oldSheet = /^old[_ -]/i.test(sheet);
  let block: {
    cidr: ParsedCidr;
    prefix: ImportPrefix | null;
    dhcp: bigint[];
    columns: BlockColumns;
  } | null = null;
  let counted = 0;
  let placeholderRows = 0;
  const blockRows = rows;
  const defaults: BlockColumns = {
    hostname: 1,
    function: 2,
    extras: extraColumns(blockRows, [1, 2]),
  };

  const closeBlock = () => {
    if (!block || !block.prefix || block.dhcp.length === 0) return;
    const sorted = [...block.dhcp].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (!block.prefix.dhcpStart) {
      block.prefix.dhcpStart = formatIp({
        family: block.cidr.family,
        value: sorted[0]!,
      });
      block.prefix.dhcpEnd = formatIp({
        family: block.cidr.family,
        value: sorted[sorted.length - 1]!,
      });
    }
  };

  rows.forEach((row, index) => {
    const origin: ImportOrigin = { sheet, row: index + 1 };
    const first = text(row[0] ?? null);
    if (!first) return;
    // Block header: «10.1.64.0/24 | Vlan64 | NORD_MGMT | note».
    if (first.includes("/")) {
      const cidr = parseCidr(first);
      if (!cidr) return;
      closeBlock();
      const normalized = formatCidr(cidr);
      const vlan = vlanNumber(
        text(row[1] ?? null)?.replace(/\s+/g, " ") ?? null,
      );
      const name = oneLine(text(row[2] ?? null));
      const note = oneLine(text(row[3] ?? null));
      let prefix = builder.findPrefix(null, normalized);
      if (!prefix) {
        const site = siteFor(builder, overview, cidr, sheet);
        if (site) builder.site(site, origin);
        if (vlan !== null) builder.vlan(site, vlan, name, origin);
        prefix = builder.prefix({
          prefix: normalized,
          vrf: null,
          site,
          vlanNumber: vlan,
          status: "active",
          securityZone: /^public/i.test(sheet) ? "OUTSIDE" : null,
          gateway: null,
          gatewayDevice: null,
          dhcpHelper: null,
          dhcpStart: null,
          dhcpEnd: null,
          description:
            [name, looksSecret(note) ? null : note]
              .filter(Boolean)
              .join(" – ") || null,
          tags: oldSheet ? ["alt"] : [],
          customFields: {},
          origin,
        }).prefix;
        builder.issue(
          "info",
          "prefix",
          origin,
          `${normalized} ist nicht in der Übersicht und wird aus dem Blatt angelegt.`,
          prefix.key,
        );
      }
      block = { cidr, prefix, dhcp: [], columns: defaults };
      return;
    }
    // Header row «IP | Hostname | Funktion»: map columns by name.
    if (/^ip$/i.test(first)) {
      if (!block) return;
      const headers = row.map(normalizeHeader);
      const hostname = headers.findIndex((header) =>
        header.startsWith("hostname"),
      );
      const fn = headers.findIndex(
        (header) => header.startsWith("funktion") || header === "function",
      );
      const used = [hostname >= 0 ? hostname : 1, fn >= 0 ? fn : 2];
      const ignored = headers
        .map((header, column) =>
          /subnetmask|maske/.test(header) ? column : -1,
        )
        .filter((column) => column >= 0);
      block.columns = {
        hostname: used[0]!,
        function: used[1]!,
        extras: extraColumns(blockRows, [...used, ...ignored]),
      };
      return;
    }
    const ip = parseIp(first);
    if (!ip) return;
    if (!block) {
      builder.issue(
        "warning",
        "row",
        origin,
        `${first}: kein Subnetz für diese Zeile erkannt – übersprungen.`,
      );
      return;
    }
    if (!cidrContainsIp(block.cidr, ip)) {
      builder.issue(
        "warning",
        "address",
        origin,
        `${formatIp(ip)} liegt nicht in ${formatCidr(block.cidr)} – übersprungen.`,
      );
      return;
    }
    const address = formatIp(ip);
    const rawHost = text(row[block.columns.hostname] ?? null);
    const fn = oneLine(text(row[block.columns.function] ?? null));
    const extras = block.columns.extras
      .map((column) => oneLine(text(row[column] ?? null)))
      .filter((value): value is string => value !== null);
    if (
      isNetworkOrBroadcast(block.cidr, ip) ||
      /^(network|broadcast)/i.test(fn ?? "")
    )
      return;

    const lines = (rawHost ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    let hostname = lines[0] ?? null;
    const moreNames = lines.slice(1);
    const isDhcp = hostname !== null && /^dhcp$/i.test(hostname);
    if (isDhcp) hostname = null;
    const statusWords = extras.filter((value) => STATUS_WORDS.test(value));
    const infoExtras = extras.filter((value) => !STATUS_WORDS.test(value));
    const mac =
      [fn, ...infoExtras].map((value) => normalizeMac(value)).find(Boolean) ??
      null;
    const functionText = fn && normalizeMac(fn) ? null : fn;
    const describing = [
      functionText,
      ...infoExtras.filter((value) => !normalizeMac(value)),
    ].filter((value): value is string => value !== null && !looksSecret(value));
    if (extras.some(looksSecret) || looksSecret(fn)) {
      builder.issue(
        "warning",
        "row",
        origin,
        `${address}: ein Feld sieht nach Zugangsdaten aus und wurde ausgelassen.`,
      );
    }

    if (
      isDhcp &&
      !mac &&
      infoExtras.length === 0 &&
      (!functionText || /(^|\()dhcp\)?$/i.test(functionText))
    ) {
      block.dhcp.push(ip.value);
      return;
    }
    if (!isDhcp && !hostname && !functionText && !mac) {
      if (!statusWords.some((value) => /^reserv/i.test(value))) {
        if (infoExtras.length) placeholderRows++;
        return;
      }
    }
    const placeholder =
      !hostname &&
      !mac &&
      describing.length > 0 &&
      describing.every((value) => /^netzwerkkomponente$/i.test(value));
    const reserved =
      placeholder ||
      (!hostname &&
        !mac &&
        !functionText &&
        statusWords.some((value) => /^reserv/i.test(value))) ||
      (!hostname &&
        !mac &&
        describing.length > 0 &&
        /^reserv/i.test(describing[0]!));
    const status = isDhcp ? "dhcp" : reserved ? "reserved" : "active";
    const description = [
      ...describing,
      ...(moreNames.length ? [`Weitere Namen: ${moreNames.join(", ")}`] : []),
    ].join(" · ");
    const fqdn =
      hostname &&
      /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(hostname) &&
      !parseIp(hostname)
        ? hostname.toLowerCase()
        : null;
    const added = builder.address({
      address,
      vrf: null,
      status,
      hostname,
      dnsName: fqdn,
      macAddress: mac,
      deviceType: inferDeviceType(hostname, functionText),
      description: description || null,
      switchName: null,
      switchPort: null,
      tags: oldSheet ? ["alt"] : [],
      customFields: {},
      origin,
    });
    if (added) counted++;
  });
  closeBlock();
  if (
    counted === 0 &&
    !rows.some((row) => text(row[0] ?? null)?.includes("/"))
  ) {
    builder.skipSheet(sheet, "Keine Adressen gefunden");
  }
  if (placeholderRows > 0) {
    builder.issue(
      "info",
      "sheet",
      { sheet, row: 0 },
      `${placeholderRows} Zeilen nur mit Bereichsbezeichnung (z. B. «Backup») ohne Hostname wurden nicht als Adressen übernommen.`,
    );
  }
}

const OCTET_HEADER = /(\d{1,3}\.\d{1,3}\.\d{1,3})\.x\b/i;

function parseOctetSheet(
  builder: BatchBuilder,
  sheet: string,
  rows: Cell[][],
  headerIndex: number,
  overview: OverviewEntry[],
) {
  const header = rows[headerIndex]!;
  const ipColumn = header.findIndex((value) => /^ip$/i.test(text(value) ?? ""));
  const oldSheet = /^old[_ -]/i.test(sheet);
  const columns: { column: number; base: string; label: string }[] = [];
  header.forEach((value, column) => {
    if (column === ipColumn) return;
    const label = text(value);
    if (!label) return;
    const match = OCTET_HEADER.exec(label);
    const base = match ? parseIp(`${match[1]}.0`) : null;
    if (!match || !base) {
      // Only report columns that actually hold data.
      const filled = rows
        .slice(headerIndex + 1)
        .filter((row) => text(row[column] ?? null)).length;
      if (filled > 0) {
        builder.issue(
          "info",
          "sheet",
          { sheet, row: headerIndex + 1 },
          `Spalte «${oneLine(label)}» übersprungen: Subnetz aus der Überschrift nicht ableitbar (${filled} Einträge).`,
        );
      }
      return;
    }
    columns.push({
      column,
      base: formatIp(base),
      label: oneLine(label.replace(OCTET_HEADER, "")) ?? "",
    });
  });
  if (!columns.length) {
    builder.skipSheet(
      sheet,
      "Keine Spalte mit Subnetz in der Überschrift (z. B. «Server 10.0.1.x»)",
    );
    return;
  }
  let added = 0;
  for (const { column, base, label } of columns) {
    const baseCidr = parseCidr(`${base}/24`)!;
    const known = builder.batch.prefixes.some((prefix) => {
      const cidr = parseCidr(prefix.prefix);
      return cidr !== null && cidrContains(cidr, baseCidr);
    });
    const origin: ImportOrigin = { sheet, row: headerIndex + 1 };
    if (!known) {
      const site = siteFor(builder, overview, baseCidr, sheet);
      const { prefix } = builder.prefix({
        prefix: formatCidr(baseCidr),
        vrf: null,
        site,
        vlanNumber: null,
        status: "active",
        securityZone: null,
        gateway: null,
        gatewayDevice: null,
        dhcpHelper: null,
        dhcpStart: null,
        dhcpEnd: null,
        description: clip(`${label} (${sheet})`, 1000),
        tags: oldSheet || /old/i.test(sheet) ? ["alt"] : [],
        customFields: {},
        origin,
      });
      builder.issue(
        "info",
        "prefix",
        origin,
        `${prefix.prefix} aus der Spalte «${label}» abgeleitet (nicht in der Übersicht).`,
        prefix.key,
      );
    }
    // «siehe / Aula / Tab» written down a column is a note, not devices.
    const noteRows = new Set<number>();
    const body = rows.slice(headerIndex + 1);
    body.forEach((row, offset) => {
      if (!/^siehe\b/i.test(text(row[column] ?? null) ?? "")) return;
      for (let next = offset; next < body.length && next < offset + 5; next++) {
        if (!text(body[next]![column] ?? null)) break;
        noteRows.add(next);
      }
    });
    body.forEach((row, offset) => {
      if (noteRows.has(offset)) return;
      const rowOrigin: ImportOrigin = { sheet, row: headerIndex + offset + 2 };
      const octetText = text(row[ipColumn] ?? null);
      const value = oneLine(text(row[column] ?? null));
      if (!octetText || !value) return;
      if (!/^\d{1,3}$/.test(octetText) || Number(octetText) > 255) return;
      const octet = Number(octetText);
      if (octet === 0 || octet === 255) return;
      if (/^\d+$/.test(value)) {
        builder.issue(
          "info",
          "row",
          rowOrigin,
          `«${value}» in Spalte «${label}» ist kein Gerät – übersprungen.`,
        );
        return;
      }
      if (looksSecret(value)) {
        builder.issue(
          "warning",
          "row",
          rowOrigin,
          `Ein Feld sieht nach Zugangsdaten aus und wurde ausgelassen.`,
        );
        return;
      }
      const address = base.replace(/\.0$/, `.${octet}`);
      // «S099 - ESX Host» → hostname S099, description ESX Host.
      const split = /^(\S+)\s+-\s+(.+)$/.exec(value);
      const hostname = split ? split[1]! : /\s/.test(value) ? null : value;
      const description = split ? split[2]! : hostname ? null : value;
      const reserved = /\breserv/i.test(value);
      const gateway = /gateway/i.test(value);
      const entry = builder.address({
        address,
        vrf: null,
        status: reserved ? "reserved" : "active",
        hostname: gateway ? null : hostname,
        dnsName: null,
        macAddress: null,
        deviceType: gateway
          ? "gateway"
          : (inferDeviceType(hostname, description) ?? uniqueDeviceType(label)),
        description:
          [
            description ?? (gateway ? value : null),
            label ? `Bereich: ${label}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        switchName: null,
        switchPort: null,
        tags: oldSheet || /old/i.test(sheet) ? ["alt"] : [],
        customFields: {},
        origin: rowOrigin,
      });
      if (entry) added++;
    });
  }
  if (added === 0)
    builder.issue(
      "info",
      "sheet",
      { sheet, row: 0 },
      "Keine Adressen in diesem Blatt.",
    );
}

export type SheetKind =
  "overview" | "blocks" | "octets" | "ignored" | "unknown";

/** How a sheet of the MASTER layout is read. */
export function classifySheet(
  name: string,
  rows: Cell[][],
): { kind: SheetKind; reason?: string; header?: number } {
  for (const [pattern, reason] of IGNORED_SHEETS) {
    if (pattern.test(name)) return { kind: "ignored", reason };
  }
  if (rows.length === 0) return { kind: "ignored", reason: "Leeres Blatt" };
  if (
    /^overview$/i.test(name.trim()) ||
    rows.slice(0, 5).some((row) => overviewColumns(row))
  ) {
    return { kind: "overview" };
  }
  if (
    rows
      .slice(0, 6)
      .some(
        (row) =>
          parseCidr(text(row[0] ?? null)) !== null &&
          (text(row[0] ?? null) ?? "").includes("/"),
      )
  ) {
    return { kind: "blocks" };
  }
  const header = rows
    .slice(0, 5)
    .findIndex(
      (row) =>
        row.some((value) => /^ip$/i.test(text(value) ?? "")) &&
        row.some((value) => OCTET_HEADER.test(text(value) ?? "")),
    );
  if (header >= 0) return { kind: "octets", header };
  return {
    kind: "unknown",
    reason:
      "Aufbau nicht erkannt (weder Subnetz-Block noch Spalten mit «a.b.c.x»)",
  };
}

/** True when the workbook looks like the MASTER layout (has an Overview sheet). */
export function isSonnenbergWorkbook(workbook: Workbook): boolean {
  return Object.entries(workbook).some(
    ([name, rows]) => classifySheet(name, rows).kind === "overview",
  );
}

/**
 * Parses a whole MASTER workbook (sheet name → rows) into the normalized
 * batch. Works in Node, e.g. with read-excel-file/node:
 *   const sheets = await readXlsxFile(path);
 *   parseSonnenbergWorkbook(Object.fromEntries(sheets.map(s => [s.sheet, s.data])))
 */
export function parseSonnenbergWorkbook(workbook: Workbook): ImportBatch {
  const builder = new BatchBuilder("sonnenberg");
  const entries = Object.entries(workbook);
  let overview: OverviewEntry[] = [];
  for (const [name, rows] of entries) {
    if (classifySheet(name, rows).kind === "overview") {
      overview = overview.concat(parseOverview(builder, name, rows));
    }
  }
  if (!overview.length) {
    builder.issue(
      "warning",
      "sheet",
      null,
      "Keine Übersicht («Overview») gefunden – Subnetze nur aus den Adressblättern.",
    );
  }
  // Block sheets first (they define prefixes), then octet sheets.
  const later: [string, Cell[][], number][] = [];
  for (const [name, rows] of entries) {
    const kind = classifySheet(name, rows);
    if (kind.kind === "overview") continue;
    if (kind.kind === "ignored" || kind.kind === "unknown") {
      builder.skipSheet(name, kind.reason ?? "Übersprungen");
      continue;
    }
    if (kind.kind === "blocks") parseBlockSheet(builder, name, rows, overview);
    else later.push([name, rows, kind.header ?? 0]);
  }
  for (const [name, rows, header] of later)
    parseOctetSheet(builder, name, rows, header, overview);
  return finalizeBatch(builder.batch);
}

/** Exposed for tests. */
export const __test = { firstLine, vlanNumber };
