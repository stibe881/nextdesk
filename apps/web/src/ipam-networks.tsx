// IPAM «Netze»: kompakter Baum (Hierarchie / nach Standort) mit Textfilter,
// Filtern und Mehrfachauswahl; Supernetz-Detail mit Adressraum-Raster und
// Subnetz-Detail mit Belegung (Heatmap, Zoom je /24, Bereichsauswahl),
// Adressliste, Verlauf & Prognose und Funden. Brotkrumen oben im Detail.

import {
  Archive,
  ChevronDown,
  ChevronRight,
  ListFilter,
  Pencil,
  Plus,
  Scissors,
  Sparkles,
  SquareCheck,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Meter,
  Notice,
  Pill,
  Segmented,
  SubTabs,
  errorText,
  useIpamQuery,
  type IpamChanged,
  type IpamDialog,
  type IpamDrawer,
} from "./ipam-ui";
import {
  CopyButton,
  RingGauge,
  StackedBar,
  Term,
  TrendChartView,
  useGridKeys,
  type StackPart,
} from "./ipam-viz";
import { ipamCall } from "./lib/ipam-api";
import { spaceGrid, type SpaceGrid } from "./lib/ipam-charts";
import {
  cidrLength,
  formatCountText,
  gapLengths,
  hostsForLength,
} from "./lib/ipam-calc";
import {
  formatCidr,
  formatCount,
  ipv4Netmask,
  parseCidrInput,
} from "./lib/ipam-cidr";
import { forecastSentence, percentText } from "./lib/ipam-format";
import {
  ADDRESS_STATUS_LABEL,
  buildGrid,
  CELL_LABEL,
  FINDING_KIND_LABEL,
  forecastText,
  formatRelative,
  PREFIX_STATUS_LABEL,
  type CellState,
  type GridCell,
  type IpamAddress,
  type IpamOverview,
  type IpamPrefix,
  type IpamPrefixDetail,
  type PrefixStatus,
} from "./lib/ipam-model";
import {
  addressListRows,
  cellMatches,
  cellSummary,
  occupancyBlocks,
  occupancyRows,
  rangeIndexes,
  rangeText,
  reservableAddresses,
  stateSegments,
} from "./lib/ipam-occupancy";
import type {
  AddressSegment,
  AddressSpace,
  BulkPrefixPatch,
  CleanupSuggestion,
  UtilizationHistory,
} from "./lib/ipam-redesign-types";
import {
  buildTree,
  descendantCount,
  directChildren,
  EMPTY_TREE_FILTER,
  hasChildren,
  zoneOptions,
  type TreeFilter,
  type TreeGrouping,
} from "./lib/ipam-tree";
import { prefixAncestors } from "./lib/ipam-ui-state";

type Props = {
  canManage: boolean;
  onChanged: IpamChanged;
  onDialog: (dialog: IpamDialog) => void;
  onOpenAddress: (drawer: IpamDrawer) => void;
  onOpenCleanup: () => void;
  onOpenFindings: () => void;
  onOpenPlanner: (parentId: string | null) => void;
  onOpenSite: (siteId: string) => void;
  onSelect: (prefixId: string) => void;
  overview: IpamOverview;
  revision: number;
  selectedPrefixId: string | null;
  tenantId: string;
};

const STATUS_TONE: Record<
  PrefixStatus,
  "success" | "neutral" | "accent" | "warning"
> = {
  active: "success",
  container: "neutral",
  reserved: "accent",
  deprecated: "warning",
};

/** Status label in the redesign: «Container» instead of «Supernetz». */
export function prefixStatusLabel(status: PrefixStatus): string {
  return status === "container" ? "Container" : PREFIX_STATUS_LABEL[status];
}

/** Grid states → colour class of the swatches/cells. */
const STATE_TONE: Record<CellState, string> = {
  active: "active",
  reserved: "reserved",
  dhcp: "dhcp",
  ghost: "ghost",
  conflict: "conflict",
  deprecated: "deprecated",
  gateway: "gateway",
  network: "network",
  free: "free",
};

export function IpamNetworksPage(props: Props) {
  const { canManage, onDialog, onSelect, overview, selectedPrefixId } = props;
  const [grouping, setGrouping] = useState<TreeGrouping>("tree");
  const [filter, setFilter] = useState<TreeFilter>(EMPTY_TREE_FILTER);
  const [showFilters, setShowFilters] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [navOpen, setNavOpen] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const cleanup = useIpamQuery<{ suggestions: CleanupSuggestion[] }>(
    canManage ? { type: "cleanupSuggestions", tenantId: props.tenantId } : null,
    `${props.tenantId}-${props.revision}-${canManage}`,
  );
  const tree = useMemo(
    () =>
      buildTree(
        overview.prefixes,
        overview.vlans,
        overview.sites,
        overview.vrfs,
        grouping,
        filter,
      ),
    [overview, grouping, filter],
  );
  const zones = useMemo(
    () => zoneOptions(overview.prefixes),
    [overview.prefixes],
  );
  const parents = useMemo(() => {
    const result = new Set<string>();
    for (const prefix of overview.prefixes) {
      if (prefix.parentId) result.add(prefix.parentId);
    }
    return result;
  }, [overview.prefixes]);
  const byId = useMemo(
    () => new Map(overview.prefixes.map((prefix) => [prefix.id, prefix])),
    [overview.prefixes],
  );
  const selected = selectedPrefixId
    ? (byId.get(selectedPrefixId) ?? null)
    : null;

  useEffect(() => {
    if (
      (selectedPrefixId && byId.has(selectedPrefixId)) ||
      !overview.prefixes.length
    )
      return;
    const first =
      overview.prefixes.find(
        (prefix) => prefix.status === "container" && !prefix.parentId,
      ) ?? overview.prefixes.find((prefix) => prefix.status !== "deprecated");
    if (first) onSelect(first.id);
  }, [overview.prefixes, selectedPrefixId, onSelect, byId]);

  if (overview.prefixes.length === 0) {
    return (
      <div className="ipam-placeholder">
        <h3>Noch keine Subnetze erfasst</h3>
        <p>
          Legen Sie zuerst ein Supernetz (z. B. 10.20.0.0/16) an und teilen Sie
          es im Subnetz-Planer auf, oder übernehmen Sie bestehende Listen über
          «Verwaltung → Import».
        </p>
        {canManage ? (
          <button
            className="primary-button"
            onClick={() => onDialog({ kind: "prefix", prefix: null })}
            type="button"
          >
            <Plus aria-hidden="true" size={16} /> Erstes Subnetz anlegen
          </button>
        ) : null}
      </div>
    );
  }

  const cleanupCount = cleanup.data?.suggestions.length ?? 0;
  const toggle = (id: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const filterCount = [filter.siteId, filter.zone, filter.status].filter(
    Boolean,
  ).length;
  const textActive = Boolean(filter.text?.trim());
  const hiddenByCollapse = (prefix: IpamPrefix) => {
    if (grouping !== "tree" || textActive) return false;
    let parentId = prefix.parentId ?? null;
    while (parentId) {
      if (collapsed.has(parentId)) return true;
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return false;
  };
  const select = (id: string) => {
    onSelect(id);
    setNavOpen(false);
    if (window.matchMedia?.("(max-width: 900px)").matches) {
      window.requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView({ block: "start" }),
      );
    }
  };

  return (
    <div className="ipam-page">
      <div className="ipam-card ipam-toolbar ipam-toolbar--nets">
        <Segmented
          label="Ansicht"
          onChange={setGrouping}
          options={[
            { value: "tree", label: "Hierarchie" },
            { value: "site", label: "Nach Standort" },
          ]}
          value={grouping}
        />
        <button
          aria-controls="ipam-net-filters"
          aria-expanded={showFilters || filterCount > 0}
          className="secondary-button"
          onClick={() => setShowFilters(!showFilters)}
          type="button"
        >
          <ListFilter aria-hidden="true" size={15} /> Filter
          {filterCount ? (
            <span className="ipam-count">{filterCount}</span>
          ) : null}
        </button>
        <span className="ipam-toolbar__spacer" />
        {canManage ? (
          <>
            <button
              aria-pressed={selectMode}
              className="secondary-button"
              onClick={() => {
                setSelectMode(!selectMode);
                setChecked(new Set());
              }}
              type="button"
            >
              <SquareCheck aria-hidden="true" size={15} />
              {selectMode ? "Auswahl beenden" : "Mehrere auswählen"}
            </button>
            <button
              className="secondary-button"
              onClick={props.onOpenCleanup}
              title="Auffälligkeiten wie aktive Supernetze oder Notizen im Namen bereinigen"
              type="button"
            >
              <Sparkles aria-hidden="true" size={15} /> Bereinigen
              {cleanupCount ? (
                <span className="ipam-count ipam-count--warning">
                  {cleanupCount}
                </span>
              ) : null}
            </button>
            <button
              className="primary-button"
              onClick={() => onDialog({ kind: "prefix", prefix: null })}
              type="button"
            >
              <Plus aria-hidden="true" size={16} /> Subnetz
            </button>
          </>
        ) : null}
        {showFilters || filterCount > 0 ? (
          <div className="ipam-toolbar__filters" id="ipam-net-filters">
            <select
              aria-label="Standort"
              onChange={(event) =>
                setFilter({ ...filter, siteId: event.target.value || null })
              }
              value={filter.siteId ?? ""}
            >
              <option value="">Alle Standorte</option>
              {overview.sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
              <option value="none">Ohne Standort</option>
            </select>
            {zones.length ? (
              <select
                aria-label="Zone"
                onChange={(event) =>
                  setFilter({ ...filter, zone: event.target.value || null })
                }
                value={filter.zone ?? ""}
              >
                <option value="">Alle Zonen</option>
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            ) : null}
            <select
              aria-label="Status"
              onChange={(event) =>
                setFilter({
                  ...filter,
                  status: (event.target.value || null) as PrefixStatus | null,
                })
              }
              value={filter.status ?? ""}
            >
              <option value="">Alle Status</option>
              {(["active", "container", "reserved", "deprecated"] as const).map(
                (status) => (
                  <option key={status} value={status}>
                    {prefixStatusLabel(status)}
                  </option>
                ),
              )}
            </select>
            <label className="ipam-check">
              <input
                checked={filter.showDeprecated}
                onChange={(event) =>
                  setFilter({ ...filter, showDeprecated: event.target.checked })
                }
                type="checkbox"
              />
              Veraltete zeigen
            </label>
            {filterCount ? (
              <button
                className="text-button"
                onClick={() =>
                  setFilter({
                    ...EMPTY_TREE_FILTER,
                    text: filter.text ?? "",
                    showDeprecated: filter.showDeprecated,
                  })
                }
                type="button"
              >
                Filter zurücksetzen
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {selectMode && checked.size > 0 ? (
        <BulkBar
          ids={[...checked]}
          onDone={(message, undo) => {
            setChecked(new Set());
            setSelectMode(false);
            props.onChanged(message, undo);
          }}
          overview={overview}
          tenantId={props.tenantId}
          zones={zones}
        />
      ) : null}

      <div className="ipam-split">
        <nav
          aria-label="Netze"
          className={`ipam-card ipam-netnav${navOpen ? " is-open" : ""}`}
        >
          <button
            aria-expanded={navOpen}
            className="ipam-netnav__toggle"
            onClick={() => setNavOpen(!navOpen)}
            type="button"
          >
            <span>
              <small>Netz wählen</small>
              <span className="ipam-mono">
                {selected?.prefix ?? "Kein Netz gewählt"}
              </span>
            </span>
            <ChevronDown aria-hidden="true" size={18} />
          </button>
          <div className="ipam-netnav__body">
            <div className="ipam-netnav__search">
              <input
                aria-label="Netze filtern"
                onChange={(event) =>
                  setFilter({ ...filter, text: event.target.value })
                }
                placeholder="Netz, Name oder VLAN filtern …"
                spellCheck={false}
                type="search"
                value={filter.text ?? ""}
              />
              <small className="ipam-muted">
                {tree.matchCount} {tree.matchCount === 1 ? "Netz" : "Netze"}
              </small>
            </div>
            <div className="ipam-tree3">
              {tree.rows.length === 0 ? (
                <p className="ipam-empty">
                  Keine Netze für diesen Filter.{" "}
                  <button
                    className="text-button"
                    onClick={() =>
                      setFilter({
                        ...EMPTY_TREE_FILTER,
                        showDeprecated: filter.showDeprecated,
                      })
                    }
                    type="button"
                  >
                    Filter zurücksetzen
                  </button>
                </p>
              ) : null}
              {tree.rows.map((row) => {
                if (row.kind === "header") {
                  return (
                    <div className="ipam-tree3__header" key={row.key}>
                      {row.label}
                    </div>
                  );
                }
                if (hiddenByCollapse(row.prefix)) return null;
                const isParent =
                  grouping === "tree" &&
                  !textActive &&
                  parents.has(row.prefix.id);
                const isOpen = !collapsed.has(row.prefix.id);
                const active = row.prefix.id === selectedPrefixId;
                const sub = [
                  row.vlan ? `VLAN ${row.vlan.vlanNumber}` : null,
                  row.prefix.description ?? row.vlan?.name ?? null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <div
                    className={`ipam-tree3__row${active ? " is-active" : ""}${row.context ? " is-context" : ""}`}
                    key={row.key}
                    style={{ paddingLeft: `${row.depth * 14}px` }}
                  >
                    {selectMode ? (
                      <input
                        aria-label={`${row.prefix.prefix} auswählen`}
                        checked={checked.has(row.prefix.id)}
                        onChange={() => toggle(row.prefix.id)}
                        type="checkbox"
                      />
                    ) : isParent ? (
                      <button
                        aria-expanded={isOpen}
                        aria-label={`${row.prefix.prefix} ${isOpen ? "zuklappen" : "aufklappen"}`}
                        className="ipam-tree3__twisty"
                        onClick={() =>
                          setCollapsed((current) => {
                            const next = new Set(current);
                            if (next.has(row.prefix.id))
                              next.delete(row.prefix.id);
                            else next.add(row.prefix.id);
                            return next;
                          })
                        }
                        type="button"
                      >
                        {isOpen ? (
                          <ChevronDown aria-hidden="true" size={14} />
                        ) : (
                          <ChevronRight aria-hidden="true" size={14} />
                        )}
                      </button>
                    ) : (
                      <span aria-hidden="true" className="ipam-tree3__spacer" />
                    )}
                    <button
                      aria-current={active ? "true" : undefined}
                      className="ipam-tree3__node"
                      onClick={() => select(row.prefix.id)}
                      type="button"
                    >
                      <span className="ipam-tree3__text">
                        <span
                          className={`ipam-mono ipam-tree3__cidr${row.prefix.status === "deprecated" ? " is-deprecated" : ""}`}
                        >
                          {row.prefix.prefix}
                          {row.warn ? (
                            <span
                              className="ipam-tag ipam-tag--warning"
                              title="Aktiv, enthält aber aktive Teilnetze"
                            >
                              prüfen
                            </span>
                          ) : null}
                        </span>
                        <small>
                          {sub || prefixStatusLabel(row.prefix.status)}
                        </small>
                      </span>
                      {row.prefix.usage && row.prefix.status !== "container" ? (
                        <Meter
                          label={row.prefix.prefix}
                          percent={row.prefix.usage.percent}
                          warningPercent={row.prefix.utilizationWarningPercent}
                        />
                      ) : (
                        <span className="ipam-tree3__kind">
                          {prefixStatusLabel(row.prefix.status)}
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
              {tree.hiddenDeprecated > 0 && grouping === "tree" ? (
                <button
                  className="text-button ipam-tree3__more"
                  onClick={() => setFilter({ ...filter, showDeprecated: true })}
                  type="button"
                >
                  {tree.hiddenDeprecated === 1
                    ? "1 veraltetes Netz ausgeblendet – anzeigen"
                    : `${tree.hiddenDeprecated} veraltete Netze ausgeblendet – anzeigen`}
                </button>
              ) : null}
            </div>
          </div>
        </nav>

        <section
          aria-label="Netz-Details"
          className="ipam-split__main"
          ref={detailRef}
        >
          {selected ? (
            <>
              <Breadcrumb
                onSelect={select}
                prefix={selected}
                prefixes={overview.prefixes}
              />
              {selected.status === "container" ||
              hasChildren(overview.prefixes, selected.id) ? (
                <SupernetDetail
                  {...props}
                  key={selected.id}
                  onSelect={select}
                  prefix={selected}
                />
              ) : (
                <SubnetDetail
                  {...props}
                  key={selected.id}
                  onSelect={select}
                  prefix={selected}
                />
              )}
            </>
          ) : (
            <div className="ipam-card">
              <p className="ipam-empty">
                Wählen Sie links ein Netz, um Belegung, Adressen und Verlauf zu
                sehen.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Breadcrumb({
  onSelect,
  prefix,
  prefixes,
}: {
  onSelect: (id: string) => void;
  prefix: IpamPrefix;
  prefixes: IpamPrefix[];
}) {
  const ancestors = prefixAncestors(prefixes, prefix.id)
    .map((id) => prefixes.find((entry) => entry.id === id))
    .filter((entry): entry is IpamPrefix => Boolean(entry));
  return (
    <nav aria-label="Pfad" className="ipam-crumbs">
      <ol>
        {ancestors.map((entry) => (
          <li key={entry.id}>
            <button
              className="ipam-crumbs__link"
              onClick={() => onSelect(entry.id)}
              title={entry.description ?? undefined}
              type="button"
            >
              <span className="ipam-mono">{entry.prefix}</span>
              {entry.description ? <small>{entry.description}</small> : null}
            </button>
            <ChevronRight aria-hidden="true" size={14} />
          </li>
        ))}
        <li aria-current="page">
          <span className="ipam-mono">{prefix.prefix}</span>
        </li>
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Bulk edit

type BulkUndo = Parameters<IpamChanged>[1];

/** Groups the previous values of a bulk change so it can be reversed. */
export function bulkUndoGroups(
  prefixes: IpamPrefix[],
  ids: string[],
  patch: BulkPrefixPatch,
): { prefixIds: string[]; patch: BulkPrefixPatch }[] {
  const groups = new Map<
    string,
    { prefixIds: string[]; patch: BulkPrefixPatch }
  >();
  for (const id of ids) {
    const prefix = prefixes.find((entry) => entry.id === id);
    if (!prefix) continue;
    const previous: BulkPrefixPatch = {};
    if (patch.status !== undefined) previous.status = prefix.status;
    if (patch.departmentId !== undefined)
      previous.departmentId = prefix.departmentId;
    if (patch.securityZone !== undefined)
      previous.securityZone = prefix.securityZone;
    if (patch.siteId !== undefined) previous.siteId = prefix.siteId;
    const key = JSON.stringify(previous);
    const group = groups.get(key) ?? { prefixIds: [], patch: previous };
    group.prefixIds.push(id);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function BulkBar({
  ids,
  onDone,
  overview,
  tenantId,
  zones,
}: {
  ids: string[];
  onDone: (message: string, undo: BulkUndo) => void;
  overview: IpamOverview;
  tenantId: string;
  zones: string[];
}) {
  const [status, setStatus] = useState("");
  const [department, setDepartment] = useState("");
  const [zone, setZone] = useState("");
  const [site, setSite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch: BulkPrefixPatch = {};
  if (status) patch.status = status as NonNullable<BulkPrefixPatch["status"]>;
  if (department)
    patch.departmentId = department === "__all" ? null : department;
  if (zone) patch.securityZone = zone === "__none" ? null : zone;
  if (site) patch.siteId = site === "__none" ? null : site;
  const empty = Object.keys(patch).length === 0;
  const apply = async () => {
    setBusy(true);
    setError(null);
    const groups = bulkUndoGroups(overview.prefixes, ids.slice(0, 200), patch);
    try {
      const result = await ipamCall<{ updated: number }>({
        type: "bulkUpdatePrefixes",
        tenantId,
        prefixIds: ids.slice(0, 200),
        patch,
      });
      onDone(
        result.updated === 1
          ? "1 Netz geändert."
          : `${result.updated} Netze geändert.`,
        {
          run: async () => {
            for (const group of groups) {
              await ipamCall({
                type: "bulkUpdatePrefixes",
                tenantId,
                prefixIds: group.prefixIds,
                patch: group.patch,
              });
            }
          },
        },
      );
    } catch (failure) {
      setError(errorText(failure, "Die Netze konnten nicht geändert werden."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ipam-bulk" role="region" aria-label="Massenänderung">
      <strong>{ids.length} ausgewählt</strong>
      <select
        aria-label="Status setzen"
        onChange={(event) => setStatus(event.target.value)}
        value={status}
      >
        <option value="">Status setzen …</option>
        {(["container", "active", "reserved", "deprecated"] as const).map(
          (value) => (
            <option key={value} value={value}>
              {prefixStatusLabel(value)}
            </option>
          ),
        )}
      </select>
      {overview.departments.length > 1 ? (
        <select
          aria-label="Abteilung setzen"
          onChange={(event) => setDepartment(event.target.value)}
          value={department}
        >
          <option value="">Abteilung …</option>
          <option value="__all">Alle Abteilungen</option>
          {overview.departments.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      ) : null}
      <select
        aria-label="Zone setzen"
        onChange={(event) => setZone(event.target.value)}
        value={zone}
      >
        <option value="">Zone …</option>
        <option value="__none">Ohne Zone</option>
        {[...new Set([...zones, "LAN", "WLAN", "MGMT", "DMZ"])].map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <select
        aria-label="Standort setzen"
        onChange={(event) => setSite(event.target.value)}
        value={site}
      >
        <option value="">Standort …</option>
        <option value="__none">Ohne Standort</option>
        {overview.sites.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </select>
      <button
        className="primary-button"
        disabled={empty || busy}
        onClick={() => void apply()}
        type="button"
      >
        {busy ? "Wird übernommen …" : "Übernehmen"}
      </button>
      {error ? (
        <span className="ipam-bulk__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared header actions

/** Archiving only sets «Veraltet» – reversible, so no confirm but undo. */
function makeArchive(
  prefix: IpamPrefix,
  tenantId: string,
  onChanged: IpamChanged,
  setError: (message: string) => void,
) {
  return async () => {
    try {
      await ipamCall({
        type: "delete",
        tenantId,
        entity: "prefix",
        id: prefix.id,
      });
      onChanged(`${prefix.prefix} archiviert (als «Veraltet» markiert).`, {
        run: () =>
          ipamCall({
            type: "bulkUpdatePrefixes",
            tenantId,
            prefixIds: [prefix.id],
            patch: { status: prefix.status },
          }),
      });
    } catch (failure) {
      setError(errorText(failure, "Das Netz konnte nicht archiviert werden."));
    }
  };
}

function DetailHead({
  actions,
  gauge,
  prefix,
  subtitle,
}: {
  actions: ReactNode;
  gauge: ReactNode;
  prefix: IpamPrefix;
  subtitle: string;
}) {
  return (
    <header className="ipam-dhead">
      {gauge}
      <div className="ipam-dhead__text">
        <div className="ipam-dhead__title">
          <h3 className="ipam-mono">{prefix.prefix}</h3>
          <CopyButton label={prefix.prefix} value={prefix.prefix} />
          <Pill tone={STATUS_TONE[prefix.status]}>
            {prefix.status === "container" ? (
              <Term name="Container">Container</Term>
            ) : (
              prefixStatusLabel(prefix.status)
            )}
          </Pill>
        </div>
        <p>{subtitle}</p>
      </div>
      {actions ? <div className="ipam-dhead__actions">{actions}</div> : null}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Supernet

type DetailProps = Props & { prefix: IpamPrefix };

function SupernetDetail(props: DetailProps) {
  const { canManage, onDialog, onOpenPlanner, overview, prefix, tenantId } =
    props;
  const [error, setError] = useState<string | null>(null);
  const [gap, setGap] = useState<{ cidr: string; free: AddressSegment } | null>(
    null,
  );
  const space = useIpamQuery<AddressSpace>(
    { type: "addressSpace", tenantId, prefixId: prefix.id },
    `${prefix.id}-${props.revision}`,
  );
  const site = overview.sites.find((entry) => entry.id === prefix.siteId);
  const children = directChildren(overview.prefixes, prefix.id);
  const archive = makeArchive(prefix, tenantId, props.onChanged, setError);
  const grid = useMemo(
    () =>
      space.data ? spaceGrid(space.data.prefix, space.data.segments) : null,
    [space.data],
  );
  const colorOf = new Map(
    (grid?.children ?? []).map((child) => [
      child.segment.prefixId,
      child.color,
    ]),
  );
  return (
    <div className="ipam-card ipam-detail2">
      <DetailHead
        actions={
          canManage ? (
            <>
              <button
                className="secondary-button"
                onClick={() => onDialog({ kind: "prefix", prefix })}
                type="button"
              >
                <Pencil aria-hidden="true" size={15} /> Bearbeiten
              </button>
              {prefix.status !== "deprecated" ? (
                <button
                  aria-label="Netz archivieren"
                  className="icon-button"
                  onClick={() => void archive()}
                  title="Archivieren (rückgängig machbar)"
                  type="button"
                >
                  <Archive aria-hidden="true" size={16} />
                </button>
              ) : null}
              <button
                className="primary-button"
                onClick={() => onOpenPlanner(prefix.id)}
                type="button"
              >
                Im Planer aufteilen
              </button>
            </>
          ) : null
        }
        gauge={
          <RingGauge
            caption="vergeben"
            label={prefix.prefix}
            percent={space.data?.allocatedPercent ?? null}
            size={68}
            warningPercent={101}
          />
        }
        prefix={prefix}
        subtitle={[prefix.description, site?.name ?? "alle Standorte"]
          .filter(Boolean)
          .join(" · ")}
      />
      <Notice error={error ?? space.error} />
      {prefix.notes ? <p className="ipam-note">{prefix.notes}</p> : null}

      {space.data ? (
        <>
          <dl className="ipam-facts">
            <div>
              <dt>Frei</dt>
              <dd>
                {formatCountText(space.data.freeTotal)}
                <small>
                  Adressen in{" "}
                  {space.data.segments.filter((s) => s.kind === "free").length}{" "}
                  Blöcken
                </small>
              </dd>
            </div>
            <div>
              <dt>Grösster freier Block</dt>
              <dd className="ipam-mono">{space.data.largestFree ?? "–"}</dd>
            </div>
            <div>
              <dt>Teilnetze</dt>
              <dd>{space.data.childCount}</dd>
            </div>
            <div>
              <dt>Grösse</dt>
              <dd>
                {formatCountText(space.data.capacity)}
                <small>Adressen</small>
              </dd>
            </div>
          </dl>
          {grid ? (
            <SpaceMap
              canManage={canManage}
              grid={grid}
              onFree={(cidr) => {
                const free = space.data!.segments.find(
                  (segment) =>
                    segment.kind === "free" && cidrInside(cidr, segment.cidr),
                );
                setGap(free ? { cidr, free } : null);
              }}
              onSelect={props.onSelect}
              selectedFree={gap?.cidr ?? null}
              space={space.data}
            />
          ) : null}
          {gap && canManage ? (
            <GapPanel
              cell={gap.cidr}
              gap={gap.free}
              key={gap.cidr}
              onCancel={() => setGap(null)}
              onCreate={(cidr) =>
                onDialog({
                  kind: "prefix",
                  prefix: null,
                  draft: {
                    prefix: cidr,
                    vrfId: prefix.vrfId,
                    siteId: prefix.siteId,
                    departmentId: prefix.departmentId,
                    status: "active",
                  },
                })
              }
            />
          ) : null}
        </>
      ) : space.loading ? (
        <div aria-hidden="true" className="ipam-skeleton ipam-skeleton--map" />
      ) : null}

      {children.length ? (
        <div className="ipam-table-wrap ipam-table-wrap--sticky">
          <table className="ipam-table ipam-table--wide">
            <thead>
              <tr>
                <th>Teilnetz</th>
                <th>Name</th>
                <th>
                  <Term name="VLAN">VLAN</Term>
                </th>
                <th>Standort</th>
                <th>Teilnetze</th>
                <th className="ipam-col-meter">Belegt</th>
              </tr>
            </thead>
            <tbody>
              {children.map((child) => {
                const vlan = overview.vlans.find(
                  (entry) => entry.id === child.vlanId,
                );
                const color = colorOf.get(child.id);
                return (
                  <tr key={child.id}>
                    <td>
                      <span className="ipam-cidrcell">
                        <i
                          aria-hidden="true"
                          className={`ipam-dot${color !== undefined ? ` ipam-dot--c${color}` : ""}`}
                        />
                        <button
                          className="text-button ipam-mono"
                          onClick={() => props.onSelect(child.id)}
                          type="button"
                        >
                          {child.prefix}
                        </button>
                      </span>
                    </td>
                    <td>
                      {child.description ?? prefixStatusLabel(child.status)}
                    </td>
                    <td>{vlan ? `${vlan.vlanNumber} ${vlan.name}` : "–"}</td>
                    <td>
                      {overview.sites.find((entry) => entry.id === child.siteId)
                        ?.name ?? "–"}
                    </td>
                    <td>
                      {descendantCount(overview.prefixes, child.id) || "–"}
                    </td>
                    <td>
                      {child.status === "container" ? (
                        <span className="ipam-muted">Container</span>
                      ) : (
                        <Meter
                          label={child.prefix}
                          percent={child.usage?.percent ?? null}
                          warningPercent={child.utilizationWarningPercent}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ipam-empty">
          Dieses Supernetz enthält noch keine Teilnetze.{" "}
          {canManage
            ? "Klicken Sie auf einen freien Block in der Karte oder teilen Sie es im Planer auf."
            : null}
        </p>
      )}
    </div>
  );
}

function cidrInside(inner: string, outer: string): boolean {
  const a = parseCidrInput(inner)?.cidr;
  const b = parseCidrInput(outer)?.cidr;
  if (!a || !b || a.version !== b.version || a.length < b.length) return false;
  const shift = BigInt((a.version === 4 ? 32 : 128) - b.length);
  return a.network >> shift === b.network >> shift;
}

/** Address space raster: one cell per unit block (e.g. /24 in a /16). */
export function SpaceMap({
  canManage,
  grid,
  onFree,
  onSelect,
  selectedFree,
  space,
}: {
  canManage: boolean;
  grid: SpaceGrid;
  onFree: (cidr: string) => void;
  onSelect: (prefixId: string) => void;
  selectedFree: string | null;
  space: AddressSpace;
}) {
  const keys = useGridKeys(grid.cells.length, grid.columns);
  const [hover, setHover] = useState<number | null>(null);
  const hovered = hover !== null ? grid.cells[hover] : null;
  const hoveredChild =
    hovered && hovered.child !== null ? grid.children[hovered.child] : null;
  return (
    <section className="ipam-space" aria-label="Adressraum-Karte">
      <div className="ipam-space__head">
        <h4>Adressraum</h4>
        <span className="ipam-muted">
          Ein Feld = ein /{grid.unitLength}
          {canManage
            ? " · freies Feld anklicken, um dort ein Subnetz anzulegen"
            : ""}
        </span>
      </div>
      <div className="ipam-space__body">
        <div
          className="ipam-space__grid"
          onKeyDown={keys.onKeyDown}
          onMouseLeave={() => setHover(null)}
          role="group"
          aria-label={`Adressraum ${space.prefix}, ${grid.cells.length} Blöcke`}
          style={{
            gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
          }}
        >
          {grid.cells.map((cell) => {
            const child =
              cell.child !== null ? grid.children[cell.child] : null;
            const label =
              cell.kind === "free"
                ? `${cell.cidr} frei`
                : `${cell.cidr}: ${child?.segment.cidr ?? ""}${child?.segment.name ? ` ${child.segment.name}` : ""}${cell.kind === "partial" ? ` (${Math.round(cell.fill * 100)} % vergeben)` : ""}`;
            const isLabel =
              child && child.firstCell === cell.index && child.cells >= 2;
            return (
              <button
                aria-label={label}
                aria-pressed={
                  cell.kind === "free" ? selectedFree === cell.cidr : undefined
                }
                className={`ipam-space__cell ipam-space__cell--${cell.kind}${child ? ` ipam-dot--c${child.color}` : ""}${selectedFree === cell.cidr ? " is-on" : ""}${child?.segment.status === "deprecated" ? " is-deprecated" : ""}`}
                data-cell={cell.index}
                disabled={cell.kind === "free" && !canManage}
                key={cell.index}
                onClick={() =>
                  cell.kind === "free"
                    ? onFree(cell.cidr)
                    : child?.segment.prefixId &&
                      onSelect(child.segment.prefixId)
                }
                onFocus={() => setHover(cell.index)}
                onMouseEnter={() => setHover(cell.index)}
                style={
                  cell.kind === "partial"
                    ? ({
                        "--fill": `${Math.max(12, Math.round(cell.fill * 100))}%`,
                      } as CSSProperties)
                    : undefined
                }
                tabIndex={cell.index === keys.focus ? 0 : -1}
                type="button"
              >
                {isLabel ? (
                  <span aria-hidden="true">
                    {child!.segment.cidr.split("/")[1]
                      ? `/${child!.segment.cidr.split("/")[1]}`
                      : ""}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="ipam-space__side">
          <div className="ipam-space__info" aria-live="polite">
            {hovered ? (
              hoveredChild ? (
                <>
                  <strong className="ipam-mono">
                    {hoveredChild.segment.cidr}
                  </strong>
                  <span>
                    {hoveredChild.segment.name ?? "Ohne Name"}
                    {hoveredChild.segment.siteName
                      ? ` · ${hoveredChild.segment.siteName}`
                      : ""}
                  </span>
                  {hoveredChild.segment.percent !== undefined ? (
                    <Meter percent={hoveredChild.segment.percent} />
                  ) : null}
                  {hovered.kind === "partial" ? (
                    <small className="ipam-muted">
                      Block {hovered.cidr}: {Math.round(hovered.fill * 100)} %
                      vergeben
                    </small>
                  ) : null}
                </>
              ) : (
                <>
                  <strong className="ipam-mono">{hovered.cidr}</strong>
                  <span>Frei</span>
                  {canManage ? (
                    <small className="ipam-muted">
                      Anklicken, um hier ein Subnetz anzulegen.
                    </small>
                  ) : null}
                </>
              )
            ) : (
              <span className="ipam-muted">
                Zeigen Sie auf ein Feld, um Netz und Belegung zu sehen.
              </span>
            )}
          </div>
          <ul className="ipam-space__legend">
            {grid.children.slice(0, 12).map((child) => (
              <li key={child.segment.cidr}>
                <button
                  className="ipam-space__chip"
                  onClick={() =>
                    child.segment.prefixId && onSelect(child.segment.prefixId)
                  }
                  type="button"
                >
                  <i
                    aria-hidden="true"
                    className={`ipam-dot ipam-dot--c${child.color}`}
                  />
                  <span className="ipam-mono">{child.segment.cidr}</span>
                  <small>{child.segment.name ?? ""}</small>
                </button>
              </li>
            ))}
            {grid.children.length > 12 ? (
              <li className="ipam-muted">
                + {grid.children.length - 12} weitere (Tabelle unten)
              </li>
            ) : null}
            <li className="ipam-space__free-key">
              <i aria-hidden="true" className="ipam-dot ipam-dot--free" /> frei
            </li>
          </ul>
        </div>
      </div>
      {space.truncated ? (
        <p className="ipam-muted">
          Sehr viele Teilnetze: Die Karte zeigt nur die ersten 512 Blöcke.
        </p>
      ) : null}
    </section>
  );
}

function GapPanel({
  cell,
  gap,
  onCancel,
  onCreate,
}: {
  cell: string;
  gap: AddressSegment;
  onCancel: () => void;
  onCreate: (cidr: string) => void;
}) {
  const lengths = gapLengths(gap.cidr);
  const cellLength = cidrLength(cell) ?? 24;
  const v4 = !gap.cidr.includes(":");
  const [length, setLength] = useState(
    v4 ? Math.max(cellLength, 24) : Math.max(cellLength, 64),
  );
  const parsed = parseCidrInput(cell)?.cidr;
  const gapCidr = parseCidrInput(gap.cidr)?.cidr;
  // Proposal: the block of the chosen size that contains the clicked field
  // (bigger sizes align down, but never leave the free gap).
  let proposal = cell;
  if (parsed && gapCidr) {
    const bits = v4 ? 32 : 128;
    const size = 1n << BigInt(bits - length);
    const network = (parsed.network / size) * size;
    proposal = formatCidr({
      version: parsed.version,
      network: network < gapCidr.network ? gapCidr.network : network,
      length,
    });
  }
  return (
    <div
      className="ipam-gap"
      role="region"
      aria-label="Neues Subnetz im freien Block"
    >
      <div>
        <span className="ipam-muted">Freier Block</span>
        <strong className="ipam-mono">{gap.cidr}</strong>
        <small>{formatCountText(gap.size)} Adressen</small>
      </div>
      <label>
        Grösse
        <select
          onChange={(event) => setLength(Number(event.target.value))}
          value={length}
        >
          {lengths.map((value) => (
            <option key={value} value={value}>
              /{value} ({hostsForLength(value, v4 ? 4 : 6)} Hosts)
            </option>
          ))}
        </select>
      </label>
      <div>
        <span className="ipam-muted">Vorschlag</span>
        <strong className="ipam-mono">{proposal}</strong>
      </div>
      <button
        className="primary-button"
        onClick={() => onCreate(proposal)}
        type="button"
      >
        Subnetz anlegen …
      </button>
      <button
        aria-label="Auswahl aufheben"
        className="icon-button"
        onClick={onCancel}
        type="button"
      >
        <X aria-hidden="true" size={16} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subnet

type SubTab = "grid" | "addresses" | "trend" | "findings";

/** Fetches all address pages of a /21–/20 so the heatmap can be drawn. */
function useAllPages(
  detail: IpamPrefixDetail | null,
  tenantId: string,
  revision: number,
): IpamAddress[] | null {
  const [all, setAll] = useState<IpamAddress[] | null>(null);
  const cidr = detail ? parseCidrInput(detail.prefix.prefix)?.cidr : null;
  const wanted = Boolean(
    detail &&
    !detail.grid &&
    cidr &&
    cidr.version === 4 &&
    cidr.length >= 20 &&
    detail.pageSize,
  );
  const id = detail?.prefix.id ?? "";
  useEffect(() => {
    if (!wanted || !detail?.pageSize) {
      setAll(null);
      return;
    }
    let active = true;
    const pages = Math.ceil(detail.total / detail.pageSize);
    const rest = Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
      ipamCall<IpamPrefixDetail>({
        type: "prefixDetail",
        tenantId,
        prefixId: id,
        page: i + 1,
        query: null,
      }),
    );
    Promise.all(rest)
      .then((results) => {
        if (!active) return;
        setAll([
          ...detail.addresses,
          ...results.flatMap((result) => result.addresses),
        ]);
      })
      .catch(() => {
        if (active) setAll(null);
      });
    return () => {
      active = false;
    };
    // detail identity changes on reload; id/revision cover it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, id, revision, tenantId, detail?.total]);
  return all;
}

function SubnetDetail(props: DetailProps) {
  const { canManage, onDialog, onOpenAddress, overview, prefix, tenantId } =
    props;
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [serverQuery, setServerQuery] = useState("");
  const detailQuery = useIpamQuery<IpamPrefixDetail>(
    {
      type: "prefixDetail",
      tenantId,
      prefixId: prefix.id,
      page,
      query: serverQuery || null,
    },
    `${prefix.id}-${page}-${serverQuery}-${props.revision}`,
  );
  const history = useIpamQuery<UtilizationHistory>(
    { type: "utilizationHistory", tenantId, prefixId: prefix.id, days: 90 },
    `${prefix.id}-${props.revision}`,
  );
  const detail = detailQuery.data;
  const allPages = useAllPages(detail, tenantId, props.revision);
  const current = detail?.prefix ?? prefix;
  const grid = useMemo(() => {
    if (!detail) return null;
    if (detail.grid && !serverQuery)
      return buildGrid(detail.prefix, detail.addresses, detail.findings);
    if (allPages && !serverQuery)
      return buildGrid(detail.prefix, allPages, detail.findings, 4096);
    return null;
  }, [detail, allPages, serverQuery]);
  const openFindings = (detail?.findings ?? []).filter(
    (finding) => finding.status === "open",
  );
  const [tab, setTab] = useState<SubTab>("grid");
  const effectiveTab: SubTab =
    tab === "grid" && detail && !grid && !allPagesPending(detail)
      ? "addresses"
      : tab;
  const vlan = overview.vlans.find((entry) => entry.id === current.vlanId);
  const site = overview.sites.find((entry) => entry.id === current.siteId);
  const department = overview.departments.find(
    (entry) => entry.id === current.departmentId,
  );
  const vrf = overview.vrfs.find((entry) => entry.id === current.vrfId);
  const usage = current.usage;
  const archive = makeArchive(current, tenantId, props.onChanged, setError);
  const forecast = history.data
    ? forecastSentence(history.data.forecast, current.utilizationWarningPercent)
    : (forecastText(detail?.forecast, current.utilizationWarningPercent) ??
      "Noch zu wenig Verlauf für eine Prognose.");
  const forecastTone =
    history.data?.forecast.daysToFull !== null &&
    history.data?.forecast.daysToFull !== undefined &&
    history.data.forecast.daysToFull <= 30
      ? "danger"
      : history.data?.forecast.daysToFull !== null &&
          history.data?.forecast.daysToFull !== undefined
        ? "warning"
        : "neutral";
  const reserve = (suggestion: string | null, addresses?: string[]) =>
    onDialog({
      kind: "reserve",
      prefix: current,
      suggestion,
      ...(addresses && addresses.length > 1 ? { addresses } : {}),
    });
  const cidr = parseCidrInput(current.prefix)?.cidr;
  const composition: StackPart[] = grid
    ? stateSegments(grid.counts).map((segment) => ({
        key: segment.state,
        label: segment.label,
        count: segment.count,
        tone: STATE_TONE[segment.state],
      }))
    : usage
      ? [
          { key: "used", label: "Belegt", count: usage.used, tone: "active" },
          {
            key: "dhcp",
            label: "DHCP-Pool",
            count: usage.dhcpSize,
            tone: "dhcp",
          },
          {
            key: "free",
            label: "Frei",
            count: Math.max(
              0,
              Number(usage.capacity || "0") - usage.used - usage.dhcpSize,
            ),
            tone: "free",
          },
        ]
      : [];

  return (
    <div className="ipam-card ipam-detail2">
      <DetailHead
        actions={
          canManage ? (
            <>
              <button
                className="secondary-button"
                onClick={() => onDialog({ kind: "prefix", prefix: current })}
                type="button"
              >
                <Pencil aria-hidden="true" size={15} /> Bearbeiten
              </button>
              <button
                aria-label="Aufteilen"
                className="icon-button"
                onClick={() => onDialog({ kind: "split", prefix: current })}
                title="In kleinere Teilnetze aufteilen"
                type="button"
              >
                <Scissors aria-hidden="true" size={16} />
              </button>
              {current.status !== "deprecated" ? (
                <button
                  aria-label="Netz archivieren"
                  className="icon-button"
                  onClick={() => void archive()}
                  title="Archivieren (rückgängig machbar)"
                  type="button"
                >
                  <Archive aria-hidden="true" size={16} />
                </button>
              ) : null}
              <button
                className="primary-button"
                disabled={!detail?.nextFree}
                onClick={() => reserve(detail?.nextFree ?? null)}
                type="button"
              >
                {detail?.nextFree ? (
                  <>
                    Nächste freie IP:{" "}
                    <span className="ipam-mono">{detail.nextFree}</span>
                  </>
                ) : detail ? (
                  "Keine Adresse frei"
                ) : (
                  "Nächste freie IP"
                )}
              </button>
            </>
          ) : null
        }
        gauge={
          <RingGauge
            caption="belegt"
            label={current.prefix}
            percent={usage?.percent ?? null}
            size={68}
            warningPercent={current.utilizationWarningPercent}
          />
        }
        prefix={current}
        subtitle={
          [
            vlan ? `VLAN ${vlan.vlanNumber} ${vlan.name}` : null,
            current.description,
            site?.name,
          ]
            .filter(Boolean)
            .join(" · ") || "Ohne Beschreibung"
        }
      />

      <dl className="ipam-facts ipam-facts--subnet">
        <div>
          <dt>
            <Term name="Gateway" />
          </dt>
          <dd className="ipam-mono">
            {current.gateway ? (
              <>
                {current.gateway}
                <CopyButton value={current.gateway} />
              </>
            ) : (
              "–"
            )}
          </dd>
        </div>
        <div>
          <dt>
            <Term name="VLAN" />
          </dt>
          <dd>{vlan ? `${vlan.vlanNumber} · ${vlan.name}` : "–"}</dd>
        </div>
        <div>
          <dt>
            <Term name="Zone" />
          </dt>
          <dd>{current.securityZone ?? vlan?.zone ?? "–"}</dd>
        </div>
        <div>
          <dt>
            <Term name="DHCP">DHCP-Pool</Term>
          </dt>
          <dd
            className={current.dhcpStart && current.dhcpEnd ? "ipam-mono" : ""}
          >
            {current.dhcpStart && current.dhcpEnd
              ? `${current.dhcpStart} – ${current.dhcpEnd}`
              : "kein Pool"}
          </dd>
        </div>
        <div>
          <dt>Grösse</dt>
          <dd>
            {cidr && cidr.version === 4 ? (
              <>
                {formatCount(BigInt(usage?.capacity || "0"))} nutzbar
                <small className="ipam-mono">{ipv4Netmask(cidr.length)}</small>
              </>
            ) : (
              `/${cidr?.length ?? "–"}`
            )}
          </dd>
        </div>
        <div>
          <dt>Standort</dt>
          <dd>
            {site ? (
              <button
                className="text-button"
                onClick={() => props.onOpenSite(site.id)}
                type="button"
              >
                {site.name}
              </button>
            ) : (
              "–"
            )}
          </dd>
        </div>
        {vrf ? (
          <div>
            <dt>
              <Term name="VRF" />
            </dt>
            <dd>{vrf.name}</dd>
          </div>
        ) : null}
        {overview.departments.length > 1 ? (
          <div>
            <dt>Abteilung</dt>
            <dd>{department?.name ?? "alle"}</dd>
          </div>
        ) : null}
      </dl>

      <div className="ipam-usage2">
        <div className="ipam-usage2__bar">
          <div className="ipam-usage2__label">
            <span>Zusammensetzung</span>
            {usage ? (
              <small className="ipam-muted">
                {usage.used + usage.dhcpSize} von{" "}
                {formatCount(BigInt(usage.capacity || "0"))} belegt
                {usage.dhcpSize
                  ? ` · davon ${usage.dhcpSize} im DHCP-Pool`
                  : ""}
              </small>
            ) : null}
          </div>
          {composition.length ? (
            <StackedBar label="Zusammensetzung" parts={composition} />
          ) : null}
        </div>
        <div className={`ipam-usage2__forecast ipam-tone-${forecastTone}`}>
          <span>Prognose</span>
          <strong>{forecast}</strong>
          <small className="ipam-muted">aus 90 Tagen Verlauf</small>
        </div>
      </div>
      {current.notes ? <p className="ipam-note">{current.notes}</p> : null}

      <Notice error={error ?? detailQuery.error} />

      <SubTabs
        label="Subnetz"
        onChange={setTab}
        tabs={[
          ...(grid || !detail || allPagesPending(detail)
            ? [{ value: "grid" as const, label: "Belegung" }]
            : []),
          {
            value: "addresses",
            label: `Adressen${detail ? ` (${detail.total})` : ""}`,
          },
          { value: "trend", label: "Verlauf & Prognose" },
          {
            value: "findings",
            label: `Funde${openFindings.length ? ` (${openFindings.length})` : ""}`,
          },
        ]}
        value={effectiveTab}
      />

      {!detail && !detailQuery.error ? (
        <div aria-hidden="true" className="ipam-skeleton ipam-skeleton--grid" />
      ) : null}

      {detail && effectiveTab === "grid" ? (
        grid ? (
          <Occupancy
            canManage={canManage}
            cells={grid.cells}
            counts={grid.counts}
            key={`${current.id}-${props.revision}`}
            onOpen={(cell) =>
              onOpenAddress({
                addressId: cell.record?.id ?? null,
                ip: cell.record ? null : cell.address,
                vrfId: current.vrfId,
              })
            }
            onReserve={(addresses) => reserve(addresses[0] ?? null, addresses)}
          />
        ) : (
          <div
            aria-hidden="true"
            className="ipam-skeleton ipam-skeleton--grid"
          />
        )
      ) : null}

      {detail && effectiveTab === "addresses" ? (
        <AddressList
          canManage={canManage}
          cells={grid?.cells ?? null}
          detail={detail}
          onAdd={() =>
            onDialog({
              kind: "address",
              initial: { address: "", vrfId: current.vrfId },
            })
          }
          onOpen={(address) =>
            onOpenAddress({
              addressId: address.id,
              ip: null,
              vrfId: address.vrfId,
            })
          }
          onOpenFree={(ip) =>
            onOpenAddress({ addressId: null, ip, vrfId: current.vrfId })
          }
          onPage={setPage}
          onReserve={(ip) => reserve(ip)}
          onServerQuery={(value) => {
            setPage(0);
            setServerQuery(value);
          }}
          page={page}
          serverQuery={serverQuery}
        />
      ) : null}

      {effectiveTab === "trend" ? (
        history.data ? (
          <TrendSection history={history.data} />
        ) : history.error ? (
          <p className="ipam-muted">{history.error}</p>
        ) : (
          <div
            aria-hidden="true"
            className="ipam-skeleton ipam-skeleton--chart"
          />
        )
      ) : null}

      {detail && effectiveTab === "findings" ? (
        openFindings.length === 0 ? (
          <p className="ipam-empty ipam-empty--ok">
            Keine offenen Funde in diesem Subnetz. Discovery und Agent melden
            hier Ghost-IPs, Konflikte und DNS-Abweichungen.
          </p>
        ) : (
          <ul className="ipam-finding-cards">
            {openFindings.map((finding) => (
              <li className={`is-${finding.severity}`} key={finding.id}>
                <b>{FINDING_KIND_LABEL[finding.kind] ?? finding.kind}</b>
                <button
                  className="text-button ipam-mono"
                  onClick={() =>
                    onOpenAddress({
                      addressId: finding.addressId,
                      ip: finding.addressId ? null : finding.address,
                      vrfId: finding.vrfId,
                    })
                  }
                  type="button"
                >
                  {finding.address}
                </button>
                <span className="ipam-muted">
                  seit {formatRelative(finding.firstSeenAt)}
                </span>
                <span className="ipam-toolbar__spacer" />
                <button
                  className="secondary-button"
                  onClick={props.onOpenFindings}
                  type="button"
                >
                  Bearbeiten
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

/** True while the extra pages of a /21–/20 are still loading. */
function allPagesPending(detail: IpamPrefixDetail): boolean {
  const cidr = parseCidrInput(detail.prefix.prefix)?.cidr;
  return Boolean(
    !detail.grid && cidr && cidr.version === 4 && cidr.length >= 20,
  );
}

function TrendSection({ history }: { history: UtilizationHistory }) {
  const first = history.points[0];
  const last = history.points[history.points.length - 1];
  const change = first && last ? last.percent - first.percent : null;
  return (
    <div className="ipam-trendsec">
      {last ? (
        <dl className="ipam-facts">
          <div>
            <dt>Heute</dt>
            <dd>{percentText(last.percent)}</dd>
          </div>
          <div>
            <dt>Vor {history.points.length} Tagen</dt>
            <dd>{first ? percentText(first.percent) : "–"}</dd>
          </div>
          <div>
            <dt>Veränderung</dt>
            <dd>
              {change === null
                ? "–"
                : `${change >= 0 ? "+" : "−"}${Math.abs(Math.round(change))} Punkte`}
            </dd>
          </div>
          <div>
            <dt>Prognose</dt>
            <dd>
              {forecastSentence(history.forecast, history.warningPercent)}
            </dd>
          </div>
        </dl>
      ) : null}
      <TrendChartView history={history} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Occupancy heatmap

const COLUMNS = 16;

function Occupancy({
  canManage,
  cells,
  counts,
  onOpen,
  onReserve,
}: {
  canManage: boolean;
  cells: GridCell[];
  counts: Record<CellState, number>;
  onOpen: (cell: GridCell) => void;
  onReserve: (addresses: string[]) => void;
}) {
  const blocks = useMemo(() => occupancyBlocks(cells), [cells]);
  const [blockIndex, setBlockIndex] = useState(0);
  const block = blocks[Math.min(blockIndex, blocks.length - 1)]!;
  const rows = useMemo(
    () => occupancyRows(cells, block, COLUMNS),
    [cells, block],
  );
  const [focusState, setFocusState] = useState<CellState | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const keys = useGridKeys(block.end - block.start + 1, COLUMNS, block.start);
  const segments = stateSegments(counts);
  const reservable = reservableAddresses(cells, selected);

  const choose = (index: number, extend: boolean, toggleOne: boolean) => {
    setSelected((current) => {
      if (extend && anchor !== null) {
        return new Set([...current, ...rangeIndexes(anchor, index)]);
      }
      const next = new Set(current);
      if (toggleOne || selectMode) {
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      }
      return new Set([index]);
    });
    setAnchor(index);
  };

  const hovered = hover !== null ? cells[hover] : null;
  const hoverRow =
    hover !== null ? Math.floor((hover - block.start) / COLUMNS) : 0;
  const hoverCol = hover !== null ? (hover - block.start) % COLUMNS : 0;

  return (
    <div className="ipam-occ">
      {blocks.length > 1 ? (
        <div
          className="ipam-occ__zoom"
          role="group"
          aria-label="Bereich wählen (Zoom je /24)"
        >
          {blocks.map((entry) => (
            <button
              aria-pressed={entry.index === block.index}
              className={`ipam-occ__block${entry.index === block.index ? " is-on" : ""}`}
              key={entry.index}
              onClick={() => {
                setBlockIndex(entry.index);
                setHover(null);
              }}
              type="button"
            >
              <span className="ipam-mono">{entry.label}</span>
              <span className="ipam-occ__mini" aria-hidden="true">
                <span
                  style={{ width: `${Math.min(100, entry.usedPercent)}%` }}
                />
              </span>
              <small>
                {percentText(entry.usedPercent)} belegt
                {entry.alerts ? (
                  <b className="ipam-occ__alert">
                    {" "}
                    · {entry.alerts} Fund{entry.alerts === 1 ? "" : "e"}
                  </b>
                ) : null}
              </small>
            </button>
          ))}
        </div>
      ) : null}

      <div
        className="ipam-occ__legend"
        role="group"
        aria-label="Legende – anklicken hebt hervor"
      >
        {segments.map((segment) => (
          <button
            aria-pressed={focusState === segment.state}
            className={`ipam-occ__key${focusState === segment.state ? " is-on" : ""}`}
            key={segment.state}
            onClick={() =>
              setFocusState(focusState === segment.state ? null : segment.state)
            }
            type="button"
          >
            <i
              aria-hidden="true"
              className={`ipam-swatch ipam-swatch--${STATE_TONE[segment.state]}`}
            />
            {segment.label}
            <b>{segment.count}</b>
          </button>
        ))}
        <span className="ipam-toolbar__spacer" />
        {canManage ? (
          <button
            aria-pressed={selectMode}
            className="secondary-button ipam-btn-small"
            onClick={() => {
              setSelectMode(!selectMode);
              setSelected(new Set());
              setAnchor(null);
            }}
            type="button"
          >
            <SquareCheck aria-hidden="true" size={14} />
            {selectMode ? "Auswahl beenden" : "Bereich wählen"}
          </button>
        ) : null}
      </div>

      <div className="ipam-occ__frame">
        <div
          aria-label={`Belegung ${block.label}`}
          className={`ipam-occ__grid${focusState ? " has-focus" : ""}`}
          onKeyDown={(event) => {
            keys.onKeyDown(event);
            if (event.key === "Escape") {
              setSelected(new Set());
              setAnchor(null);
            }
          }}
          onMouseLeave={() => setHover(null)}
          role="grid"
        >
          <div className="ipam-occ__row ipam-occ__row--head" role="row">
            <span className="ipam-occ__rowlabel" role="columnheader">
              <span className="sr-only">Zeile</span>
            </span>
            {Array.from({ length: COLUMNS }, (_, column) => (
              <span
                className="ipam-occ__colhead"
                key={column}
                role="columnheader"
              >
                +{column}
              </span>
            ))}
          </div>
          {rows.map((row) => (
            <div className="ipam-occ__row" key={row.start} role="row">
              <span
                className="ipam-occ__rowlabel ipam-mono"
                role="rowheader"
                title={row.first}
              >
                {row.label}
              </span>
              {row.indexes.map((index) => {
                const cell = cells[index]!;
                const isSelected = selected.has(index);
                return (
                  <span key={index} role="gridcell">
                    <button
                      aria-label={`${cellSummary(cell)}${isSelected ? " (ausgewählt)" : ""}`}
                      aria-pressed={selectMode ? isSelected : undefined}
                      className={`ipam-occ__cell ipam-swatch--${STATE_TONE[cell.state]}${isSelected ? " is-selected" : ""}${focusState && focusState !== cell.state ? " is-dim" : ""}`}
                      data-cell={index}
                      onBlur={() => setHover(null)}
                      onClick={(event) => {
                        if (
                          selectMode ||
                          event.shiftKey ||
                          event.ctrlKey ||
                          event.metaKey
                        ) {
                          if (!canManage) return onOpen(cell);
                          choose(
                            index,
                            event.shiftKey,
                            event.ctrlKey || event.metaKey,
                          );
                        } else {
                          setSelected(new Set());
                          onOpen(cell);
                        }
                      }}
                      onFocus={() => setHover(index)}
                      onKeyDown={(event) => {
                        if (event.key === " " && canManage) {
                          event.preventDefault();
                          choose(index, event.shiftKey, true);
                        }
                      }}
                      onMouseEnter={() => setHover(index)}
                      tabIndex={index === keys.focus ? 0 : -1}
                      type="button"
                    />
                  </span>
                );
              })}
            </div>
          ))}
          {hovered ? (
            <CellTip
              cell={hovered}
              column={hoverCol}
              row={hoverRow}
              rows={rows.length}
            />
          ) : null}
        </div>
      </div>

      {selected.size > 0 ? (
        <div className="ipam-occ__selection" role="region" aria-label="Auswahl">
          <span>
            <b>{selected.size}</b>{" "}
            {selected.size === 1 ? "Adresse" : "Adressen"} ausgewählt
            {reservable.length ? (
              <>
                {" · "}
                <span className="ipam-mono">{rangeText(reservable)}</span>
              </>
            ) : null}
            {reservable.length < selected.size ? (
              <small className="ipam-muted">
                {" "}
                (belegte Adressen werden übersprungen)
              </small>
            ) : null}
          </span>
          <span className="ipam-toolbar__spacer" />
          <button
            className="text-button"
            onClick={() => {
              setSelected(new Set());
              setAnchor(null);
            }}
            type="button"
          >
            Auswahl aufheben
          </button>
          <button
            className="primary-button"
            disabled={!reservable.length}
            onClick={() => onReserve(reservable)}
            type="button"
          >
            {reservable.length > 1
              ? `${reservable.length} Adressen reservieren …`
              : "Reservieren …"}
          </button>
        </div>
      ) : (
        <p className="ipam-occ__hint">
          Klick öffnet die Adresse · Pfeiltasten bewegen
          {canManage
            ? " · Umschalt-Klick oder «Bereich wählen» markiert mehrere freie Adressen zum Reservieren"
            : ""}
        </p>
      )}
    </div>
  );
}

function CellTip({
  cell,
  column,
  row,
  rows,
}: {
  cell: GridCell;
  column: number;
  row: number;
  rows: number;
}) {
  const record = cell.record;
  const below = row < 3;
  const style = {
    "--col": column,
    "--row": row + 1,
    "--rows": rows + 1,
  } as CSSProperties;
  return (
    <div
      aria-hidden="true"
      className={`ipam-occ__tip${below ? " is-below" : ""}${column > 9 ? " is-left" : ""}`}
      style={style}
    >
      <div className="ipam-occ__tiphead">
        <strong className="ipam-mono">{cell.address}</strong>
        <span className={`ipam-chip ipam-chip--${STATE_TONE[cell.state]}`}>
          {CELL_LABEL[cell.state]}
        </span>
      </div>
      {cell.finding ? (
        <p className="ipam-occ__tipalert">
          {FINDING_KIND_LABEL[cell.finding.kind] ?? cell.finding.kind}
        </p>
      ) : null}
      {record ? (
        <dl>
          {record.hostname ? (
            <>
              <dt>Host</dt>
              <dd>{record.hostname}</dd>
            </>
          ) : null}
          {record.macAddress ? (
            <>
              <dt>MAC</dt>
              <dd className="ipam-mono">{record.macAddress.toLowerCase()}</dd>
            </>
          ) : null}
          {record.switchName ? (
            <>
              <dt>Port</dt>
              <dd>
                {record.switchName}
                {record.switchPort ? ` · ${record.switchPort}` : ""}
              </dd>
            </>
          ) : null}
          {record.description ? (
            <>
              <dt>Zweck</dt>
              <dd>{record.description}</dd>
            </>
          ) : null}
          <dt>Gesehen</dt>
          <dd>{formatRelative(record.lastSeenAt)}</dd>
        </dl>
      ) : (
        <p className="ipam-muted">
          {cell.state === "free"
            ? "Frei – anklicken zum Reservieren"
            : cell.state === "dhcp"
              ? "Im DHCP-Pool, vom Server vergeben"
              : cell.state === "network"
                ? "Netz- bzw. Broadcastadresse, nicht vergebbar"
                : CELL_LABEL[cell.state]}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Address list

type ListFilterKey =
  "all" | "active" | "reserved" | "dhcp" | "deprecated" | "findings";

const LIST_FILTERS: { key: ListFilterKey; label: string }[] = [
  { key: "all", label: "Alle" },
  { key: "active", label: "Aktiv" },
  { key: "reserved", label: "Reserviert" },
  { key: "dhcp", label: "DHCP" },
  { key: "deprecated", label: "Veraltet" },
  { key: "findings", label: "Mit Fund" },
];

function matchesFilter(
  address: IpamAddress | null,
  finding: boolean,
  key: ListFilterKey,
) {
  if (key === "all") return true;
  if (key === "findings") return finding;
  return address?.status === key;
}

function AddressList({
  canManage,
  cells,
  detail,
  onAdd,
  onOpen,
  onOpenFree,
  onPage,
  onReserve,
  onServerQuery,
  page,
  serverQuery,
}: {
  canManage: boolean;
  cells: GridCell[] | null;
  detail: IpamPrefixDetail;
  onAdd: () => void;
  onOpen: (address: IpamAddress) => void;
  onOpenFree: (ip: string) => void;
  onPage: (page: number) => void;
  onReserve: (ip: string) => void;
  onServerQuery: (value: string) => void;
  page: number;
  serverQuery: string;
}) {
  const [text, setText] = useState(serverQuery);
  const [status, setStatus] = useState<ListFilterKey>("all");
  const [showFree, setShowFree] = useState(true);
  const local = cells !== null;
  const term = text.trim();
  const findingAddresses = new Set(
    detail.findings
      .filter((entry) => entry.status === "open")
      .map((entry) => entry.address),
  );

  type Row =
    | {
        kind: "address";
        key: string;
        address: IpamAddress;
        finding: boolean;
        state: CellState | null;
      }
    | { kind: "free"; key: string; from: string; to: string; count: number };
  let rows: Row[];
  if (local) {
    const filtering = Boolean(term) || status !== "all";
    rows = addressListRows(
      cells!,
      (cell) =>
        Boolean(cell.record) &&
        cellMatches(cell, term) &&
        matchesFilter(cell.record, Boolean(cell.finding), status),
      showFree && !filtering,
    ).map((row) =>
      row.kind === "free"
        ? {
            kind: "free",
            key: row.key,
            from: row.from,
            to: row.to,
            count: row.count,
          }
        : {
            kind: "address",
            key: row.cell.address,
            address: row.cell.record!,
            finding: Boolean(row.cell.finding),
            state: row.cell.state,
          },
    );
  } else {
    rows = detail.addresses
      .filter((address) =>
        matchesFilter(address, findingAddresses.has(address.address), status),
      )
      .map((address) => ({
        kind: "address",
        key: address.id,
        address,
        finding: findingAddresses.has(address.address),
        state: null,
      }));
  }
  const addressCount = rows.filter((row) => row.kind === "address").length;

  return (
    <div className="ipam-alist">
      <form
        className="ipam-alist__bar"
        onSubmit={(event) => {
          event.preventDefault();
          if (!local) onServerQuery(term);
        }}
        role="search"
      >
        <input
          aria-label="Adressen filtern"
          onChange={(event) => setText(event.target.value)}
          placeholder={
            local
              ? "IP, Hostname, MAC, Hersteller …"
              : "Hostname, DNS-Name, Hersteller … (Enter)"
          }
          spellCheck={false}
          type="search"
          value={text}
        />
        <div className="ipam-chips" role="group" aria-label="Status">
          {LIST_FILTERS.map((entry) => (
            <button
              aria-pressed={status === entry.key}
              className={status === entry.key ? "is-active" : ""}
              key={entry.key}
              onClick={() => setStatus(entry.key)}
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>
        {local ? (
          <label className="ipam-check">
            <input
              checked={showFree}
              onChange={(event) => setShowFree(event.target.checked)}
              type="checkbox"
            />
            Freie Bereiche zeigen
          </label>
        ) : null}
        {canManage ? (
          <button className="secondary-button" onClick={onAdd} type="button">
            <Plus aria-hidden="true" size={14} /> Adresse erfassen
          </button>
        ) : null}
      </form>
      {addressCount === 0 && !rows.length ? (
        <p className="ipam-empty">
          {term || status !== "all"
            ? "Keine Adressen für diesen Filter."
            : "Noch keine Adressen erfasst. Reservieren Sie die nächste freie Adresse oder übernehmen Sie Listen über «Verwaltung → Import»."}
        </p>
      ) : (
        <div className="ipam-table-wrap ipam-table-wrap--sticky">
          <table className="ipam-table ipam-alist__table">
            <thead>
              <tr>
                <th>IP-Adresse</th>
                <th>Status</th>
                <th>Hostname</th>
                <th>MAC</th>
                <th>Switch-Port</th>
                <th>Gesehen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) =>
                row.kind === "free" ? (
                  <tr className="ipam-alist__free" key={row.key}>
                    <td colSpan={4}>
                      <span className="ipam-mono">
                        {row.count === 1 ? row.from : `${row.from} – ${row.to}`}
                      </span>
                      <span className="ipam-chip ipam-chip--free">
                        {row.count} frei
                      </span>
                    </td>
                    <td colSpan={2} className="ipam-alist__freeactions">
                      {canManage ? (
                        <button
                          aria-label={`${row.from} reservieren`}
                          className="text-button"
                          onClick={() => onReserve(row.from)}
                          type="button"
                        >
                          Erste reservieren
                        </button>
                      ) : (
                        <button
                          className="text-button"
                          onClick={() => onOpenFree(row.from)}
                          type="button"
                        >
                          Ansehen
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  <AddressRow
                    address={row.address}
                    finding={row.finding}
                    gateway={detail.prefix.gateway}
                    key={row.key}
                    onOpen={onOpen}
                    state={row.state}
                  />
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      {!local && detail.pageSize && detail.total > detail.pageSize ? (
        <div className="ipam-pager">
          <button
            className="secondary-button"
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
            type="button"
          >
            Zurück
          </button>
          <span>
            Seite {page + 1} von {Math.ceil(detail.total / detail.pageSize)}
          </span>
          <button
            className="secondary-button"
            disabled={(page + 1) * detail.pageSize >= detail.total}
            onClick={() => onPage(page + 1)}
            type="button"
          >
            Weiter
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AddressRow({
  address,
  finding,
  gateway,
  onOpen,
  state,
}: {
  address: IpamAddress;
  finding: boolean;
  gateway: string | null;
  onOpen: (address: IpamAddress) => void;
  state: CellState | null;
}) {
  const chipState: CellState =
    state && (state === "conflict" || state === "ghost")
      ? state
      : address.status === "deprecated"
        ? "deprecated"
        : address.status;
  return (
    <tr
      className="ipam-alist__row"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        onOpen(address);
      }}
    >
      <td>
        <span className="ipam-alist__ip">
          <button
            className="text-button ipam-mono"
            onClick={() => onOpen(address)}
            type="button"
          >
            {address.address}
          </button>
          <CopyButton value={address.address} />
        </span>
      </td>
      <td>
        <span className={`ipam-chip ipam-chip--${STATE_TONE[chipState]}`}>
          {chipState === "conflict" || chipState === "ghost"
            ? CELL_LABEL[chipState]
            : ADDRESS_STATUS_LABEL[address.status]}
        </span>
        {address.status === "reserved" && address.reservedUntil ? (
          <small className="ipam-muted">
            {" "}
            bis {new Date(address.reservedUntil).toLocaleDateString("de-CH")}
          </small>
        ) : null}
        {finding && chipState !== "conflict" && chipState !== "ghost" ? (
          <span className="ipam-chip ipam-chip--ghost">Fund</span>
        ) : null}
      </td>
      <td>
        <span className="ipam-alist__host">
          {address.hostname ?? (address.address === gateway ? "Gateway" : "–")}
          {address.description ? <small>{address.description}</small> : null}
        </span>
      </td>
      <td className="ipam-mono ipam-alist__mac">
        {address.macAddress?.toLowerCase() ?? "–"}
      </td>
      <td>
        {address.switchName
          ? `${address.switchName}${address.switchPort ? ` · ${address.switchPort}` : ""}`
          : "–"}
      </td>
      <td className="ipam-alist__seen">{formatRelative(address.lastSeenAt)}</td>
    </tr>
  );
}
