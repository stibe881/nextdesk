/**
 * Parsers for device lists:
 * - Switch list (one sheet per site): Standort, IP Adresse, Bezeichnung,
 *   Switch (model), port/PoE columns, Bemerkungen → IPAM addresses (device
 *   type switch) and infrastructure devices (category switch).
 * - Aruba access point list (one sheet per building): Gebäude, Standort,
 *   UKV Link, Switch, AP Nr., MAC Adresse, Serien Nummer, Installiert →
 *   infrastructure devices (category access_point). The list has no IP
 *   addresses; the devices are still created so discovery can match by MAC.
 */

import {
  BatchBuilder,
  type Cell,
  type ImportBatch,
  type ImportOrigin,
  type Workbook,
  finalizeBatch,
  guessManufacturer,
  looksSecret,
  normalizeHeader,
  normalizeIp,
  normalizeMac,
  oneLine,
  text,
} from "./ipam-import-model";

type HeaderMatch = {
  index: number;
  columns: Map<string, number>;
  labels: string[];
};

function findHeader(
  rows: Cell[][],
  required: string[][],
  scan = 8,
): HeaderMatch | null {
  for (let index = 0; index < Math.min(rows.length, scan); index++) {
    const row = rows[index]!;
    const headers = row.map(normalizeHeader);
    const columns = new Map<string, number>();
    headers.forEach((header, column) => {
      if (header && !columns.has(header)) columns.set(header, column);
    });
    const ok = required.every((alternatives) =>
      alternatives.some((name) => columns.has(name)),
    );
    if (ok) {
      return {
        index,
        columns,
        labels: row.map((value) => oneLine(text(value)) ?? ""),
      };
    }
  }
  return null;
}

function column(match: HeaderMatch, ...names: string[]): number {
  for (const name of names) {
    const index = match.columns.get(name);
    if (index !== undefined) return index;
  }
  return -1;
}

const value = (row: Cell[], index: number) =>
  index >= 0 ? text(row[index] ?? null) : null;

/** True when the workbook looks like the switch list. */
export function isSwitchList(workbook: Workbook): boolean {
  return Object.values(workbook).some((rows) =>
    findHeader(rows, [
      ["ipadresse", "ipaddress", "ip"],
      ["bezeichnung", "name"],
      ["switch", "modell", "model"],
    ]),
  );
}

/** True when the workbook looks like the access point list. */
export function isAccessPointList(workbook: Workbook): boolean {
  return Object.values(workbook).some((rows) =>
    findHeader(rows, [
      ["sobeapnr", "apnr", "apnummer", "accesspoint"],
      ["macadresse", "mac", "macaddress"],
    ]),
  );
}

export function parseSwitchList(workbook: Workbook): ImportBatch {
  const builder = new BatchBuilder("switch_list");
  for (const [sheet, rows] of Object.entries(workbook)) {
    const header = findHeader(rows, [
      ["ipadresse", "ipaddress", "ip"],
      ["bezeichnung", "name"],
    ]);
    if (!header) {
      builder.skipSheet(sheet, "Keine Spalten «IP Adresse» und «Bezeichnung»");
      continue;
    }
    const cols = {
      location: column(header, "standort", "location"),
      ip: column(header, "ipadresse", "ipaddress", "ip"),
      name: column(header, "bezeichnung", "name"),
      model: column(header, "switch", "modell", "model"),
      notes: column(header, "bemerkungen", "bemerkung", "notes"),
      serial: column(header, "seriennummer", "serial", "serialnumber"),
      mac: column(header, "macadresse", "mac", "macaddress"),
    };
    const known = new Set(Object.values(cols).filter((index) => index >= 0));
    let found = 0;
    rows.slice(header.index + 1).forEach((row, offset) => {
      const origin: ImportOrigin = { sheet, row: header.index + offset + 2 };
      const name = oneLine(value(row, cols.name));
      const ipText = value(row, cols.ip);
      if (!name && !ipText) return;
      const ip = normalizeIp(ipText);
      if (ipText && !ip) {
        builder.issue(
          "warning",
          "row",
          origin,
          `«${ipText}» ist keine IP-Adresse – nur das Gerät wird übernommen.`,
        );
      }
      if (ip && ipText && ip !== ipText.trim()) {
        builder.issue(
          "info",
          "address",
          origin,
          `«${ipText}» als ${ip} übernommen.`,
        );
      }
      const location = oneLine(value(row, cols.location));
      const model = oneLine(value(row, cols.model));
      const remark = oneLine(value(row, cols.notes));
      const extras = header.labels
        .map((label, index) => {
          if (known.has(index) || !label) return null;
          const entry = oneLine(value(row, index));
          if (!entry || looksSecret(entry)) return null;
          return `${label}: ${entry}`;
        })
        .filter((entry): entry is string => entry !== null);
      const deviceName = name ?? ip ?? "Switch";
      if (ip) {
        builder.address({
          address: ip,
          vrf: null,
          status: "active",
          hostname: name,
          dnsName: null,
          macAddress: normalizeMac(value(row, cols.mac)),
          deviceType: "switch",
          description:
            [location, model, looksSecret(remark) ? null : remark]
              .filter(Boolean)
              .join(" · ") || null,
          switchName: null,
          switchPort: null,
          tags: [],
          customFields: {
            ...(location ? { standort: location } : {}),
            ...(model ? { modell: model } : {}),
            blatt: sheet,
          },
          origin,
        });
      }
      builder.device({
        name: deviceName,
        category: "switch",
        serialNumber: value(row, cols.serial),
        macAddress: normalizeMac(value(row, cols.mac)),
        ipAddress: ip,
        hostname: name,
        manufacturer: guessManufacturer(model),
        model,
        location: location ?? sheet,
        uplink: null,
        uplinkPort: null,
        notes:
          [
            location && location !== sheet
              ? `Standort: ${location} (${sheet})`
              : `Standort: ${sheet}`,
            remark && !looksSecret(remark) ? `Bemerkungen: ${remark}` : null,
            ...extras,
          ]
            .filter(Boolean)
            .join("\n") || null,
        lifecycleState: "active",
        origin,
      });
      found++;
    });
    if (!found) builder.skipSheet(sheet, "Keine Einträge");
  }
  return finalizeBatch(builder.batch);
}

const INSTALLED_NO = /^(nein|no|n|0|false)$/i;

export function parseAccessPointList(workbook: Workbook): ImportBatch {
  const builder = new BatchBuilder("aruba_ap");
  for (const [sheet, rows] of Object.entries(workbook)) {
    const header = findHeader(rows, [
      ["sobeapnr", "apnr", "apnummer", "accesspoint", "name"],
      ["macadresse", "mac", "macaddress"],
    ]);
    if (!header) {
      builder.skipSheet(sheet, "Keine Spalten «AP Nr.» und «MAC Adresse»");
      continue;
    }
    const cols = {
      building: column(header, "gebaude", "building"),
      location: column(header, "standort", "location", "raum"),
      patch: column(header, "ukvlink", "patch", "dose"),
      uplink: column(header, "switch", "uplink"),
      name: column(
        header,
        "sobeapnr",
        "apnr",
        "apnummer",
        "accesspoint",
        "name",
      ),
      mac: column(header, "macadresse", "mac", "macaddress"),
      serial: column(header, "seriennummer", "serial", "serialnumber"),
      installed: column(header, "installiert", "installed"),
      model: column(header, "modell", "model", "typ"),
      ip: column(header, "ipadresse", "ipaddress", "ip"),
    };
    let found = 0;
    let lastBuilding: string | null = null;
    rows.slice(header.index + 1).forEach((row, offset) => {
      const origin: ImportOrigin = { sheet, row: header.index + offset + 2 };
      const name = oneLine(value(row, cols.name));
      const macText = value(row, cols.mac);
      const serial = oneLine(value(row, cols.serial));
      const building = oneLine(value(row, cols.building));
      if (building) lastBuilding = building;
      if (!name && !macText && !serial) {
        if (row.some((cell) => text(cell) !== null)) {
          builder.issue(
            "info",
            "row",
            origin,
            "Zeile ohne AP-Nummer, MAC und Seriennummer übersprungen.",
          );
        }
        return;
      }
      const mac = normalizeMac(macText);
      if (macText && !mac) {
        builder.issue(
          "warning",
          "device",
          origin,
          `«${macText}» ist keine MAC-Adresse und wird nicht übernommen.`,
        );
      }
      const room = oneLine(value(row, cols.location));
      const patch = oneLine(value(row, cols.patch));
      const uplink = oneLine(value(row, cols.uplink));
      const installed = value(row, cols.installed);
      const ip = normalizeIp(value(row, cols.ip));
      const location = building ?? lastBuilding ?? sheet;
      const deviceName = name ?? (mac ? `AP ${mac}` : `AP ${serial}`);
      const device = builder.device({
        name: deviceName,
        category: "access_point",
        serialNumber: serial,
        macAddress: mac,
        ipAddress: ip,
        hostname: null,
        manufacturer: "HPE Aruba",
        model: oneLine(value(row, cols.model)),
        location,
        uplink,
        uplinkPort: null,
        notes:
          [
            room ? `Standort: ${room}` : null,
            patch ? `UKV-Link: ${patch}` : null,
            uplink ? `Switch: ${uplink}` : null,
            `Liste: ${sheet}`,
          ]
            .filter(Boolean)
            .join("\n") || null,
        lifecycleState:
          installed && INSTALLED_NO.test(installed) ? "stock" : "active",
        origin,
      });
      if (device && ip) {
        builder.address({
          address: ip,
          vrf: null,
          status: "active",
          hostname: deviceName,
          dnsName: null,
          macAddress: mac,
          deviceType: "access_point",
          description: [location, room].filter(Boolean).join(" · ") || null,
          switchName: uplink,
          switchPort: null,
          tags: [],
          customFields: {},
          origin,
        });
      }
      if (device) found++;
    });
    if (!found) builder.skipSheet(sheet, "Keine Access Points");
  }
  return finalizeBatch(builder.batch);
}
