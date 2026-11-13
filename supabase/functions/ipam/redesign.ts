// IPAM redesign: request parsing and pure logic for the new actions of the
// `ipam` edge function (dashboard, change log, cleanup, address space,
// planner, site templates, VLAN matrix, sites, target/actual comparison).
// No database access so everything can be tested with `deno test`.

import { msg } from "../_shared/formality.ts";
import {
  addressBits,
  type Cidr,
  cidrCapacity,
  cidrContainsAddress,
  cidrContainsCidr,
  cidrLast,
  cidrSize,
  formatAddress,
  formatCidr,
  type IpAddress,
  parseAddress,
  parseCidrInput,
  usableRange,
  utilizationPercent,
} from "../_shared/ipam-cidr.ts";
import { InputError, isUuid, optionalText, parsePrefixText, PREFIX_STATUSES, type PrefixStatus } from "./logic.ts";

type Json = Record<string, unknown>;

export const CHANGE_SOURCES = [
  "user",
  "cleanup",
  "planner",
  "template",
  "discovery",
  "intune",
  "prtg",
  "import",
  "api",
  "system",
] as const;
export const OBJECT_TYPES = ["prefix", "vlan", "site", "address", "template"] as const;
export const CLEANUP_KINDS = [
  "active_with_children",
  "note_in_name",
  "gateway_outside",
  "dhcp_outside",
  "duplicate_vlan",
  "old_summary",
  "empty_container",
] as const;

export type ChangeSource = (typeof CHANGE_SOURCES)[number];
export type ObjectType = (typeof OBJECT_TYPES)[number];
export type CleanupKind = (typeof CLEANUP_KINDS)[number];

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Templates

export type TemplateEntry = {
  function: string;
  description: string | null;
  vlanOffset: number;
  /** Number of /24 blocks from the start of the site supernet. */
  offset24: number;
  length: number;
  zone: string | null;
  dhcp: boolean;
};

export type Template = {
  id?: string;
  name: string;
  description: string | null;
  prefixLength: number;
  entries: TemplateEntry[];
};

function integer(value: unknown, label: string, min: number, max: number): number {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new InputError(`${label} muss eine ganze Zahl zwischen ${min} und ${max} sein.`);
  }
  return parsed;
}

function uuid(value: unknown, label: string): string {
  if (!isUuid(value)) throw new InputError(`${label} ist ungültig.`);
  return value.toLowerCase();
}

function optionalUuid(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return uuid(value, label);
}

/** Template validation: entries fit into the supernet, are aligned and disjoint. */
export function parseTemplate(value: unknown): Template {
  if (!isRecord(value)) throw new InputError("Die Angaben zur Vorlage fehlen.");
  const name = optionalText(value.name, 120, "Der Name");
  if (!name) throw new InputError(msg("Bitte erfasse einen Namen für die Vorlage.", msg("Bitte erfasse einen Namen für die Vorlage.", "Bitte erfassen Sie einen Namen für die Vorlage.")));
  const prefixLength = integer(value.prefixLength, "Die Länge des Supernetzes", 8, 30);
  if (!Array.isArray(value.entries) || value.entries.length > 128) {
    throw new InputError("Eine Vorlage hat höchstens 128 Einträge.");
  }
  const space = 1n << BigInt(32 - prefixLength);
  const seenFunctions = new Set<string>();
  const seenOffsets = new Set<number>();
  const ranges: { start: bigint; end: bigint; name: string }[] = [];
  const entries = value.entries.map((raw, index): TemplateEntry => {
    if (!isRecord(raw)) throw new InputError(`Eintrag ${index + 1} der Vorlage ist ungültig.`);
    const fn = optionalText(raw.function, 120, "Die Funktion");
    if (!fn) throw new InputError(msg(`Eintrag ${index + 1}: Bitte erfasse die Funktion.`, msg(`Eintrag ${index + 1}: Bitte erfasse die Funktion.`, `Eintrag ${index + 1}: Bitte erfassen Sie die Funktion.`)));
    if (seenFunctions.has(fn.toLowerCase())) throw new InputError(`Die Funktion «${fn}» kommt doppelt vor.`);
    seenFunctions.add(fn.toLowerCase());
    const vlanOffset = integer(raw.vlanOffset, `«${fn}»: Der VLAN-Abstand`, 0, 4093);
    if (seenOffsets.has(vlanOffset)) throw new InputError(`«${fn}»: Der VLAN-Abstand ${vlanOffset} kommt doppelt vor.`);
    seenOffsets.add(vlanOffset);
    const offset24 = integer(raw.offset24, `«${fn}»: Der Abstand in /24`, 0, 1 << 22);
    const length = integer(raw.length, `«${fn}»: Die Präfixlänge`, prefixLength, 30);
    const start = BigInt(offset24) * 256n;
    const size = 1n << BigInt(32 - length);
    if (start % size !== 0n) {
      throw new InputError(`«${fn}»: Ein /${length} muss an einer passenden Grenze beginnen.`);
    }
    if (start + size > space) {
      throw new InputError(`«${fn}» liegt ausserhalb des /${prefixLength}-Supernetzes.`);
    }
    const end = start + size - 1n;
    const overlap = ranges.find((range) => range.start <= end && start <= range.end);
    if (overlap) throw new InputError(`«${fn}» überschneidet sich mit «${overlap.name}».`);
    ranges.push({ start, end, name: fn });
    return {
      function: fn,
      description: optionalText(raw.description, 500, "Die Beschreibung"),
      vlanOffset,
      offset24,
      length,
      zone: optionalText(raw.zone, 60, "Die Zone"),
      dhcp: raw.dhcp === true,
    };
  });
  const template: Template = {
    name,
    description: optionalText(value.description, 1000, "Die Beschreibung"),
    prefixLength,
    entries,
  };
  const id = optionalUuid(value.id, "Die Vorlage");
  if (id) template.id = id;
  return template;
}

/** Stored template row → Template (lenient; invalid entries are dropped). */
export function templateFromRow(row: Json): Template {
  const entries = Array.isArray(row.entries) ? row.entries : [];
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    description: typeof row.description === "string" ? row.description : null,
    prefixLength: Number(row.prefix_length) || 24,
    entries: entries.filter(isRecord).map((entry) => ({
      function: String(entry.function ?? ""),
      description: typeof entry.description === "string" ? entry.description : null,
      vlanOffset: Number(entry.vlanOffset) || 0,
      offset24: Number(entry.offset24) || 0,
      length: Number(entry.length) || 24,
      zone: typeof entry.zone === "string" ? entry.zone : null,
      dhcp: entry.dhcp === true,
    })).filter((entry) => entry.function),
  };
}

export type LayoutItem = {
  function: string;
  description: string | null;
  vlanNumber: number;
  prefix: string;
  gateway: string | null;
  zone: string | null;
  dhcp: boolean;
};

/** First assignable address of a prefix (gateway convention). */
export function firstUsable(cidr: Cidr): string | null {
  if (cidr.version === 4 && cidr.length > 30) return null;
  if (cidr.version === 6 && cidr.length === 128) return null;
  return formatAddress({ version: cidr.version, value: usableRange(cidr).first });
}

/** Expected VLANs and subnets of a site built from a template. */
export function templateLayout(
  template: Template,
  supernet: Cidr,
  vlanBase: number,
  functions: string[] | null,
): { items: LayoutItem[]; errors: string[] } {
  const errors: string[] = [];
  const items: LayoutItem[] = [];
  const wanted = functions ? new Set(functions.map((fn) => fn.toLowerCase())) : null;
  if (wanted) {
    for (const fn of functions!) {
      if (!template.entries.some((entry) => entry.function.toLowerCase() === fn.toLowerCase())) {
        errors.push(`Die Funktion «${fn}» gibt es in der Vorlage nicht.`);
      }
    }
  }
  if (supernet.version !== 4) {
    return { items, errors: [...errors, "Standort-Vorlagen gelten nur für IPv4."] };
  }
  for (const entry of template.entries) {
    if (wanted && !wanted.has(entry.function.toLowerCase())) continue;
    const vlanNumber = vlanBase + entry.vlanOffset;
    const cidr = templateEntryCidr(entry, supernet);
    if (vlanNumber > 4094) {
      errors.push(`«${entry.function}»: VLAN ${vlanNumber} ist grösser als 4094.`);
      continue;
    }
    if (!cidr) {
      errors.push(`«${entry.function}» passt nicht in ${formatCidr(supernet)}.`);
      continue;
    }
    items.push({
      function: entry.function,
      description: entry.description,
      vlanNumber,
      prefix: formatCidr(cidr),
      gateway: firstUsable(cidr),
      zone: entry.zone,
      dhcp: entry.dhcp,
    });
  }
  return { items, errors };
}

/** Subnet of a template entry inside the supernet, or null when it does not fit. */
export function templateEntryCidr(entry: TemplateEntry, supernet: Cidr): Cidr | null {
  if (supernet.version !== 4 || entry.length < supernet.length || entry.length > 32) return null;
  const network = supernet.network + BigInt(entry.offset24) * 256n;
  const cidr: Cidr = { version: 4, network, length: entry.length };
  const size = cidrSize(cidr);
  if (network % size !== 0n || !cidrContainsCidr(supernet, cidr)) return null;
  return cidr;
}

// ---------------------------------------------------------------------------
// Request parsing

export type BulkPatch = {
  status?: PrefixStatus;
  departmentId?: string | null;
  securityZone?: string | null;
  siteId?: string | null;
};

export type PlanItemInput = {
  name: string;
  length: number;
  vlanNumber: number | null;
  securityZone: string | null;
};

export type AssetLocationChoice = { mode: "none" } | { mode: "existing"; id: string } | { mode: "new" };

export type RedesignAction =
  | { type: "dashboard"; tenantId: string }
  | {
    type: "changeLog";
    tenantId: string;
    objectType: ObjectType | null;
    objectId: string | null;
    source: ChangeSource | null;
    since: string | null;
    before: number | null;
    limit: number;
  }
  | { type: "undoChange"; tenantId: string; entryId: number }
  | { type: "bulkUpdatePrefixes"; tenantId: string; prefixIds: string[]; patch: BulkPatch }
  | { type: "cleanupSuggestions"; tenantId: string }
  | { type: "applyCleanup"; tenantId: string; keys: string[] }
  | { type: "addressSpace"; tenantId: string; prefixId: string }
  | { type: "utilizationHistory"; tenantId: string; prefixId: string; days: number }
  | { type: "planPrefixes"; tenantId: string; parentPrefixId: string; items: PlanItemInput[]; dryRun: boolean }
  | { type: "listTemplates"; tenantId: string }
  | { type: "saveTemplate"; tenantId: string; template: Template }
  | { type: "deleteTemplate"; tenantId: string; id: string }
  | { type: "vlanMatrix"; tenantId: string; templateId: string | null }
  | { type: "createFromTemplate"; tenantId: string; siteId: string; function: string; templateId: string }
  | {
    type: "createSiteFromTemplate";
    tenantId: string;
    templateId: string;
    name: string;
    code: string | null;
    address: string | null;
    supernet: string;
    vlanBase: number;
    assetLocation: AssetLocationChoice;
    functions: string[];
    dryRun: boolean;
  }
  | { type: "siteOverview"; tenantId: string }
  | { type: "siteDetail"; tenantId: string; siteId: string }
  | { type: "compareObserved"; tenantId: string; siteId: string | null };

export const REDESIGN_TYPES: ReadonlySet<string> = new Set([
  "dashboard",
  "changeLog",
  "undoChange",
  "bulkUpdatePrefixes",
  "cleanupSuggestions",
  "applyCleanup",
  "addressSpace",
  "utilizationHistory",
  "planPrefixes",
  "listTemplates",
  "saveTemplate",
  "deleteTemplate",
  "vlanMatrix",
  "createFromTemplate",
  "createSiteFromTemplate",
  "siteOverview",
  "siteDetail",
  "compareObserved",
]);

const REDESIGN_READ: ReadonlySet<string> = new Set([
  "dashboard",
  "changeLog",
  "cleanupSuggestions",
  "addressSpace",
  "utilizationHistory",
  "listTemplates",
  "vlanMatrix",
  "siteOverview",
  "siteDetail",
  "compareObserved",
]);

/** True when the action only reads (previews with dryRun count as reading). */
export function redesignIsRead(action: RedesignAction): boolean {
  if (REDESIGN_READ.has(action.type)) return true;
  if (action.type === "planPrefixes" || action.type === "createSiteFromTemplate") return action.dryRun;
  return false;
}

function oneOfOrNull<T extends string>(value: unknown, allowed: readonly T[], label: string): T | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new InputError(`${label} ist ungültig.`);
}

function uuidList(value: unknown, max: number, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max || !value.every(isUuid)) {
    throw new InputError(`${label} ist ungültig (1 bis ${max} Einträge).`);
  }
  return [...new Set((value as string[]).map((id) => id.toLowerCase()))];
}

function parseBulkPatch(value: unknown): BulkPatch {
  if (!isRecord(value)) throw new InputError("Die Änderung fehlt.");
  const patch: BulkPatch = {};
  if (value.status !== undefined) {
    const status = oneOfOrNull(value.status, PREFIX_STATUSES, "Der Status");
    if (!status) throw new InputError("Der Status ist ungültig.");
    patch.status = status;
  }
  if (value.departmentId !== undefined) patch.departmentId = optionalUuid(value.departmentId, "Die Abteilung");
  if (value.securityZone !== undefined) {
    patch.securityZone = optionalText(value.securityZone, 60, "Die Sicherheitszone");
  }
  if (value.siteId !== undefined) patch.siteId = optionalUuid(value.siteId, "Der Standort");
  if (!Object.keys(patch).length) throw new InputError(msg("Bitte wähle mindestens eine Änderung.", msg("Bitte wähle mindestens eine Änderung.", "Bitte wählen Sie mindestens eine Änderung.")));
  return patch;
}

function parsePlanItems(value: unknown): PlanItemInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new InputError(msg("Bitte plane 1 bis 64 Teilnetze.", msg("Bitte plane 1 bis 64 Teilnetze.", "Bitte planen Sie 1 bis 64 Teilnetze.")));
  }
  return value.map((raw, index) => {
    if (!isRecord(raw)) throw new InputError(`Teilnetz ${index + 1} ist ungültig.`);
    const name = optionalText(raw.name, 120, "Der Name");
    if (!name) throw new InputError(msg(`Teilnetz ${index + 1}: Bitte erfasse einen Namen.`, msg(`Teilnetz ${index + 1}: Bitte erfasse einen Namen.`, `Teilnetz ${index + 1}: Bitte erfassen Sie einen Namen.`)));
    const vlan = raw.vlanNumber === undefined || raw.vlanNumber === null || raw.vlanNumber === ""
      ? null
      : integer(raw.vlanNumber, `«${name}»: Die VLAN-ID`, 1, 4094);
    return {
      name,
      length: integer(raw.length, `«${name}»: Die Präfixlänge`, 1, 128),
      vlanNumber: vlan,
      securityZone: optionalText(raw.securityZone, 60, "Die Sicherheitszone"),
    };
  });
}

function parseAssetLocation(value: unknown): AssetLocationChoice {
  if (value === undefined || value === null) return { mode: "none" };
  if (!isRecord(value)) throw new InputError("Die Angabe zum Asset-Standort ist ungültig.");
  if (value.mode === "none") return { mode: "none" };
  if (value.mode === "new") return { mode: "new" };
  if (value.mode === "existing") return { mode: "existing", id: uuid(value.id, "Der Asset-Standort") };
  throw new InputError("Die Angabe zum Asset-Standort ist ungültig.");
}

/** Parses the new actions; null when `type` is none of them. */
export function parseRedesignAction(body: unknown): RedesignAction | null {
  if (!isRecord(body) || typeof body.type !== "string" || !REDESIGN_TYPES.has(body.type)) return null;
  if (!isUuid(body.tenantId)) throw new InputError("Der Mandant ist ungültig.");
  const tenantId = body.tenantId.toLowerCase();
  switch (body.type) {
    case "dashboard":
    case "cleanupSuggestions":
    case "listTemplates":
    case "siteOverview":
      return { type: body.type, tenantId };
    case "changeLog": {
      let since: string | null = null;
      if (body.since !== undefined && body.since !== null && body.since !== "") {
        if (typeof body.since !== "string" || Number.isNaN(Date.parse(body.since))) {
          throw new InputError("Das Datum ist ungültig.");
        }
        since = new Date(body.since).toISOString();
      }
      return {
        type: "changeLog",
        tenantId,
        objectType: oneOfOrNull(body.objectType, OBJECT_TYPES, "Die Objektart"),
        objectId: optionalUuid(body.objectId, "Das Objekt"),
        source: oneOfOrNull(body.source, CHANGE_SOURCES, "Die Herkunft"),
        since,
        before: body.before === undefined || body.before === null
          ? null
          : integer(body.before, "Der Cursor", 1, Number.MAX_SAFE_INTEGER),
        limit: body.limit === undefined || body.limit === null ? 50 : integer(body.limit, "Die Anzahl", 1, 100),
      };
    }
    case "undoChange":
      return {
        type: "undoChange",
        tenantId,
        entryId: integer(body.entryId, "Der Eintrag", 1, Number.MAX_SAFE_INTEGER),
      };
    case "bulkUpdatePrefixes":
      return {
        type: "bulkUpdatePrefixes",
        tenantId,
        prefixIds: uuidList(body.prefixIds, 200, "Die Auswahl der Subnetze"),
        patch: parseBulkPatch(body.patch),
      };
    case "applyCleanup": {
      if (!Array.isArray(body.keys) || body.keys.length === 0 || body.keys.length > 500) {
        throw new InputError(msg("Bitte wähle 1 bis 500 Vorschläge.", msg("Bitte wähle 1 bis 500 Vorschläge.", "Bitte wählen Sie 1 bis 500 Vorschläge.")));
      }
      const keys = body.keys.map((key) => {
        if (typeof key !== "string" || !/^[a-z_]+:[0-9a-f-]{36}$/i.test(key)) {
          throw new InputError("Ein Vorschlag ist ungültig.");
        }
        return key.toLowerCase();
      });
      return { type: "applyCleanup", tenantId, keys: [...new Set(keys)] };
    }
    case "addressSpace":
      return { type: "addressSpace", tenantId, prefixId: uuid(body.prefixId, "Das Subnetz") };
    case "utilizationHistory":
      return {
        type: "utilizationHistory",
        tenantId,
        prefixId: uuid(body.prefixId, "Das Subnetz"),
        days: body.days === undefined || body.days === null ? 90 : integer(body.days, "Der Zeitraum", 1, 365),
      };
    case "planPrefixes":
      return {
        type: "planPrefixes",
        tenantId,
        parentPrefixId: uuid(body.parentPrefixId, "Das Supernetz"),
        items: parsePlanItems(body.items),
        dryRun: body.dryRun !== false,
      };
    case "saveTemplate":
      return { type: "saveTemplate", tenantId, template: parseTemplate(body.template) };
    case "deleteTemplate":
      return { type: "deleteTemplate", tenantId, id: uuid(body.id, "Die Vorlage") };
    case "vlanMatrix":
      return { type: "vlanMatrix", tenantId, templateId: optionalUuid(body.templateId, "Die Vorlage") };
    case "createFromTemplate": {
      const fn = optionalText(body.function, 120, "Die Funktion");
      if (!fn) throw new InputError("Die Funktion fehlt.");
      return {
        type: "createFromTemplate",
        tenantId,
        siteId: uuid(body.siteId, "Der Standort"),
        function: fn,
        templateId: uuid(body.templateId, "Die Vorlage"),
      };
    }
    case "createSiteFromTemplate": {
      const name = optionalText(body.name, 120, "Der Name");
      if (!name) throw new InputError(msg("Bitte erfasse einen Namen für den Standort.", msg("Bitte erfasse einen Namen für den Standort.", "Bitte erfassen Sie einen Namen für den Standort.")));
      const supernet = parsePrefixText(body.supernet);
      if (supernet.version !== 4) throw new InputError("Das Supernetz muss ein IPv4-Netz sein.");
      if (!Array.isArray(body.functions) || body.functions.length > 128) {
        throw new InputError("Die Auswahl der Funktionen ist ungültig.");
      }
      const functions = body.functions.map((fn) => {
        const text = optionalText(fn, 120, "Die Funktion");
        if (!text) throw new InputError("Eine Funktion ist ungültig.");
        return text;
      });
      return {
        type: "createSiteFromTemplate",
        tenantId,
        templateId: uuid(body.templateId, "Die Vorlage"),
        name,
        code: optionalText(body.code, 40, "Das Kürzel"),
        address: optionalText(body.address, 300, "Die Adresse"),
        supernet: formatCidr(supernet),
        vlanBase: integer(body.vlanBase, "Die VLAN-Basis", 1, 4094),
        assetLocation: parseAssetLocation(body.assetLocation),
        functions: [...new Map(functions.map((fn) => [fn.toLowerCase(), fn])).values()],
        dryRun: body.dryRun !== false,
      };
    }
    case "siteDetail":
      return { type: "siteDetail", tenantId, siteId: uuid(body.siteId, "Der Standort") };
    case "compareObserved":
      return { type: "compareObserved", tenantId, siteId: optionalUuid(body.siteId, "Der Standort") };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Address space: free gaps as aligned CIDR blocks

/** Aligned CIDR blocks covering [start, end] (inclusive), largest first possible. */
export function rangeToCidrs(version: 4 | 6, start: bigint, end: bigint, max = Infinity): Cidr[] {
  const bits = addressBits(version);
  const result: Cidr[] = [];
  let cursor = start;
  while (cursor <= end && result.length < max) {
    let zeros = 0;
    while (zeros < bits && ((cursor >> BigInt(zeros)) & 1n) === 0n) zeros++;
    while (zeros > 0 && cursor + (1n << BigInt(zeros)) - 1n > end) zeros--;
    result.push({ version, network: cursor, length: bits - zeros });
    cursor += 1n << BigInt(zeros);
  }
  return result;
}

/** Prefixes strictly inside the parent (equal or outside ones are ignored). */
function strictlyInside(parent: Cidr, cidr: Cidr): boolean {
  return cidrContainsCidr(parent, cidr) && cidr.length > parent.length;
}

/** Free space of the parent outside all occupied prefixes, as aligned blocks. */
export function freeBlocks(parent: Cidr, occupied: Cidr[], max = Infinity): Cidr[] {
  const ranges = occupied
    .filter((cidr) => strictlyInside(parent, cidr))
    .map((cidr) => ({ start: cidr.network, end: cidrLast(cidr) }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const result: Cidr[] = [];
  let cursor = parent.network;
  const last = cidrLast(parent);
  for (const range of ranges) {
    if (range.end < cursor) continue;
    if (range.start > cursor) {
      result.push(...rangeToCidrs(parent.version, cursor, range.start - 1n, max - result.length));
    }
    cursor = range.end + 1n;
    if (result.length >= max) return result.slice(0, max);
  }
  if (cursor <= last) result.push(...rangeToCidrs(parent.version, cursor, last, max - result.length));
  return result.slice(0, max);
}

export type ChildInput<M> = { cidr: Cidr; meta: M };
export type SpaceSegment<M> =
  | { kind: "child"; cidr: Cidr; meta: M | null }
  | { kind: "free"; cidr: Cidr };

/** Direct children of the parent (those not nested in another child). */
export function directChildren<M>(parent: Cidr, children: ChildInput<M>[]): ChildInput<M>[] {
  const inside = children.filter((child) => strictlyInside(parent, child.cidr));
  return inside.filter((child) => !inside.some((other) => other !== child && strictlyInside(other.cidr, child.cidr)))
    .sort((a, b) => (a.cidr.network < b.cidr.network ? -1 : a.cidr.network > b.cidr.network ? 1 : 0));
}

export function addressSpaceLayout<M>(parent: Cidr, children: ChildInput<M>[], maxSegments = 512): {
  segments: SpaceSegment<M>[];
  truncated: boolean;
  capacity: bigint;
  freeTotal: bigint;
  allocatedPercent: number;
  largestFree: number | null;
  childCount: number;
} {
  const direct = directChildren(parent, children);
  // Only count the free blocks up to a sane bound (IPv6 can have many gaps).
  const free = freeBlocks(parent, direct.map((child) => child.cidr), 100_000);
  const capacity = cidrSize(parent);
  const freeTotal = free.reduce((sum, block) => sum + cidrSize(block), 0n);
  const all: SpaceSegment<M>[] = [
    ...direct.map((child) => ({ kind: "child" as const, cidr: child.cidr, meta: child.meta })),
    ...free.map((cidr) => ({ kind: "free" as const, cidr })),
  ].sort((a, b) => (a.cidr.network < b.cidr.network ? -1 : a.cidr.network > b.cidr.network ? 1 : 0));
  const truncated = all.length > maxSegments;
  return {
    segments: truncated ? all.slice(0, maxSegments) : all,
    truncated,
    capacity,
    freeTotal,
    allocatedPercent: utilizationPercent(capacity - freeTotal, capacity),
    largestFree: free.length ? Math.min(...free.map((block) => block.length)) : null,
    childCount: direct.length,
  };
}

// ---------------------------------------------------------------------------
// Planner: smallest fitting gap, aligned, in the given order

export type PlacedItem = { name: string; cidr: Cidr | null; error: string | null };

export function planPlacement(
  parent: Cidr,
  occupied: Cidr[],
  items: { name: string; length: number }[],
): { items: PlacedItem[]; freeAfter: bigint } {
  const bits = addressBits(parent.version);
  let blocks = freeBlocks(parent, occupied);
  const placed: PlacedItem[] = [];
  for (const item of items) {
    if (!Number.isInteger(item.length) || item.length <= parent.length || item.length > bits) {
      placed.push({
        name: item.name,
        cidr: null,
        error: `Ein /${item.length} passt nicht in ${formatCidr(parent)}.`,
      });
      continue;
    }
    let best: Cidr | null = null;
    for (const block of blocks) {
      if (block.length > item.length) continue;
      if (!best || block.length > best.length) best = block;
    }
    if (!best) {
      placed.push({ name: item.name, cidr: null, error: `Kein freier Bereich für ein /${item.length}.` });
      continue;
    }
    const cidr: Cidr = { version: parent.version, network: best.network, length: item.length };
    const rest = rangeToCidrs(parent.version, cidrLast(cidr) + 1n, cidrLast(best));
    blocks = [...blocks.filter((block) => block !== best), ...rest]
      .sort((a, b) => (a.network < b.network ? -1 : a.network > b.network ? 1 : 0));
    placed.push({ name: item.name, cidr, error: null });
  }
  return { items: placed, freeAfter: blocks.reduce((sum, block) => sum + cidrSize(block), 0n) };
}

// ---------------------------------------------------------------------------
// Forecast (contract shape)

export type ForecastSummary = {
  trend: "rising" | "stable" | "falling" | "unknown";
  daysToWarning: number | null;
  daysToFull: number | null;
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Converts the regression result (logic.forecastUtilization) to the contract shape. */
export function forecastSummary(
  forecast: { warningOn: string | null; fullOn: string | null; perDay: number | null } | null | undefined,
  today: string,
): ForecastSummary {
  if (!forecast) return { trend: "unknown", daysToWarning: null, daysToFull: null };
  const trend = forecast.perDay === null
    ? "unknown"
    : forecast.perDay > 0.05
    ? "rising"
    : forecast.perDay < -0.05
    ? "falling"
    : "stable";
  const days = (day: string | null) => (day ? Math.max(0, daysBetween(today, day)) : null);
  return { trend, daysToWarning: days(forecast.warningOn), daysToFull: days(forecast.fullOn) };
}

// ---------------------------------------------------------------------------
// Agents

export type AgentState = "online" | "late" | "offline" | "disabled";
const AGENT_RANK: Record<AgentState, number> = { online: 3, late: 2, offline: 1, disabled: 0 };

export function agentState(status: string, lastSeenAt: string | null, now = Date.now()): AgentState {
  if (status !== "active") return "disabled";
  const seen = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
  if (Number.isNaN(seen)) return "offline";
  const age = now - seen;
  if (age < 30 * 60_000) return "online";
  if (age < 24 * 3_600_000) return "late";
  return "offline";
}

export function betterAgentState(a: AgentState | null, b: AgentState): AgentState {
  return a === null || AGENT_RANK[b] > AGENT_RANK[a] ? b : a;
}

// ---------------------------------------------------------------------------
// Names (VLAN functions)

/** Lowercase, without site prefix («BAAR_») and separators. */
export function normalizeFunctionName(
  name: string,
  site: { name?: string | null; code?: string | null } | null = null,
): string {
  let text = name.trim().toLowerCase();
  const prefixes = [
    site?.code,
    site?.name,
    site?.name?.replace(/\s+/g, ""),
    site?.name?.split(/\s+/)[0],
  ].filter((value): value is string => !!value && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());
  for (const prefix of prefixes) {
    for (const separator of ["_", "-", " "]) {
      if (text.startsWith(prefix + separator) && text.length > prefix.length + 1) {
        text = text.slice(prefix.length + 1);
        return text.replace(/[\s_\-.]+/g, "");
      }
    }
  }
  return text.replace(/[\s_\-.]+/g, "");
}

/** «OLD»/«ALT» as a separate word (underscore and dash separate words). */
export function hasOldMarker(text: string | null | undefined): boolean {
  if (!text) return false;
  return /(^|[^a-z0-9äöüé])(old|alt)($|[^a-z0-9äöüé])/i.test(text);
}

// ---------------------------------------------------------------------------
// Cleanup assistant

export type CleanupPrefix = {
  id: string;
  prefix: string;
  vrfId: string | null;
  status: string;
  description: string | null;
  notes: string | null;
  gateway: string | null;
  dhcpStart: string | null;
  dhcpEnd: string | null;
  /** Documented addresses (without deprecated). */
  used: number;
};

export type CleanupVlan = {
  id: string;
  vlanNumber: number;
  name: string;
  siteId: string | null;
  siteName: string | null;
  siteCode: string | null;
  status: string;
  description: string | null;
  notes: string | null;
};

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

/** Suggestion plus the column values that fix it (null = hint only). */
export type CleanupPlan = { suggestion: CleanupSuggestion; patch: Record<string, unknown> | null };

const NOTE_MARKER = /(-->|->|=>)/;

/** Splits «Text --> Hinweis» into description and note; null when no marker. */
export function splitNoteFromText(text: string | null): { description: string | null; note: string } | null {
  if (!text) return null;
  const trimmed = text.trim();
  const match = NOTE_MARKER.exec(trimmed);
  if (!match) return null;
  if (match.index === 0) {
    const note = trimmed.slice(match[0].length).trim();
    return { description: null, note: note || trimmed };
  }
  const before = trimmed.slice(0, match.index);
  // Only a separated marker counts («A -> B», «A-->B»), not «x->y» in a word.
  if (match[0] !== "-->" && !/\s$/.test(before)) return null;
  const note = trimmed.slice(match.index + match[0].length).trim();
  if (!note) return null;
  return { description: before.trim() || null, note };
}

function mergeNotes(existing: string | null, note: string): string {
  const merged = existing && existing.trim() ? `${existing.trim()}\n${note}` : note;
  return merged.slice(0, 4000);
}

function quote(text: string, max = 80): string {
  const short = text.length > max ? `${text.slice(0, max - 1)}…` : text;
  return `«${short}»`;
}

export function cleanupPlans(prefixes: CleanupPrefix[], vlans: CleanupVlan[]): CleanupPlan[] {
  const plans: CleanupPlan[] = [];
  const parsed = prefixes.map((row) => ({ row, cidr: parseCidrInput(row.prefix)?.cidr ?? null }));
  const add = (
    kind: CleanupKind,
    objectType: ObjectType,
    objectId: string,
    texts: { title: string; detail: string; fix: string },
    patch: Record<string, unknown> | null,
    defaultOn = patch !== null,
  ) => {
    plans.push({
      suggestion: { key: `${kind}:${objectId}`, kind, objectType, objectId, defaultOn, ...texts },
      patch,
    });
  };
  const childrenOf = (entry: { row: CleanupPrefix; cidr: Cidr | null }) =>
    entry.cidr
      ? parsed.filter((other) =>
        other.row.id !== entry.row.id && other.cidr && other.row.vrfId === entry.row.vrfId &&
        strictlyInside(entry.cidr!, other.cidr)
      )
      : [];

  for (const entry of parsed) {
    const { row, cidr } = entry;
    const label = row.prefix;
    const old = hasOldMarker(row.description) && row.status !== "deprecated";
    if (old) {
      add("old_summary", "prefix", row.id, {
        title: `${label} als veraltet markieren`,
        detail: `Die Beschreibung ${quote(row.description ?? "")} weist auf ein altes Netz hin.`,
        fix: "Status auf «Veraltet» setzen",
      }, { status: "deprecated" });
    }
    const children = childrenOf(entry);
    if (!old && row.status === "active" && children.some((child) => child.row.status === "active")) {
      add("active_with_children", "prefix", row.id, {
        title: `${label} enthält aktive Teilnetze`,
        detail: `${label} ist aktiv, enthält aber ${children.length} Teilnetz(e).`,
        fix: "Status auf «Container» setzen",
      }, { status: "container" });
    }
    const split = splitNoteFromText(row.description);
    if (split) {
      add("note_in_name", "prefix", row.id, {
        title: `Hinweis in der Beschreibung von ${label}`,
        detail: `${quote(row.description ?? "")} enthält einen Hinweis.`,
        fix: split.description
          ? `Hinweis in die Notiz verschieben, Beschreibung ${quote(split.description, 40)}`
          : "Text in die Notiz verschieben und Beschreibung leeren",
      }, { description: split.description, notes: mergeNotes(row.notes, split.note) });
    }
    if (cidr && row.gateway) {
      const gateway = parseAddress(row.gateway);
      const usable = usableRange(cidr);
      if (
        !gateway || !cidrContainsAddress(cidr, gateway) || gateway.value < usable.first || gateway.value > usable.last
      ) {
        add("gateway_outside", "prefix", row.id, {
          title: `Gateway von ${label} ungültig`,
          detail: `Das Gateway ${row.gateway} liegt ausserhalb der nutzbaren Adressen von ${label}.`,
          fix: "Gateway leeren",
        }, { gateway: null });
      }
    }
    if (cidr && (row.dhcpStart || row.dhcpEnd)) {
      const start = row.dhcpStart ? parseAddress(row.dhcpStart) : null;
      const end = row.dhcpEnd ? parseAddress(row.dhcpEnd) : null;
      const usable = usableRange(cidr);
      const inside = (address: IpAddress | null) =>
        !!address && cidrContainsAddress(cidr, address) && address.value >= usable.first &&
        address.value <= usable.last;
      if (!inside(start) || !inside(end) || start!.value > end!.value) {
        add("dhcp_outside", "prefix", row.id, {
          title: `DHCP-Bereich von ${label} ungültig`,
          detail: `Der DHCP-Bereich ${row.dhcpStart ?? "?"} – ${
            row.dhcpEnd ?? "?"
          } liegt nicht in den nutzbaren Adressen von ${label}.`,
          fix: "DHCP-Bereich leeren",
        }, { dhcp_start: null, dhcp_end: null });
      }
    }
    if (row.status === "container" && !children.length && row.used === 0) {
      add("empty_container", "prefix", row.id, {
        title: `${label} ist leer`,
        detail: `Der Container ${label} enthält weder Teilnetze noch Adressen.`,
        fix: "Prüfen, ob der Container noch gebraucht wird",
      }, null);
    }
  }

  for (const vlan of vlans) {
    const split = splitNoteFromText(vlan.description);
    if (split) {
      add("note_in_name", "vlan", vlan.id, {
        title: `Hinweis in der Beschreibung von VLAN ${vlan.vlanNumber}`,
        detail: `${quote(vlan.description ?? "")} enthält einen Hinweis.`,
        fix: "Hinweis in die Notiz verschieben",
      }, { description: split.description, notes: mergeNotes(vlan.notes, split.note) });
    }
  }

  // Same VLAN ID at several sites.
  const groups = new Map<number, CleanupVlan[]>();
  for (const vlan of vlans) {
    if (vlan.status === "deprecated") continue;
    groups.set(vlan.vlanNumber, [...(groups.get(vlan.vlanNumber) ?? []), vlan]);
  }
  for (const [number, group] of [...groups].sort((a, b) => a[0] - b[0])) {
    const sites = new Set(group.map((vlan) => vlan.siteId ?? ""));
    if (sites.size < 2) continue;
    const old = group.filter((vlan) => hasOldMarker(vlan.name));
    const where = (vlan: CleanupVlan) => `${vlan.name}${vlan.siteName ? ` (${vlan.siteName})` : ""}`;
    if (old.length && old.length < group.length) {
      for (const vlan of old) {
        add("duplicate_vlan", "vlan", vlan.id, {
          title: `VLAN ${number} doppelt`,
          detail: `${group.map(where).join(" und ")} haben dieselbe ID.`,
          fix: `${vlan.name} als veraltet markieren`,
        }, { status: "deprecated" });
      }
      continue;
    }
    const names = new Set(
      group.map((vlan) => normalizeFunctionName(vlan.name, { name: vlan.siteName, code: vlan.siteCode })),
    );
    if (names.size > 1) {
      const first = [...group].sort((a, b) => a.id.localeCompare(b.id))[0]!;
      add("duplicate_vlan", "vlan", first.id, {
        title: `VLAN ${number} mit verschiedenen Namen`,
        detail: `${group.map(where).join(", ")} verwenden dieselbe ID für Verschiedenes.`,
        fix: "Nur Hinweis – bitte prüfen",
      }, null);
    }
  }
  return plans;
}

// ---------------------------------------------------------------------------
// VLAN matrix

export type MatrixSite = {
  id: string;
  name: string;
  code: string | null;
  vlanBase: number | null;
  supernet: string | null;
};
export type MatrixVlan = { id: string; siteId: string | null; vlanNumber: number; name: string; zone: string | null };
export type MatrixPrefix = { id: string; prefix: string; vlanId: string | null; percent: number | null };

export type MatrixCell = {
  siteId: string;
  state: "ok" | "diff" | "missing" | "na";
  vlanId?: string;
  vlanNumber?: number;
  vlanName?: string;
  prefixId?: string;
  prefix?: string;
  percent?: number;
  note?: string;
  suggestion?: { vlanNumber: number; prefix: string };
};

export type MatrixRow = { function: string; zone: string | null; cells: MatrixCell[] };

function vlanPrefixes(vlan: MatrixVlan, prefixes: MatrixPrefix[]): { row: MatrixPrefix; cidr: Cidr }[] {
  return prefixes
    .filter((prefix) => prefix.vlanId === vlan.id)
    .map((row) => ({ row, cidr: parseCidrInput(row.prefix)?.cidr ?? null }))
    .filter((entry): entry is { row: MatrixPrefix; cidr: Cidr } => entry.cidr !== null)
    .sort((a, b) => (a.cidr.version - b.cidr.version) || (a.cidr.network < b.cidr.network ? -1 : 1));
}

function cellFor(siteId: string, vlan: MatrixVlan, prefix: MatrixPrefix | null): MatrixCell {
  const cell: MatrixCell = { siteId, state: "ok", vlanId: vlan.id, vlanNumber: vlan.vlanNumber, vlanName: vlan.name };
  if (prefix) {
    cell.prefixId = prefix.id;
    cell.prefix = prefix.prefix;
    if (prefix.percent !== null) cell.percent = prefix.percent;
  }
  return cell;
}

export function vlanMatrix(
  template: Template | null,
  sites: MatrixSite[],
  vlans: MatrixVlan[],
  prefixes: MatrixPrefix[],
): {
  rows: MatrixRow[];
  otherVlans: { siteId: string; vlanId: string; vlanNumber: number; name: string; prefix: string | null }[];
} {
  const used = new Set<string>();
  const bySite = new Map<string, MatrixVlan[]>();
  for (const vlan of vlans) {
    if (!vlan.siteId) continue;
    bySite.set(vlan.siteId, [...(bySite.get(vlan.siteId) ?? []), vlan]);
  }
  const rows: MatrixRow[] = (template?.entries ?? []).map((entry) => {
    const wanted = normalizeFunctionName(entry.function);
    const cells = sites.map((site): MatrixCell => {
      const siteVlans = bySite.get(site.id) ?? [];
      if (!siteVlans.length) return { siteId: site.id, state: "na" };
      const supernet = site.supernet ? parseCidrInput(site.supernet)?.cidr ?? null : null;
      const nameMatches = (vlan: MatrixVlan) => normalizeFunctionName(vlan.name, site) === wanted;
      if (site.vlanBase !== null && supernet && supernet.version === 4) {
        const expectedNumber = site.vlanBase + entry.vlanOffset;
        const expected = templateEntryCidr(entry, supernet);
        const vlan = siteVlans.find((candidate) => candidate.vlanNumber === expectedNumber && !used.has(candidate.id));
        if (!vlan) {
          const cell: MatrixCell = { siteId: site.id, state: "missing" };
          if (expected && expectedNumber <= 4094) {
            cell.suggestion = { vlanNumber: expectedNumber, prefix: formatCidr(expected) };
          }
          return cell;
        }
        used.add(vlan.id);
        const own = vlanPrefixes(vlan, prefixes);
        const exact = expected
          ? own.find((candidate) =>
            candidate.cidr.network === expected.network && candidate.cidr.length === expected.length
          )
          : undefined;
        const shown = exact ?? own[0] ?? null;
        const cell = cellFor(site.id, vlan, shown?.row ?? null);
        const notes: string[] = [];
        if (!nameMatches(vlan)) notes.push(`Name ${vlan.name}`);
        if (expected && !exact) {
          const sameStart = own.find((candidate) => candidate.cidr.network === expected.network);
          if (sameStart) notes.push(`/${sameStart.cidr.length} statt /${expected.length}`);
          else if (shown) notes.push(`${formatCidr(shown.cidr)} statt ${formatCidr(expected)}`);
          else notes.push(`kein Subnetz (erwartet ${formatCidr(expected)})`);
        }
        if (notes.length) {
          cell.state = "diff";
          cell.note = notes.join(" · ");
        }
        return cell;
      }
      const vlan = siteVlans.find((candidate) => nameMatches(candidate) && !used.has(candidate.id));
      if (!vlan) return { siteId: site.id, state: "missing" };
      used.add(vlan.id);
      return cellFor(site.id, vlan, vlanPrefixes(vlan, prefixes)[0]?.row ?? null);
    });
    return { function: entry.function, zone: entry.zone, cells };
  });
  const siteIds = new Set(sites.map((site) => site.id));
  const otherVlans = vlans
    .filter((vlan) => vlan.siteId && siteIds.has(vlan.siteId) && !used.has(vlan.id))
    .sort((a, b) => a.vlanNumber - b.vlanNumber)
    .map((vlan) => ({
      siteId: vlan.siteId!,
      vlanId: vlan.id,
      vlanNumber: vlan.vlanNumber,
      name: vlan.name,
      prefix: vlanPrefixes(vlan, prefixes)[0]?.row.prefix ?? null,
    }));
  return { rows, otherVlans };
}

// ---------------------------------------------------------------------------
// Template suggestion from the best documented site

export type SuggestSite = MatrixSite;
export type SuggestPrefix = {
  id: string;
  prefix: string;
  vlanId: string | null;
  securityZone: string | null;
  dhcp: boolean;
};

export function suggestTemplate(
  sites: SuggestSite[],
  vlans: MatrixVlan[],
  prefixes: SuggestPrefix[],
): Template | null {
  const ranked = sites
    .map((site) => ({ site, vlans: vlans.filter((vlan) => vlan.siteId === site.id) }))
    .filter((entry) => entry.vlans.length >= 2)
    .sort((a, b) => {
      const layoutA = a.site.vlanBase !== null && a.site.supernet ? 1 : 0;
      const layoutB = b.site.vlanBase !== null && b.site.supernet ? 1 : 0;
      return layoutB - layoutA || b.vlans.length - a.vlans.length || a.site.name.localeCompare(b.site.name);
    });
  const best = ranked[0];
  if (!best) return null;
  const { site } = best;
  const withPrefix = best.vlans
    .map((vlan) => {
      const prefix = prefixes
        .filter((row) => row.vlanId === vlan.id)
        .map((row) => ({ row, cidr: parseCidrInput(row.prefix)?.cidr ?? null }))
        .find((entry) => entry.cidr?.version === 4);
      return prefix && prefix.cidr ? { vlan, prefix: prefix.row, cidr: prefix.cidr } : null;
    })
    .filter((entry): entry is { vlan: MatrixVlan; prefix: SuggestPrefix; cidr: Cidr } => entry !== null)
    .sort((a, b) => a.vlan.vlanNumber - b.vlan.vlanNumber);
  if (!withPrefix.length) return null;
  const supernet = site.supernet ? parseCidrInput(site.supernet)?.cidr ?? null : null;
  const exact = site.vlanBase !== null && supernet !== null && supernet.version === 4;
  const base = exact ? site.vlanBase! : Math.min(...withPrefix.map((entry) => entry.vlan.vlanNumber));
  const start = exact ? supernet!.network : withPrefix.reduce(
    (min, entry) => (entry.cidr.network < min ? entry.cidr.network : min),
    withPrefix[0]!.cidr.network,
  ) &
    ~255n;
  const entries: TemplateEntry[] = [];
  const seen = new Set<string>();
  for (const { vlan, prefix, cidr } of withPrefix) {
    const offset = cidr.network - start;
    const fn = vlan.name.replace(
      new RegExp(
        `^(${
          [site.code, site.name].filter(Boolean).map((text) => text!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
        })[_\\- ]`,
        "i",
      ),
      "",
    ).trim() || vlan.name;
    // Templates place subnets in whole /24 steps.
    if (offset < 0n || offset % 256n !== 0n || offset % cidrSize(cidr) !== 0n) {
      continue;
    }
    if (vlan.vlanNumber - base < 0 || seen.has(fn.toLowerCase())) continue;
    if (exact && !cidrContainsCidr(supernet!, cidr)) continue;
    seen.add(fn.toLowerCase());
    entries.push({
      function: fn,
      description: null,
      vlanOffset: vlan.vlanNumber - base,
      offset24: Number(offset / 256n),
      length: cidr.length,
      zone: vlan.zone ?? prefix.securityZone,
      dhcp: prefix.dhcp,
    });
  }
  if (!entries.length) return null;
  let prefixLength: number;
  if (exact) {
    prefixLength = supernet!.length;
  } else {
    const end = entries.reduce((max, entry) => {
      const last = BigInt(entry.offset24) * 256n + (1n << BigInt(32 - entry.length));
      return last > max ? last : max;
    }, 0n);
    let bitsNeeded = 0;
    while ((1n << BigInt(bitsNeeded)) < end) bitsNeeded++;
    prefixLength = Math.max(8, Math.min(30, 32 - bitsNeeded));
  }
  // Drop duplicate vlan offsets and keep entries that fit (same rules as parseTemplate).
  const offsets = new Set<number>();
  const fitting = entries.filter((entry) => {
    if (offsets.has(entry.vlanOffset) || entry.length < prefixLength) return false;
    offsets.add(entry.vlanOffset);
    return BigInt(entry.offset24) * 256n + (1n << BigInt(32 - entry.length)) <= 1n << BigInt(32 - prefixLength);
  });
  return {
    name: `Vorlage aus ${site.name}`.slice(0, 120),
    description: exact
      ? `Abgeleitet aus ${site.name} (VLAN-Basis ${base}, Supernetz ${formatCidr(supernet!)}).`
      : `Abgeleitet aus ${site.name} (kleinste VLAN-ID ${base}).`,
    prefixLength,
    entries: fitting,
  };
}

// ---------------------------------------------------------------------------
// Target/actual comparison

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

/** Counts documented vs. seen addresses per leaf prefix (same VRF). */
export function compareObservedRows(
  prefixes: { id: string; prefix: string; name: string | null; vrfId: string | null }[],
  documented: { address: string; vrfId: string | null }[],
  seen: { address: string; vrfId: string | null }[],
): CompareRow[] {
  const parsed = prefixes
    .map((row) => ({ row, cidr: parseCidrInput(row.prefix)?.cidr ?? null }))
    .filter((entry): entry is { row: typeof prefixes[number]; cidr: Cidr } => entry.cidr !== null)
    .sort((a, b) => b.cidr.length - a.cidr.length);
  const sets = new Map<string, { documented: Set<string>; seen: Set<string> }>();
  const place = (item: { address: string; vrfId: string | null }, kind: "documented" | "seen") => {
    const address = parseAddress(item.address.split("/")[0] ?? "");
    if (!address) return;
    const hit = parsed.find((entry) => entry.row.vrfId === item.vrfId && cidrContainsAddress(entry.cidr, address));
    if (!hit) return;
    const bucket = sets.get(hit.row.id) ?? { documented: new Set(), seen: new Set() };
    bucket[kind].add(formatAddress(address));
    sets.set(hit.row.id, bucket);
  };
  for (const item of documented) place(item, "documented");
  for (const item of seen) place(item, "seen");
  const rows: CompareRow[] = [];
  for (const { row, cidr } of parsed) {
    const bucket = sets.get(row.id);
    if (!bucket) continue;
    let matched = 0;
    for (const address of bucket.documented) if (bucket.seen.has(address)) matched++;
    const union = bucket.documented.size + bucket.seen.size - matched;
    rows.push({
      prefixId: row.id,
      prefix: formatCidr(cidr),
      name: row.name,
      documented: bucket.documented.size,
      seen: bucket.seen.size,
      matched,
      onlySeen: bucket.seen.size - matched,
      onlyDocumented: bucket.documented.size - matched,
      matchPercent: union ? Math.round((matched / union) * 1000) / 10 : null,
    });
  }
  return rows.sort((a, b) => {
    const left = parseCidrInput(a.prefix)!.cidr;
    const right = parseCidrInput(b.prefix)!.cidr;
    return left.network < right.network ? -1 : left.network > right.network ? 1 : left.length - right.length;
  });
}

// ---------------------------------------------------------------------------
// Change log

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
  changes: { field: string; label: string; before: string | null; after: string | null }[];
  undoable: boolean;
};

const COMMON_LABELS: Record<string, string> = {
  status: "Status",
  description: "Beschreibung",
  notes: "Notiz",
  department_id: "Abteilung",
  site_id: "Standort",
  vlan_id: "VLAN",
  vrf_id: "VRF",
  tags: "Schlagwörter",
  custom_fields: "Eigene Felder",
  name: "Name",
};

export const FIELD_LABELS: Record<ObjectType, Record<string, string>> = {
  prefix: {
    prefix: "Subnetz",
    security_zone: "Sicherheitszone",
    gateway: "Gateway",
    gateway_device: "Gateway-Gerät",
    dhcp_helper: "DHCP-Helper",
    dhcp_start: "DHCP-Beginn",
    dhcp_end: "DHCP-Ende",
    utilization_warning_percent: "Warnschwelle",
  },
  vlan: { vlan_number: "VLAN-ID", zone: "Zone" },
  site: {
    code: "Kürzel",
    address: "Adresse",
    asset_location_id: "Asset-Standort",
    vlan_base: "VLAN-Basis",
    supernet_prefix_id: "Supernetz",
    template_id: "Vorlage",
  },
  address: {
    address: "Adresse",
    hostname: "Hostname",
    dns_name: "DNS-Name",
    mac_address: "MAC-Adresse",
    vendor: "Hersteller",
    device_type: "Gerätetyp",
    switch_name: "Switch",
    switch_port: "Switch-Port",
    owner_user_id: "Verantwortlich",
    team_id: "Team",
    asset_id: "Asset",
    service_id: "Dienst",
    intune_device_id: "Intune-Gerät",
    prtg_device_id: "PRTG-Gerät",
    reserved_until: "Reserviert bis",
  },
  template: { prefix_length: "Supernetz-Länge", entries: "Einträge" },
};

const STATUS_LABELS: Record<ObjectType, Record<string, string>> = {
  prefix: { container: "Container", active: "Aktiv", reserved: "Reserviert", deprecated: "Veraltet" },
  vlan: { active: "Aktiv", deprecated: "Veraltet" },
  site: {},
  address: { active: "Aktiv", reserved: "Reserviert", dhcp: "DHCP", deprecated: "Freigegeben" },
  template: {},
};

export function fieldLabel(objectType: ObjectType, field: string): string {
  return FIELD_LABELS[objectType]?.[field] ?? COMMON_LABELS[field] ?? field;
}

/** Value as text for the change log (resolver maps ids to names). */
export function formatChangeValue(
  objectType: ObjectType,
  field: string,
  value: unknown,
  resolve: (field: string, id: string) => string | null = () => null,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (field === "status" && typeof value === "string") return STATUS_LABELS[objectType]?.[value] ?? value;
  if (typeof value === "string" && field.endsWith("_id") && isUuid(value)) return resolve(field, value) ?? value;
  if (field === "entries" && Array.isArray(value)) return `${value.length} Einträge`;
  if (Array.isArray(value)) return value.length ? value.map(String).join(", ") : null;
  if (typeof value === "object") {
    const keys = Object.keys(value as Json);
    return keys.length ? JSON.stringify(value).slice(0, 300) : null;
  }
  if (typeof value === "boolean") return value ? "Ja" : "Nein";
  if (field === "utilization_warning_percent") return `${value} %`;
  // Postgres host addresses arrive as «10.0.0.1/32»; show them without /32.
  if (typeof value === "string" && /\/(32|128)$/.test(value) && (field === "gateway" || field.startsWith("dhcp_"))) {
    return value.replace(/\/(32|128)$/, "");
  }
  return String(value).slice(0, 300);
}

function short(value: string | null): string {
  if (value === null) return "–";
  return value.length > 60 ? `${value.slice(0, 59)}…` : value;
}

export function changeLogEntry(
  row: Json,
  options: { actorName: string | null; canManage: boolean; resolve?: (field: string, id: string) => string | null },
): ChangeLogEntry {
  const objectType = String(row.object_type) as ObjectType;
  const action = String(row.action) as ChangeLogEntry["action"];
  const fields = Array.isArray(row.changes) ? row.changes.map(String) : [];
  const before = isRecord(row.before) ? row.before : {};
  const after = isRecord(row.after) ? row.after : {};
  const changes = fields.map((field) => ({
    field,
    label: fieldLabel(objectType, field),
    before: formatChangeValue(objectType, field, before[field], options.resolve),
    after: formatChangeValue(objectType, field, after[field], options.resolve),
  }));
  let summary: string;
  if (action === "create") summary = "Angelegt";
  else if (action === "delete") summary = "Gelöscht";
  else {
    const parts = changes.slice(0, 3).map((change) =>
      `${change.label}: ${short(change.before)} → ${short(change.after)}`
    );
    if (changes.length > 3) parts.push(`+${changes.length - 3} weitere`);
    summary = parts.join(" · ") || "Geändert";
  }
  return {
    id: Number(row.id),
    at: String(row.at),
    actorName: options.actorName,
    source: String(row.source) as ChangeSource,
    objectType,
    objectId: String(row.object_id),
    objectLabel: String(row.object_label ?? ""),
    action,
    summary,
    changes,
    undoable: options.canManage && action === "update" && row.is_latest === true && fields.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Small helpers for the handlers

/** Capacity as bigint from a prefix text (0 for invalid). */
export function prefixSize(prefix: string): bigint {
  const cidr = parseCidrInput(prefix)?.cidr;
  return cidr ? cidrSize(cidr) : 0n;
}

export function hostsText(cidr: Cidr): string {
  return cidrCapacity(cidr).toString();
}

/** «/19» for a prefix length, null for null. */
export function lengthText(length: number | null): string | null {
  return length === null ? null : `/${length}`;
}
