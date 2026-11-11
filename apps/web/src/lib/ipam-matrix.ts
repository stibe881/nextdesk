// VLAN-Matrix, VLAN-Liste nach Standort und Standort-Vorlagen (reine Logik).

import { compareCidrText, parseCidrInput } from "./ipam-cidr";
import type { IpamPrefix, IpamSite, IpamVlan } from "./ipam-model";
import type {
  MatrixCell,
  SiteTemplate,
  TemplateEntry,
  VlanMatrix,
} from "./ipam-redesign-types";

export type CellView = {
  state: MatrixCell["state"];
  title: string;
  prefix: string | null;
  percent: string | null;
  note: string | null;
  /** Accessible description of the whole cell. */
  label: string;
};

/** Display data of one matrix cell. */
export function matrixCellView(
  cell: MatrixCell,
  functionName: string,
  siteName: string,
): CellView {
  const percent =
    cell.percent === undefined || cell.percent === null
      ? null
      : `${Math.round(cell.percent)} %`;
  if (cell.state === "missing") {
    const suggestion = cell.suggestion
      ? `Vorschlag VLAN ${cell.suggestion.vlanNumber} · ${cell.suggestion.prefix}`
      : null;
    return {
      state: "missing",
      title: "fehlt",
      prefix: null,
      percent: null,
      note: suggestion,
      label: `${functionName} an ${siteName}: fehlt${suggestion ? `, ${suggestion}` : ""}`,
    };
  }
  if (cell.state === "na") {
    return {
      state: "na",
      title: "–",
      prefix: null,
      percent: null,
      note: null,
      label: `${functionName} an ${siteName}: nicht vorgesehen`,
    };
  }
  const title =
    cell.vlanNumber !== undefined
      ? String(cell.vlanNumber)
      : (cell.vlanName ?? "");
  const note = cell.state === "diff" ? (cell.note ?? "weicht ab") : null;
  return {
    state: cell.state,
    title,
    prefix: cell.prefix ?? null,
    percent,
    note,
    label: `${functionName} an ${siteName}: VLAN ${title}${cell.prefix ? `, ${cell.prefix}` : ""}${note ? `, ${note}` : ", wie Vorlage"}`,
  };
}

/** Counts per state across the matrix (for the legend). */
export function matrixCounts(
  matrix: Pick<VlanMatrix, "rows">,
): Record<MatrixCell["state"], number> {
  const counts = { ok: 0, diff: 0, missing: 0, na: 0 };
  for (const row of matrix.rows) {
    for (const cell of row.cells) counts[cell.state] += 1;
  }
  return counts;
}

/** Cell of a row for a site (rows may omit sites → na). */
export function cellFor(
  row: VlanMatrix["rows"][number],
  siteId: string,
): MatrixCell {
  return (
    row.cells.find((cell) => cell.siteId === siteId) ?? {
      siteId,
      state: "na",
    }
  );
}

// ---------------------------------------------------------------------------
// VLAN list grouped by site

export type VlanListItem = {
  vlan: IpamVlan;
  prefixes: IpamPrefix[];
  zone: string | null;
  /** Highest utilization of the VLAN's active prefixes. */
  percent: number | null;
};

export type VlanGroup = {
  key: string;
  siteId: string | null;
  name: string;
  items: VlanListItem[];
};

/** VLANs grouped by site (alphabetical, «Ohne Standort» last). */
export function groupVlansBySite(
  vlans: IpamVlan[],
  sites: IpamSite[],
  prefixes: IpamPrefix[],
  query = "",
): VlanGroup[] {
  const term = query.trim().toLowerCase();
  const items = vlans
    .filter((vlan) => {
      if (!term) return true;
      return `${vlan.vlanNumber} ${vlan.name} ${vlan.description ?? ""}`
        .toLowerCase()
        .includes(term);
    })
    .map((vlan): VlanListItem => {
      const own = prefixes
        .filter(
          (prefix) =>
            prefix.vlanId === vlan.id && prefix.status !== "deprecated",
        )
        .sort((a, b) => compareCidrText(a.prefix, b.prefix));
      const percents = own
        .map((prefix) => prefix.usage?.percent)
        .filter((value): value is number => typeof value === "number");
      return {
        vlan,
        prefixes: own,
        zone:
          vlan.zone ??
          own.find((prefix) => prefix.securityZone)?.securityZone ??
          null,
        percent: percents.length ? Math.max(...percents) : null,
      };
    });
  const groups: VlanGroup[] = [...sites]
    .sort((a, b) => a.name.localeCompare(b.name, "de-CH"))
    .map((site) => ({
      key: site.id,
      siteId: site.id,
      name: site.name,
      items: items.filter((item) => item.vlan.siteId === site.id),
    }));
  groups.push({
    key: "none",
    siteId: null,
    name: "Ohne Standort",
    items: items.filter(
      (item) =>
        !item.vlan.siteId ||
        !sites.some((site) => site.id === item.vlan.siteId),
    ),
  });
  for (const group of groups) {
    group.items.sort((a, b) => a.vlan.vlanNumber - b.vlan.vlanNumber);
  }
  return groups.filter((group) => group.items.length > 0);
}

// ---------------------------------------------------------------------------
// Templates

export function emptyTemplateEntry(index: number): TemplateEntry {
  return {
    function: "",
    description: null,
    vlanOffset: index,
    offset24: index,
    length: 24,
    zone: null,
    dhcp: false,
  };
}

/** German validation messages; empty array when the template is valid. */
export function validateTemplate(template: SiteTemplate): string[] {
  const errors: string[] = [];
  if (!template.name.trim()) errors.push("Bitte einen Namen erfassen.");
  if (
    !Number.isInteger(template.prefixLength) ||
    template.prefixLength < 8 ||
    template.prefixLength > 30
  ) {
    errors.push(
      "Die Länge des Standort-Supernetzes muss zwischen /8 und /30 liegen.",
    );
  }
  if (!template.entries.length)
    errors.push("Bitte mindestens eine Funktion erfassen.");
  const names = new Set<string>();
  const capacity24 = 2 ** Math.max(0, 24 - template.prefixLength);
  const used: [number, number, string][] = [];
  template.entries.forEach((entry, index) => {
    const label = entry.function.trim() || `Zeile ${index + 1}`;
    if (!entry.function.trim())
      errors.push(`Zeile ${index + 1}: Funktion fehlt.`);
    const key = entry.function.trim().toLowerCase();
    if (key && names.has(key)) errors.push(`${label}: Funktion doppelt.`);
    names.add(key);
    if (entry.length < template.prefixLength || entry.length > 30) {
      errors.push(
        `${label}: Grösse /${entry.length} passt nicht ins Supernetz.`,
      );
      return;
    }
    if (entry.vlanOffset < 0 || entry.vlanOffset > 4093) {
      errors.push(`${label}: VLAN-Versatz ungültig.`);
    }
    // Subnet start in /24 units and its size in /24 units (at least one).
    const blocks = entry.length <= 24 ? 2 ** (24 - entry.length) : 1;
    if (entry.offset24 < 0 || entry.offset24 + blocks > capacity24) {
      errors.push(`${label}: liegt ausserhalb des Supernetzes.`);
      return;
    }
    if (entry.length <= 24 && entry.offset24 % blocks !== 0) {
      errors.push(
        `${label}: /${entry.length} muss bei einem Vielfachen von ${blocks} × /24 beginnen.`,
      );
    }
    for (const [start, end, other] of used) {
      if (entry.offset24 < end && start < entry.offset24 + blocks) {
        errors.push(`${label}: überschneidet sich mit ${other}.`);
        break;
      }
    }
    used.push([entry.offset24, entry.offset24 + blocks, label]);
  });
  return errors;
}

/**
 * Client-side example of a template (first site supernet at offset 0):
 * function, VLAN and subnet relative to the given supernet and base.
 */
export function templateExample(
  template: SiteTemplate,
  supernet: string,
  vlanBase: number,
): { function: string; vlanNumber: number; prefix: string | null }[] {
  const cidr = parseCidrInput(supernet)?.cidr;
  return template.entries.map((entry) => {
    let prefix: string | null = null;
    if (cidr && cidr.version === 4) {
      const network = cidr.network + BigInt(entry.offset24) * 256n;
      const value = Number(network);
      prefix = `${value >>> 24}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}/${entry.length}`;
    }
    return {
      function: entry.function,
      vlanNumber: vlanBase + entry.vlanOffset,
      prefix,
    };
  });
}
