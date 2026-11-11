import { describe, expect, it } from "vitest";
import {
  cellFor,
  groupVlansBySite,
  matrixCellView,
  matrixCounts,
  templateExample,
  validateTemplate,
} from "./ipam-matrix";
import type { IpamPrefix, IpamVlan } from "./ipam-model";
import type { SiteTemplate } from "./ipam-redesign-types";

describe("matrixCellView", () => {
  it("describes ok, diff, missing and na cells", () => {
    expect(
      matrixCellView(
        {
          siteId: "s1",
          state: "ok",
          vlanNumber: 67,
          prefix: "10.1.3.0/24",
          percent: 41.4,
        },
        "PRINTER",
        "Nord",
      ),
    ).toMatchObject({
      title: "67",
      prefix: "10.1.3.0/24",
      percent: "41 %",
      note: null,
    });
    const diff = matrixCellView(
      {
        siteId: "s1",
        state: "diff",
        vlanNumber: 68,
        prefix: "10.1.4.0/23",
        note: "/23 statt /22",
      },
      "WLAN",
      "Nord",
    );
    expect(diff.note).toBe("/23 statt /22");
    expect(diff.label).toContain("/23 statt /22");
    const missing = matrixCellView(
      {
        siteId: "s1",
        state: "missing",
        suggestion: { vlanNumber: 162, prefix: "10.2.2.0/24" },
      },
      "LOCK",
      "Süd",
    );
    expect(missing.note).toBe("Vorschlag VLAN 162 · 10.2.2.0/24");
    expect(
      matrixCellView({ siteId: "s1", state: "na" }, "X", "VPN").title,
    ).toBe("–");
  });

  it("counts states and fills missing cells as na", () => {
    const rows = [
      {
        function: "MGMT",
        zone: null,
        cells: [
          { siteId: "a", state: "ok" as const },
          { siteId: "b", state: "missing" as const },
        ],
      },
    ];
    expect(matrixCounts({ rows })).toEqual({
      ok: 1,
      diff: 0,
      missing: 1,
      na: 0,
    });
    expect(cellFor(rows[0]!, "c")).toEqual({ siteId: "c", state: "na" });
  });
});

describe("groupVlansBySite", () => {
  const vlans: IpamVlan[] = [
    {
      id: "1",
      vlanNumber: 64,
      name: "MGMT",
      siteId: "n",
      departmentId: null,
      description: null,
      zone: "MGMT",
    },
    {
      id: "2",
      vlanNumber: 67,
      name: "PRINTER",
      siteId: "n",
      departmentId: null,
      description: "Drucker",
    },
    {
      id: "3",
      vlanNumber: 10,
      name: "Clients",
      siteId: null,
      departmentId: null,
      description: null,
    },
  ];
  const prefixes = [
    {
      id: "p1",
      prefix: "10.1.3.0/24",
      vlanId: "2",
      status: "active",
      securityZone: "LAN",
      usage: { percent: 41 },
    },
    {
      id: "p2",
      prefix: "10.1.9.0/24",
      vlanId: "2",
      status: "active",
      securityZone: null,
      usage: { percent: 77 },
    },
    {
      id: "p3",
      prefix: "10.9.9.0/24",
      vlanId: "2",
      status: "deprecated",
      securityZone: null,
      usage: { percent: 99 },
    },
  ] as unknown as IpamPrefix[];
  const sites = [
    {
      id: "n",
      name: "Nord",
      code: null,
      address: null,
      description: null,
      departmentId: null,
    },
  ];

  it("groups, sorts and derives zone and utilization", () => {
    const groups = groupVlansBySite(vlans, sites, prefixes);
    expect(groups.map((group) => group.name)).toEqual([
      "Nord",
      "Ohne Standort",
    ]);
    const printer = groups[0]!.items[1]!;
    expect(printer.vlan.vlanNumber).toBe(67);
    expect(printer.prefixes.map((p) => p.prefix)).toEqual([
      "10.1.3.0/24",
      "10.1.9.0/24",
    ]);
    expect(printer.zone).toBe("LAN");
    expect(printer.percent).toBe(77);
    expect(groups[0]!.items[0]!.zone).toBe("MGMT");
  });

  it("filters by number or name", () => {
    expect(
      groupVlansBySite(vlans, sites, prefixes, "drucker")[0]!.items,
    ).toHaveLength(1);
    expect(groupVlansBySite(vlans, sites, prefixes, "zzz")).toEqual([]);
  });
});

describe("templates", () => {
  const template: SiteTemplate = {
    name: "Standard",
    prefixLength: 19,
    entries: [
      { function: "MGMT", vlanOffset: 0, offset24: 0, length: 24, dhcp: false },
      { function: "WLAN", vlanOffset: 4, offset24: 4, length: 22, dhcp: true },
    ],
  };

  it("accepts a valid template", () => {
    expect(validateTemplate(template)).toEqual([]);
  });

  it("reports overlaps, misalignment, duplicates and size errors", () => {
    const errors = validateTemplate({
      ...template,
      name: "",
      entries: [
        ...template.entries,
        {
          function: "wlan",
          vlanOffset: 5,
          offset24: 5,
          length: 24,
          dhcp: false,
        },
        {
          function: "BIG",
          vlanOffset: 6,
          offset24: 2,
          length: 22,
          dhcp: false,
        },
        {
          function: "OUT",
          vlanOffset: 7,
          offset24: 31,
          length: 23,
          dhcp: false,
        },
      ],
    });
    expect(errors).toContain("Bitte einen Namen erfassen.");
    expect(errors.some((error) => error.includes("Funktion doppelt"))).toBe(
      true,
    );
    expect(
      errors.some((error) => error.includes("überschneidet sich mit WLAN")),
    ).toBe(true);
    expect(errors.some((error) => error.includes("Vielfachen von 4"))).toBe(
      true,
    );
    expect(
      errors.some(
        (error) => error.startsWith("OUT:") && error.includes("ausserhalb"),
      ),
    ).toBe(true);
  });

  it("computes an example per entry", () => {
    expect(templateExample(template, "172.16.224.0/19", 224)).toEqual([
      { function: "MGMT", vlanNumber: 224, prefix: "172.16.224.0/24" },
      { function: "WLAN", vlanNumber: 228, prefix: "172.16.228.0/22" },
    ]);
  });
});
