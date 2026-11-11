import { describe, expect, it } from "vitest";
import {
  buildGrid,
  childLengths,
  customFieldRows,
  customFieldsFromRows,
  defaultChildLength,
  eventSummary,
  forecastText,
  formatRelative,
  parseTagInput,
  usageTone,
  vrfLabel,
  type IpamAddress,
  type IpamFinding,
} from "./ipam-model";

function address(text: string, status: IpamAddress["status"]): IpamAddress {
  return {
    id: text,
    address: text,
    vrfId: null,
    prefixId: "p",
    status,
    hostname: null,
    dnsName: null,
    macAddress: null,
    vendor: null,
    deviceType: null,
    description: null,
    switchName: null,
    switchPort: null,
    ownerUserId: null,
    ownerName: null,
    teamId: null,
    teamName: null,
    assetId: null,
    serviceId: null,
    intuneDeviceId: null,
    prtgDeviceId: null,
    reservedUntil: null,
    lastSeenAt: null,
    lastSeenSource: null,
    tags: [],
    customFields: {},
    createdAt: null,
    updatedAt: null,
  };
}

function finding(text: string, kind: IpamFinding["kind"]): IpamFinding {
  return {
    id: `f-${text}-${kind}`,
    vrfId: null,
    address: text,
    addressId: null,
    prefixId: "p",
    kind,
    severity: "warning",
    details: {},
    status: "open",
    ticketId: null,
    firstSeenAt: null,
    lastSeenAt: null,
    resolvedAt: null,
  };
}

describe("ipam grid", () => {
  it("builds 256 cells for a /24 with all states", () => {
    const grid = buildGrid(
      {
        prefix: "10.20.30.0/24",
        gateway: "10.20.30.1",
        dhcpStart: "10.20.30.100",
        dhcpEnd: "10.20.30.199",
      },
      [
        address("10.20.30.20", "active"),
        address("10.20.30.22", "reserved"),
        address("10.20.30.24", "deprecated"),
        address("10.20.30.150", "dhcp"),
      ],
      [
        finding("10.20.30.22", "ghost"),
        finding("10.20.30.22", "foreign_mac"),
        finding("10.20.30.23", "ghost"),
      ],
    );
    expect(grid?.cells).toHaveLength(256);
    const state = (last: number) => grid!.cells[last]!.state;
    expect(state(0)).toBe("network");
    expect(state(255)).toBe("network");
    expect(state(1)).toBe("gateway");
    expect(state(20)).toBe("active");
    expect(state(22)).toBe("conflict");
    expect(state(23)).toBe("ghost");
    expect(state(24)).toBe("deprecated");
    expect(state(100)).toBe("dhcp");
    expect(state(150)).toBe("dhcp");
    expect(state(21)).toBe("free");
    expect(grid!.counts.dhcp).toBe(100);
    expect(grid!.counts.network).toBe(2);
    expect(
      Object.values(grid!.counts).reduce((sum, count) => sum + count, 0),
    ).toBe(256);
  });

  it("refuses large prefixes", () => {
    expect(
      buildGrid(
        {
          prefix: "10.0.0.0/16",
          gateway: null,
          dhcpStart: null,
          dhcpEnd: null,
        },
        [],
        [],
      ),
    ).toBeNull();
  });
});

describe("ipam helpers", () => {
  it("colors utilization by threshold", () => {
    expect(usageTone(40, 85)).toBe("ok");
    expect(usageTone(88, 85)).toBe("warning");
    expect(usageTone(96, 85)).toBe("danger");
    expect(usageTone(null, 85)).toBe("none");
    expect(usageTone(98, 99)).toBe("ok");
  });

  it("describes the forecast", () => {
    expect(
      forecastText(
        {
          warningOn: "2026-11-28",
          fullOn: "2026-12-17",
          perDay: 2,
          points: 10,
        },
        85,
        "2026-11-11",
      ),
    ).toBe(
      "Voll voraussichtlich am 17.12.2026. Warnschwelle (85 %) voraussichtlich am 28.11.2026.",
    );
    expect(
      forecastText(
        { warningOn: null, fullOn: null, perDay: 0, points: 2 },
        85,
        "2026-11-11",
      ),
    ).toBeNull();
    expect(
      forecastText(
        { warningOn: null, fullOn: null, perDay: -1, points: 20 },
        85,
        "2026-11-11",
      ),
    ).toBe("Keine steigende Auslastung erkennbar.");
  });

  it("offers child lengths", () => {
    expect(childLengths("10.20.30.0/24", 8)).toEqual([25, 26, 27, 28, 29, 30]);
    expect(childLengths("10.0.0.0/8").at(-1)).toBe(24);
    expect(defaultChildLength("10.20.0.0/16")).toBe(24);
    expect(defaultChildLength("fd00::/48")).toBe(64);
    expect(defaultChildLength("10.20.30.0/24")).toBe(25);
  });

  it("converts own fields and tags", () => {
    const rows = customFieldRows({ Inventarnr: "INV-1", aktiv: true });
    expect(rows).toEqual([
      { key: "Inventarnr", value: "INV-1" },
      { key: "aktiv", value: "ja" },
    ]);
    expect(customFieldsFromRows([...rows, { key: " ", value: "x" }])).toEqual({
      Inventarnr: "INV-1",
      aktiv: "ja",
    });
    expect(parseTagInput("Server, Haus A ,,Server")).toEqual([
      "Server",
      "Haus A",
    ]);
  });

  it("formats history and labels", () => {
    expect(
      eventSummary({
        kind: "updated",
        details: { changes: { hostname: {}, mac_address: {} } },
      }),
    ).toBe("Geändert: Hostname, MAC");
    expect(
      eventSummary({
        kind: "reserved",
        details: { hostname: "AP-A2", description: "Kopierer" },
      }),
    ).toBe("Reserviert: AP-A2 · «Kopierer»");
    expect(vrfLabel(null, [])).toBe("Global");
    const now = Date.parse("2026-11-11T12:00:00Z");
    expect(formatRelative("2026-11-11T11:56:00Z", now)).toBe("vor 4 Min.");
    expect(formatRelative("2026-11-08T12:00:00Z", now)).toBe("vor 3 Tagen");
    expect(formatRelative(null, now)).toBe("nie");
  });
});
