import { describe, expect, it } from "vitest";
import {
  barTicks,
  buildBar,
  calculate,
  defaultBlockInGap,
  findKnownPrefix,
  formatCountText,
  freeBlocksOfLength,
  gapLengths,
  hostsForLength,
  maskToLength,
  plannerLengths,
  segmentShares,
} from "./ipam-calc";

describe("calculate (IP-Rechner)", () => {
  it("computes an IPv4 /22", () => {
    const result = calculate("172.16.68.0/22")!;
    expect(result.network).toBe("172.16.68.0/22");
    expect(result.mask).toBe("255.255.252.0");
    expect(result.wildcard).toBe("0.0.3.255");
    expect(result.first).toBe("172.16.68.1");
    expect(result.last).toBe("172.16.71.254");
    expect(result.broadcast).toBe("172.16.71.255");
    expect(result.hosts).toBe("1’022");
    expect(result.hostBitsSet).toBe(false);
  });

  it("clears host bits and reports them", () => {
    const result = calculate("10.20.30.77/24")!;
    expect(result.network).toBe("10.20.30.0/24");
    expect(result.hostBitsSet).toBe(true);
  });

  it("accepts a dotted mask", () => {
    expect(maskToLength("255.255.255.128")).toBe(25);
    expect(maskToLength("255.0.255.0")).toBeNull();
    expect(calculate("10.0.0.5 255.255.255.0")?.network).toBe("10.0.0.0/24");
  });

  it("handles /31 and /32 without network/broadcast reserve", () => {
    const p2p = calculate("10.0.0.0/31")!;
    expect(p2p.hosts).toBe("2");
    expect(p2p.first).toBe("10.0.0.0");
    expect(p2p.last).toBe("10.0.0.1");
    expect(p2p.broadcast).toBeNull();
    expect(calculate("10.0.0.9/32")?.hosts).toBe("1");
  });

  it("supports IPv6 and rejects invalid input", () => {
    const v6 = calculate("fd00:10::/64")!;
    expect(v6.version).toBe(6);
    expect(v6.mask).toBeNull();
    expect(v6.first).toBe("fd00:10::");
    expect(calculate("")).toBeNull();
    expect(calculate("10.0.0.0")).toBeNull();
    expect(calculate("10.0.0.300/24")).toBeNull();
    expect(calculate("10.0.0.0/33")).toBeNull();
  });
});

describe("findKnownPrefix", () => {
  const prefixes = [
    { id: "a", prefix: "172.16.0.0/16" },
    { id: "b", prefix: "172.16.68.0/22" },
  ];
  it("prefers the exact prefix, else the most specific container", () => {
    expect(
      findKnownPrefix(calculate("172.16.68.0/22")!.cidr, prefixes),
    ).toEqual({
      item: prefixes[1],
      exact: true,
    });
    expect(
      findKnownPrefix(calculate("172.16.69.0/24")!.cidr, prefixes)?.item.id,
    ).toBe("b");
    expect(
      findKnownPrefix(calculate("172.16.99.0/24")!.cidr, prefixes)?.exact,
    ).toBe(false);
    expect(findKnownPrefix(calculate("10.0.0.0/8")!.cidr, prefixes)).toBeNull();
  });
});

describe("bars", () => {
  it("builds existing, planned and free segments in address order", () => {
    const bar = buildBar(
      "172.16.64.0/18",
      [{ cidr: "172.16.64.0/24", name: "MGMT" }],
      [{ cidr: "172.16.66.0/23", name: "VOIP" }],
    );
    expect(bar.map((segment) => [segment.kind, segment.label])).toEqual([
      ["existing", "172.16.64.0/24"],
      ["free", "172.16.65.0 – 172.16.65.255"],
      ["planned", "172.16.66.0/23"],
      ["free", "172.16.68.0 – 172.16.127.255"],
    ]);
    const total = bar.reduce((sum, segment) => sum + segment.share, 0);
    expect(total).toBeCloseTo(1, 2);
  });

  it("skips entries outside the parent and nested ones", () => {
    const bar = buildBar("10.0.0.0/16", [
      { cidr: "10.0.0.0/24" },
      { cidr: "10.0.0.0/25" },
      { cidr: "192.168.0.0/24" },
    ]);
    expect(bar.filter((segment) => segment.kind === "existing")).toHaveLength(
      1,
    );
  });

  it("returns ticks and shares", () => {
    expect(barTicks("172.16.0.0/16")).toEqual([
      "172.16.0.0",
      "172.16.64.0",
      "172.16.128.0",
      "172.16.192.0",
      "172.16.255.255",
    ]);
    expect(
      segmentShares("10.0.0.0/16", [
        { cidr: "10.0.0.0/17" },
        { cidr: "10.0.128.0/18" },
      ]),
    ).toEqual([0.5, 0.25]);
  });
});

describe("free blocks and sizes", () => {
  it("finds aligned blocks of a template length", () => {
    expect(
      freeBlocksOfLength(
        [
          { kind: "child", cidr: "172.16.0.0/19" },
          { kind: "free", cidr: "172.16.32.0/19" },
          { kind: "free", cidr: "172.16.64.0/20" },
          { kind: "free", cidr: "172.16.128.0/17" },
        ],
        19,
      ),
    ).toEqual(["172.16.32.0/19", "172.16.128.0/19"]);
  });

  it("offers lengths and a default block in a gap", () => {
    expect(gapLengths("172.16.8.0/21")[0]).toBe(21);
    expect(gapLengths("172.16.8.0/21").at(-1)).toBe(30);
    expect(defaultBlockInGap("172.16.8.0/21")).toEqual({
      cidr: "172.16.8.0/24",
      length: 24,
    });
    expect(defaultBlockInGap("10.0.0.0/26")).toEqual({
      cidr: "10.0.0.0/26",
      length: 26,
    });
    expect(plannerLengths("172.16.64.0/18")[0]).toBe(19);
    expect(hostsForLength(24)).toBe("254");
    expect(hostsForLength(22)).toBe("1’022");
    expect(formatCountText("22528")).toBe("22’528");
  });
});
