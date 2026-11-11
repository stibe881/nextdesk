import { ChevronDown, Network, Settings } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IpamAddressDrawer } from "./ipam-address-drawer";
import { IpamCleanupDialog } from "./ipam-cleanup";
import { IpamExportPanel } from "./ipam-export";
import { IpamFindingsPage, type FindingsMode } from "./ipam-findings";
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
import { IpamNetworksPage } from "./ipam-networks";
import { IpamOverviewPage, LIVE_SEARCH_ID, LiveSearch } from "./ipam-overview";
import { IpamPlannerPage } from "./ipam-planner";
import { IpamSitesPage } from "./ipam-sites";
import {
  Notice,
  Toast,
  errorText,
  type IpamDialog,
  type IpamDrawer,
  type IpamToastState,
  type UndoAction,
} from "./ipam-ui";
import { IpamVlansPage } from "./ipam-vlans";
import { ipamCall } from "./lib/ipam-api";
import type { IpamAddressDetail, IpamOverview } from "./lib/ipam-model";
import { isSearchShortcut, loadPrefs, savePrefs } from "./lib/ipam-ui-state";
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
  /** Rendered under «Verwaltung → Import» (IpamImportWizard). */
  importPanel?: (props: IpamPanelProps) => ReactNode;
  /** Rendered under «Verwaltung → Discovery & Agenten». */
  discoveryPanel?: (props: IpamPanelProps) => ReactNode;
  /** Rendered under «Verwaltung → API & Webhooks» (IpamApiSettings). */
  apiPanel?: (props: IpamPanelProps) => ReactNode;
};

export type IpamView =
  | "overview"
  | "networks"
  | "vlans"
  | "sites"
  | "findings"
  | "planner"
  | "import"
  | "export"
  | "discovery"
  | "api";

const TABS: { key: IpamView; label: string }[] = [
  { key: "overview", label: "Übersicht" },
  { key: "networks", label: "Netze" },
  { key: "vlans", label: "VLANs" },
  { key: "sites", label: "Standorte" },
  { key: "findings", label: "Funde" },
];

const VIEWS: IpamView[] = [
  "overview",
  "networks",
  "vlans",
  "sites",
  "findings",
  "planner",
  "import",
  "export",
  "discovery",
  "api",
];

const ADMIN_TITLE: Partial<Record<IpamView, string>> = {
  planner: "Subnetz-Planer",
  import: "Import (Excel, phpIPAM, NetBox)",
  export: "Export & Sophos-Objekte",
  discovery: "Discovery & Agenten",
  api: "API & Webhooks",
};

/** IP-Adressverwaltung: Übersicht, Netze, VLANs, Standorte, Funde. */
export function Ipam({
  apiPanel,
  discoveryPanel,
  importPanel,
  onOpenTicket,
  tenantId,
}: IpamProps) {
  // Last view and selection per tenant (this browser only).
  const [initial] = useState(() => loadPrefs(tenantId));
  const [overview, setOverview] = useState<IpamOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<IpamToastState | null>(null);
  const [view, setView] = useState<IpamView>(
    VIEWS.includes(initial.view as IpamView)
      ? (initial.view as IpamView)
      : "overview",
  );
  const [selectedPrefixId, setSelectedPrefixId] = useState<string | null>(
    initial.prefixId ?? null,
  );
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(
    initial.siteId ?? null,
  );
  const [plannerParentId, setPlannerParentId] = useState<string | null>(null);
  const [findingsMode, setFindingsMode] = useState<FindingsMode>(
    initial.findingsMode === "compare" || initial.findingsMode === "changes"
      ? (initial.findingsMode as FindingsMode)
      : "findings",
  );
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<IpamDialog | null>(null);
  const [drawer, setDrawer] = useState<IpamDrawer | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
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

  const refresh = useCallback((message?: string, undo?: UndoAction) => {
    if (message)
      setToast({
        id: Date.now(),
        message,
        tone: "success",
        ...(undo ? { undo } : {}),
      });
    setRevision((current) => current + 1);
  }, []);

  const runUndo = useCallback(
    (undo: UndoAction) => {
      setToast(null);
      undo
        .run()
        .then(() => refresh("Änderung rückgängig gemacht."))
        .catch((failure: unknown) =>
          setToast({
            id: Date.now(),
            message: errorText(
              failure,
              "Die Änderung konnte nicht rückgängig gemacht werden.",
            ),
            tone: "error",
          }),
        );
    },
    [refresh],
  );

  useEffect(() => {
    savePrefs(tenantId, {
      view,
      prefixId: selectedPrefixId,
      siteId: selectedSiteId,
      findingsMode,
    });
  }, [tenantId, view, selectedPrefixId, selectedSiteId, findingsMode]);

  // «/» focuses the search (overview: large field, elsewhere the header).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isSearchShortcut(event)) return;
      const input = document.getElementById(LIVE_SEARCH_ID);
      if (!input) return;
      event.preventDefault();
      input.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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
      prefixes: overview?.prefixes ?? [],
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

  const openPrefix = useCallback((prefixId: string) => {
    setSelectedPrefixId(prefixId);
    setView("networks");
  }, []);
  const openSite = useCallback((siteId: string) => {
    setSelectedSiteId(siteId);
    setView("sites");
  }, []);
  const openPlanner = useCallback((parentId: string | null) => {
    setPlannerParentId(parentId);
    setView("planner");
  }, []);
  const openAddress = useCallback(
    (address: { id: string; vrfId: string | null }) =>
      setDrawer({ addressId: address.id, ip: null, vrfId: address.vrfId }),
    [],
  );

  const panelProps: IpamPanelProps = {
    tenantId,
    canManage,
    onChanged: () => refresh(),
  };
  const openFindings = overview?.kpis.openFindings ?? 0;
  const adminTitle = ADMIN_TITLE[view];

  return (
    <section aria-labelledby="ipam-heading" className="ipam">
      <header className="ipam-head">
        <div className="ipam-head__row">
          <div className="ipam-head__title">
            <Network aria-hidden="true" size={22} />
            <div>
              <p className="eyebrow">DIENSTE &amp; ÜBERWACHUNG</p>
              <h2 id="ipam-heading">IP-Adressen</h2>
            </div>
          </div>
          <div className="ipam-head__actions">
            {overview && view !== "overview" ? (
              <LiveSearch
                compact
                onOpenAddress={openAddress}
                onOpenPrefix={openPrefix}
                onOpenVlans={() => setView("vlans")}
                overview={overview}
                tenantId={tenantId}
              />
            ) : null}
            <button
              aria-pressed={view === "planner"}
              className="secondary-button"
              onClick={() => openPlanner(selectedPrefixId)}
              type="button"
            >
              Subnetz-Planer
            </button>
            <AdminMenu
              canManage={canManage}
              onSelect={(entry) => {
                if (entry === "cleanup") setCleanupOpen(true);
                else if (entry === "vrf") setDialog({ kind: "vrf", vrf: null });
                else setView(entry);
              }}
            />
          </div>
        </div>
        <nav aria-label="Bereiche" className="ipam-head__tabs">
          {TABS.map((entry) => (
            <button
              aria-current={view === entry.key ? "page" : undefined}
              className={view === entry.key ? "is-active" : ""}
              key={entry.key}
              onClick={() => setView(entry.key)}
              type="button"
            >
              {entry.label}
              {entry.key === "findings" && openFindings ? (
                <span className="ipam-count ipam-count--danger">
                  <span className="sr-only">offen: </span>
                  {openFindings}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
      </header>

      <Notice error={error} />
      <Toast onClose={() => setToast(null)} onUndo={runUndo} toast={toast} />

      {adminTitle ? (
        <div className="ipam-admin-head">
          <h3>{adminTitle}</h3>
          <button
            className="text-button"
            onClick={() => setView("overview")}
            type="button"
          >
            Zur Übersicht
          </button>
        </div>
      ) : null}

      {loading && !overview ? (
        <p className="empty-state">IP-Adressen werden geladen …</p>
      ) : overview ? (
        <div className="ipam-view">
          {view === "overview" ? (
            <IpamOverviewPage
              canManage={canManage}
              onOpenAddress={openAddress}
              onOpenChanges={() => {
                setFindingsMode("changes");
                setView("findings");
              }}
              onOpenFindings={() => {
                setFindingsMode("findings");
                setView("findings");
              }}
              onOpenNetworks={() => setView("networks")}
              onOpenPrefix={openPrefix}
              onOpenVlans={() => setView("vlans")}
              overview={overview}
              revision={revision}
              tenantId={tenantId}
            />
          ) : view === "networks" ? (
            <IpamNetworksPage
              canManage={canManage}
              onChanged={refresh}
              onDialog={setDialog}
              onOpenAddress={setDrawer}
              onOpenCleanup={() => setCleanupOpen(true)}
              onOpenFindings={() => {
                setFindingsMode("findings");
                setView("findings");
              }}
              onOpenPlanner={openPlanner}
              onOpenSite={openSite}
              onSelect={setSelectedPrefixId}
              overview={overview}
              revision={revision}
              selectedPrefixId={selectedPrefixId}
              tenantId={tenantId}
            />
          ) : view === "vlans" ? (
            <IpamVlansPage
              canManage={canManage}
              onChanged={refresh}
              onDialog={setDialog}
              onOpenPrefix={openPrefix}
              onOpenSite={openSite}
              overview={overview}
              revision={revision}
              tenantId={tenantId}
            />
          ) : view === "sites" ? (
            <IpamSitesPage
              canManage={canManage}
              lookups={lookups}
              onChanged={refresh}
              onOpenPrefix={openPrefix}
              onSelectSite={setSelectedSiteId}
              overview={overview}
              revision={revision}
              selectedSiteId={selectedSiteId}
              tenantId={tenantId}
            />
          ) : view === "findings" ? (
            <IpamFindingsPage
              canManage={canManage}
              mode={findingsMode}
              onChanged={refresh}
              onMode={setFindingsMode}
              onOpenAddress={setDrawer}
              onOpenDiscovery={() => setView("discovery")}
              onOpenPrefix={openPrefix}
              onOpenTicket={onOpenTicket}
              revision={revision}
              tenantId={tenantId}
            />
          ) : view === "planner" ? (
            <IpamPlannerPage
              canManage={canManage}
              initialParentId={plannerParentId}
              key={plannerParentId ?? "none"}
              onChanged={refresh}
              onOpenPrefix={openPrefix}
              overview={overview}
              revision={revision}
              tenantId={tenantId}
            />
          ) : view === "import" ? (
            importPanel ? (
              importPanel(panelProps)
            ) : (
              <Placeholder>
                Hier übernehmen Sie Subnetze und Adressen aus Excel/CSV, phpIPAM
                oder NetBox.
              </Placeholder>
            )
          ) : view === "discovery" ? (
            discoveryPanel ? (
              discoveryPanel(panelProps)
            ) : (
              <Placeholder>
                Scans, Netzwerkagent sowie DHCP- und DNS-Abgleich werden hier
                eingerichtet.
              </Placeholder>
            )
          ) : view === "api" ? (
            apiPanel ? (
              apiPanel(panelProps)
            ) : (
              <Placeholder>
                REST-API-Schlüssel und Webhooks für Ansible, Terraform oder
                Power Automate.
              </Placeholder>
            )
          ) : (
            <IpamExportPanel overview={overview} tenantId={tenantId} />
          )}
        </div>
      ) : null}

      {cleanupOpen ? (
        <IpamCleanupDialog
          onApplied={(message) => refresh(message)}
          onClose={() => setCleanupOpen(false)}
          tenantId={tenantId}
        />
      ) : null}

      {drawer ? (
        <IpamAddressDrawer
          addressId={drawer.addressId}
          canManage={canManage}
          ip={drawer.ip}
          key={`${drawer.addressId ?? ""}-${drawer.ip ?? ""}-${revision}`}
          onChanged={(message, undo) => refresh(message, undo)}
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
          draft={dialog.draft}
          initial={dialog.prefix}
          lookups={lookups}
          onClose={() => setDialog(null)}
          onSaved={(message, id) => {
            setSelectedPrefixId(id);
            setView("networks");
            refresh(message);
          }}
          tenantId={tenantId}
        />
      ) : null}
      {dialog?.kind === "reserve" ? (
        <ReserveDialog
          addresses={dialog.addresses}
          lookups={lookups}
          onClose={() => setDialog(null)}
          onSaved={(message, addressId, ids) => {
            refresh(message, {
              run: async () => {
                for (const id of ids) {
                  await ipamCall({
                    type: "releaseAddress",
                    tenantId,
                    addressId: id,
                    note: "Reservierung rückgängig gemacht",
                  });
                }
              },
            });
            if (ids.length === 1)
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

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="ipam-placeholder">
      <p>{children}</p>
    </div>
  );
}

type AdminEntry = "cleanup" | "import" | "export" | "discovery" | "api" | "vrf";

/** «Verwaltung» menu (button + list, closes on Escape and outside click). */
function AdminMenu({
  canManage,
  onSelect,
}: {
  canManage: boolean;
  onSelect: (entry: AdminEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node))
        setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const entries: { key: AdminEntry; label: string; manage?: boolean }[] = [
    { key: "cleanup", label: "Bereinigungs-Assistent", manage: true },
    { key: "import", label: "Import (Excel, phpIPAM, NetBox)" },
    { key: "export", label: "Export & Sophos-Objekte" },
    { key: "discovery", label: "Discovery & Agenten" },
    { key: "api", label: "API & Webhooks" },
    { key: "vrf", label: "VRF anlegen", manage: true },
  ];
  return (
    <div className="ipam-menu" ref={ref}>
      <button
        aria-expanded={open}
        aria-haspopup="true"
        className="secondary-button"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <Settings aria-hidden="true" size={16} /> Verwaltung
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      {open ? (
        <ul className="ipam-menu__list">
          {entries
            .filter((entry) => !entry.manage || canManage)
            .map((entry) => (
              <li key={entry.key}>
                <button
                  onClick={() => {
                    setOpen(false);
                    onSelect(entry.key);
                  }}
                  type="button"
                >
                  {entry.label}
                </button>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}
