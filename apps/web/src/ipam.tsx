import {
  ArrowRight,
  Download,
  Layers,
  Pencil,
  Plus,
  Scissors,
  Search,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { IpamAddressDrawer } from "./ipam-address-drawer";
import {
  AddressDialog,
  NextPrefixDialog,
  PrefixDialog,
  ReserveDialog,
  SiteDialog,
  SplitDialog,
  VlanDialog,
  VrfDialog,
  type IpamLookups,
} from "./ipam-forms";
import { downloadFile, ipamCall } from "./lib/ipam-api";
import { formatCount } from "./lib/ipam-cidr";
import {
  ADDRESS_STATUS_LABEL,
  buildGrid,
  CELL_LABEL,
  CELL_ORDER,
  FINDING_GROUPS,
  FINDING_KIND_LABEL,
  forecastText,
  formatPercent,
  formatRelative,
  PREFIX_STATUS_LABEL,
  usageTone,
  vlanLabel,
  type IpamAddress,
  type IpamAddressDetail,
  type IpamFile,
  type IpamFinding,
  type IpamOverview,
  type IpamPrefix,
  type IpamPrefixDetail,
  type IpamSite,
  type IpamVlan,
  type IpamVrf,
} from "./lib/ipam-model";
import "./ipam.css";

/** Props of the panels that parts B (Import) and C (Discovery) provide. */
export type IpamPanelProps = {
  tenantId: string;
  canManage: boolean;
  onChanged?: () => void;
};

export type IpamProps = {
  tenantId: string;
  onOpenTicket?: (ticketId: string) => void;
  /** Rendered in the «Import» tab (IpamImportWizard). */
  importPanel?: (props: IpamPanelProps) => ReactNode;
  /** Rendered in the «Discovery» tab (IpamDiscoveryPanel). */
  discoveryPanel?: (props: IpamPanelProps) => ReactNode;
};

type Tab =
  "spaces" | "vlans" | "sites" | "findings" | "import" | "discovery" | "export";

const TABS: { key: Tab; label: string }[] = [
  { key: "spaces", label: "Adressräume" },
  { key: "vlans", label: "VLANs" },
  { key: "sites", label: "Standorte" },
  { key: "findings", label: "Funde" },
  { key: "import", label: "Import" },
  { key: "discovery", label: "Discovery" },
  { key: "export", label: "Export" },
];

type Dialog =
  | { kind: "vrf"; vrf: IpamVrf | null }
  | { kind: "site"; site: IpamSite | null }
  | { kind: "vlan"; vlan: IpamVlan | null }
  | { kind: "prefix"; prefix: IpamPrefix | null }
  | { kind: "reserve"; prefix: IpamPrefix; suggestion: string | null }
  | { kind: "nextPrefix"; parent: IpamPrefix }
  | { kind: "split"; prefix: IpamPrefix }
  | { kind: "address"; initial: Partial<IpamAddress> & { address: string } };

type Drawer = {
  addressId: string | null;
  ip: string | null;
  vrfId: string | null;
};

function errorText(failure: unknown, fallback: string): string {
  return failure instanceof Error ? failure.message : fallback;
}

/** IP-Adressverwaltung: Adressräume, VLANs, Standorte, Funde, Export. */
export function Ipam({
  discoveryPanel,
  importPanel,
  onOpenTicket,
  tenantId,
}: IpamProps) {
  const [overview, setOverview] = useState<IpamOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("spaces");
  const [selectedPrefixId, setSelectedPrefixId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [assets, setAssets] = useState<{ id: string; name: string }[] | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await ipamCall<IpamOverview>({
        type: "overview",
        tenantId,
      });
      setOverview(result);
      setError(null);
    } catch (failure) {
      setError(
        errorText(failure, "Die IP-Adressen konnten nicht geladen werden."),
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  const refresh = useCallback((message?: string) => {
    if (message) setNotice(message);
    setRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const canManage = overview?.canManage === true;
  const lookups: IpamLookups = useMemo(
    () => ({
      vrfs: overview?.vrfs ?? [],
      sites: overview?.sites ?? [],
      vlans: overview?.vlans ?? [],
      departments: overview?.departments ?? [],
      people: overview?.people ?? [],
      teams: overview?.teams ?? [],
      services: overview?.services ?? [],
    }),
    [overview],
  );

  // Assets for the link picker are loaded once, when an address form opens.
  const addressDialogOpen = dialog?.kind === "address";
  useEffect(() => {
    if (!addressDialogOpen || assets !== null) return;
    void ipamCall<{
      assets: { id: string; name: string; assetTag: string | null }[];
    }>({ type: "lookups", tenantId })
      .then((result) =>
        setAssets(
          result.assets.map((asset) => ({
            id: asset.id,
            name: asset.assetTag
              ? `${asset.assetTag} · ${asset.name}`
              : asset.name,
          })),
        ),
      )
      .catch(() => setAssets([]));
  }, [addressDialogOpen, assets, tenantId]);

  const panelProps: IpamPanelProps = {
    tenantId,
    canManage,
    onChanged: () => refresh(),
  };
  const kpis = overview?.kpis;

  return (
    <section aria-labelledby="ipam-heading" className="ipam">
      <header className="ipam__hero">
        <div>
          <p className="eyebrow">DIENSTE &amp; ÜBERWACHUNG</p>
          <h2 id="ipam-heading">IP-Adressen</h2>
          <p>
            Subnetze, VLANs und einzelne Adressen je VRF, mit Belegung, nächster
            freier Adresse und Verknüpfung zu Geräten und Tickets.
          </p>
        </div>
        {canManage ? (
          <span className="ipam__hero-actions">
            <button
              className="secondary-button"
              onClick={() => setDialog({ kind: "vrf", vrf: null })}
              type="button"
            >
              VRF anlegen
            </button>
            <button
              className="primary-button"
              onClick={() => setDialog({ kind: "prefix", prefix: null })}
              type="button"
            >
              <Plus aria-hidden="true" size={16} /> Subnetz anlegen
            </button>
          </span>
        ) : null}
      </header>

      {kpis ? (
        <div className="ipam__kpis">
          <article>
            <p>Subnetze</p>
            <strong>{kpis.prefixCount}</strong>
            <small>
              {kpis.vrfCount + 1}{" "}
              {kpis.vrfCount === 0 ? "Adressraum" : "Adressräume"} (inkl.
              Global)
            </small>
          </article>
          <article>
            <p>IPv4-Adressen in Gebrauch</p>
            <strong>{formatCount(BigInt(kpis.usedV4))}</strong>
            <small>von {formatCount(BigInt(kpis.capacityV4 || "0"))}</small>
          </article>
          <article className={kpis.overWarning ? "is-warn" : ""}>
            <p>Subnetze über Warnschwelle</p>
            <strong>{kpis.overWarning}</strong>
            <small>gelb ab Schwelle, rot ab 95 %</small>
          </article>
          <article
            className={
              kpis.conflicts ? "is-bad" : kpis.openFindings ? "is-warn" : ""
            }
          >
            <p>Offene Funde</p>
            <strong>{kpis.openFindings}</strong>
            <small>
              {kpis.conflicts === 1
                ? "1 Konflikt"
                : `${kpis.conflicts} Konflikte`}
            </small>
          </article>
        </div>
      ) : null}

      <GlobalSearch
        onOpenAddress={(address) =>
          setDrawer({ addressId: address.id, ip: null, vrfId: address.vrfId })
        }
        onOpenPrefix={(prefixId) => {
          setTab("spaces");
          setSelectedPrefixId(prefixId);
        }}
        tenantId={tenantId}
      />

      <div aria-label="Bereiche" className="ipam__tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            aria-selected={tab === entry.key}
            className={tab === entry.key ? "is-active" : ""}
            key={entry.key}
            onClick={() => setTab(entry.key)}
            role="tab"
            type="button"
          >
            {entry.label}
            {entry.key === "findings" && kpis?.openFindings ? (
              <span className="ipam__badge">{kpis.openFindings}</span>
            ) : null}
          </button>
        ))}
      </div>

      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="form-message form-message--success" role="status">
          {notice}
        </p>
      ) : null}

      {loading && !overview ? (
        <p className="empty-state">IP-Adressen werden geladen …</p>
      ) : overview ? (
        <div role="tabpanel">
          {tab === "spaces" ? (
            <AddressSpaces
              canManage={canManage}
              onDialog={setDialog}
              onOpenAddress={(drawerState) => setDrawer(drawerState)}
              onSelect={setSelectedPrefixId}
              overview={overview}
              revision={revision}
              selectedPrefixId={selectedPrefixId}
              tenantId={tenantId}
              onChanged={refresh}
            />
          ) : tab === "vlans" ? (
            <VlanTable
              canManage={canManage}
              onChanged={refresh}
              onDialog={setDialog}
              overview={overview}
              tenantId={tenantId}
            />
          ) : tab === "sites" ? (
            <SiteTable
              canManage={canManage}
              onChanged={refresh}
              onDialog={setDialog}
              overview={overview}
              tenantId={tenantId}
            />
          ) : tab === "findings" ? (
            <Findings
              onChanged={refresh}
              onOpenAddress={(drawerState) => setDrawer(drawerState)}
              onOpenTicket={onOpenTicket}
              revision={revision}
              tenantId={tenantId}
            />
          ) : tab === "import" ? (
            importPanel ? (
              importPanel(panelProps)
            ) : (
              <Placeholder title="Import">
                Hier können Sie bald Subnetze und Adressen aus Excel/CSV,
                phpIPAM oder NetBox übernehmen – mit Spaltenzuordnung, Vorschau
                und Prüfung auf Überlappungen.
              </Placeholder>
            )
          ) : tab === "discovery" ? (
            discoveryPanel ? (
              discoveryPanel(panelProps)
            ) : (
              <Placeholder title="Discovery">
                Scans, Netzwerkagent sowie DHCP- und DNS-Abgleich werden hier
                eingerichtet. Dafür braucht es den nextDesk-Netzwerkagenten in
                Ihrem Netz.
              </Placeholder>
            )
          ) : (
            <ExportPanel overview={overview} tenantId={tenantId} />
          )}
        </div>
      ) : null}

      {drawer ? (
        <IpamAddressDrawer
          addressId={drawer.addressId}
          canManage={canManage}
          ip={drawer.ip}
          key={`${drawer.addressId ?? ""}-${drawer.ip ?? ""}-${revision}`}
          onChanged={(message) => refresh(message)}
          onClose={() => setDrawer(null)}
          onEdit={(detail: IpamAddressDetail) =>
            setDialog({
              kind: "address",
              initial: detail.address ?? {
                address: detail.ip,
                vrfId: detail.vrfId,
              },
            })
          }
          onOpenTicket={onOpenTicket}
          onReserve={(detail) => {
            if (!detail.prefix) {
              setError(
                "Die Adresse liegt in keinem erfassten Subnetz. Bitte erfassen Sie sie direkt.",
              );
              return;
            }
            setDrawer(null);
            setDialog({
              kind: "reserve",
              prefix: detail.prefix,
              suggestion: detail.ip,
            });
          }}
          tenantId={tenantId}
          vrfId={drawer.vrfId}
        />
      ) : null}

      {dialog?.kind === "vrf" ? (
        <VrfDialog
          initial={dialog.vrf}
          onClose={() => setDialog(null)}
          onSaved={refresh}
          tenantId={tenantId}
        />
      ) : null}
      {dialog?.kind === "site" ? (
        <SiteDialog
          initial={dialog.site}
          lookups={lookups}
          onClose={() => setDialog(null)}
          onSaved={refresh}
          tenantId={tenantId}
        />
      ) : null}
      {dialog?.kind === "vlan" ? (
        <VlanDialog
          initial={dialog.vlan}
          lookups={lookups}
          onClose={() => setDialog(null)}
          onSaved={refresh}
          tenantId={tenantId}
        />
      ) : null}
      {dialog?.kind === "prefix" ? (
        <PrefixDialog
          initial={dialog.prefix}
          lookups={lookups}
          onClose={() => setDialog(null)}
          onSaved={(message, id) => {
            setSelectedPrefixId(id);
            setTab("spaces");
            refresh(message);
          }}
          tenantId={tenantId}
        />
      ) : null}
      {dialog?.kind === "reserve" ? (
        <ReserveDialog
          lookups={lookups}
          onClose={() => setDialog(null)}
          onSaved={(message, addressId) => {
            refresh(message);
            setDrawer({ addressId, ip: null, vrfId: dialog.prefix.vrfId });
          }}
          prefix={dialog.prefix}
          suggestion={dialog.suggestion}
          tenantId={tenantId}
        />
      ) : null}
      {dialog?.kind === "nextPrefix" ? (
        <NextPrefixDialog
          lookups={lookups}
          onClose={() => setDialog(null)}
          onSaved={(message, id) => {
            setSelectedPrefixId(id);
            refresh(message);
          }}
          parent={dialog.parent}
          tenantId={tenantId}
        />
      ) : null}
      {dialog?.kind === "split" ? (
        <SplitDialog
          onClose={() => setDialog(null)}
          onSaved={refresh}
          prefix={dialog.prefix}
          tenantId={tenantId}
        />
      ) : null}
      {dialog?.kind === "address" ? (
        <AddressDialog
          assets={assets ?? []}
          initial={dialog.initial}
          lookups={lookups}
          onClose={() => setDialog(null)}
          onSaved={(message, id) => {
            refresh(message);
            setDrawer({
              addressId: id,
              ip: null,
              vrfId: dialog.initial.vrfId ?? null,
            });
          }}
          tenantId={tenantId}
        />
      ) : null}
    </section>
  );
}

function Placeholder({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <div className="ipam-placeholder">
      <Layers aria-hidden="true" size={26} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search

function GlobalSearch({
  onOpenAddress,
  onOpenPrefix,
  tenantId,
}: {
  onOpenAddress: (address: IpamAddress) => void;
  onOpenPrefix: (prefixId: string) => void;
  tenantId: string;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{
    addresses: IpamAddress[];
    prefixes: IpamPrefix[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setError(null);
    try {
      setResult(
        await ipamCall({ type: "search", tenantId, query: query.trim() }),
      );
    } catch (failure) {
      setError(errorText(failure, "Die Suche ist fehlgeschlagen."));
    }
  };
  return (
    <div className="ipam__search">
      <form onSubmit={(event) => void submit(event)} role="search">
        <label>
          <Search aria-hidden="true" size={15} />
          <input
            aria-label="IP-Adressen durchsuchen"
            onChange={(event) => {
              setQuery(event.target.value);
              if (!event.target.value) setResult(null);
            }}
            placeholder="IP, Subnetz, Hostname, MAC …"
            value={query}
          />
        </label>
        <button className="secondary-button" type="submit">
          Suchen
        </button>
      </form>
      {error ? <p className="ipam-muted">{error}</p> : null}
      {result ? (
        <div className="ipam__search-results">
          {result.prefixes.length === 0 && result.addresses.length === 0 ? (
            <p className="ipam-muted">Keine Treffer.</p>
          ) : null}
          {result.prefixes.map((prefix) => (
            <button
              key={prefix.id}
              onClick={() => {
                onOpenPrefix(prefix.id);
                setResult(null);
              }}
              type="button"
            >
              <span className="ipam-mono">{prefix.prefix}</span>
              <small>{prefix.description ?? "Subnetz"}</small>
            </button>
          ))}
          {result.addresses.map((address) => (
            <button
              key={address.id}
              onClick={() => onOpenAddress(address)}
              type="button"
            >
              <span className="ipam-mono">{address.address}</span>
              <small>
                {[
                  address.hostname,
                  ADDRESS_STATUS_LABEL[address.status],
                  address.macAddress,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Address spaces: tree + prefix detail

function UsageBar({ prefix }: { prefix: IpamPrefix }) {
  const percent = prefix.usage?.percent ?? 0;
  const tone = usageTone(
    prefix.usage?.percent,
    prefix.utilizationWarningPercent,
  );
  return (
    <span
      aria-label={`Auslastung ${formatPercent(percent)}`}
      className={`ipam-bar ipam-bar--${tone}`}
      role="img"
      title={`Auslastung ${formatPercent(percent)}`}
    >
      <b
        style={{
          width: `${Math.min(100, Math.max(percent, percent > 0 ? 2 : 0))}%`,
        }}
      />
    </span>
  );
}

function AddressSpaces({
  canManage,
  onChanged,
  onDialog,
  onOpenAddress,
  onSelect,
  overview,
  revision,
  selectedPrefixId,
  tenantId,
}: {
  canManage: boolean;
  onChanged: (message?: string) => void;
  onDialog: (dialog: Dialog) => void;
  onOpenAddress: (drawer: Drawer) => void;
  onSelect: (prefixId: string) => void;
  overview: IpamOverview;
  revision: number;
  selectedPrefixId: string | null;
  tenantId: string;
}) {
  const [showDeprecated, setShowDeprecated] = useState(false);
  const groups = useMemo(() => {
    const visible = overview.prefixes.filter(
      (prefix) => showDeprecated || prefix.status !== "deprecated",
    );
    const vrfs: { id: string | null; name: string; vrf: IpamVrf | null }[] = [
      { id: null, name: "Global", vrf: null },
      ...overview.vrfs.map((vrf) => ({ id: vrf.id, name: vrf.name, vrf })),
    ];
    return vrfs
      .map((group) => ({
        ...group,
        prefixes: visible.filter((prefix) => prefix.vrfId === group.id),
      }))
      .filter(
        (group) => group.id === null || group.prefixes.length || canManage,
      );
  }, [overview, showDeprecated, canManage]);
  const vlans = useMemo(
    () => new Map(overview.vlans.map((vlan) => [vlan.id, vlan])),
    [overview.vlans],
  );
  const selected =
    overview.prefixes.find((prefix) => prefix.id === selectedPrefixId) ?? null;

  useEffect(() => {
    if (!selectedPrefixId) {
      const first =
        overview.prefixes.find(
          (prefix) =>
            prefix.status !== "deprecated" && prefix.status !== "container",
        ) ?? overview.prefixes[0];
      if (first) onSelect(first.id);
    }
  }, [overview.prefixes, selectedPrefixId, onSelect]);

  if (overview.prefixes.length === 0) {
    return (
      <div className="ipam-placeholder">
        <Layers aria-hidden="true" size={26} />
        <h3>Noch keine Subnetze erfasst</h3>
        <p>
          Legen Sie zuerst ein Supernetz (z. B. 10.20.0.0/16) an und teilen Sie
          es danach auf, oder übernehmen Sie bestehende Listen im Tab «Import».
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

  return (
    <div className="ipam-split">
      <nav aria-label="Subnetzbaum" className="ipam-panel ipam-tree">
        <div className="ipam-tree__head">
          <strong>Baum</strong>
          <label>
            <input
              checked={showDeprecated}
              onChange={(event) => setShowDeprecated(event.target.checked)}
              type="checkbox"
            />
            Veraltete
          </label>
        </div>
        {groups.map((group) => (
          <div className="ipam-tree__group" key={group.id ?? "global"}>
            <div className="ipam-tree__vrf">
              <span>VRF · {group.name}</span>
              {canManage && group.vrf ? (
                <button
                  aria-label={`VRF ${group.name} bearbeiten`}
                  className="icon-button"
                  onClick={() => onDialog({ kind: "vrf", vrf: group.vrf })}
                  type="button"
                >
                  <Pencil aria-hidden="true" size={13} />
                </button>
              ) : null}
            </div>
            {group.prefixes.length === 0 ? (
              <p className="ipam-muted ipam-tree__empty">Keine Subnetze</p>
            ) : null}
            {group.prefixes.map((prefix) => {
              const vlan = prefix.vlanId ? vlans.get(prefix.vlanId) : undefined;
              return (
                <button
                  aria-current={
                    prefix.id === selectedPrefixId ? "true" : undefined
                  }
                  className={`ipam-node${prefix.id === selectedPrefixId ? " is-active" : ""}${prefix.status === "deprecated" ? " is-deprecated" : ""}`}
                  key={prefix.id}
                  onClick={() => onSelect(prefix.id)}
                  style={{ paddingLeft: `${8 + (prefix.depth ?? 0) * 14}px` }}
                  type="button"
                >
                  <span className="ipam-node__name">
                    <span className="ipam-mono">{prefix.prefix}</span>
                    <small>
                      {[
                        prefix.description,
                        vlan ? `VLAN ${vlan.vlanNumber}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || PREFIX_STATUS_LABEL[prefix.status]}
                    </small>
                  </span>
                  <UsageBar prefix={prefix} />
                </button>
              );
            })}
          </div>
        ))}
        <p className="ipam-muted ipam-tree__legend">
          Balken: Auslastung, gelb ab Warnschwelle, rot ab 95 %.
        </p>
      </nav>
      {selected ? (
        <PrefixPanel
          canManage={canManage}
          key={selected.id}
          onChanged={onChanged}
          onDialog={onDialog}
          onOpenAddress={onOpenAddress}
          onSelect={onSelect}
          overview={overview}
          prefix={selected}
          revision={revision}
          tenantId={tenantId}
        />
      ) : (
        <div className="ipam-panel">
          <p className="ipam-muted">Wählen Sie links ein Subnetz.</p>
        </div>
      )}
    </div>
  );
}

function PrefixPanel({
  canManage,
  onChanged,
  onDialog,
  onOpenAddress,
  onSelect,
  overview,
  prefix,
  revision,
  tenantId,
}: {
  canManage: boolean;
  onChanged: (message?: string) => void;
  onDialog: (dialog: Dialog) => void;
  onOpenAddress: (drawer: Drawer) => void;
  onSelect: (prefixId: string) => void;
  overview: IpamOverview;
  prefix: IpamPrefix;
  revision: number;
  tenantId: string;
}) {
  const [detail, setDetail] = useState<IpamPrefixDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");

  useEffect(() => {
    let current = true;
    setError(null);
    void ipamCall<IpamPrefixDetail>({
      type: "prefixDetail",
      tenantId,
      prefixId: prefix.id,
      page,
      query: appliedQuery || null,
    })
      .then((result) => {
        if (current) setDetail(result);
      })
      .catch((failure: unknown) => {
        if (current) {
          setError(
            errorText(failure, "Das Subnetz konnte nicht geladen werden."),
          );
        }
      });
    return () => {
      current = false;
    };
  }, [tenantId, prefix.id, page, appliedQuery, revision]);

  const grid = useMemo(
    () =>
      detail?.grid
        ? buildGrid(detail.prefix, detail.addresses, detail.findings)
        : null,
    [detail],
  );
  const current = detail?.prefix ?? prefix;
  const vlan = overview.vlans.find((entry) => entry.id === current.vlanId);
  const site = overview.sites.find((entry) => entry.id === current.siteId);
  const usage = current.usage;
  const forecast = forecastText(
    detail?.forecast,
    current.utilizationWarningPercent,
  );
  const isContainer = current.status === "container";
  const archive = async () => {
    if (
      !window.confirm(
        `${current.prefix} archivieren? Das Subnetz wird als «Veraltet» markiert; Adressen und Verlauf bleiben erhalten.`,
      )
    ) {
      return;
    }
    try {
      await ipamCall({
        type: "delete",
        tenantId,
        entity: "prefix",
        id: current.id,
      });
      onChanged(`${current.prefix} archiviert.`);
    } catch (failure) {
      setError(
        errorText(failure, "Das Subnetz konnte nicht archiviert werden."),
      );
    }
  };

  return (
    <section
      aria-label={`Subnetz ${current.prefix}`}
      className="ipam-panel ipam-detail"
    >
      <header className="ipam-detail__head">
        <div>
          <h3 className="ipam-mono">{current.prefix}</h3>
          <p>
            {[
              vlanLabel(vlan),
              current.description,
              PREFIX_STATUS_LABEL[current.status],
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <dl className="ipam-facts">
            {site ? (
              <div>
                <dt>Standort</dt>
                <dd>{site.name}</dd>
              </div>
            ) : null}
            {current.gateway ? (
              <div>
                <dt>Gateway</dt>
                <dd className="ipam-mono">
                  {current.gateway}
                  {current.gatewayDevice ? ` (${current.gatewayDevice})` : ""}
                </dd>
              </div>
            ) : null}
            {current.dhcpStart && current.dhcpEnd ? (
              <div>
                <dt>DHCP-Pool</dt>
                <dd className="ipam-mono">
                  {current.dhcpStart} – {current.dhcpEnd}
                </dd>
              </div>
            ) : null}
            {current.securityZone ? (
              <div>
                <dt>Zone</dt>
                <dd>{current.securityZone}</dd>
              </div>
            ) : null}
            {usage ? (
              <div>
                <dt>Auslastung</dt>
                <dd>
                  {formatPercent(usage.percent)} ({usage.used + usage.dhcpSize}{" "}
                  von {formatCount(BigInt(usage.capacity))})
                </dd>
              </div>
            ) : null}
          </dl>
          {forecast ? <p className="ipam-forecast">{forecast}</p> : null}
        </div>
        {canManage ? (
          <div className="ipam-detail__actions">
            <button
              aria-label="Subnetz bearbeiten"
              className="icon-button"
              onClick={() => onDialog({ kind: "prefix", prefix: current })}
              title="Bearbeiten"
              type="button"
            >
              <Pencil aria-hidden="true" size={16} />
            </button>
            {current.status !== "deprecated" ? (
              <button
                aria-label="Subnetz archivieren"
                className="icon-button"
                onClick={() => void archive()}
                title="Archivieren"
                type="button"
              >
                <Trash2 aria-hidden="true" size={16} />
              </button>
            ) : null}
            <button
              className="secondary-button"
              onClick={() => onDialog({ kind: "split", prefix: current })}
              type="button"
            >
              <Scissors aria-hidden="true" size={15} /> Aufteilen
            </button>
            <button
              className="secondary-button"
              onClick={() => onDialog({ kind: "nextPrefix", parent: current })}
              type="button"
            >
              Nächstes freies Subnetz
            </button>
            {!isContainer ? (
              <button
                className="primary-button"
                onClick={() =>
                  onDialog({
                    kind: "reserve",
                    prefix: current,
                    suggestion: detail?.nextFree ?? null,
                  })
                }
                type="button"
              >
                Nächste freie IP
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {!isContainer && detail ? (
        <div className="ipam-suggest">
          {detail.nextFree ? (
            <>
              <span>
                Nächste freie Adresse:{" "}
                <strong className="ipam-mono">{detail.nextFree}</strong>
                {current.dhcpStart ? " (ausserhalb des DHCP-Pools)" : ""}
              </span>
              {canManage ? (
                <button
                  className="text-button"
                  onClick={() =>
                    onDialog({
                      kind: "reserve",
                      prefix: current,
                      suggestion: detail.nextFree,
                    })
                  }
                  type="button"
                >
                  Reservieren … <ArrowRight aria-hidden="true" size={14} />
                </button>
              ) : null}
            </>
          ) : (
            <span>In diesem Subnetz ist keine Adresse mehr frei.</span>
          )}
        </div>
      ) : null}

      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
      {!detail && !error ? <p className="ipam-muted">Wird geladen …</p> : null}

      {detail && detail.children.length ? (
        <div className="ipam-children">
          <h4>Teilnetze</h4>
          <ul>
            {detail.children.map((child) => (
              <li key={child.id}>
                <button onClick={() => onSelect(child.id)} type="button">
                  <span className="ipam-mono">{child.prefix}</span>
                  <small>
                    {child.description ?? PREFIX_STATUS_LABEL[child.status]}
                  </small>
                  <UsageBar prefix={child} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {detail && grid ? (
        <>
          <div aria-label="Belegungsraster" className="ipam-grid" role="grid">
            {grid.cells.map((cell) => {
              const name = cell.record?.hostname ?? null;
              const label = `${cell.address} · ${CELL_LABEL[cell.state]}${name ? ` · ${name}` : ""}`;
              const clickable = cell.state !== "network";
              return (
                <button
                  aria-label={label}
                  className={`ipam-cell ipam-cell--${cell.state}`}
                  disabled={!clickable}
                  key={cell.address}
                  onClick={() => {
                    if (cell.record) {
                      onOpenAddress({
                        addressId: cell.record.id,
                        ip: null,
                        vrfId: current.vrfId,
                      });
                    } else if (cell.state === "free" && canManage) {
                      onDialog({
                        kind: "reserve",
                        prefix: current,
                        suggestion: cell.address,
                      });
                    } else {
                      onOpenAddress({
                        addressId: null,
                        ip: cell.address,
                        vrfId: current.vrfId,
                      });
                    }
                  }}
                  title={label}
                  type="button"
                />
              );
            })}
          </div>
          <ul className="ipam-legend">
            {CELL_ORDER.filter((state) => grid.counts[state] > 0).map(
              (state) => (
                <li key={state}>
                  <i className={`ipam-cell--${state}`} />
                  {CELL_LABEL[state]} {grid.counts[state]}
                </li>
              ),
            )}
          </ul>
          <AddressTable
            addresses={detail.addresses}
            onOpen={(address) =>
              onOpenAddress({
                addressId: address.id,
                ip: null,
                vrfId: address.vrfId,
              })
            }
          />
        </>
      ) : null}

      {detail && !detail.grid ? (
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
          {detail.addresses.length === 0 ? (
            <p className="ipam-muted">
              {isContainer
                ? "Supernetz: Adressen werden in den Teilnetzen geführt."
                : "Keine Adressen erfasst."}
            </p>
          ) : (
            <AddressTable
              addresses={detail.addresses}
              onOpen={(address) =>
                onOpenAddress({
                  addressId: address.id,
                  ip: null,
                  vrfId: address.vrfId,
                })
              }
            />
          )}
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
    </section>
  );
}

function AddressTable({
  addresses,
  onOpen,
}: {
  addresses: IpamAddress[];
  onOpen: (address: IpamAddress) => void;
}) {
  if (!addresses.length) return null;
  return (
    <div className="ipam-table-wrap">
      <table className="ipam-table">
        <thead>
          <tr>
            <th>Adresse</th>
            <th>Status</th>
            <th>Hostname</th>
            <th>MAC</th>
            <th>Zuletzt gesehen</th>
          </tr>
        </thead>
        <tbody>
          {addresses.map((address) => (
            <tr key={address.id} onClick={() => onOpen(address)}>
              <td>
                <button
                  className="text-button ipam-mono"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(address);
                  }}
                  type="button"
                >
                  {address.address}
                </button>
              </td>
              <td>
                <span className={`ipam-status ipam-status--${address.status}`}>
                  {ADDRESS_STATUS_LABEL[address.status]}
                </span>
              </td>
              <td>{address.hostname ?? "–"}</td>
              <td className="ipam-mono">
                {address.macAddress?.toUpperCase() ?? "–"}
              </td>
              <td>{formatRelative(address.lastSeenAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VLANs and sites

async function removeEntry(
  tenantId: string,
  entity: "vlan" | "site",
  id: string,
  label: string,
  onChanged: (message?: string) => void,
  onError: (message: string) => void,
) {
  if (!window.confirm(`${label} entfernen?`)) return;
  try {
    await ipamCall({ type: "delete", tenantId, entity, id });
    onChanged(`${label} entfernt.`);
  } catch (failure) {
    onError(errorText(failure, "Der Eintrag konnte nicht entfernt werden."));
  }
}

function VlanTable({
  canManage,
  onChanged,
  onDialog,
  overview,
  tenantId,
}: {
  canManage: boolean;
  onChanged: (message?: string) => void;
  onDialog: (dialog: Dialog) => void;
  overview: IpamOverview;
  tenantId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const sites = new Map(overview.sites.map((site) => [site.id, site.name]));
  const departments = new Map(overview.departments.map((d) => [d.id, d.name]));
  return (
    <div className="ipam-panel">
      <div className="ipam-panel__head">
        <h3>VLANs</h3>
        {canManage ? (
          <button
            className="primary-button"
            onClick={() => onDialog({ kind: "vlan", vlan: null })}
            type="button"
          >
            <Plus aria-hidden="true" size={16} /> VLAN anlegen
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="form-message form-message--error">{error}</p>
      ) : null}
      {overview.vlans.length === 0 ? (
        <p className="ipam-muted">Noch keine VLANs erfasst.</p>
      ) : (
        <div className="ipam-table-wrap">
          <table className="ipam-table">
            <thead>
              <tr>
                <th>VLAN-ID</th>
                <th>Name</th>
                <th>Standort</th>
                <th>Subnetze</th>
                {overview.departments.length > 1 ? <th>Abteilung</th> : null}
                {canManage ? <th aria-label="Aktionen" /> : null}
              </tr>
            </thead>
            <tbody>
              {overview.vlans.map((vlan) => {
                const prefixes = overview.prefixes.filter(
                  (prefix) =>
                    prefix.vlanId === vlan.id && prefix.status !== "deprecated",
                );
                return (
                  <tr key={vlan.id}>
                    <td>{vlan.vlanNumber}</td>
                    <td>
                      {vlan.name}
                      {vlan.description ? (
                        <small> · {vlan.description}</small>
                      ) : null}
                    </td>
                    <td>
                      {vlan.siteId ? (sites.get(vlan.siteId) ?? "–") : "–"}
                    </td>
                    <td className="ipam-mono">
                      {prefixes.map((prefix) => prefix.prefix).join(", ") ||
                        "–"}
                    </td>
                    {overview.departments.length > 1 ? (
                      <td>
                        {vlan.departmentId
                          ? (departments.get(vlan.departmentId) ?? "–")
                          : "Alle"}
                      </td>
                    ) : null}
                    {canManage ? (
                      <td className="ipam-table__actions">
                        <button
                          aria-label={`VLAN ${vlan.vlanNumber} bearbeiten`}
                          className="icon-button"
                          onClick={() => onDialog({ kind: "vlan", vlan })}
                          type="button"
                        >
                          <Pencil aria-hidden="true" size={15} />
                        </button>
                        <button
                          aria-label={`VLAN ${vlan.vlanNumber} entfernen`}
                          className="icon-button"
                          onClick={() =>
                            void removeEntry(
                              tenantId,
                              "vlan",
                              vlan.id,
                              `VLAN ${vlan.vlanNumber}`,
                              onChanged,
                              setError,
                            )
                          }
                          type="button"
                        >
                          <Trash2 aria-hidden="true" size={15} />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SiteTable({
  canManage,
  onChanged,
  onDialog,
  overview,
  tenantId,
}: {
  canManage: boolean;
  onChanged: (message?: string) => void;
  onDialog: (dialog: Dialog) => void;
  overview: IpamOverview;
  tenantId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="ipam-panel">
      <div className="ipam-panel__head">
        <h3>Standorte</h3>
        {canManage ? (
          <button
            className="primary-button"
            onClick={() => onDialog({ kind: "site", site: null })}
            type="button"
          >
            <Plus aria-hidden="true" size={16} /> Standort anlegen
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="form-message form-message--error">{error}</p>
      ) : null}
      {overview.sites.length === 0 ? (
        <p className="ipam-muted">
          Noch keine Standorte erfasst. Standorte gruppieren VLANs und Subnetze
          nach Gebäude oder Stockwerk.
        </p>
      ) : (
        <div className="ipam-table-wrap">
          <table className="ipam-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Kürzel</th>
                <th>Adresse</th>
                <th>VLANs</th>
                <th>Subnetze</th>
                {canManage ? <th aria-label="Aktionen" /> : null}
              </tr>
            </thead>
            <tbody>
              {overview.sites.map((site) => (
                <tr key={site.id}>
                  <td>
                    {site.name}
                    {site.description ? (
                      <small> · {site.description}</small>
                    ) : null}
                  </td>
                  <td>{site.code ?? "–"}</td>
                  <td>{site.address ?? "–"}</td>
                  <td>
                    {
                      overview.vlans.filter((vlan) => vlan.siteId === site.id)
                        .length
                    }
                  </td>
                  <td>
                    {
                      overview.prefixes.filter(
                        (prefix) =>
                          prefix.siteId === site.id &&
                          prefix.status !== "deprecated",
                      ).length
                    }
                  </td>
                  {canManage ? (
                    <td className="ipam-table__actions">
                      <button
                        aria-label={`${site.name} bearbeiten`}
                        className="icon-button"
                        onClick={() => onDialog({ kind: "site", site })}
                        type="button"
                      >
                        <Pencil aria-hidden="true" size={15} />
                      </button>
                      <button
                        aria-label={`${site.name} entfernen`}
                        className="icon-button"
                        onClick={() =>
                          void removeEntry(
                            tenantId,
                            "site",
                            site.id,
                            site.name,
                            onChanged,
                            setError,
                          )
                        }
                        type="button"
                      >
                        <Trash2 aria-hidden="true" size={15} />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Findings

function detailText(details: Record<string, unknown>): string {
  const labels: Record<string, string> = {
    mac: "MAC",
    macAddress: "MAC",
    vendor: "Hersteller",
    hostname: "Hostname",
    dnsName: "DNS",
    switchName: "Switch",
    switchPort: "Port",
    source: "Quelle",
    message: "",
  };
  return Object.entries(details)
    .filter(
      ([, value]) => typeof value === "string" || typeof value === "number",
    )
    .slice(0, 6)
    .map(([key, value]) => {
      const label = labels[key] ?? key;
      return label ? `${label}: ${String(value)}` : String(value);
    })
    .join(" · ");
}

function Findings({
  onChanged,
  onOpenAddress,
  onOpenTicket,
  revision,
  tenantId,
}: {
  onChanged: (message?: string) => void;
  onOpenAddress: (drawer: Drawer) => void;
  onOpenTicket: ((ticketId: string) => void) | undefined;
  revision: number;
  tenantId: string;
}) {
  const [status, setStatus] = useState<"open" | "resolved" | "ignored" | "all">(
    "open",
  );
  const [group, setGroup] = useState<string | null>(null);
  const [data, setData] = useState<{
    canManage: boolean;
    findings: IpamFinding[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void ipamCall<{ canManage: boolean; findings: IpamFinding[] }>({
      type: "findings",
      tenantId,
      status,
    })
      .then((result) => {
        if (current) setData(result);
      })
      .catch((failure: unknown) => {
        if (current)
          setError(
            errorText(failure, "Die Funde konnten nicht geladen werden."),
          );
      });
    return () => {
      current = false;
    };
  }, [tenantId, status, revision]);

  const act = async (
    id: string,
    body: Record<string, unknown>,
    message: string,
  ) => {
    setBusyId(id);
    setError(null);
    try {
      const result = await ipamCall<{
        ticketId?: string;
        ticketNumber?: string;
      }>({
        ...body,
        tenantId,
      });
      if (result.ticketId) onOpenTicket?.(result.ticketId);
      onChanged(
        result.ticketNumber
          ? `Ticket ${result.ticketNumber} erstellt.`
          : message,
      );
    } catch (failure) {
      setError(
        errorText(failure, "Die Aktion konnte nicht ausgeführt werden."),
      );
    } finally {
      setBusyId(null);
    }
  };

  const findings = data?.findings ?? [];
  const activeGroup = FINDING_GROUPS.find((entry) => entry.label === group);
  const visible = activeGroup
    ? findings.filter((finding) => activeGroup.kinds.includes(finding.kind))
    : findings;
  const canManage = data?.canManage === true;

  return (
    <div className="ipam-panel">
      <div className="ipam-panel__head">
        <h3>Funde aus der Discovery</h3>
        <select
          aria-label="Status"
          onChange={(event) => setStatus(event.target.value as typeof status)}
          value={status}
        >
          <option value="open">Offen</option>
          <option value="resolved">Erledigt</option>
          <option value="ignored">Ignoriert</option>
          <option value="all">Alle</option>
        </select>
      </div>
      <div className="ipam-chips" role="group" aria-label="Art">
        <button
          className={group === null ? "is-active" : ""}
          onClick={() => setGroup(null)}
          type="button"
        >
          Alle <span>{findings.length}</span>
        </button>
        {FINDING_GROUPS.map((entry) => {
          const count = findings.filter((finding) =>
            entry.kinds.includes(finding.kind),
          ).length;
          if (!count && group !== entry.label) return null;
          return (
            <button
              className={group === entry.label ? "is-active" : ""}
              key={entry.label}
              onClick={() => setGroup(entry.label)}
              type="button"
            >
              {entry.label} <span>{count}</span>
            </button>
          );
        })}
      </div>
      {error ? (
        <p className="form-message form-message--error">{error}</p>
      ) : null}
      {!data ? (
        <p className="ipam-muted">Wird geladen …</p>
      ) : visible.length === 0 ? (
        <p className="ipam-muted">
          {status === "open"
            ? "Keine offenen Funde. Funde entstehen, sobald die Discovery Abweichungen meldet."
            : "Keine Funde."}
        </p>
      ) : (
        <div className="ipam-table-wrap">
          <table className="ipam-table ipam-findings">
            <thead>
              <tr>
                <th>Fund</th>
                <th>Adresse</th>
                <th>Details</th>
                <th>Seit</th>
                <th aria-label="Aktionen" />
              </tr>
            </thead>
            <tbody>
              {visible.map((finding) => (
                <tr className={`is-${finding.severity}`} key={finding.id}>
                  <td>
                    <strong>
                      {FINDING_KIND_LABEL[finding.kind] ?? finding.kind}
                    </strong>
                    {finding.prefix ? <small> · {finding.prefix}</small> : null}
                  </td>
                  <td>
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
                  </td>
                  <td>{detailText(finding.details) || "–"}</td>
                  <td>{formatRelative(finding.firstSeenAt)}</td>
                  <td className="ipam-table__actions">
                    {finding.ticketId ? (
                      <button
                        className="text-button"
                        onClick={() => onOpenTicket?.(finding.ticketId!)}
                        type="button"
                      >
                        {finding.ticketNumber ?? "Ticket"}
                      </button>
                    ) : null}
                    {canManage && finding.status === "open" ? (
                      <>
                        {finding.kind === "ghost" ||
                        finding.kind === "outside_prefix" ? (
                          <button
                            className="secondary-button"
                            disabled={busyId === finding.id}
                            onClick={() =>
                              void act(
                                finding.id,
                                { type: "adoptFinding", findingId: finding.id },
                                `${finding.address} übernommen.`,
                              )
                            }
                            type="button"
                          >
                            Übernehmen
                          </button>
                        ) : null}
                        {!finding.ticketId ? (
                          <button
                            className="secondary-button"
                            disabled={busyId === finding.id}
                            onClick={() =>
                              void act(
                                finding.id,
                                {
                                  type: "findingTicket",
                                  findingId: finding.id,
                                },
                                "Ticket erstellt.",
                              )
                            }
                            type="button"
                          >
                            Ticket
                          </button>
                        ) : null}
                        <button
                          className="text-button"
                          disabled={busyId === finding.id}
                          onClick={() =>
                            void act(
                              finding.id,
                              {
                                type: "resolveFinding",
                                findingId: finding.id,
                                status: "resolved",
                              },
                              "Fund erledigt.",
                            )
                          }
                          type="button"
                        >
                          Erledigt
                        </button>
                        <button
                          className="text-button"
                          disabled={busyId === finding.id}
                          onClick={() =>
                            void act(
                              finding.id,
                              {
                                type: "resolveFinding",
                                findingId: finding.id,
                                status: "ignored",
                              },
                              "Fund ignoriert.",
                            )
                          }
                          type="button"
                        >
                          Ignorieren
                        </button>
                      </>
                    ) : null}
                    {canManage && finding.status !== "open" ? (
                      <button
                        className="text-button"
                        disabled={busyId === finding.id}
                        onClick={() =>
                          void act(
                            finding.id,
                            {
                              type: "resolveFinding",
                              findingId: finding.id,
                              status: "open",
                            },
                            "Fund wieder geöffnet.",
                          )
                        }
                        type="button"
                      >
                        Wieder öffnen
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export

function ExportPanel({
  overview,
  tenantId,
}: {
  overview: IpamOverview;
  tenantId: string;
}) {
  const [scope, setScope] = useState<
    "all" | "prefixes" | "addresses" | "vlans"
  >("all");
  const [vrfFilter, setVrfFilter] = useState<string>("all");
  const [includeHosts, setIncludeHosts] = useState(true);
  const [includeGroups, setIncludeGroups] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      const file = await ipamCall<IpamFile>({ ...body, tenantId });
      downloadFile(file);
      setMessage(
        file.count !== undefined
          ? `${file.filename} mit ${file.count} Objekten heruntergeladen.`
          : `${file.filename} heruntergeladen.`,
      );
    } catch (failure) {
      setError(errorText(failure, "Der Export ist fehlgeschlagen."));
    } finally {
      setBusy(null);
    }
  };
  const prefixIds =
    vrfFilter === "all"
      ? null
      : overview.prefixes
          .filter((prefix) => (prefix.vrfId ?? "global") === vrfFilter)
          .map((prefix) => prefix.id);

  return (
    <div className="ipam-export">
      {error ? (
        <p className="form-message form-message--error">{error}</p>
      ) : null}
      {message ? (
        <p className="form-message form-message--success">{message}</p>
      ) : null}
      <section className="ipam-panel">
        <h3>Daten exportieren</h3>
        <p className="ipam-muted">
          Subnetze, Adressen und VLANs als CSV (für Excel) oder JSON (für
          Skripte und Backups). Es werden nur Einträge exportiert, die Sie sehen
          dürfen.
        </p>
        <label className="ipam-export__field">
          Umfang
          <select
            onChange={(event) => setScope(event.target.value as typeof scope)}
            value={scope}
          >
            <option value="all">Alles</option>
            <option value="prefixes">Subnetze</option>
            <option value="addresses">Adressen</option>
            <option value="vlans">VLANs und Standorte</option>
          </select>
        </label>
        <div className="ipam-export__actions">
          <button
            className="secondary-button"
            disabled={busy !== null}
            onClick={() =>
              void run("csv", { type: "export", format: "csv", scope })
            }
            type="button"
          >
            <Download aria-hidden="true" size={15} />
            {busy === "csv" ? "Exportiert …" : "CSV"}
          </button>
          <button
            className="secondary-button"
            disabled={busy !== null}
            onClick={() =>
              void run("json", { type: "export", format: "json", scope })
            }
            type="button"
          >
            <Download aria-hidden="true" size={15} />
            {busy === "json" ? "Exportiert …" : "JSON"}
          </button>
        </div>
      </section>
      <section className="ipam-panel">
        <h3>Firewall-Objekte (Sophos)</h3>
        <p className="ipam-muted">
          Netzwerke und einzelne Hosts als IP-Host-Objekte für Sophos Firewall
          (SFOS). Die XML-Datei importieren Sie unter «Backup &amp; Firmware →
          Import/Export». Je Subnetz entsteht auf Wunsch eine Hostgruppe mit den
          dokumentierten Hosts.
        </p>
        <label className="ipam-export__field">
          Adressraum
          <select
            onChange={(event) => setVrfFilter(event.target.value)}
            value={vrfFilter}
          >
            <option value="all">Alle</option>
            <option value="global">Global</option>
            {overview.vrfs.map((vrf) => (
              <option key={vrf.id} value={vrf.id}>
                {vrf.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ipam-export__check">
          <input
            checked={includeHosts}
            onChange={(event) => setIncludeHosts(event.target.checked)}
            type="checkbox"
          />
          Einzelne Hosts (aktiv und reserviert) einschliessen
        </label>
        <label className="ipam-export__check">
          <input
            checked={includeGroups}
            disabled={!includeHosts}
            onChange={(event) => setIncludeGroups(event.target.checked)}
            type="checkbox"
          />
          Hostgruppe je Subnetz
        </label>
        <div className="ipam-export__actions">
          <button
            className="primary-button"
            disabled={busy !== null}
            onClick={() =>
              void run("sophos-xml", {
                type: "exportSophos",
                format: "xml",
                prefixIds,
                includeHosts,
                includeGroups,
              })
            }
            type="button"
          >
            <Download aria-hidden="true" size={15} />
            {busy === "sophos-xml" ? "Exportiert …" : "Sophos-XML"}
          </button>
          <button
            className="secondary-button"
            disabled={busy !== null}
            onClick={() =>
              void run("sophos-csv", {
                type: "exportSophos",
                format: "csv",
                prefixIds,
                includeHosts,
                includeGroups,
              })
            }
            type="button"
          >
            <Download aria-hidden="true" size={15} />
            {busy === "sophos-csv" ? "Exportiert …" : "Objektliste CSV"}
          </button>
        </div>
      </section>
    </div>
  );
}
