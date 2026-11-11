// Belegung eines Subnetzes: Raster in /24-Blöcken mit Zeilenbeschriftung,
// Bereichsauswahl, zusammengefasste freie Bereiche und Anteile je Status
// (reine Logik zu buildGrid aus ipam-model).

import {
  CELL_LABEL,
  CELL_ORDER,
  type CellState,
  type GridCell,
} from "./ipam-model";

/** States that occupy an address (used for the block utilization). */
const USED: ReadonlySet<CellState> = new Set([
  "active",
  "reserved",
  "dhcp",
  "ghost",
  "conflict",
  "gateway",
]);

export type OccupancyBlock = {
  index: number;
  /** First and last cell index (inclusive). */
  start: number;
  end: number;
  /** «10.10.5.0/24» for full /24 blocks, otherwise the first address. */
  label: string;
  /** Short label for the zoom buttons («.5.0»). */
  short: string;
  counts: Record<CellState, number>;
  /** Share of used cells (incl. DHCP pool), 0..100. */
  usedPercent: number;
  /** Open conflicts/ghosts in the block. */
  alerts: number;
};

function emptyCounts(): Record<CellState, number> {
  return Object.fromEntries(CELL_ORDER.map((state) => [state, 0])) as Record<
    CellState,
    number
  >;
}

/**
 * Splits the grid into blocks of 256 addresses (one /24 for IPv4). Prefixes
 * up to /24 give exactly one block.
 */
export function occupancyBlocks(
  cells: GridCell[],
  blockSize = 256,
): OccupancyBlock[] {
  const blocks: OccupancyBlock[] = [];
  for (let start = 0; start < cells.length; start += blockSize) {
    const end = Math.min(cells.length, start + blockSize) - 1;
    const counts = emptyCounts();
    for (let index = start; index <= end; index++) {
      counts[cells[index]!.state] += 1;
    }
    const size = end - start + 1;
    const used = [...USED].reduce((sum, state) => sum + counts[state], 0);
    const first = cells[start]!.address;
    const parts = first.split(".");
    const full = size === 256 && parts.length === 4;
    blocks.push({
      index: blocks.length,
      start,
      end,
      label: full ? `${first}/24` : first,
      short: parts.length === 4 ? `.${parts[2]}.${parts[3]}` : first,
      counts,
      usedPercent: Math.round((used / size) * 1000) / 10,
      alerts: counts.conflict + counts.ghost,
    });
  }
  return blocks;
}

export type OccupancyRow = {
  /** Row label: last octet(s) of the first address («.32»). */
  label: string;
  /** Full first address of the row (for screen readers). */
  first: string;
  start: number;
  indexes: number[];
};

/** Rows of `columns` cells for one block (default 16 × 16 for a /24). */
export function occupancyRows(
  cells: GridCell[],
  block: Pick<OccupancyBlock, "start" | "end">,
  columns = 16,
): OccupancyRow[] {
  const rows: OccupancyRow[] = [];
  for (let start = block.start; start <= block.end; start += columns) {
    const end = Math.min(block.end, start + columns - 1);
    const first = cells[start]!.address;
    const parts = first.split(".");
    rows.push({
      label: parts.length === 4 ? `.${parts[3]}` : first,
      first,
      start,
      indexes: Array.from({ length: end - start + 1 }, (_, i) => start + i),
    });
  }
  return rows;
}

/** Indexes from `anchor` to `target` in ascending order. */
export function rangeIndexes(anchor: number, target: number): number[] {
  const from = Math.min(anchor, target);
  const to = Math.max(anchor, target);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** Addresses of the selection that can be reserved (only free cells). */
export function reservableAddresses(
  cells: GridCell[],
  indexes: Iterable<number>,
): string[] {
  const result: string[] = [];
  for (const index of [...indexes].sort((a, b) => a - b)) {
    const cell = cells[index];
    if (cell && cell.state === "free") result.push(cell.address);
  }
  return result;
}

/** «10.10.1.40 – 10.10.1.44» or a single address. */
export function rangeText(addresses: string[]): string {
  if (!addresses.length) return "";
  if (addresses.length === 1) return addresses[0]!;
  return `${addresses[0]} – ${addresses[addresses.length - 1]}`;
}

export type StateSegment = {
  state: CellState;
  label: string;
  count: number;
  /** Share 0..1 of all cells. */
  share: number;
};

/** Segments for the stacked bar and legend, in display order. */
export function stateSegments(
  counts: Record<CellState, number>,
): StateSegment[] {
  const total = CELL_ORDER.reduce((sum, state) => sum + counts[state], 0);
  return CELL_ORDER.filter((state) => counts[state] > 0).map((state) => ({
    state,
    label: CELL_LABEL[state],
    count: counts[state],
    share: total ? counts[state] / total : 0,
  }));
}

export type AddressListRow =
  | { kind: "cell"; index: number; cell: GridCell }
  | {
      kind: "free";
      key: string;
      from: string;
      to: string;
      count: number;
      /** Index of the first free cell (reserve suggestion). */
      index: number;
    };

/**
 * List of the documented/notable addresses with free runs collapsed into one
 * row each («10.10.1.141 – 10.10.1.254 · 114 frei»). Network/broadcast and
 * plain DHCP pool cells without a record are skipped (the pool is shown as
 * its own run), unless `keep` says otherwise.
 */
export function addressListRows(
  cells: GridCell[],
  keep: (cell: GridCell) => boolean,
  showFree: boolean,
): AddressListRow[] {
  const rows: AddressListRow[] = [];
  let run: { start: number; end: number } | null = null;
  const flush = () => {
    if (!run) return;
    if (showFree) {
      rows.push({
        kind: "free",
        key: `free-${run.start}`,
        from: cells[run.start]!.address,
        to: cells[run.end]!.address,
        count: run.end - run.start + 1,
        index: run.start,
      });
    }
    run = null;
  };
  cells.forEach((cell, index) => {
    if (cell.state === "free" && !cell.record) {
      if (run) run.end = index;
      else run = { start: index, end: index };
      return;
    }
    flush();
    if (keep(cell)) rows.push({ kind: "cell", index, cell });
  });
  flush();
  return rows;
}

/** Text filter for the address list (IP, hostname, DNS, MAC, vendor …). */
export function cellMatches(cell: GridCell, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  const record = cell.record;
  return [
    cell.address,
    record?.hostname,
    record?.dnsName,
    record?.macAddress,
    record?.vendor,
    record?.description,
    record?.switchName,
    record?.ownerName,
  ].some((value) => value?.toLowerCase().includes(needle));
}

/** One-line description of a cell for tooltips and screen readers. */
export function cellSummary(cell: GridCell): string {
  const parts = [`${cell.address}`, CELL_LABEL[cell.state]];
  if (cell.record?.hostname) parts.push(cell.record.hostname);
  return parts.join(" · ");
}
