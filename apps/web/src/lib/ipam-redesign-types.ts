// Typen der neuen Aktionen der Edge Function `ipam` (IPAM-Redesign).
// Strikt nach dem Schnittstellen-Vertrag; Antworten kommen wie bei den
// bestehenden Aktionen als `{ data: … }` und werden von `ipamCall` entpackt.

export type ChangeSource =
  | "user"
  | "cleanup"
  | "planner"
  | "template"
  | "discovery"
  | "intune"
  | "prtg"
  | "import"
  | "api"
  | "system";

export type ObjectType = "prefix" | "vlan" | "site" | "address" | "template";

export type ChangeLogEntry = {
  id: number;
  at: string;
  actorName: string | null;
  source: ChangeSource;
  objectType: ObjectType;
  objectId: string;
  objectLabel: string;
  action: "create" | "update" | "delete";
  summary: string;
  changes: {
    field: string;
    label: string;
    before: string | null;
    after: string | null;
  }[];
  undoable: boolean;
};

export type Forecast = {
  trend: "rising" | "stable" | "falling" | "unknown";
  daysToWarning: number | null;
  daysToFull: number | null;
};

export type AgentStatus = "online" | "late" | "offline" | "disabled";

// 1. dashboard
export type DashboardTopEntry = {
  prefixId: string;
  prefix: string;
  name: string | null;
  vlanNumber: number | null;
  vlanName: string | null;
  siteName: string | null;
  percent: number;
  forecast: Forecast;
};

export type Dashboard = {
  kpis: {
    freeIpv4: number;
    activePrefixes: number;
    overThreshold: number;
    fullWithin30Days: number;
    openFindings: number;
    findingsByKind: Record<string, number>;
    expiringReservations30Days: number;
  };
  topUtilization: DashboardTopEntry[];
  agents: {
    id: string;
    name: string;
    platform: string | null;
    status: AgentStatus;
    lastSeenAt: string | null;
  }[];
  recentChanges: ChangeLogEntry[];
};

// 2. changeLog
export type ChangeLogRequest = {
  objectType?: ObjectType;
  objectId?: string;
  source?: ChangeSource;
  since?: string;
  before?: number;
  limit?: number;
};

export type ChangeLogPage = {
  entries: ChangeLogEntry[];
  nextBefore: number | null;
};

// 4. bulkUpdatePrefixes
export type BulkPrefixPatch = {
  status?: "container" | "active" | "reserved" | "deprecated";
  departmentId?: string | null;
  securityZone?: string | null;
  siteId?: string | null;
};

// 5. cleanupSuggestions / applyCleanup
export type CleanupKind =
  | "active_with_children"
  | "note_in_name"
  | "gateway_outside"
  | "dhcp_outside"
  | "duplicate_vlan"
  | "old_summary"
  | "empty_container";

export type CleanupSuggestion = {
  key: string;
  kind: CleanupKind;
  title: string;
  detail: string;
  fix: string;
  objectType: ObjectType;
  objectId: string;
  defaultOn: boolean;
};

export type CleanupResult = {
  applied: number;
  failed: { key: string; message: string }[];
};

// 6. addressSpace
export type AddressSegment = {
  kind: "child" | "free";
  cidr: string;
  size: string;
  prefixId?: string;
  name?: string | null;
  siteName?: string | null;
  percent?: number;
  status?: string;
};

export type AddressSpace = {
  prefixId: string;
  prefix: string;
  capacity: string;
  allocatedPercent: number;
  freeTotal: string;
  largestFree: string | null;
  childCount: number;
  segments: AddressSegment[];
  truncated?: boolean;
};

// 7. utilizationHistory
export type UtilizationHistory = {
  points: { day: string; used: number; total: number; percent: number }[];
  forecast: Forecast;
  warningPercent: number;
};

// 8. planPrefixes
export type PlanItem = {
  name: string;
  length: number;
  vlanNumber?: number | null;
  securityZone?: string | null;
};

export type PlanResult = {
  items: {
    name: string;
    cidr: string | null;
    hosts: string | null;
    error: string | null;
  }[];
  freeAfter: string;
};

// 9. templates
export type TemplateEntry = {
  function: string;
  description?: string | null;
  vlanOffset: number;
  offset24: number;
  length: number;
  zone?: string | null;
  dhcp: boolean;
};

export type SiteTemplate = {
  id?: string;
  name: string;
  description?: string | null;
  prefixLength: number;
  entries: TemplateEntry[];
};

export type TemplateList = {
  templates: SiteTemplate[];
  suggested?: SiteTemplate | null;
};

// 10. vlanMatrix
export type MatrixCellState = "ok" | "diff" | "missing" | "na";

export type MatrixCell = {
  siteId: string;
  state: MatrixCellState;
  vlanId?: string;
  vlanNumber?: number;
  vlanName?: string;
  prefixId?: string;
  prefix?: string;
  percent?: number;
  note?: string;
  suggestion?: { vlanNumber: number; prefix: string };
};

export type VlanMatrix = {
  template: SiteTemplate | null;
  sites: { id: string; name: string }[];
  rows: { function: string; zone: string | null; cells: MatrixCell[] }[];
  otherVlans: {
    siteId: string;
    vlanId: string;
    vlanNumber: number;
    name: string;
    prefix: string | null;
  }[];
};

// 12. createSiteFromTemplate
export type AssetLocationMode =
  { mode: "none" } | { mode: "existing"; id: string } | { mode: "new" };

export type SiteFromTemplateRequest = {
  templateId: string;
  name: string;
  code?: string | null;
  address?: string | null;
  supernet: string;
  vlanBase: number;
  assetLocation: AssetLocationMode;
  functions: string[];
  dryRun: boolean;
};

export type SiteFromTemplateResult = {
  preview: {
    function: string;
    vlanNumber: number;
    prefix: string;
    gateway: string;
  }[];
  siteId?: string;
};

// 14. siteOverview
export type SiteCard = {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  assetLocation: { id: string; name: string } | null;
  supernet: string | null;
  vlanCount: number;
  prefixCount: number;
  switchCount: number;
  apCount: number;
  deviceCount: number;
  percent: number | null;
  agent: { status: AgentStatus; name: string } | null;
};

export type SiteOverview = {
  sites: SiteCard[];
  assetLocations: { id: string; name: string; linkedSiteId: string | null }[];
};

// 15. siteDetail
export type SiteDetail = {
  site: SiteCard & {
    description: string | null;
    departmentId: string | null;
    vlanBase: number | null;
    supernetPrefixId: string | null;
    templateId: string | null;
  };
  vlans: {
    id: string;
    vlanNumber: number;
    name: string;
    description: string | null;
    zone: string | null;
    prefixes: {
      id: string;
      prefix: string;
      gateway: string | null;
      dhcpStart: string | null;
      dhcpEnd: string | null;
      percent: number | null;
    }[];
  }[];
  prefixesWithoutVlan: {
    id: string;
    prefix: string;
    name: string | null;
    percent: number | null;
  }[];
  devices: {
    assetId: string;
    name: string;
    category: string | null;
    ipAddress: string | null;
    model: string | null;
    manufacturer: string | null;
    serialNumber: string | null;
    locationNote: string | null;
    uplinkAssetId: string | null;
    uplinkName: string | null;
  }[];
};

// 16. compareObserved
export type CompareRow = {
  prefixId: string;
  prefix: string;
  name: string | null;
  documented: number;
  seen: number;
  matched: number;
  onlySeen: number;
  onlyDocumented: number;
  matchPercent: number | null;
};

export type CompareObserved = {
  lastScanAt: string | null;
  rows: CompareRow[];
};
