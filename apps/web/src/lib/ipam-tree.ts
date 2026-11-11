// Netzbaum der Ansicht «Netze»: Hierarchie oder nach Standort, Filter und
// Hinweise (reine Logik).

import { compareCidrText } from "./ipam-cidr";
import type {
  IpamPrefix,
  IpamSite,
  IpamVlan,
  IpamVrf,
  PrefixStatus,
} from "./ipam-model";

export type TreeGrouping = "tree" | "site";

export type TreeFilter = {
  showDeprecated: boolean;
  /** Site id, "none" for prefixes without site, or null for all. */
  siteId: string | null;
  zone: string | null;
  status: PrefixStatus | null;
  /** Free text: prefix, description, VLAN number or name. */
  text?: string;
};

export const EMPTY_TREE_FILTER: TreeFilter = {
  showDeprecated: false,
  siteId: null,
  zone: null,
  status: null,
  text: "",
};

export type TreeRow =
  | { kind: "header"; key: string; label: string }
  | {
      kind: "node";
      key: string;
      prefix: IpamPrefix;
      depth: number;
      vlan: IpamVlan | null;
      /** Active prefix with active children: should become a container. */
      warn: boolean;
      /** Shown only because a descendant matches the filter. */
      context: boolean;
    };

export type TreeResult = {
  rows: TreeRow[];
  /** Deprecated prefixes hidden by «Veraltete zeigen». */
  hiddenDeprecated: number;
  /** Prefixes matching the filter (without context rows). */
  matchCount: number;
};

/** Ids of prefixes that are active and contain active children. */
export function activeWithChildren(prefixes: IpamPrefix[]): Set<string> {
  const result = new Set<string>();
  const byId = new Map(prefixes.map((prefix) => [prefix.id, prefix]));
  for (const prefix of prefixes) {
    if (!prefix.parentId || prefix.status !== "active") continue;
    const parent = byId.get(prefix.parentId);
    if (parent?.status === "active") result.add(parent.id);
  }
  return result;
}

/** Distinct security zones (for the zone filter), sorted. */
export function zoneOptions(prefixes: IpamPrefix[]): string[] {
  return [
    ...new Set(
      prefixes
        .map((prefix) => prefix.securityZone?.trim())
        .filter((zone): zone is string => Boolean(zone)),
    ),
  ].sort((a, b) => a.localeCompare(b, "de-CH"));
}

function matches(
  prefix: IpamPrefix,
  filter: TreeFilter,
  vlan: IpamVlan | null = null,
): boolean {
  if (!filter.showDeprecated && prefix.status === "deprecated") return false;
  const text = filter.text?.trim().toLowerCase();
  if (text) {
    const haystack = [
      prefix.prefix,
      prefix.description,
      prefix.securityZone,
      vlan ? `vlan ${vlan.vlanNumber}` : null,
      vlan ? String(vlan.vlanNumber) : null,
      vlan?.name,
    ];
    if (!haystack.some((value) => value?.toLowerCase().includes(text)))
      return false;
  }
  if (filter.siteId === "none" && prefix.siteId) return false;
  if (
    filter.siteId &&
    filter.siteId !== "none" &&
    prefix.siteId !== filter.siteId
  )
    return false;
  if (
    filter.zone &&
    (prefix.securityZone ?? "").toLowerCase() !== filter.zone.toLowerCase()
  )
    return false;
  if (filter.status && prefix.status !== filter.status) return false;
  return true;
}

function filterActive(filter: TreeFilter): boolean {
  return Boolean(
    filter.siteId || filter.zone || filter.status || filter.text?.trim(),
  );
}

/**
 * Rows for the tree. `prefixes` must be in overview order (each prefix
 * follows its parent, with parentId/depth).
 *
 * - tree: VRF headers (only when VRFs exist), nodes indented by the number
 *   of visible ancestors. With a site/zone/status filter, ancestors of a
 *   match stay as dimmed context rows so the tree remains readable.
 * - site: one header per site (alphabetical, «Ohne Standort» last) with the
 *   leaf prefixes of that site; a site without leaves shows its prefixes.
 */
export function buildTree(
  prefixes: IpamPrefix[],
  vlans: IpamVlan[],
  sites: IpamSite[],
  vrfs: IpamVrf[],
  grouping: TreeGrouping,
  filter: TreeFilter,
): TreeResult {
  const vlanById = new Map(vlans.map((vlan) => [vlan.id, vlan]));
  const byId = new Map(prefixes.map((prefix) => [prefix.id, prefix]));
  const warn = activeWithChildren(prefixes);
  const hiddenDeprecated = filter.showDeprecated
    ? 0
    : prefixes.filter((prefix) => prefix.status === "deprecated").length;
  const matching = new Set(
    prefixes
      .filter((prefix) =>
        matches(
          prefix,
          filter,
          prefix.vlanId ? (vlanById.get(prefix.vlanId) ?? null) : null,
        ),
      )
      .map((prefix) => prefix.id),
  );
  const node = (
    prefix: IpamPrefix,
    depth: number,
    context: boolean,
  ): TreeRow => ({
    kind: "node",
    key: prefix.id,
    prefix,
    depth,
    vlan: prefix.vlanId ? (vlanById.get(prefix.vlanId) ?? null) : null,
    warn: warn.has(prefix.id),
    context,
  });

  if (grouping === "site") {
    const hasVisibleChild = new Set<string>();
    for (const prefix of prefixes) {
      if (prefix.parentId && matching.has(prefix.id))
        hasVisibleChild.add(prefix.parentId);
    }
    const groups = [
      ...[...sites].sort((a, b) => a.name.localeCompare(b.name, "de-CH")),
      { id: "", name: "Ohne Standort" } as Pick<IpamSite, "id" | "name">,
    ];
    const rows: TreeRow[] = [];
    for (const site of groups) {
      const own = prefixes.filter(
        (prefix) =>
          matching.has(prefix.id) && (prefix.siteId ?? "") === site.id,
      );
      if (!own.length) continue;
      const leaves = own.filter((prefix) => !hasVisibleChild.has(prefix.id));
      const shown = (leaves.length ? leaves : own)
        .slice()
        .sort((a, b) => compareCidrText(a.prefix, b.prefix));
      rows.push({
        kind: "header",
        key: `site-${site.id || "none"}`,
        label: site.name,
      });
      shown.forEach((prefix) => rows.push(node(prefix, 0, false)));
    }
    return { rows, hiddenDeprecated, matchCount: matching.size };
  }

  // Hierarchy: include ancestors of matches as context when filtering.
  const included = new Set(matching);
  if (filterActive(filter)) {
    for (const id of matching) {
      let parentId = byId.get(id)?.parentId ?? null;
      while (parentId) {
        const parent = byId.get(parentId);
        if (!parent) break;
        if (!filter.showDeprecated && parent.status === "deprecated") break;
        included.add(parentId);
        parentId = parent.parentId ?? null;
      }
    }
  }
  const depthOf = (prefix: IpamPrefix): number => {
    let depth = 0;
    let parentId = prefix.parentId ?? null;
    while (parentId) {
      if (included.has(parentId)) depth++;
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return depth;
  };
  const rows: TreeRow[] = [];
  const groups: { id: string | null; name: string }[] = [
    { id: null, name: "Global" },
    ...vrfs.map((vrf) => ({ id: vrf.id, name: vrf.name })),
  ];
  for (const group of groups) {
    const own = prefixes.filter(
      (prefix) => included.has(prefix.id) && prefix.vrfId === group.id,
    );
    if (!own.length) continue;
    if (vrfs.length) {
      rows.push({
        kind: "header",
        key: `vrf-${group.id ?? "global"}`,
        label: `VRF · ${group.name}`,
      });
    }
    own.forEach((prefix) =>
      rows.push(node(prefix, depthOf(prefix), !matching.has(prefix.id))),
    );
  }
  return { rows, hiddenDeprecated, matchCount: matching.size };
}

/** Prefixes directly below the given one (overview parentId). */
export function directChildren(
  prefixes: IpamPrefix[],
  parentId: string,
): IpamPrefix[] {
  return prefixes.filter((prefix) => prefix.parentId === parentId);
}

/** True when the prefix has visible (non-deprecated) children. */
export function hasChildren(prefixes: IpamPrefix[], prefixId: string): boolean {
  return prefixes.some(
    (prefix) => prefix.parentId === prefixId && prefix.status !== "deprecated",
  );
}

/** Number of descendants (any depth), e.g. for the children table. */
export function descendantCount(
  prefixes: IpamPrefix[],
  prefixId: string,
): number {
  const children = new Map<string, string[]>();
  for (const prefix of prefixes) {
    if (!prefix.parentId) continue;
    const list = children.get(prefix.parentId) ?? [];
    list.push(prefix.id);
    children.set(prefix.parentId, list);
  }
  let count = 0;
  const stack = [...(children.get(prefixId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    count++;
    stack.push(...(children.get(id) ?? []));
  }
  return count;
}
