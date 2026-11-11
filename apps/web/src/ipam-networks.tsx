// IPAM «Netze»: Baum (Hierarchie / nach Standort) mit Filtern und
// Mehrfachauswahl, Supernetz-Detail mit Adressraum-Karte und Subnetz-Detail
// mit Belegung, Adressen, Verlauf & Prognose und Funden.

import {
  Archive,
  Pencil,
  Plus,
  Scissors,
  Sparkles,
  SquareCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Meter,
  Notice,
  Pill,
  Segmented,
  SubTabs,
  errorText,
  useIpamQuery,
  type IpamDialog,
  type IpamDrawer,
} from "./ipam-ui";
import { ipamCall } from "./lib/ipam-api";
import {
  barTicks,
  cidrLength,
  formatCountText,
  gapLengths,
  hostsForLength,
  segmentShares,
} from "./lib/ipam-calc";
import { formatCidr, formatCount, parseCidrInput } from "./lib/ipam-cidr";
import { forecastSentence, historyChart, percentText } from "./lib/ipam-format";
import {
  ADDRESS_STATUS_LABEL,
  buildGrid,
  CELL_LABEL,
  CELL_ORDER,
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

type Props = {
  canManage: boolean;
  onChanged: (message?: string) => void;
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

export function IpamNetworksPage(props: Props) {
  const { canManage, onDialog, onSelect, overview, selectedPrefixId } = props;
  const [grouping, setGrouping] = useState<TreeGrouping>("tree");
  const [filter, setFilter] = useState<TreeFilter>(EMPTY_TREE_FILTER);
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
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
  const selected =
    overview.prefixes.find((prefix) => prefix.id === selectedPrefixId) ?? null;

  useEffect(() => {
    if (selectedPrefixId || !overview.prefixes.length) return;
    const first =
      overview.prefixes.find(
        (prefix) => prefix.status === "container" && !prefix.parentId,
      ) ?? overview.prefixes.find((prefix) => prefix.status !== "deprecated");
    if (first) onSelect(first.id);
  }, [overview.prefixes, selectedPrefixId, onSelect]);

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

  return (
    <div className="ipam-page">
      <div className="ipam-card ipam-toolbar">
        <Segmented
          label="Ansicht"
          onChange={setGrouping}
          options={[
            { value: "tree", label: "Hierarchie" },
            { value: "site", label: "Nach Standort" },
          ]}
          value={grouping}
        />
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
      </div>

      {selectMode && checked.size > 0 ? (
        <BulkBar
          ids={[...checked]}
          onDone={(message) => {
            setChecked(new Set());
            setSelectMode(false);
            props.onChanged(message);
          }}
          overview={overview}
          tenantId={props.tenantId}
          zones={zones}
        />
      ) : null}

      <div className="ipam-split">
        <nav aria-label="Netze" className="ipam-card ipam-tree2">
          {tree.rows.length === 0 ? (
            <p className="ipam-muted">Keine Netze für diesen Filter.</p>
          ) : null}
          {tree.rows.map((row) =>
            row.kind === "header" ? (
              <div className="ipam-tree2__header" key={row.key}>
                {row.label}
              </div>
            ) : (
              <div
                className="ipam-tree2__row"
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
                ) : null}
                <button
                  aria-current={
                    row.prefix.id === selectedPrefixId ? "true" : undefined
                  }
                  className={`ipam-tree2__node${row.prefix.id === selectedPrefixId ? " is-active" : ""}${row.context ? " is-context" : ""}`}
                  onClick={() => onSelect(row.prefix.id)}
                  type="button"
                >
                  <span className="ipam-tree2__text">
                    <span className="ipam-tree2__line">
                      <span
                        className={`ipam-mono${row.prefix.status === "deprecated" ? " is-deprecated" : ""}`}
                      >
                        {row.prefix.prefix}
                      </span>
                      {row.vlan ? (
                        <span className="ipam-tag">
                          VLAN {row.vlan.vlanNumber}
                        </span>
                      ) : null}
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
                      {row.prefix.description ??
                        row.vlan?.name ??
                        prefixStatusLabel(row.prefix.status)}
                    </small>
                  </span>
                  {row.prefix.usage ? (
                    <Meter
                      label={row.prefix.prefix}
                      percent={row.prefix.usage.percent}
                      warningPercent={row.prefix.utilizationWarningPercent}
                    />
                  ) : null}
                </button>
              </div>
            ),
          )}
          {tree.hiddenDeprecated > 0 && grouping === "tree" ? (
            <button
              className="text-button ipam-tree2__more"
              onClick={() => setFilter({ ...filter, showDeprecated: true })}
              type="button"
            >
              {tree.hiddenDeprecated === 1
                ? "1 veraltetes Netz ausgeblendet – anzeigen"
                : `${tree.hiddenDeprecated} veraltete Netze ausgeblendet – anzeigen`}
            </button>
          ) : null}
        </nav>

        <section className="ipam-split__main">
          {selected ? (
            selected.status === "container" ||
            hasChildren(overview.prefixes, selected.id) ? (
              <SupernetDetail {...props} key={selected.id} prefix={selected} />
            ) : (
              <SubnetDetail {...props} key={selected.id} prefix={selected} />
            )
          ) : (
            <div className="ipam-card">
              <p className="ipam-muted">Wählen Sie links ein Netz.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bulk edit

function BulkBar({
  ids,
  onDone,
  overview,
  tenantId,
  zones,
}: {
  ids: string[];
  onDone: (message: string) => void;
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

function makeArchive(
  prefix: IpamPrefix,
  tenantId: string,
  onChanged: (message?: string) => void,
  setError: (message: string) => void,
) {
  return async () => {
    if (
      !window.confirm(
        `${prefix.prefix} archivieren? Das Netz wird als «Veraltet» markiert; Adressen und Verlauf bleiben erhalten.`,
      )
    )
      return;
    try {
      await ipamCall({
        type: "delete",
        tenantId,
        entity: "prefix",
        id: prefix.id,
      });
      onChanged(`${prefix.prefix} archiviert.`);
    } catch (failure) {
      setError(errorText(failure, "Das Netz konnte nicht archiviert werden."));
    }
  };
}

// ---------------------------------------------------------------------------
// Supernet

type DetailProps = Props & { prefix: IpamPrefix };

function SupernetDetail(props: DetailProps) {
  const { canManage, onDialog, onOpenPlanner, overview, prefix, tenantId } =
    props;
  const [error, setError] = useState<string | null>(null);
  const [gap, setGap] = useState<AddressSegment | null>(null);
  const space = useIpamQuery<AddressSpace>(
    { type: "addressSpace", tenantId, prefixId: prefix.id },
    `${prefix.id}-${props.revision}`,
  );
  const site = overview.sites.find((entry) => entry.id === prefix.siteId);
  const children = directChildren(overview.prefixes, prefix.id);
  const archive = makeArchive(prefix, tenantId, props.onChanged, setError);
  return (
    <div className="ipam-card ipam-detail2">
      <header className="ipam-detail2__head">
        <div>
          <div className="ipam-detail2__title">
            <h3 className="ipam-mono">{prefix.prefix}</h3>
            <Pill tone={STATUS_TONE[prefix.status]}>
              {prefixStatusLabel(prefix.status)}
            </Pill>
          </div>
          <p>
            {[prefix.description, site?.name ?? "alle Standorte"]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {canManage ? (
          <div className="ipam-detail2__actions">
            <button
              className="secondary-button"
              onClick={() => onDialog({ kind: "prefix", prefix })}
              type="button"
            >
              <Pencil aria-hidden="true" size={15} /> Bearbeiten
            </button>
            <button
              className="secondary-button"
              onClick={() => onOpenPlanner(prefix.id)}
              type="button"
            >
              Im Planer aufteilen
            </button>
            {prefix.status !== "deprecated" ? (
              <button
                aria-label="Netz archivieren"
                className="icon-button"
                onClick={() => void archive()}
                title="Archivieren"
                type="button"
              >
                <Archive aria-hidden="true" size={16} />
              </button>
            ) : null}
          </div>
        ) : null}
      </header>
      <Notice error={error ?? space.error} />
      {prefix.notes ? <p className="ipam-note">{prefix.notes}</p> : null}

      {space.data ? (
        <>
          <div className="ipam-stats">
            <div>
              <span>Vergeben an Subnetze</span>
              <strong>{percentText(space.data.allocatedPercent)}</strong>
            </div>
            <div>
              <span>Frei</span>
              <strong>{formatCountText(space.data.freeTotal)}</strong>
              <small>
                Adressen in{" "}
                {space.data.segments.filter((s) => s.kind === "free").length}{" "}
                Blöcken
              </small>
            </div>
            <div>
              <span>Grösster freier Block</span>
              <strong className="ipam-mono">
                {space.data.largestFree ?? "–"}
              </strong>
            </div>
            <div>
              <span>Teilnetze</span>
              <strong>{space.data.childCount}</strong>
            </div>
          </div>
          <AddressSpaceMap
            canManage={canManage}
            gap={gap}
            onGap={setGap}
            onSelect={props.onSelect}
            space={space.data}
          />
          {gap && canManage ? (
            <GapPanel
              gap={gap}
              key={gap.cidr}
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
        <p className="ipam-muted">Adressraum wird berechnet …</p>
      ) : null}

      {children.length ? (
        <div className="ipam-table-wrap">
          <table className="ipam-table ipam-table--wide">
            <thead>
              <tr>
                <th>Teilnetz</th>
                <th>Name</th>
                <th>Standort</th>
                <th>Teilnetze</th>
                <th className="ipam-col-meter">Belegt</th>
              </tr>
            </thead>
            <tbody>
              {children.map((child) => (
                <tr key={child.id}>
                  <td>
                    <button
                      className="text-button ipam-mono"
                      onClick={() => props.onSelect(child.id)}
                      type="button"
                    >
                      {child.prefix}
                    </button>
                  </td>
                  <td>
                    {child.description ?? prefixStatusLabel(child.status)}
                  </td>
                  <td>
                    {overview.sites.find((entry) => entry.id === child.siteId)
                      ?.name ?? "–"}
                  </td>
                  <td>{descendantCount(overview.prefixes, child.id)}</td>
                  <td>
                    <Meter
                      label={child.prefix}
                      percent={child.usage?.percent ?? null}
                      warningPercent={child.utilizationWarningPercent}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function AddressSpaceMap({
  canManage,
  gap,
  onGap,
  onSelect,
  space,
}: {
  canManage: boolean;
  gap: AddressSegment | null;
  onGap: (segment: AddressSegment) => void;
  onSelect: (prefixId: string) => void;
  space: AddressSpace;
}) {
  const shares = segmentShares(space.prefix, space.segments);
  return (
    <div className="ipam-map">
      <div className="ipam-map__head">
        <h4>Adressraum-Karte</h4>
        {canManage ? (
          <span className="ipam-muted">
            Klick auf einen freien Block legt dort ein Subnetz an
          </span>
        ) : null}
      </div>
      <div className="ipam-map__bar">
        {space.segments.map((segment, index) => {
          const share = shares[index] ?? 0;
          const style = { flexGrow: Math.max(share, 0.004) };
          const wide = share >= 0.06;
          if (segment.kind === "free") {
            return (
              <button
                aria-label={`Freier Block ${segment.cidr}, ${formatCountText(segment.size)} Adressen`}
                aria-pressed={gap?.cidr === segment.cidr}
                className={`ipam-map__free${gap?.cidr === segment.cidr ? " is-on" : ""}`}
                disabled={!canManage}
                key={`f-${segment.cidr}`}
                onClick={() => onGap(segment)}
                style={style}
                title={`${segment.cidr} frei`}
                type="button"
              >
                {wide ? "frei" : ""}
              </button>
            );
          }
          return (
            <button
              aria-label={`${segment.cidr}${segment.name ? ` ${segment.name}` : ""}`}
              className={`ipam-map__child ipam-map__child--c${index % 6}${segment.status === "deprecated" ? " is-deprecated" : ""}`}
              key={`c-${segment.cidr}`}
              onClick={() => segment.prefixId && onSelect(segment.prefixId)}
              style={style}
              title={`${segment.cidr}${segment.name ? ` ${segment.name}` : ""}${segment.percent !== undefined ? ` · ${percentText(segment.percent)}` : ""}`}
              type="button"
            >
              {wide ? (
                <>
                  <span>{segment.name ?? segment.siteName ?? ""}</span>
                  <span className="ipam-mono">{segment.cidr}</span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
      <div aria-hidden="true" className="ipam-map__ticks ipam-mono">
        {barTicks(space.prefix).map((tick) => (
          <span key={tick}>{tick}</span>
        ))}
      </div>
      {space.truncated ? (
        <p className="ipam-muted">
          Sehr viele Teilnetze: Die Karte zeigt nur die ersten 512 Blöcke.
        </p>
      ) : null}
    </div>
  );
}

function GapPanel({
  gap,
  onCreate,
}: {
  gap: AddressSegment;
  onCreate: (cidr: string) => void;
}) {
  const lengths = gapLengths(gap.cidr);
  const gapLength = cidrLength(gap.cidr) ?? 24;
  const v4 = !gap.cidr.includes(":");
  const [length, setLength] = useState(
    v4 ? Math.max(gapLength, 24) : Math.max(gapLength, 64),
  );
  const parsed = parseCidrInput(gap.cidr)?.cidr;
  const proposal = parsed ? formatCidr({ ...parsed, length }) : gap.cidr;
  return (
    <div className="ipam-gap">
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subnet

type SubTab = "grid" | "addresses" | "trend" | "findings";

function SubnetDetail(props: DetailProps) {
  const { canManage, onDialog, onOpenAddress, overview, prefix, tenantId } =
    props;
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const detailQuery = useIpamQuery<IpamPrefixDetail>(
    {
      type: "prefixDetail",
      tenantId,
      prefixId: prefix.id,
      page,
      query: appliedQuery || null,
    },
    `${prefix.id}-${page}-${appliedQuery}-${props.revision}`,
  );
  const history = useIpamQuery<UtilizationHistory>(
    { type: "utilizationHistory", tenantId, prefixId: prefix.id, days: 90 },
    `${prefix.id}-${props.revision}`,
  );
  const detail = detailQuery.data;
  const current = detail?.prefix ?? prefix;
  const grid = useMemo(
    () =>
      detail?.grid
        ? buildGrid(detail.prefix, detail.addresses, detail.findings)
        : null,
    [detail],
  );
  const openFindings = (detail?.findings ?? []).filter(
    (finding) => finding.status === "open",
  );
  const [tab, setTab] = useState<SubTab>("grid");
  const effectiveTab: SubTab =
    tab === "grid" && detail && !grid ? "addresses" : tab;
  const vlan = overview.vlans.find((entry) => entry.id === current.vlanId);
  const site = overview.sites.find((entry) => entry.id === current.siteId);
  const department = overview.departments.find(
    (entry) => entry.id === current.departmentId,
  );
  const usage = current.usage;
  const archive = makeArchive(current, tenantId, props.onChanged, setError);
  const forecast = history.data
    ? forecastSentence(history.data.forecast, current.utilizationWarningPercent)
    : (forecastText(detail?.forecast, current.utilizationWarningPercent) ??
      "Noch zu wenig Verlauf für eine Prognose.");
  const reserve = (suggestion: string | null) =>
    onDialog({ kind: "reserve", prefix: current, suggestion });

  return (
    <div className="ipam-card ipam-detail2">
      <header className="ipam-detail2__head">
        <div>
          <div className="ipam-detail2__title">
            <h3 className="ipam-mono">{current.prefix}</h3>
            <Pill tone={STATUS_TONE[current.status]}>
              {prefixStatusLabel(current.status)}
            </Pill>
          </div>
          <p>
            {[vlan?.name, current.description].filter(Boolean).join(" · ") ||
              "Ohne Beschreibung"}
          </p>
        </div>
        {canManage ? (
          <div className="ipam-detail2__actions">
            <button
              className="secondary-button"
              onClick={() => onDialog({ kind: "prefix", prefix: current })}
              type="button"
            >
              <Pencil aria-hidden="true" size={15} /> Bearbeiten
            </button>
            <button
              className="secondary-button"
              onClick={() => onDialog({ kind: "split", prefix: current })}
              type="button"
            >
              <Scissors aria-hidden="true" size={15} /> Aufteilen
            </button>
            {current.status !== "deprecated" ? (
              <button
                aria-label="Netz archivieren"
                className="icon-button"
                onClick={() => void archive()}
                title="Archivieren"
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
          </div>
        ) : null}
      </header>

      <ul aria-label="Eigenschaften" className="ipam-chips2">
        <li>
          <b>Gateway</b>
          <span className="ipam-mono">{current.gateway ?? "–"}</span>
        </li>
        <li>
          <b>VLAN</b>
          {vlan ? `${vlan.vlanNumber} ${vlan.name}` : "–"}
        </li>
        <li>
          <b>Zone</b>
          {current.securityZone ?? vlan?.zone ?? "–"}
        </li>
        <li>
          <b>DHCP</b>
          <span className="ipam-mono">
            {current.dhcpStart && current.dhcpEnd
              ? `${current.dhcpStart} – ${current.dhcpEnd}`
              : "–"}
          </span>
        </li>
        <li>
          <b>Standort</b>
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
        </li>
        {overview.departments.length > 1 ? (
          <li>
            <b>Abteilung</b>
            {department?.name ?? "alle"}
          </li>
        ) : null}
      </ul>

      <div className="ipam-usagebox">
        <div>
          <span className="ipam-muted">Auslastung</span>
          <Meter
            percent={usage?.percent ?? null}
            warningPercent={current.utilizationWarningPercent}
          />
          {usage ? (
            <small>
              {usage.used + usage.dhcpSize} von{" "}
              {formatCount(BigInt(usage.capacity || "0"))}
              {usage.dhcpSize ? ` · davon ${usage.dhcpSize} im DHCP-Pool` : ""}
            </small>
          ) : null}
        </div>
        <div>
          <span className="ipam-muted">Prognose</span>
          <strong>{forecast}</strong>
          <small>aus 90 Tagen Verlauf</small>
        </div>
      </div>
      {current.notes ? <p className="ipam-note">{current.notes}</p> : null}

      <Notice error={error ?? detailQuery.error} />

      <SubTabs
        label="Subnetz"
        onChange={setTab}
        tabs={[
          ...(grid || !detail
            ? [{ value: "grid" as const, label: "Belegung" }]
            : []),
          { value: "addresses", label: "Adressen" },
          { value: "trend", label: "Verlauf & Prognose" },
          {
            value: "findings",
            label: `Funde${openFindings.length ? ` (${openFindings.length})` : ""}`,
          },
        ]}
        value={effectiveTab}
      />

      {!detail && !detailQuery.error ? (
        <p className="ipam-muted">Wird geladen …</p>
      ) : null}

      {detail && effectiveTab === "grid" && grid ? (
        <OccupancyGrid
          canManage={canManage}
          cells={grid.cells}
          counts={grid.counts}
          dhcpRange={
            current.dhcpStart && current.dhcpEnd
              ? `${current.dhcpStart} – ${current.dhcpEnd}`
              : null
          }
          onOpen={(cell) =>
            onOpenAddress({
              addressId: cell.record?.id ?? null,
              ip: cell.record ? null : cell.address,
              vrfId: current.vrfId,
            })
          }
          onReserve={(cell) => reserve(cell.address)}
        />
      ) : null}

      {detail && effectiveTab === "addresses" ? (
        <>
          <form
            className="ipam-list-search"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(0);
              setAppliedQuery(query.trim());
            }}
          >
            <input
              aria-label="Adressen filtern"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Hostname, DNS-Name, Hersteller …"
              value={query}
            />
            <button className="secondary-button" type="submit">
              Filtern
            </button>
            {canManage ? (
              <button
                className="text-button"
                onClick={() =>
                  onDialog({
                    kind: "address",
                    initial: { address: "", vrfId: current.vrfId },
                  })
                }
                type="button"
              >
                <Plus aria-hidden="true" size={14} /> Adresse erfassen
              </button>
            ) : null}
          </form>
          <AddressTable
            addresses={detail.addresses}
            gateway={current.gateway}
            onOpen={(address) =>
              onOpenAddress({
                addressId: address.id,
                ip: null,
                vrfId: address.vrfId,
              })
            }
          />
          {detail.pageSize && detail.total > detail.pageSize ? (
            <div className="ipam-pager">
              <button
                className="secondary-button"
                disabled={page === 0}
                onClick={() => setPage((value) => value - 1)}
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
                onClick={() => setPage((value) => value + 1)}
                type="button"
              >
                Weiter
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {effectiveTab === "trend" ? (
        history.data ? (
          <HistoryChartView history={history.data} />
        ) : history.error ? (
          <p className="ipam-muted">{history.error}</p>
        ) : (
          <p className="ipam-muted">Verlauf wird geladen …</p>
        )
      ) : null}

      {detail && effectiveTab === "findings" ? (
        openFindings.length === 0 ? (
          <p className="ipam-muted">Keine offenen Funde in diesem Subnetz.</p>
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
                  Ansehen
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function OccupancyGrid({
  canManage,
  cells,
  counts,
  dhcpRange,
  onOpen,
  onReserve,
}: {
  canManage: boolean;
  cells: GridCell[];
  counts: Record<CellState, number>;
  dhcpRange: string | null;
  onOpen: (cell: GridCell) => void;
  onReserve: (cell: GridCell) => void;
}) {
  const [index, setIndex] = useState<number | null>(null);
  const cell = index !== null ? (cells[index] ?? null) : null;
  return (
    <div className="ipam-occupancy">
      <div className="ipam-occupancy__main">
        <div
          aria-label="Belegungsraster"
          className={`ipam-grid2${cells.length > 256 ? " is-dense" : ""}`}
          role="group"
        >
          {cells.map((entry, position) => {
            const name = entry.record?.hostname ?? null;
            const label = `${entry.address} · ${CELL_LABEL[entry.state]}${name ? ` · ${name}` : ""}`;
            return (
              <button
                aria-label={label}
                aria-pressed={position === index}
                className={`ipam-cell ipam-cell--${entry.state}${position === index ? " is-on" : ""}`}
                key={entry.address}
                onClick={() => setIndex(position)}
                title={label}
                type="button"
              />
            );
          })}
        </div>
        <ul className="ipam-legend">
          {CELL_ORDER.filter((state) => counts[state] > 0).map((state) => (
            <li key={state}>
              <i className={`ipam-cell--${state}`} />
              {CELL_LABEL[state]} {counts[state]}
            </li>
          ))}
        </ul>
      </div>
      <aside className="ipam-occupancy__side" aria-live="polite">
        {cell ? (
          <>
            <strong className="ipam-mono">{cell.address}</strong>
            <span>
              <span className={`ipam-cellbadge ipam-cell--${cell.state}`}>
                {CELL_LABEL[cell.state]}
              </span>
            </span>
            <span className="ipam-muted">
              {cell.finding
                ? (FINDING_KIND_LABEL[cell.finding.kind] ?? cell.finding.kind)
                : cell.record
                  ? [
                      cell.record.hostname,
                      cell.record.macAddress,
                      cell.record.switchName
                        ? `${cell.record.switchName}${cell.record.switchPort ? ` ${cell.record.switchPort}` : ""}`
                        : null,
                      cell.record.lastSeenAt
                        ? formatRelative(cell.record.lastSeenAt)
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Dokumentierte Adresse."
                  : cell.state === "free"
                    ? "Frei – kann reserviert werden."
                    : cell.state === "dhcp"
                      ? `Teil des DHCP-Pools${dhcpRange ? ` (${dhcpRange})` : ""}.`
                      : CELL_LABEL[cell.state]}
            </span>
            {cell.state === "free" && canManage ? (
              <button
                className="primary-button"
                onClick={() => onReserve(cell)}
                type="button"
              >
                Reservieren
              </button>
            ) : cell.state !== "network" ? (
              <button
                className="secondary-button"
                onClick={() => onOpen(cell)}
                type="button"
              >
                Adresse öffnen
              </button>
            ) : null}
          </>
        ) : (
          <span className="ipam-muted">
            Wählen Sie ein Feld, um die Adresse zu sehen.
          </span>
        )}
      </aside>
    </div>
  );
}

function AddressTable({
  addresses,
  gateway,
  onOpen,
}: {
  addresses: IpamAddress[];
  gateway: string | null;
  onOpen: (address: IpamAddress) => void;
}) {
  if (!addresses.length)
    return <p className="ipam-muted">Keine Adressen erfasst.</p>;
  return (
    <div className="ipam-table-wrap">
      <table className="ipam-table ipam-table--wide">
        <thead>
          <tr>
            <th>IP</th>
            <th>Hostname</th>
            <th>MAC</th>
            <th>Switch-Port</th>
            <th>Status</th>
            <th>Gesehen</th>
          </tr>
        </thead>
        <tbody>
          {addresses.map((address) => (
            <tr key={address.id}>
              <td>
                <button
                  className="text-button ipam-mono"
                  onClick={() => onOpen(address)}
                  type="button"
                >
                  {address.address}
                </button>
              </td>
              <td>
                {address.hostname ??
                  (address.address === gateway ? "Gateway" : "–")}
              </td>
              <td className="ipam-mono">
                {address.macAddress?.toLowerCase() ?? "–"}
              </td>
              <td>
                {address.switchName
                  ? `${address.switchName}${address.switchPort ? ` · ${address.switchPort}` : ""}`
                  : "–"}
              </td>
              <td>
                <span className={`ipam-status ipam-status--${address.status}`}>
                  {ADDRESS_STATUS_LABEL[address.status]}
                  {address.status === "reserved" && address.reservedUntil
                    ? ` bis ${new Date(address.reservedUntil).toLocaleDateString("de-CH")}`
                    : ""}
                </span>
              </td>
              <td>{formatRelative(address.lastSeenAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HistoryChartView({ history }: { history: UtilizationHistory }) {
  const chart = historyChart(history, 90);
  if (!history.points.length) {
    return (
      <p className="ipam-muted">
        Noch kein Verlauf. Die Auslastung wird täglich gemessen.
      </p>
    );
  }
  return (
    <figure className="ipam-chart">
      <svg
        aria-label={chart.description}
        role="img"
        viewBox={`0 0 ${chart.width} ${chart.height}`}
      >
        {chart.gridLines.map((line) => (
          <g key={line.label}>
            <line
              className="ipam-chart__grid"
              x1={40}
              x2={chart.width - 10}
              y1={line.y}
              y2={line.y}
            />
            <text
              className="ipam-chart__label"
              textAnchor="end"
              x={34}
              y={line.y + 4}
            >
              {line.label}
            </text>
          </g>
        ))}
        <line
          className="ipam-chart__warn"
          x1={40}
          x2={chart.width - 10}
          y1={chart.warningY}
          y2={chart.warningY}
        />
        <text
          className="ipam-chart__warn-label"
          textAnchor="end"
          x={chart.width - 14}
          y={chart.warningY - 6}
        >
          Warnschwelle {history.warningPercent} %
        </text>
        <polyline className="ipam-chart__line" points={chart.measured} />
        {chart.forecast ? (
          <line
            className="ipam-chart__forecast"
            x1={chart.forecast.x1}
            x2={chart.forecast.x2}
            y1={chart.forecast.y1}
            y2={chart.forecast.y2}
          />
        ) : null}
        {chart.last ? (
          <circle
            className="ipam-chart__dot"
            cx={chart.last.x}
            cy={chart.last.y}
            r={4}
          />
        ) : null}
        <text className="ipam-chart__label" x={40} y={chart.height - 4}>
          {chart.startLabel}
        </text>
        {chart.last && chart.endLabel ? (
          <text
            className="ipam-chart__label"
            textAnchor="middle"
            x={chart.last.x}
            y={chart.height - 4}
          >
            heute
          </text>
        ) : null}
        <text
          className="ipam-chart__label"
          textAnchor="end"
          x={chart.width - 10}
          y={chart.height - 4}
        >
          {chart.endLabel ?? "heute"}
        </text>
      </svg>
      <figcaption className="ipam-muted">
        Durchgezogen: gemessen (täglich) · gestrichelt: Prognose
      </figcaption>
    </figure>
  );
}
