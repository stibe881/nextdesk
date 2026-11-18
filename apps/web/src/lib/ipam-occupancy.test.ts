import { describe, expect, it } from "vitest";
import { buildGrid, type IpamAddress, type IpamFinding } from "./ipam-model";
import {
  addressListRows,
  cellMatches,
  occupancyBlocks,
  occupancyRows,
  rangeIndexes,
  rangeText,
  reservableAddresses,
  stateSegments,
} from "./ipam-occupancy";

function address(ip: string, extra: Partial<IpamAddress> = {}): IpamAddress {
  return {
    id: `a-${ip}`,
    address: ip,
    vrfId: null,
    prefixId: "p",
    status: "active",
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
    ...extra,
  };
}

const ghost: IpamFinding = {
  id: "f1",
  vrfId: null,
  address: "10.0.5.9",
  addressId: null,
  prefixId: "p",
  kind: "ghost",
  severity: "warning",
  details: {},
  status: "open",
  ticketId: null,
  firstSeenAt: null,
  lastSeenAt: null,
  resolvedAt: null,
};

const grid22 = buildGrid(
  {
    prefix: "10.0.4.0/22",
    gateway: "10.0.4.1",
    dhcpStart: "10.0.6.0",
    dhcpEnd: "10.0.6.255",
  },
  [
    address("10.0.4.10", {
      hostname: "SRV-A",
      macAddress: "aa:bb:cc:00:11:22",
    }),
    address("10.0.4.11", { status: "reserved", description: "Drucker" }),
  ],
  [ghost],
)!;

describe("occupancy blocks", () => {
  it("splits a /22 into four /24 blocks with utilization and alerts", () => {
    const blocks = occupancyBlocks(grid22.cells);
    expect(blocks.map((block) => block.label)).toEqual([
      "10.0.4.0/24",
      "10.0.5.0/24",
      "10.0.6.0/24",
      "10.0.7.0/24",
    ]);
    expect(blocks[0]!.short).toBe(".4.0");
    expect(blocks[1]!.alerts).toBe(1);
    expect(blocks[2]!.usedPercent).toBe(100);
    expect(blocks[3]!.counts.network).toBe(1);
    // Gateway + 2 records = 3 of 256.
    expect(blocks[0]!.usedPercent).toBeCloseTo(1.2, 1);
  });

  it("labels rows of 16 by the last octet", () => {
    const blocks = occupancyBlocks(grid22.cells);
    const rows = occupancyRows(grid22.cells, blocks[1]!);
    expect(rows).toHaveLength(16);
    expect(rows[2]!.label).toBe(".32");
    expect(rows[2]!.first).toBe("10.0.5.32");
    expect(rows[2]!.indexes[0]).toBe(256 + 32);
  });

  it("handles a small prefix as one partial block", () => {
    const small = buildGrid(
      { prefix: "10.9.9.0/28", gateway: null, dhcpStart: null, dhcpEnd: null },
      [],
      [],
    )!;
    const blocks = occupancyBlocks(small.cells);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.label).toBe("10.9.9.0");
    expect(occupancyRows(small.cells, blocks[0]!)).toHaveLength(1);
  });

  it("builds grids up to /20 when asked", () => {
    const big = buildGrid(
      { prefix: "10.8.0.0/20", gateway: null, dhcpStart: null, dhcpEnd: null },
      [],
      [],
      4096,
    )!;
    expect(occupancyBlocks(big.cells)).toHaveLength(16);
    expect(
      buildGrid(
        {
          prefix: "10.8.0.0/20",
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

describe("range selection", () => {
  it("selects ranges in both directions and keeps only free addresses", () => {
    expect(rangeIndexes(12, 9)).toEqual([9, 10, 11, 12]);
    const free = reservableAddresses(grid22.cells, rangeIndexes(9, 13));
    expect(free).toEqual(["10.0.4.9", "10.0.4.12", "10.0.4.13"]);
    expect(rangeText(free)).toBe("10.0.4.9 – 10.0.4.13");
    expect(rangeText(["10.0.4.9"])).toBe("10.0.4.9");
    expect(rangeText([])).toBe("");
  });
});

describe("segments and list", () => {
  it("returns the state shares in display order", () => {
    const segments = stateSegments(grid22.counts);
    expect(segments[0]!.state).toBe("active");
    expect(segments.map((segment) => segment.state)).toContain("dhcp");
    const total = segments.reduce((sum, segment) => sum + segment.share, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it("collapses free runs and filters documented addresses", () => {
    const rows = addressListRows(
      grid22.cells,
      (cell) => Boolean(cell.record),
      true,
    );
    expect(rows[0]).toMatchObject({
      kind: "free",
      from: "10.0.4.2",
      to: "10.0.4.9",
      count: 8,
    });
    expect(rows[1]).toMatchObject({ kind: "cell", index: 10 });
    expect(rows.filter((row) => row.kind === "cell")).toHaveLength(2);
    expect(addressListRows(grid22.cells, () => false, false)).toEqual([]);
  });

  it("matches IP, hostname, MAC and description", () => {
    const cell = grid22.cells[10]!;
    expect(cellMatches(cell, "srv")).toBe(true);
    expect(cellMatches(cell, "AA:BB")).toBe(true);
    expect(cellMatches(cell, "10.0.4.10")).toBe(true);
    expect(cellMatches(cell, "drucker")).toBe(false);
    expect(cellMatches(grid22.cells[11]!, "drucker")).toBe(true);
    expect(cellMatches(cell, "  ")).toBe(true);
  });
});
