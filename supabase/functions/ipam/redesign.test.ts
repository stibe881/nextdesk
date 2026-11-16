import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { type Cidr, formatCidr, parseCidr } from "../_shared/ipam-cidr.ts";
import { InputError, parsePrefix, parseSite, parseVlan } from "./logic.ts";
import {
  addressSpaceLayout,
  agentState,
  betterAgentState,
  changeLogEntry,
  cleanupPlans,
  type CleanupPrefix,
  type CleanupVlan,
  compareObservedRows,
  forecastSummary,
  freeBlocks,
  hasOldMarker,
  normalizeFunctionName,
  parseRedesignAction,
  parseTemplate,
  planPlacement,
  rangeToCidrs,
  redesignIsRead,
  splitNoteFromText,
  suggestTemplate,
  type Template,
  templateLayout,
  historyFirstDay,
  occupiedOfDaily,
  totalSeries,
  utilizationHistoryPoints,
  utilizationRow,
  vlanMatrix,
} from "./redesign.ts";

const TENANT = "10000000-0000-4000-8000-000000000001";
const ID = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cidr = (text: string): Cidr => parseCidr(text)!;
const texts = (list: Cidr[]) => list.map(formatCidr);

Deno.test("range to aligned CIDR blocks", () => {
  const start = cidr("10.0.0.1/32").network;
  const end = cidr("10.0.0.6/32").network;
  assertEquals(texts(rangeToCidrs(4, start, end)), ["10.0.0.1/32", "10.0.0.2/31", "10.0.0.4/31", "10.0.0.6/32"]);
  assertEquals(texts(rangeToCidrs(4, cidr("10.0.0.0/24").network, cidr("10.0.255.255/32").network)), [
    "10.0.0.0/16",
  ]);
});

Deno.test("free blocks around children (IPv4 and IPv6)", () => {
  const parent = cidr("172.16.64.0/19");
  const free = freeBlocks(parent, [cidr("172.16.65.0/24"), cidr("172.16.72.0/22"), cidr("172.16.64.0/19")]);
  assertEquals(texts(free), [
    "172.16.64.0/24",
    "172.16.66.0/23",
    "172.16.68.0/22",
    "172.16.76.0/22",
    "172.16.80.0/20",
  ]);
  const v6 = freeBlocks(cidr("fd00::/48"), [cidr("fd00:0:0:1::/64")]);
  assertEquals(texts(v6).slice(0, 2), ["fd00::/64", "fd00:0:0:2::/63"]);
});

Deno.test("address space: direct children, gaps, largest free and truncation", () => {
  const parent = cidr("10.0.0.0/16");
  const layout = addressSpaceLayout(parent, [
    { cidr: cidr("10.0.0.0/24"), meta: "a" },
    { cidr: cidr("10.0.0.0/25"), meta: "nested" },
    { cidr: cidr("10.0.2.0/23"), meta: "b" },
    { cidr: cidr("10.0.0.0/16"), meta: "self" },
  ]);
  assertEquals(layout.childCount, 2);
  assertEquals(layout.segments.slice(0, 3).map((segment) => [segment.kind, formatCidr(segment.cidr)]), [
    ["child", "10.0.0.0/24"],
    ["free", "10.0.1.0/24"],
    ["child", "10.0.2.0/23"],
  ]);
  assertEquals(layout.capacity, 65536n);
  assertEquals(layout.freeTotal, 65536n - 768n);
  assertEquals(layout.largestFree, 17);
  assertEquals(layout.allocatedPercent, 1.1);
  const many = addressSpaceLayout(
    cidr("10.0.0.0/16"),
    Array.from(
      { length: 300 },
      (_, index) => ({ cidr: cidr(`10.0.${index % 256}.${index < 256 ? 0 : 128}/25`), meta: index }),
    ),
    100,
  );
  assert(many.truncated);
  assertEquals(many.segments.length, 100);
});

Deno.test("planner: smallest fitting gap, aligned, in the given order", () => {
  const parent = cidr("172.16.64.0/19");
  const occupied = [cidr("172.16.64.0/24"), cidr("172.16.66.0/24")];
  const plan = planPlacement(parent, occupied, [
    { name: "Clients", length: 24 },
    { name: "Server", length: 22 },
    { name: "Mgmt", length: 26 },
    { name: "Zu gross", length: 19 },
    { name: "Voice", length: 21 },
    { name: "Rest", length: 20 },
  ]);
  assertEquals(plan.items.map((item) => item.cidr ? formatCidr(item.cidr) : item.error), [
    "172.16.65.0/24", // smallest gap first (a /24 hole)
    "172.16.68.0/22",
    "172.16.67.0/26",
    "Ein /19 passt nicht in 172.16.64.0/19.",
    "172.16.72.0/21",
    "172.16.80.0/20",
  ]);
  assertEquals(plan.freeAfter, 256n - 64n);
  const full = planPlacement(cidr("10.0.0.0/30"), [], [{ name: "A", length: 31 }, { name: "B", length: 31 }, {
    name: "C",
    length: 31,
  }]);
  assertEquals(full.items[2]!.error, "Kein freier Bereich für ein /31.");
});

Deno.test("cleanup rules", () => {
  const prefix = (id: number, value: string, extra: Partial<CleanupPrefix> = {}): CleanupPrefix => ({
    id: ID(id),
    prefix: value,
    vrfId: null,
    status: "active",
    description: null,
    notes: null,
    gateway: null,
    dhcpStart: null,
    dhcpEnd: null,
    used: 0,
    ...extra,
  });
  const vlan = (id: number, number: number, name: string, site: string | null, extra: Partial<CleanupVlan> = {}) => ({
    id: ID(id),
    vlanNumber: number,
    name,
    siteId: site,
    siteName: site ? `Site ${site}` : null,
    siteCode: null,
    status: "active",
    description: null,
    notes: null,
    ...extra,
  });
  const plans = cleanupPlans(
    [
      prefix(1, "10.0.0.0/16", { used: 5 }),
      prefix(2, "10.0.1.0/24", { description: "Clients --> Terminiert neu im Datacenter", notes: "alt" }),
      prefix(3, "10.100.0.0/16", { status: "container", description: "--> nach DC verschoben" }),
      prefix(4, "10.200.0.0/16", { description: "Campus Summary OLD" }),
      prefix(5, "10.201.0.0/24", { gateway: "10.201.0.0" }),
      prefix(6, "10.202.0.0/24", { dhcpStart: "10.202.0.200", dhcpEnd: "10.202.0.255" }),
      prefix(7, "10.203.0.0/16", { status: "container" }),
      prefix(8, "10.204.0.0/24", { description: "Kurs->Altstetten" }),
    ],
    [
      vlan(20, 100, "DMZ", "a"),
      vlan(21, 100, "DMZ_OLD", "b"),
      vlan(22, 10, "Clients", "a"),
      vlan(23, 10, "Clients", "b"),
      vlan(24, 30, "Drucker", "a"),
      vlan(25, 30, "Voice", "b"),
    ],
  );
  const byKey = new Map(plans.map((plan) => [plan.suggestion.key, plan]));
  assertEquals(byKey.get(`active_with_children:${ID(1)}`)?.patch, { status: "container" });
  assertEquals(byKey.get(`note_in_name:${ID(2)}`)?.patch, {
    description: "Clients",
    notes: "alt\nTerminiert neu im Datacenter",
  });
  assertEquals(byKey.get(`note_in_name:${ID(3)}`)?.patch, { description: null, notes: "nach DC verschoben" });
  assertEquals(byKey.get(`old_summary:${ID(4)}`)?.patch, { status: "deprecated" });
  assertEquals(byKey.get(`gateway_outside:${ID(5)}`)?.patch, { gateway: null });
  assertEquals(byKey.get(`dhcp_outside:${ID(6)}`)?.patch, { dhcp_start: null, dhcp_end: null });
  const empty = byKey.get(`empty_container:${ID(7)}`)!;
  assertEquals([empty.patch, empty.suggestion.defaultOn], [null, false]);
  assert(!byKey.has(`empty_container:${ID(3)}`) || byKey.get(`empty_container:${ID(3)}`)!.patch === null);
  assert(!byKey.has(`note_in_name:${ID(8)}`), "arrow inside a word is not a note");
  const duplicate = byKey.get(`duplicate_vlan:${ID(21)}`)!;
  assertEquals([duplicate.patch, duplicate.suggestion.defaultOn], [{ status: "deprecated" }, true]);
  assert(!byKey.has(`duplicate_vlan:${ID(20)}`));
  assert(
    !plans.some((plan) => plan.suggestion.objectId === ID(22) || plan.suggestion.objectId === ID(23)),
    "same function at several sites is normal",
  );
  const hint = byKey.get(`duplicate_vlan:${ID(24)}`)!;
  assertEquals([hint.patch, hint.suggestion.defaultOn], [null, false]);
});

Deno.test("notes and old markers", () => {
  assertEquals(splitNoteFromText("=> siehe Ticket"), { description: null, note: "siehe Ticket" });
  assertEquals(splitNoteFromText("Server -> neu in DC"), { description: "Server", note: "neu in DC" });
  assertEquals(splitNoteFromText("Server"), null);
  assert(hasOldMarker("DMZ_OLD"));
  assert(hasOldMarker("Netz ALT"));
  assert(!hasOldMarker("Altstetten"));
  assert(!hasOldMarker("GOLDEN"));
  assertEquals(normalizeFunctionName("BAAR_Drucker", { name: "Baar", code: "BAAR" }), "drucker");
  assertEquals(normalizeFunctionName("Wlan-Gäste"), "wlangäste");
});

const TEMPLATE: Template = {
  id: ID(99),
  name: "Schulhaus",
  description: null,
  prefixLength: 19,
  entries: [
    { function: "Clients", description: null, vlanOffset: 0, offset24: 0, length: 22, zone: "LAN", dhcp: true },
    { function: "Drucker", description: null, vlanOffset: 10, offset24: 4, length: 24, zone: "LAN", dhcp: false },
    { function: "Voice", description: null, vlanOffset: 20, offset24: 5, length: 24, zone: "VOICE", dhcp: true },
  ],
};

Deno.test("template validation and layout", () => {
  assertEquals(parseTemplate({ ...TEMPLATE, id: undefined }).entries.length, 3);
  assertThrows(
    () => parseTemplate({ ...TEMPLATE, entries: [{ ...TEMPLATE.entries[0], offset24: 2 }] }),
    InputError,
    "Grenze",
  );
  assertThrows(
    () => parseTemplate({ ...TEMPLATE, entries: [TEMPLATE.entries[0], { ...TEMPLATE.entries[1], offset24: 3 }] }),
    InputError,
    "überschneidet",
  );
  assertThrows(
    () => parseTemplate({ ...TEMPLATE, entries: [{ ...TEMPLATE.entries[1], offset24: 40 }] }),
    InputError,
    "ausserhalb",
  );
  const layout = templateLayout(TEMPLATE, cidr("172.16.96.0/19"), 300, ["clients", "Voice"]);
  assertEquals(layout.errors, []);
  assertEquals(layout.items.map((item) => [item.function, item.vlanNumber, item.prefix, item.gateway]), [
    ["Clients", 300, "172.16.96.0/22", "172.16.96.1"],
    ["Voice", 320, "172.16.101.0/24", "172.16.101.1"],
  ]);
  assertEquals(templateLayout(TEMPLATE, cidr("172.16.96.0/19"), 4090, null).errors.length, 2);
});

Deno.test("vlan matrix: ok, diff, missing, na and other vlans", () => {
  const sites = [
    { id: "a", name: "Baar", code: "BAAR", vlanBase: 100, supernet: "172.16.64.0/19" },
    { id: "b", name: "Kloten", code: null, vlanBase: null, supernet: null },
    { id: "c", name: "VPN", code: null, vlanBase: null, supernet: null },
  ];
  const vlans = [
    { id: "v1", siteId: "a", vlanNumber: 100, name: "BAAR_CLIENTS", zone: null },
    { id: "v2", siteId: "a", vlanNumber: 110, name: "DRUCKER-ALT", zone: null },
    { id: "v3", siteId: "a", vlanNumber: 999, name: "Spezial", zone: null },
    { id: "v4", siteId: "b", vlanNumber: 10, name: "Clients", zone: null },
  ];
  const prefixes = [
    { id: "p1", prefix: "172.16.64.0/22", vlanId: "v1", percent: 40 },
    { id: "p2", prefix: "172.16.68.0/23", vlanId: "v2", percent: 10 },
  ];
  const matrix = vlanMatrix(TEMPLATE, sites, vlans, prefixes);
  const state = (row: number) => matrix.rows[row]!.cells.map((cell) => cell.state);
  assertEquals(state(0), ["ok", "ok", "na"]);
  assertEquals(state(1), ["diff", "missing", "na"]);
  assertEquals(matrix.rows[1]!.cells[0]!.note, "Name DRUCKER-ALT · /23 statt /24");
  assertEquals(state(2), ["missing", "missing", "na"]);
  assertEquals(matrix.rows[2]!.cells[0]!.suggestion, { vlanNumber: 120, prefix: "172.16.69.0/24" });
  assertEquals(matrix.rows[2]!.cells[1]!.suggestion, undefined);
  assertEquals(matrix.rows[0]!.cells[0]!.percent, 40);
  assertEquals(matrix.otherVlans.map((vlan) => vlan.vlanId), ["v3"]);
  assertEquals(vlanMatrix(null, sites, vlans, prefixes).otherVlans.length, 4);
});

Deno.test("template suggestion from the site with the most VLANs", () => {
  const sites = [
    { id: "a", name: "Baar", code: "BAAR", vlanBase: null, supernet: null },
    { id: "b", name: "Zug", code: null, vlanBase: null, supernet: null },
  ];
  const vlans = [
    { id: "v1", siteId: "a", vlanNumber: 110, name: "BAAR_Clients", zone: null },
    { id: "v2", siteId: "a", vlanNumber: 120, name: "BAAR_Drucker", zone: "LAN" },
    { id: "v3", siteId: "a", vlanNumber: 130, name: "BAAR_Voice", zone: null },
    { id: "v4", siteId: "b", vlanNumber: 10, name: "Clients", zone: null },
  ];
  const prefixes = [
    { id: "p1", prefix: "172.16.64.0/22", vlanId: "v1", securityZone: "LAN", dhcp: true },
    { id: "p2", prefix: "172.16.68.0/24", vlanId: "v2", securityZone: null, dhcp: false },
    { id: "p3", prefix: "172.16.70.0/24", vlanId: "v3", securityZone: "VOICE", dhcp: true },
  ];
  const template = suggestTemplate(sites, vlans, prefixes)!;
  assertEquals(template.prefixLength, 21);
  assertEquals(
    template.entries.map((entry) => [entry.function, entry.vlanOffset, entry.offset24, entry.length, entry.zone]),
    [
      ["Clients", 0, 0, 22, "LAN"],
      ["Drucker", 10, 4, 24, "LAN"],
      ["Voice", 20, 6, 24, "VOICE"],
    ],
  );
  // The suggestion passes the same validation as a saved template.
  parseTemplate(template);
  assertEquals(suggestTemplate(sites.slice(1), vlans, prefixes), null);
});

Deno.test("parses the new actions and read/manage", () => {
  assertEquals(parseRedesignAction({ type: "overview", tenantId: TENANT }), null);
  assertEquals(parseRedesignAction({ type: "dashboard", tenantId: TENANT }), { type: "dashboard", tenantId: TENANT });
  const log = parseRedesignAction({ type: "changeLog", tenantId: TENANT, objectType: "prefix", limit: 20, before: 55 });
  assertEquals(log, {
    type: "changeLog",
    tenantId: TENANT,
    objectType: "prefix",
    objectId: null,
    source: null,
    since: null,
    before: 55,
    limit: 20,
  });
  assertThrows(() => parseRedesignAction({ type: "changeLog", tenantId: TENANT, limit: 101 }), InputError);
  assertThrows(
    () => parseRedesignAction({ type: "bulkUpdatePrefixes", tenantId: TENANT, prefixIds: [ID(1)], patch: {} }),
    InputError,
  );
  const bulk = parseRedesignAction({
    type: "bulkUpdatePrefixes",
    tenantId: TENANT,
    prefixIds: [ID(1), ID(1)],
    patch: { status: "container", siteId: null },
  });
  assertEquals(bulk && bulk.type === "bulkUpdatePrefixes" ? [bulk.prefixIds, bulk.patch] : null, [[ID(1)], {
    status: "container",
    siteId: null,
  }]);
  const plan = parseRedesignAction({
    type: "planPrefixes",
    tenantId: TENANT,
    parentPrefixId: ID(1),
    items: [{ name: "Clients", length: 24, vlanNumber: "110" }],
    dryRun: true,
  })!;
  assert(redesignIsRead(plan));
  assert(!redesignIsRead({ ...plan, dryRun: false } as typeof plan));
  assert(!redesignIsRead(parseRedesignAction({ type: "undoChange", tenantId: TENANT, entryId: 3 })!));
  const site = parseRedesignAction({
    type: "createSiteFromTemplate",
    tenantId: TENANT,
    templateId: ID(9),
    name: "Kloten",
    supernet: "172.16.160.0/19",
    vlanBase: 160,
    assetLocation: { mode: "new" },
    functions: ["Clients", "clients"],
    dryRun: false,
  });
  assertEquals(site && site.type === "createSiteFromTemplate" ? [site.functions, site.assetLocation] : null, [
    ["clients"],
    { mode: "new" },
  ]);
  assertThrows(() =>
    parseRedesignAction({
      type: "createSiteFromTemplate",
      tenantId: TENANT,
      templateId: ID(9),
      name: "X",
      supernet: "172.16.160.5/19",
      vlanBase: 1,
      functions: [],
    }), InputError);
  assertThrows(() => parseRedesignAction({ type: "applyCleanup", tenantId: TENANT, keys: ["drop table"] }), InputError);
});

Deno.test("forecast summary and agent state", () => {
  assertEquals(forecastSummary(null, "2026-11-11"), { trend: "unknown", daysToWarning: null, daysToFull: null });
  assertEquals(
    forecastSummary({ warningOn: "2026-11-01", fullOn: "2026-12-11", perDay: 1.5 }, "2026-11-11"),
    { trend: "rising", daysToWarning: 0, daysToFull: 30 },
  );
  assertEquals(forecastSummary({ warningOn: null, fullOn: null, perDay: 0 }, "2026-11-11").trend, "stable");
  const now = Date.parse("2026-11-11T12:00:00Z");
  assertEquals(agentState("active", "2026-11-11T11:45:00Z", now), "online");
  assertEquals(agentState("active", "2026-11-11T01:00:00Z", now), "late");
  assertEquals(agentState("active", "2026-11-09T01:00:00Z", now), "offline");
  assertEquals(agentState("active", null, now), "offline");
  assertEquals(agentState("disabled", "2026-11-11T11:59:00Z", now), "disabled");
  assertEquals(betterAgentState("late", "online"), "online");
  assertEquals(betterAgentState("online", "offline"), "online");
});

Deno.test("target/actual comparison per leaf prefix", () => {
  const rows = compareObservedRows(
    [
      { id: "p1", prefix: "10.0.1.0/24", name: "Clients", vrfId: null },
      { id: "p2", prefix: "10.0.2.0/24", name: null, vrfId: null },
      { id: "p3", prefix: "10.0.3.0/24", name: null, vrfId: null },
    ],
    [{ address: "10.0.1.10/32", vrfId: null }, { address: "10.0.1.11", vrfId: null }, {
      address: "10.0.2.5",
      vrfId: "other",
    }],
    [{ address: "10.0.1.10", vrfId: null }, { address: "10.0.1.99", vrfId: null }, {
      address: "10.0.2.5",
      vrfId: null,
    }],
  );
  assertEquals(rows, [
    {
      prefixId: "p1",
      prefix: "10.0.1.0/24",
      name: "Clients",
      documented: 2,
      seen: 2,
      matched: 1,
      onlySeen: 1,
      onlyDocumented: 1,
      matchPercent: 33.3,
    },
    {
      prefixId: "p2",
      prefix: "10.0.2.0/24",
      name: null,
      documented: 0,
      seen: 1,
      matched: 0,
      onlySeen: 1,
      onlyDocumented: 0,
      matchPercent: 0,
    },
  ]);
});

Deno.test("change log entry: labels, summary and undo", () => {
  const entry = changeLogEntry({
    id: 7,
    at: "2026-11-11T10:00:00Z",
    source: "cleanup",
    object_type: "prefix",
    object_id: ID(1),
    object_label: "10.0.0.0/16",
    action: "update",
    changes: ["status", "site_id", "gateway"],
    before: { status: "active", site_id: null, gateway: "10.0.0.1/32" },
    after: { status: "container", site_id: ID(5), gateway: null },
    is_latest: true,
  }, {
    actorName: null,
    canManage: true,
    resolve: (field, id) => (field === "site_id" && id === ID(5) ? "Baar" : null),
  });
  assertEquals(entry.summary, "Status: Aktiv → Container · Standort: – → Baar · Gateway: 10.0.0.1 → –");
  assertEquals(entry.changes[0], { field: "status", label: "Status", before: "Aktiv", after: "Container" });
  assert(entry.undoable);
  const readOnly = changeLogEntry({
    ...entry,
    object_type: "prefix",
    action: "update",
    changes: ["status"],
    is_latest: true,
  }, {
    actorName: "A",
    canManage: false,
  });
  assert(!readOnly.undoable);
  const created = changeLogEntry({
    id: 8,
    at: "x",
    source: "planner",
    object_type: "vlan",
    object_id: ID(2),
    object_label: "VLAN 10 Clients",
    action: "create",
    changes: [],
    after: { name: "Clients" },
    is_latest: true,
  }, { actorName: "S. Gross", canManage: true });
  assertEquals([created.summary, created.undoable], ["Angelegt", false]);
});

Deno.test("save actions accept the new fields and keep them when not sent", () => {
  const site = parseSite({ name: "Baar", vlanBase: "100", assetLocationId: ID(3), supernetPrefixId: null });
  assertEquals([site.vlanBase, site.assetLocationId, site.supernetPrefixId, site.templateId], [
    100,
    ID(3),
    null,
    undefined,
  ]);
  assertThrows(() => parseSite({ name: "Baar", vlanBase: 5000 }), InputError);
  const vlan = parseVlan({ vlanNumber: 10, name: "Clients", securityZone: "LAN", notes: " Hinweis " });
  assertEquals([vlan.zone, vlan.notes, vlan.status], ["LAN", "Hinweis", undefined]);
  assertEquals(parseVlan({ vlanNumber: 10, name: "Clients", zone: null, status: "deprecated" }).zone, null);
  assertThrows(() => parseVlan({ vlanNumber: 10, name: "Clients", status: "old" }), InputError);
  assertEquals(parsePrefix({ prefix: "10.0.0.0/24" }).notes, undefined);
  assertEquals(parsePrefix({ prefix: "10.0.0.0/24", notes: "" }).notes, null);
});

Deno.test("utilization history: one counting, approximations, live point replaces today", () => {
  // Row before 0347, backfilled by 0348 (occupied_total = used).
  const legacy = utilizationRow({ day: "2026-11-14", used: 30, dhcp_used: 50, total: "254", occupied_total: 30 });
  // Row before 0347 without backfill (fallback to the documented addresses).
  const raw = utilizationRow({ day: "2026-11-13", used: 29, dhcp_used: 50, total: "254" });
  const stored = utilizationRow({
    day: "2026-11-15", used: 31, dhcp_used: 50, total: "254",
    static_used: 28, static_total: "204", pool_used: 20, pool_size: "50", occupied_total: 48,
  });
  const staleToday = utilizationRow({
    day: "2026-11-16", used: 1, dhcp_used: 50, total: 254,
    static_used: 1, static_total: 204, pool_used: 1, pool_size: 50, occupied_total: 2,
  });
  // RPC row (dhcp_size/capacity) with the day given explicitly.
  const live = utilizationRow({
    used: 33, dhcp_size: "50", capacity: "254",
    static_used: 30, static_total: "204", pool_used: 25, pool_size: "50", occupied_total: 55,
  }, "2026-11-16");
  const points = utilizationHistoryPoints([stored, staleToday, legacy, raw], live);
  assertEquals(points.map((point) => point.day), ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"]);
  // Old rows: occupied / total (pool size never counted), flagged as approximation.
  assertEquals(points[1], {
    day: "2026-11-14", used: 30, total: 254, percent: 11.8,
    staticPercent: null, poolPercent: null, totalPercent: 11.8, approx: true,
    staticUsed: null, staticTotal: null, poolUsed: null, poolSize: null, occupied: 30,
  });
  assertEquals([points[0]!.used, points[0]!.percent, points[0]!.approx], [29, 11.4, true]);
  assertEquals(points[2]!.staticPercent, 13.7);
  assertEquals(points[2]!.poolPercent, 40);
  assertEquals([points[2]!.percent, points[2]!.totalPercent, points[2]!.approx], [18.9, 18.9, false]);
  // Live values win over the stored row of today.
  assertEquals(points[3]!.occupied, 55);
  assertEquals(points[3]!.poolPercent, 50);
  assertEquals(points[3]!.percent, 21.7);
  // Forecast series: the same counting for every day.
  assertEquals(totalSeries(points).map((point) => point.used), [29, 30, 48, 55]);
  assertEquals(occupiedOfDaily({ used: 59, dhcp_used: 139, occupied_total: null }), 59);
  assertEquals(occupiedOfDaily({ used: 70, dhcp_used: 139, occupied_total: "61" }), 61);
});

Deno.test("utilization history: customer case (pool 139, 59 addresses, old rows)", () => {
  const old = ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"].map((day) =>
    utilizationRow({ day, used: 59, dhcp_used: 139, total: "254", occupied_total: 59 })
  );
  const live = utilizationRow({
    used: 59, dhcp_size: "139", capacity: "254",
    static_used: 59, static_total: "115", pool_used: 0, pool_size: "139", occupied_total: 59,
  }, "2026-11-16");
  const points = utilizationHistoryPoints(old, live);
  // Flat 23 %, no drop from 78 %.
  assertEquals(points.map((point) => point.percent), [23.2, 23.2, 23.2, 23.2, 23.2]);
  assertEquals(points.map((point) => point.approx), [true, true, true, true, false]);
  assertEquals([points[4]!.staticPercent, points[4]!.poolPercent], [51.3, 0]);
  assertEquals(historyFirstDay("2026-11-12", points), "2026-11-12");
  assertEquals(historyFirstDay(null, points.slice(4)), "2026-11-16");
  assertEquals(historyFirstDay(null, []), null);
});

Deno.test("utilization history: no pool and IPv6", () => {
  const [point] = utilizationHistoryPoints([], utilizationRow({
    used: 3, dhcp_size: 0, capacity: "18446744073709551616",
    static_used: 3, static_total: "18446744073709551616", pool_used: 0, pool_size: 0, occupied_total: 3,
  }, "2026-11-16"));
  assertEquals(point!.poolPercent, null);
  assertEquals(point!.poolSize, null);
  assertEquals(point!.staticPercent, 0);
  assertEquals(point!.totalPercent, 0);
  // Pool covers the whole prefix: no static capacity.
  const full = utilizationHistoryPoints([utilizationRow({
    day: "2026-11-16", used: 2, dhcp_used: 254, total: 254,
    static_used: 0, static_total: 0, pool_used: 254, pool_size: 254, occupied_total: 254,
  })], null)[0]!;
  assertEquals(full.staticPercent, null);
  assertEquals(full.poolPercent, 100);
  assertEquals(full.totalPercent, 100);
  assertEquals(full.percent, 100);
});
