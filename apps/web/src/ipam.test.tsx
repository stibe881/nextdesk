import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("./lib/ipam-api", () => ({
  ipamCall: invoke,
  downloadFile: vi.fn(),
}));

import { Ipam } from "./ipam";
import { IpamFindingsPage } from "./ipam-findings";
import { bulkUndoGroups, IpamNetworksPage } from "./ipam-networks";
import { DashboardView, searchHits } from "./ipam-overview";
import { IpCalculator, planItems, plannerParents } from "./ipam-planner";
import { SiteCardButton, SiteDocumentation, siteNetRows } from "./ipam-sites";
import { MatrixSection } from "./ipam-vlans";
import { changeLogRequest } from "./ipam-findings";
import type { IpamOverview, IpamPrefix } from "./lib/ipam-model";
import type {
  Dashboard,
  SiteDetail,
  VlanMatrix,
} from "./lib/ipam-redesign-types";

const tenantId = "00000000-0000-4000-8000-000000000001";
const noop = () => undefined;
/** SSR output without React's text separators. */
const render = (node: ReactNode) =>
  renderToString(node).replaceAll("<!-- -->", "");

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
    usage: { used: 10, dhcpSize: 0, capacity: "254", percent: 4 },
    parentId,
    depth: parentId ? 1 : 0,
    ...extra,
  };
}

const overview: IpamOverview = {
  canManage: true,
  departments: [],
  vrfs: [],
  sites: [
    {
      id: "s1",
      name: "Campus Nord",
      code: "CN",
      address: null,
      description: null,
      departmentId: null,
    },
  ],
  vlans: [
    {
      id: "v1",
      vlanNumber: 67,
      name: "PRINTER",
      siteId: "s1",
      departmentId: null,
      description: null,
    },
  ],
  prefixes: [
    prefix("root", "10.20.0.0/16", null, {
      status: "container",
      description: "Interne Netze",
    }),
    prefix("p1", "10.20.67.0/24", "root", {
      siteId: "s1",
      vlanId: "v1",
      description: "Drucker",
    }),
    prefix("old", "10.99.0.0/16", null, { status: "deprecated" }),
  ],
  people: [],
  teams: [],
  services: [],
  kpis: {
    prefixCount: 2,
    vrfCount: 0,
    addressCount: 10,
    usedV4: 10,
    capacityV4: "254",
    overWarning: 0,
    openFindings: 3,
    conflicts: 1,
  },
};

describe("Ipam shell", () => {
  it("renders header, tabs and the administration menu without changing the props", () => {
    const html = render(
      <Ipam
        apiPanel={() => <p>API</p>}
        discoveryPanel={() => <p>Discovery</p>}
        importPanel={() => <p>Import</p>}
        onOpenTicket={noop}
        tenantId={tenantId}
      />,
    );
    expect(html).toContain("IP-Adressen");
    for (const label of [
      "Übersicht",
      "Netze",
      "VLANs",
      "Standorte",
      "Funde",
      "Subnetz-Planer",
      "Verwaltung",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("IP-Adressen werden geladen");
  });
});

describe("Übersicht", () => {
  const dashboard: Dashboard = {
    kpis: {
      freeIpv4: 9412,
      activePrefixes: 57,
      overThreshold: 3,
      fullWithin30Days: 1,
      openFindings: 7,
      findingsByKind: { conflict: 2, ghost: 4, dns_mismatch: 1 },
      expiringReservations30Days: 4,
    },
    topUtilization: [
      {
        prefixId: "p1",
        prefix: "10.20.68.0/22",
        name: "WLAN",
        vlanNumber: 68,
        vlanName: "WLAN_BYOD",
        siteName: "Campus Nord",
        percent: 96,
        forecast: { trend: "rising", daysToWarning: null, daysToFull: 18 },
      },
    ],
    agents: [
      {
        id: "a1",
        name: "Agent Nord",
        platform: "Linux",
        status: "late",
        lastSeenAt: null,
      },
    ],
    recentChanges: [
      {
        id: 1,
        at: new Date().toISOString(),
        actorName: null,
        source: "cleanup",
        objectType: "prefix",
        objectId: "root",
        objectLabel: "10.0.0.0/16",
        action: "update",
        summary: "Status: Aktiv → Container",
        changes: [],
        undoable: true,
      },
    ],
  };

  it("shows KPIs, top utilization with forecast, agents and recent changes", () => {
    const html = render(
      <DashboardView
        dashboard={dashboard}
        onOpenChanges={noop}
        onOpenFindings={noop}
        onOpenNetworks={noop}
        onOpenPrefix={noop}
      />,
    );
    expect(html).toContain("9’412");
    expect(html).toContain("in 57 aktiven Subnetzen");
    expect(html).toContain("1 davon in unter 30 Tagen voll");
    expect(html).toContain("4 Ghost-IPs · 2 Konflikte · 1 DNS");
    expect(html).toContain("voll in ca. 18 Tagen");
    expect(html).toContain("68 WLAN_BYOD");
    expect(html).toContain("Verspätet");
    expect(html).toContain("Bereinigung");
  });

  it("combines search hits with VLANs from the overview", () => {
    const open = vi.fn();
    const hits = searchHits(
      "67",
      { addresses: [], prefixes: [overview.prefixes[1]!] },
      overview,
      open,
      open,
      open,
    );
    expect(hits.map((hit) => hit.kind)).toEqual(["Subnetz", "VLAN"]);
    expect(hits[1]!.title).toBe("67 PRINTER");
    expect(searchHits("6", null, overview, open, open, open)).toEqual([]);
  });
});

describe("Netze", () => {
  it("renders the tree with filters and hides deprecated networks", () => {
    const html = render(
      <IpamNetworksPage
        canManage
        onChanged={noop}
        onDialog={noop}
        onOpenAddress={noop}
        onOpenCleanup={noop}
        onOpenFindings={noop}
        onOpenPlanner={noop}
        onOpenSite={noop}
        onSelect={noop}
        overview={overview}
        revision={0}
        selectedPrefixId="root"
        tenantId={tenantId}
      />,
    );
    expect(html).toContain("Hierarchie");
    expect(html).toContain("Nach Standort");
    // Site/zone/status filters sit behind «Filter»; text filter is inline.
    expect(html).toContain("Filter");
    expect(html).toContain("Netze filtern");
    expect(html).toContain('aria-label="Pfad"');
    expect(html).toContain("Mehrere auswählen");
    expect(html).toContain("10.20.67.0/24");
    expect(html).toContain("VLAN 67");
    expect(html).not.toContain("10.99.0.0/16");
    expect(html).toContain("1 veraltetes Netz ausgeblendet");
    // Supernet detail is shown for the container.
    expect(html).toContain("Im Planer aufteilen");
  });
});

describe("Planer", () => {
  it("offers containers as parents and maps rows to the contract", () => {
    expect(plannerParents(overview.prefixes).map((entry) => entry.id)).toEqual([
      "root",
    ]);
    expect(
      planItems([
        { id: 1, name: " KAMERA ", length: 24, vlan: "84", zone: "" },
        { id: 2, name: "VOIP", length: 23, vlan: "abc", zone: "LAN" },
      ]),
    ).toEqual([
      { name: "KAMERA", length: 24, vlanNumber: 84, securityZone: null },
      { name: "VOIP", length: 23, vlanNumber: null, securityZone: "LAN" },
    ]);
  });

  it("renders the calculator", () => {
    const html = render(
      <IpCalculator onOpenPrefix={noop} prefixes={overview.prefixes} />,
    );
    expect(html).toContain("IP-Rechner");
    expect(html).toContain("Adresse mit Präfix");
  });
});

describe("VLAN-Matrix", () => {
  const matrix: VlanMatrix = {
    template: { id: "t1", name: "Standard", prefixLength: 19, entries: [] },
    sites: [
      { id: "s1", name: "Campus Nord" },
      { id: "s2", name: "Süd" },
      { id: "s3", name: "VPN" },
    ],
    rows: [
      {
        function: "PRINTER",
        zone: "LAN",
        cells: [
          {
            siteId: "s1",
            state: "ok",
            vlanNumber: 67,
            prefix: "10.20.67.0/24",
            percent: 41,
          },
          {
            siteId: "s2",
            state: "missing",
            suggestion: { vlanNumber: 131, prefix: "10.20.131.0/24" },
          },
          { siteId: "s3", state: "na" },
        ],
      },
      {
        function: "WLAN",
        zone: "WLAN",
        cells: [
          {
            siteId: "s1",
            state: "diff",
            vlanNumber: 68,
            prefix: "10.20.68.0/23",
            note: "/23 statt /22",
          },
        ],
      },
    ],
    otherVlans: [
      {
        siteId: "s1",
        vlanId: "v9",
        vlanNumber: 999,
        name: "TEST",
        prefix: null,
      },
    ],
  };

  it("shows ok, deviating, missing and not applicable cells", () => {
    const html = render(
      <MatrixSection
        canManage
        error={null}
        matrix={matrix}
        onChanged={noop}
        onDialog={noop}
        onEditTemplate={noop}
        onOpenPrefix={noop}
        onOpenSite={noop}
        overview={overview}
        revision={0}
        suggested={null}
        tenantId={tenantId}
      />,
    );
    expect(html).toContain("ipam-mx--ok");
    expect(html).toContain("/23 statt /22");
    expect(html).toContain("Vorschlag 131 · 10.20.131.0/24");
    expect(html).toContain("+ anlegen");
    expect(html).toContain("PRINTER an VPN: nicht vorgesehen");
    expect(html).toContain("Weitere VLANs ausserhalb der Vorlage (1)");
  });

  it("explains a missing template", () => {
    const html = render(
      <MatrixSection
        canManage
        error={null}
        matrix={{ ...matrix, template: null, rows: [] }}
        onChanged={noop}
        onDialog={noop}
        onEditTemplate={noop}
        onOpenPrefix={noop}
        onOpenSite={noop}
        overview={overview}
        revision={0}
        suggested={{
          name: "Vorschlag",
          prefixLength: 19,
          entries: [
            {
              function: "MGMT",
              vlanOffset: 0,
              offset24: 0,
              length: 24,
              dhcp: false,
            },
          ],
        }}
        tenantId={tenantId}
      />,
    );
    expect(html).toContain("Noch keine Standort-Vorlage");
    expect(html).toContain("Vorgeschlagene Vorlage prüfen");
  });
});

describe("Standorte", () => {
  const detail: SiteDetail = {
    site: {
      id: "s1",
      name: "Campus Nord",
      code: "CN",
      address: "Nordstrasse 1",
      assetLocation: null,
      supernet: "10.20.64.0/19",
      vlanCount: 1,
      prefixCount: 1,
      switchCount: 1,
      apCount: 1,
      deviceCount: 2,
      percent: 41,
      agent: { status: "online", name: "Agent Nord" },
      description: null,
      departmentId: null,
      vlanBase: 64,
      supernetPrefixId: "root",
      templateId: null,
    },
    vlans: [
      {
        id: "v1",
        vlanNumber: 67,
        name: "PRINTER",
        description: null,
        zone: "LAN",
        prefixes: [
          {
            id: "p1",
            prefix: "10.20.67.0/24",
            gateway: "10.20.67.1",
            dhcpStart: "10.20.67.100",
            dhcpEnd: "10.20.67.199",
            percent: 41,
          },
        ],
      },
    ],
    prefixesWithoutVlan: [],
    devices: [
      {
        assetId: "a1",
        name: "SW001",
        category: "Switch",
        ipAddress: "10.20.64.11",
        model: "Modell X",
        manufacturer: null,
        serialNumber: "SN-1",
        locationNote: "Rack A",
        uplinkAssetId: null,
        uplinkName: null,
      },
    ],
  };

  it("renders a site card with link hint and agent status", () => {
    const html = render(
      <SiteCardButton active onPick={noop} site={detail.site} />,
    );
    expect(html).toContain("Campus Nord");
    expect(html).toContain("Asset-Standort noch nicht verknüpft");
    expect(html).toContain("Agent online");
    expect(html).toContain('aria-pressed="true"');
  });

  it("renders the printable documentation without secrets", () => {
    expect(siteNetRows(detail)[0]).toMatchObject({
      vlan: "67",
      dhcp: ".100 – .199",
    });
    const html = render(<SiteDocumentation detail={detail} onClose={noop} />);
    expect(html).toContain("Netzwerkdokumentation Campus Nord");
    expect(html).toContain("10.20.67.0/24");
    expect(html).toContain("SN-1");
    expect(html).toContain("keine Passwörter oder WLAN-Schlüssel");
  });
});

describe("Funde und Protokoll", () => {
  it("renders the mode switch", () => {
    const html = render(
      <IpamFindingsPage
        canManage
        mode="changes"
        onChanged={noop}
        onMode={noop}
        onOpenAddress={noop}
        onOpenDiscovery={noop}
        onOpenPrefix={noop}
        onOpenTicket={undefined}
        revision={0}
        tenantId={tenantId}
      />,
    );
    expect(html).toContain("Soll / Ist");
    expect(html).toContain("Änderungsprotokoll");
    expect(html).toContain("Alle Objekte");
    expect(html).toContain("Letzte 30 Tage");
  });

  it("builds the change log request", () => {
    const now = Date.parse("2026-11-11T12:00:00Z");
    expect(changeLogRequest("prefix", "cleanup", "7", 120, now)).toEqual({
      limit: 50,
      objectType: "prefix",
      source: "cleanup",
      since: "2026-11-04T12:00:00.000Z",
      before: 120,
    });
    expect(changeLogRequest("", "", "all", null, now)).toEqual({ limit: 50 });
  });
});

describe("Netze – Rückgängig", () => {
  it("groups the previous values of a bulk change", () => {
    const prefixes = [
      prefix("a", "10.1.0.0/24", null, { status: "active", siteId: "s1" }),
      prefix("b", "10.1.1.0/24", null, { status: "active", siteId: null }),
      prefix("c", "10.1.2.0/24", null, { status: "reserved", siteId: "s1" }),
    ];
    const groups = bulkUndoGroups(prefixes, ["a", "b", "c", "x"], {
      status: "deprecated",
    });
    expect(groups).toEqual([
      { prefixIds: ["a", "b"], patch: { status: "active" } },
      { prefixIds: ["c"], patch: { status: "reserved" } },
    ]);
    expect(
      bulkUndoGroups(prefixes, ["a", "b"], { siteId: "s2" }).map(
        (group) => group.patch,
      ),
    ).toEqual([{ siteId: "s1" }, { siteId: null }]);
  });
});
