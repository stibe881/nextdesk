import { describe, expect, it } from "vitest";
import type { IpamPrefix, IpamSite, IpamVlan } from "./ipam-model";
import {
  activeWithChildren,
  buildTree,
  descendantCount,
  EMPTY_TREE_FILTER,
  zoneOptions,
} from "./ipam-tree";

function prefix(
  id: string,
  cidr: string,
  parentId: string | null,
  extra: Partial<IpamPrefix> = {},
): IpamPrefix {
  return {
    id,
    prefix: cidr,
    vrfId: null,
    siteId: null,
    vlanId: null,
    status: "active",
    securityZone: null,
    gateway: null,
    gatewayDevice: null,
    dhcpHelper: null,
    dhcpStart: null,
    dhcpEnd: null,
    description: null,
    utilizationWarningPercent: 85,
    tags: [],
    customFields: {},
    departmentId: null,
    updatedAt: null,
    usage: null,
    parentId,
    depth: 0,
    ...extra,
  };
}

const sites: IpamSite[] = [
  {
    id: "s-b",
    name: "Campus Nord",
    code: null,
    address: null,
    description: null,
    departmentId: null,
  },
  {
    id: "s-a",
    name: "Areal Süd",
    code: null,
    address: null,
    description: null,
    departmentId: null,
  },
];
const vlans: IpamVlan[] = [
  {
    id: "v1",
    vlanNumber: 67,
    name: "PRINTER",
    siteId: "s-b",
    departmentId: null,
    description: null,
  },
];

// Overview order: each prefix follows its parent.
const prefixes = [
  prefix("old", "10.0.0.0/8", null, {
    status: "deprecated",
    description: "Summary OLD",
  }),
  prefix("old-child", "10.0.0.0/16", "old", { status: "active" }),
  prefix("old-leaf", "10.0.4.0/24", "old-child", { status: "active" }),
  prefix("root", "172.16.0.0/16", null, { status: "container" }),
  prefix("nord", "172.16.64.0/18", "root", {
    status: "container",
    siteId: "s-b",
  }),
  prefix("printer", "172.16.67.0/24", "nord", {
    siteId: "s-b",
    vlanId: "v1",
    securityZone: "LAN",
  }),
  prefix("mgmt", "172.16.64.0/24", "nord", {
    siteId: "s-b",
    securityZone: "MGMT",
  }),
  prefix("sued", "172.16.128.0/19", "root", {
    status: "container",
    siteId: "s-a",
  }),
];

describe("buildTree", () => {
  it("hides deprecated prefixes and re-indents their children", () => {
    const tree = buildTree(
      prefixes,
      vlans,
      sites,
      [],
      "tree",
      EMPTY_TREE_FILTER,
    );
    expect(tree.hiddenDeprecated).toBe(1);
    const nodes = tree.rows.filter((row) => row.kind === "node");
    expect(nodes.map((row) => row.key)).not.toContain("old");
    const child = nodes.find((row) => row.key === "old-child");
    expect(child && child.kind === "node" && child.depth).toBe(0);
    const printer = nodes.find((row) => row.key === "printer");
    expect(printer && printer.kind === "node" && printer.depth).toBe(2);
    expect(printer && printer.kind === "node" && printer.vlan?.vlanNumber).toBe(
      67,
    );
    // No VRFs → no headers.
    expect(tree.rows.some((row) => row.kind === "header")).toBe(false);
  });

  it("flags active prefixes with active children", () => {
    expect([...activeWithChildren(prefixes)]).toEqual(["old-child"]);
    const tree = buildTree(
      prefixes,
      vlans,
      sites,
      [],
      "tree",
      EMPTY_TREE_FILTER,
    );
    const row = tree.rows.find((entry) => entry.key === "old-child");
    expect(row && row.kind === "node" && row.warn).toBe(true);
  });

  it("keeps ancestors as context when filtering", () => {
    const tree = buildTree(prefixes, vlans, sites, [], "tree", {
      ...EMPTY_TREE_FILTER,
      zone: "lan",
    });
    expect(tree.matchCount).toBe(1);
    const keys = tree.rows.map((row) => row.key);
    expect(keys).toEqual(["root", "nord", "printer"]);
    const root = tree.rows[0]!;
    expect(root.kind === "node" && root.context).toBe(true);
  });

  it("groups leaves by site, alphabetically, with «Ohne Standort» last", () => {
    const tree = buildTree(prefixes, vlans, sites, [], "site", {
      ...EMPTY_TREE_FILTER,
      showDeprecated: true,
    });
    const headers = tree.rows
      .filter((row) => row.kind === "header")
      .map((row) => (row.kind === "header" ? row.label : ""));
    expect(headers).toEqual(["Areal Süd", "Campus Nord", "Ohne Standort"]);
    const nord = tree.rows.slice(
      tree.rows.findIndex((row) => row.key === "site-s-b") + 1,
      tree.rows.findIndex((row) => row.key === "site-none"),
    );
    expect(nord.map((row) => row.key)).toEqual(["mgmt", "printer"]);
  });

  it("adds VRF headers when VRFs exist and filters by status", () => {
    const tree = buildTree(
      prefixes,
      vlans,
      sites,
      [
        {
          id: "vrf1",
          name: "Gäste",
          routeDistinguisher: null,
          description: null,
        },
      ],
      "tree",
      { ...EMPTY_TREE_FILTER, status: "container" },
    );
    expect(tree.rows[0]).toMatchObject({
      kind: "header",
      label: "VRF · Global",
    });
    expect(tree.matchCount).toBe(3);
  });
});

describe("helpers", () => {
  it("lists zones and counts descendants", () => {
    expect(zoneOptions(prefixes)).toEqual(["LAN", "MGMT"]);
    expect(descendantCount(prefixes, "root")).toBe(4);
    expect(descendantCount(prefixes, "printer")).toBe(0);
  });
});

describe("buildTree text filter", () => {
  it("matches prefix, description and VLAN and keeps ancestors as context", () => {
    const byVlan = buildTree(prefixes, vlans, sites, [], "tree", {
      ...EMPTY_TREE_FILTER,
      text: "printer",
    });
    const nodes = byVlan.rows.filter((row) => row.kind === "node");
    expect(nodes.map((row) => row.key)).toEqual(["root", "nord", "printer"]);
    expect(
      nodes.filter((row) => row.kind === "node" && row.context).length,
    ).toBe(2);
    const byNumber = buildTree(prefixes, vlans, sites, [], "tree", {
      ...EMPTY_TREE_FILTER,
      text: "67",
    });
    expect(byNumber.matchCount).toBe(1);
    const byCidr = buildTree(prefixes, vlans, sites, [], "tree", {
      ...EMPTY_TREE_FILTER,
      text: "172.16.64",
    });
    expect(byCidr.matchCount).toBe(2);
  });
});
