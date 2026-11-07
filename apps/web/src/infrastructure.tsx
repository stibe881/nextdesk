import { CsvImportDialog } from "./csv-import-dialog";
import { INFRASTRUCTURE_IMPORT_FIELDS } from "./lib/import-fields";
import { RackView } from "./infrastructure-racks";
import {
  MaintenancePlanning,
  type MaintenanceWindow,
} from "./infrastructure-planning";
import {
  AlertTriangle,
  Battery,
  Cpu,
  Database,
  HardDrive,
  Network,
  Pencil,
  Plus,
  Router,
  Search,
  Server,
  ShieldCheck,
  Wifi,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { supabase } from "./lib/supabase";
import "./infrastructure.css";

type Category =
  | "server"
  | "switch"
  | "access_point"
  | "firewall"
  | "router"
  | "storage"
  | "ups"
  | "virtual_host"
  | "other";
type Lifecycle =
  "ordered" | "stock" | "active" | "repair" | "retired" | "disposed";
type Criticality = "low" | "medium" | "high" | "critical";

type Device = {
  id: string;
  name: string;
  assetTag: string | null;
  inventoryNumber: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  lifecycleState: Lifecycle;
  lifecycleChangedAt: string;
  locationId: string | null;
  locationName: string | null;
  category: Category;
  hostname: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  firmwareVersion: string | null;
  rack: string | null;
  rackUnit: string | null;
  uplinkAssetId: string | null;
  uplinkName: string | null;
  uplinkPort: string | null;
  purchaseDate: string | null;
  purchasePrice: number | null;
  supplier: string | null;
  warrantyUntil: string | null;
  supportUntil: string | null;
  endOfLife: string | null;
  plannedReplacement: string | null;
  criticality: Criticality;
  maintenanceIntervalMonths: number | null;
  lastMaintenanceOn: string | null;
  notes: string | null;
  serviceId: string | null;
  maintenanceChecklist: string[];
  serviceTaskTemplateId: string | null;
};
type Location = { id: string; name: string };
type Service = { id: string; name: string };
type Detail = {
  windows?: MaintenanceWindow[];
  lifecycle: {
    id: string;
    from: Lifecycle | null;
    to: Lifecycle;
    reason: string | null;
    actorName: string | null;
    at: string;
  }[];
  maintenance: {
    id: string;
    performedOn: string;
    kind: string;
    note: string;
    actorName: string | null;
  }[];
  connected: {
    id: string;
    name: string;
    lifecycleState: Lifecycle;
    port: string | null;
    category: Category | null;
  }[];
  tickets: {
    id: string;
    ticketNumber: string;
    subject: string;
    open: boolean;
  }[];
};

const CATEGORY: Record<Category, { label: string; Icon: LucideIcon }> = {
  server: { label: "Server", Icon: Server },
  switch: { label: "Switch", Icon: Network },
  access_point: { label: "Access Point", Icon: Wifi },
  firewall: { label: "Firewall", Icon: ShieldCheck },
  router: { label: "Router", Icon: Router },
  storage: { label: "Storage / NAS", Icon: Database },
  ups: { label: "USV", Icon: Battery },
  virtual_host: { label: "Virtualisierung", Icon: Cpu },
  other: { label: "Sonstiges", Icon: HardDrive },
};
const LIFECYCLE: { key: Lifecycle; label: string }[] = [
  { key: "ordered", label: "Bestellt" },
  { key: "stock", label: "Lager" },
  { key: "active", label: "In Betrieb" },
  { key: "repair", label: "Reparatur" },
  { key: "retired", label: "Ausser Betrieb" },
  { key: "disposed", label: "Entsorgt" },
];
const LIFECYCLE_LABEL = Object.fromEntries(
  LIFECYCLE.map((entry) => [entry.key, entry.label]),
) as Record<Lifecycle, string>;
const CRITICALITY_LABEL: Record<Criticality, string> = {
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
  critical: "Kritisch",
};
const MAINTENANCE_LABEL: Record<string, string> = {
  maintenance: "Wartung",
  firmware: "Firmware-Update",
  repair: "Reparatur",
  inspection: "Prüfung",
  other: "Sonstiges",
};

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Die Verbindung ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("infrastructure", {
    body,
  });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = (await context.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (payload?.error?.message) throw new Error(payload.error.message);
    }
    throw new Error("Die Anfrage konnte nicht ausgeführt werden.");
  }
  return (data as { data: T }).data;
}

function formatDate(value: string | null): string {
  if (!value) return "–";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}.${month}.${year}`;
}

function daysUntil(value: string | null): number | null {
  if (!value) return null;
  const target = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  const today = new Date();
  const base = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - base) / 86_400_000);
}

function nextMaintenance(device: Device): string | null {
  if (!device.maintenanceIntervalMonths) return null;
  const base = device.lastMaintenanceOn ?? device.purchaseDate;
  if (!base) return null;
  const date = new Date(`${base.slice(0, 10)}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + device.maintenanceIntervalMonths);
  return date.toISOString().slice(0, 10);
}

type DueFlag = { label: string; tone: "bad" | "warn"; date: string };

/** Upcoming or overdue lifecycle dates of an active device. */
function dueFlags(device: Device): DueFlag[] {
  if (["retired", "disposed"].includes(device.lifecycleState)) return [];
  const checks: [string, string | null][] = [
    ["Garantie", device.warrantyUntil],
    ["Herstellersupport", device.supportUntil],
    ["End of Life", device.endOfLife],
    ["Wartung", nextMaintenance(device)],
  ];
  return checks.flatMap(([label, date]) => {
    const days = daysUntil(date);
    if (days === null || date === null || days > 90) return [];
    return [
      {
        label:
          days < 0
            ? `${label} abgelaufen`
            : `${label} in ${days} ${days === 1 ? "Tag" : "Tagen"}`,
        tone: days < 0 ? ("bad" as const) : ("warn" as const),
        date,
      },
    ];
  });
}

const EMPTY_FORM: Omit<
  Device,
  | "id"
  | "lifecycleChangedAt"
  | "locationName"
  | "uplinkName"
  | "lastMaintenanceOn"
  | "serviceTaskTemplateId"
> & {
  id: string | null;
} = {
  id: null,
  name: "",
  category: "switch",
  lifecycleState: "active",
  locationId: null,
  assetTag: null,
  inventoryNumber: null,
  serialNumber: null,
  manufacturer: null,
  model: null,
  hostname: null,
  ipAddress: null,
  macAddress: null,
  firmwareVersion: null,
  rack: null,
  rackUnit: null,
  uplinkAssetId: null,
  uplinkPort: null,
  purchaseDate: null,
  purchasePrice: null,
  supplier: null,
  warrantyUntil: null,
  supportUntil: null,
  endOfLife: null,
  plannedReplacement: null,
  criticality: "medium",
  maintenanceIntervalMonths: null,
  notes: null,
  serviceId: null,
  maintenanceChecklist: [],
};
type Form = typeof EMPTY_FORM;

/**
 * Infrastruktur: inventory of network and server hardware with technical
 * data, uplinks, warranty, support, end of life, maintenance and lifecycle.
 */
export function Infrastructure({
  tenantId,
  onOpenTicket,
}: {
  tenantId: string;
  onOpenTicket?: (ticketId: string) => void;
}) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [category, setCategory] = useState<Category | "all">("all");
  const [lifecycleFilter, setLifecycleFilter] = useState<
    "current" | "all" | Lifecycle
  >("current");
  const [query, setQuery] = useState("");
  const [onlyDue, setOnlyDue] = useState(false);
  const [layout, setLayout] = useState<"list" | "racks">("list");
  const [importOpen, setImportOpen] = useState(false);
  // Locations created during an import, by lower-case name.
  const importLocations = useRef(new Map<string, string>());

  async function importDevice(values: Record<string, string | number | null>) {
    const text = (key: string) =>
      typeof values[key] === "string" ? (values[key] as string) : null;
    const number = (key: string) =>
      typeof values[key] === "number" ? (values[key] as number) : null;
    let locationId: string | null = null;
    const locationName = text("location");
    if (locationName) {
      const key = locationName.toLowerCase();
      locationId =
        importLocations.current.get(key) ??
        locations.find((entry) => entry.name.toLowerCase() === key)?.id ??
        null;
      if (!locationId) {
        const created = await call<{ location: Location }>({
          type: "addLocation",
          tenantId,
          name: locationName,
        });
        locationId = created.location.id;
        importLocations.current.set(key, locationId);
      }
    }
    await call({
      type: "save",
      tenantId,
      device: {
        ...EMPTY_FORM,
        name: text("name"),
        category: text("category") ?? "other",
        hostname: text("hostname"),
        ipAddress: text("ipAddress"),
        macAddress: text("macAddress"),
        manufacturer: text("manufacturer"),
        model: text("model"),
        serialNumber: text("serialNumber"),
        inventoryNumber: text("inventoryNumber"),
        firmwareVersion: text("firmwareVersion"),
        locationId,
        rack: text("rack"),
        rackUnit: text("rackUnit"),
        purchaseDate: text("purchaseDate"),
        purchasePrice: number("purchasePrice"),
        supplier: text("supplier"),
        warrantyUntil: text("warrantyUntil"),
        supportUntil: text("supportUntil"),
        endOfLife: text("endOfLife"),
        criticality: text("criticality") ?? "medium",
        maintenanceIntervalMonths: number("maintenanceIntervalMonths"),
        notes: text("notes"),
      },
    });
  }
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await call<{
        canManage: boolean;
        devices: Device[];
        locations: Location[];
        services?: Service[];
      }>({ type: "list", tenantId });
      setDevices(data.devices);
      setLocations(data.locations);
      setServices(data.services ?? []);
      setCanManage(data.canManage);
      setError("");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Infrastruktur konnte nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("de-CH");
    return devices.filter((device) => {
      if (category !== "all" && device.category !== category) return false;
      if (
        lifecycleFilter === "current" &&
        ["retired", "disposed"].includes(device.lifecycleState)
      )
        return false;
      if (
        lifecycleFilter !== "current" &&
        lifecycleFilter !== "all" &&
        device.lifecycleState !== lifecycleFilter
      )
        return false;
      if (onlyDue && dueFlags(device).length === 0) return false;
      if (!needle) return true;
      return [
        device.name,
        device.hostname,
        device.ipAddress,
        device.macAddress,
        device.serialNumber,
        device.inventoryNumber,
        device.assetTag,
        device.model,
        device.manufacturer,
        device.locationName,
        device.rack,
      ].some((value) => value?.toLocaleLowerCase("de-CH").includes(needle));
    });
  }, [devices, category, lifecycleFilter, onlyDue, query]);

  const counts = useMemo(() => {
    const current = devices.filter(
      (device) => !["retired", "disposed"].includes(device.lifecycleState),
    );
    return {
      total: current.length,
      active: current.filter((device) => device.lifecycleState === "active")
        .length,
      due: current.filter((device) => dueFlags(device).length > 0).length,
      overdue: current.filter((device) =>
        dueFlags(device).some((flag) => flag.tone === "bad"),
      ).length,
      byCategory: Object.fromEntries(
        (Object.keys(CATEGORY) as Category[]).map((key) => [
          key,
          current.filter((device) => device.category === key).length,
        ]),
      ) as Record<Category, number>,
    };
  }, [devices]);

  const selected = devices.find((device) => device.id === selectedId) ?? null;

  function edit(device: Device | null) {
    setForm(
      device
        ? {
            ...EMPTY_FORM,
            ...Object.fromEntries(
              Object.keys(EMPTY_FORM).map((key) => [
                key,
                (device as Record<string, unknown>)[key] ?? null,
              ]),
            ),
          }
        : { ...EMPTY_FORM, category: category === "all" ? "switch" : category },
    );
  }

  return (
    <section
      className="infrastructure"
      aria-labelledby="infrastructure-heading"
    >
      <header className="infrastructure__hero">
        <div>
          <p className="eyebrow">INVENTAR</p>
          <h2 id="infrastructure-heading">Infrastruktur</h2>
          <p>
            Access Points, Switches, Server und weitere Netzwerk- und
            Serverhardware mit Lebenszyklus, Garantie, Wartung und Verbindungen.
          </p>
        </div>
        {canManage ? (
          <span className="infrastructure__hero-actions">
            <button
              className="secondary-button"
              onClick={() => setImportOpen(true)}
              type="button"
            >
              CSV importieren
            </button>
            <button
              className="primary-button"
              onClick={() => edit(null)}
              type="button"
            >
              <Plus aria-hidden="true" size={16} /> Gerät erfassen
            </button>
          </span>
        ) : null}
      </header>
      {importOpen ? (
        <CsvImportDialog
          fields={INFRASTRUCTURE_IMPORT_FIELDS}
          onClose={() => setImportOpen(false)}
          onFinished={(imported) => {
            if (imported) {
              setNotice(`${imported} Geräte importiert.`);
              void load();
            }
          }}
          onImportRow={importDevice}
          templateName="infrastruktur-vorlage.csv"
          title="Geräte aus CSV importieren"
        />
      ) : null}

      <div className="infrastructure__kpis">
        <article>
          <p>Geräte</p>
          <strong>{counts.total}</strong>
        </article>
        <article>
          <p>In Betrieb</p>
          <strong>{counts.active}</strong>
        </article>
        <article
          className={counts.due ? "is-warn" : ""}
          onClick={() => setOnlyDue((current) => !current)}
        >
          <p>Fällig in 90 Tagen</p>
          <strong>{counts.due}</strong>
        </article>
        <article className={counts.overdue ? "is-bad" : ""}>
          <p>Abgelaufen / überfällig</p>
          <strong>{counts.overdue}</strong>
        </article>
      </div>

      <div
        aria-label="Darstellung"
        className="infrastructure__view-toggle"
        role="group"
      >
        <button
          aria-pressed={layout === "list"}
          className={
            layout === "list" ? "secondary-button is-active" : "text-button"
          }
          onClick={() => setLayout("list")}
          type="button"
        >
          Liste
        </button>
        <button
          aria-pressed={layout === "racks"}
          className={
            layout === "racks" ? "secondary-button is-active" : "text-button"
          }
          onClick={() => setLayout("racks")}
          type="button"
        >
          Racks
        </button>
      </div>

      <div className="infrastructure__filters">
        <div
          className="infrastructure__categories"
          role="group"
          aria-label="Gerätetyp"
        >
          <button
            className={category === "all" ? "is-active" : ""}
            onClick={() => setCategory("all")}
            type="button"
          >
            Alle <span>{counts.total}</span>
          </button>
          {(Object.keys(CATEGORY) as Category[])
            .filter((key) => counts.byCategory[key] > 0 || category === key)
            .map((key) => {
              const { Icon, label } = CATEGORY[key];
              return (
                <button
                  className={category === key ? "is-active" : ""}
                  key={key}
                  onClick={() => setCategory(key)}
                  type="button"
                >
                  <Icon aria-hidden="true" size={14} />
                  {label} <span>{counts.byCategory[key]}</span>
                </button>
              );
            })}
        </div>
        <div className="infrastructure__search">
          <label>
            <Search aria-hidden="true" size={15} />
            <input
              aria-label="Suchen"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, IP, MAC, Seriennummer, Standort …"
              value={query}
            />
          </label>
          <select
            aria-label="Lebenszyklus"
            onChange={(event) =>
              setLifecycleFilter(event.target.value as typeof lifecycleFilter)
            }
            value={lifecycleFilter}
          >
            <option value="current">Aktueller Bestand</option>
            <option value="all">Alle inkl. ausgemustert</option>
            {LIFECYCLE.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
          <label className="infrastructure__due-toggle">
            <input
              checked={onlyDue}
              onChange={(event) => setOnlyDue(event.target.checked)}
              type="checkbox"
            />
            Nur Fälligkeiten
          </label>
        </div>
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

      {loading && devices.length === 0 ? (
        <p className="empty-state">Infrastruktur wird geladen …</p>
      ) : visible.length === 0 ? (
        <div className="infrastructure__empty">
          <Network aria-hidden="true" size={28} />
          <p>
            {devices.length === 0
              ? "Noch keine Geräte erfasst."
              : "Keine Geräte entsprechen dem Filter."}
          </p>
          {canManage && devices.length === 0 ? (
            <button
              className="primary-button"
              onClick={() => edit(null)}
              type="button"
            >
              <Plus aria-hidden="true" size={16} /> Erstes Gerät erfassen
            </button>
          ) : null}
        </div>
      ) : layout === "racks" ? (
        <RackView
          categoryLabel={(key) => CATEGORY[key as Category]?.label ?? key}
          devices={visible}
          onOpen={setSelectedId}
        />
      ) : (
        <ul className="infrastructure__list">
          {visible.map((device) => {
            const { Icon, label } = CATEGORY[device.category];
            const flags = dueFlags(device);
            return (
              <li key={device.id}>
                <button
                  className={`infrastructure__device${selectedId === device.id ? " is-selected" : ""}`}
                  onClick={() => setSelectedId(device.id)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={`infrastructure__icon infrastructure__icon--${device.category}`}
                  >
                    <Icon size={18} />
                  </span>
                  <span className="infrastructure__main">
                    <strong>{device.name}</strong>
                    <span>
                      {[label, device.manufacturer, device.model]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span className="infrastructure__meta">
                      {device.ipAddress ? (
                        <code>{device.ipAddress}</code>
                      ) : null}
                      {device.locationName ? (
                        <span>{device.locationName}</span>
                      ) : null}
                      {device.rack ? (
                        <span>
                          Rack {device.rack}
                          {device.rackUnit ? ` / HE ${device.rackUnit}` : ""}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="infrastructure__chips">
                    <span
                      className={`infrastructure__lifecycle infrastructure__lifecycle--${device.lifecycleState}`}
                    >
                      {LIFECYCLE_LABEL[device.lifecycleState]}
                    </span>
                    {device.criticality === "critical" ||
                    device.criticality === "high" ? (
                      <span
                        className={`infrastructure__criticality infrastructure__criticality--${device.criticality}`}
                      >
                        {CRITICALITY_LABEL[device.criticality]}
                      </span>
                    ) : null}
                    {flags.slice(0, 2).map((flag) => (
                      <span
                        className={`infrastructure__due infrastructure__due--${flag.tone}`}
                        key={flag.label}
                      >
                        <AlertTriangle aria-hidden="true" size={12} />
                        {flag.label}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected ? (
        <DeviceDetail
          canManage={canManage}
          device={selected}
          devices={devices}
          onClose={() => setSelectedId(null)}
          onEdit={() => edit(selected)}
          onChanged={(message) => {
            setNotice(message);
            void load();
          }}
          onOpenDevice={setSelectedId}
          onOpenTicket={onOpenTicket}
          services={services}
          tenantId={tenantId}
        />
      ) : null}

      {form ? (
        <DeviceEditor
          devices={devices}
          form={form}
          locations={locations}
          services={services}
          onCancel={() => setForm(null)}
          onLocationAdded={(location) =>
            setLocations((current) =>
              [...current, location].sort((a, b) =>
                a.name.localeCompare(b.name, "de-CH"),
              ),
            )
          }
          onSaved={(assetId, created) => {
            setForm(null);
            setNotice(created ? "Gerät erfasst." : "Gerät gespeichert.");
            setSelectedId(assetId);
            void load();
          }}
          tenantId={tenantId}
        />
      ) : null}
    </section>
  );
}

function DeviceDetail({
  device,
  devices,
  canManage,
  tenantId,
  onClose,
  onEdit,
  onChanged,
  onOpenDevice,
  onOpenTicket,
  services,
}: {
  device: Device;
  devices: Device[];
  services: Service[];
  canManage: boolean;
  tenantId: string;
  onClose: () => void;
  onEdit: () => void;
  onChanged: (message: string) => void;
  onOpenDevice: (id: string) => void;
  onOpenTicket?: ((ticketId: string) => void) | undefined;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<
    "overview" | "lifecycle" | "maintenance" | "connections"
  >("overview");
  const [lifecycleTarget, setLifecycleTarget] = useState<Lifecycle>(
    device.lifecycleState,
  );
  const [reason, setReason] = useState("");
  const [maintenance, setMaintenance] = useState({
    performedOn: new Date().toISOString().slice(0, 10),
    kind: "maintenance",
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadDetail = useCallback(async () => {
    try {
      setDetail(
        await call<Detail>({ type: "detail", tenantId, assetId: device.id }),
      );
    } catch {
      setDetail(null);
    }
  }, [device.id, tenantId]);

  useEffect(() => {
    setLifecycleTarget(device.lifecycleState);
    void loadDetail();
  }, [device.id, device.lifecycleState, loadDetail]);

  async function run(body: Record<string, unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await call({ tenantId, ...body });
      onChanged(message);
      await loadDetail();
      return true;
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Aktion ist fehlgeschlagen.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function changeLifecycle(event: FormEvent) {
    event.preventDefault();
    if (lifecycleTarget === device.lifecycleState) return;
    const done = await run(
      {
        type: "setLifecycle",
        assetId: device.id,
        state: lifecycleTarget,
        reason: reason.trim() || null,
      },
      `Lebenszyklus auf «${LIFECYCLE_LABEL[lifecycleTarget]}» gesetzt.`,
    );
    if (done) setReason("");
  }

  async function addMaintenance(event: FormEvent) {
    event.preventDefault();
    if (!maintenance.note.trim()) return;
    const done = await run(
      { type: "addMaintenance", assetId: device.id, ...maintenance },
      "Wartung erfasst.",
    );
    if (done) setMaintenance({ ...maintenance, note: "" });
  }

  const { Icon, label } = CATEGORY[device.category];
  const currentIndex = LIFECYCLE.findIndex(
    (entry) => entry.key === device.lifecycleState,
  );
  const flags = dueFlags(device);
  const field = (title: string, value: string | null | undefined) =>
    value ? (
      <div>
        <dt>{title}</dt>
        <dd>{value}</dd>
      </div>
    ) : null;

  return (
    <div
      className="infrastructure__drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        aria-label={`Gerät ${device.name}`}
        className="infrastructure__drawer"
      >
        <header>
          <span
            aria-hidden="true"
            className={`infrastructure__icon infrastructure__icon--${device.category}`}
          >
            <Icon size={20} />
          </span>
          <div>
            <h3>{device.name}</h3>
            <p>
              {label}
              {device.hostname ? ` · ${device.hostname}` : ""}
            </p>
          </div>
          {canManage ? (
            <button
              aria-label="Bearbeiten"
              className="infrastructure__icon-button"
              onClick={onEdit}
              type="button"
            >
              <Pencil aria-hidden="true" size={16} />
            </button>
          ) : null}
          <button
            aria-label="Schliessen"
            className="infrastructure__icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={17} />
          </button>
        </header>

        <ol className="infrastructure__stepper" aria-label="Lebenszyklus">
          {LIFECYCLE.map((entry, index) => (
            <li
              className={
                index < currentIndex
                  ? "is-done"
                  : index === currentIndex
                    ? "is-current"
                    : ""
              }
              key={entry.key}
            >
              <span aria-hidden="true" />
              {entry.label}
            </li>
          ))}
        </ol>

        {flags.length ? (
          <div className="infrastructure__flags">
            {flags.map((flag) => (
              <span
                className={`infrastructure__due infrastructure__due--${flag.tone}`}
                key={flag.label}
              >
                <AlertTriangle aria-hidden="true" size={12} />
                {flag.label} ({formatDate(flag.date)})
              </span>
            ))}
          </div>
        ) : null}

        <nav className="infrastructure__tabs" aria-label="Bereiche">
          {(
            [
              ["overview", "Übersicht"],
              ["lifecycle", "Lebenszyklus"],
              ["maintenance", "Wartung"],
              ["connections", "Verbindungen"],
            ] as const
          ).map(([value, text]) => (
            <button
              aria-pressed={tab === value}
              className={tab === value ? "is-active" : ""}
              key={value}
              onClick={() => setTab(value)}
              type="button"
            >
              {text}
            </button>
          ))}
        </nav>
        {error ? (
          <p className="form-message form-message--error" role="alert">
            {error}
          </p>
        ) : null}

        {tab === "overview" ? (
          <div className="infrastructure__sections">
            <section>
              <h4>Netzwerk</h4>
              <dl>
                {field("IP-Adresse", device.ipAddress)}
                {field("MAC-Adresse", device.macAddress)}
                {field("Hostname", device.hostname)}
                {field("Firmware / Version", device.firmwareVersion)}
                {field(
                  "Uplink",
                  device.uplinkName
                    ? `${device.uplinkName}${device.uplinkPort ? ` · Port ${device.uplinkPort}` : ""}`
                    : null,
                )}
              </dl>
            </section>
            <section>
              <h4>Standort</h4>
              <dl>
                {field("Standort", device.locationName)}
                {field("Rack", device.rack)}
                {field("Höheneinheit", device.rackUnit)}
              </dl>
            </section>
            <section>
              <h4>Hardware</h4>
              <dl>
                {field("Hersteller", device.manufacturer)}
                {field("Modell", device.model)}
                {field("Seriennummer", device.serialNumber)}
                {field("Inventarnummer", device.inventoryNumber)}
                {field("Asset-Tag", device.assetTag)}
                {field("Kritikalität", CRITICALITY_LABEL[device.criticality])}
              </dl>
            </section>
            <section>
              <h4>Beschaffung & Lebenszyklus</h4>
              <dl>
                {field(
                  "Kaufdatum",
                  device.purchaseDate && formatDate(device.purchaseDate),
                )}
                {field(
                  "Kaufpreis",
                  device.purchasePrice !== null
                    ? `CHF ${device.purchasePrice.toLocaleString("de-CH", { minimumFractionDigits: 2 })}`
                    : null,
                )}
                {field("Lieferant", device.supplier)}
                {field(
                  "Garantie bis",
                  device.warrantyUntil && formatDate(device.warrantyUntil),
                )}
                {field(
                  "Herstellersupport bis",
                  device.supportUntil && formatDate(device.supportUntil),
                )}
                {field(
                  "End of Life",
                  device.endOfLife && formatDate(device.endOfLife),
                )}
                {field(
                  "Ersatz geplant",
                  device.plannedReplacement &&
                    formatDate(device.plannedReplacement),
                )}
                {field(
                  "Wartungsintervall",
                  device.maintenanceIntervalMonths
                    ? `alle ${device.maintenanceIntervalMonths} Monate`
                    : null,
                )}
                {field(
                  "Nächste Wartung",
                  nextMaintenance(device) &&
                    formatDate(nextMaintenance(device)),
                )}
              </dl>
            </section>
            {device.notes ? (
              <section className="infrastructure__notes">
                <h4>Notizen</h4>
                <p>{device.notes}</p>
              </section>
            ) : null}
          </div>
        ) : null}

        {tab === "lifecycle" ? (
          <div className="infrastructure__panel">
            {canManage ? (
              <form
                className="infrastructure__inline-form"
                onSubmit={changeLifecycle}
              >
                <label>
                  Neuer Status
                  <select
                    onChange={(event) =>
                      setLifecycleTarget(event.target.value as Lifecycle)
                    }
                    value={lifecycleTarget}
                  >
                    {LIFECYCLE.map((entry) => (
                      <option key={entry.key} value={entry.key}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="infrastructure__grow">
                  Begründung
                  <input
                    maxLength={2000}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="z. B. Ersetzt durch neues Modell"
                    value={reason}
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={busy || lifecycleTarget === device.lifecycleState}
                  type="submit"
                >
                  Ändern
                </button>
              </form>
            ) : null}
            <ul className="infrastructure__timeline">
              {(detail?.lifecycle ?? []).map((event) => (
                <li key={event.id}>
                  <time>{new Date(event.at).toLocaleDateString("de-CH")}</time>
                  <strong>
                    {event.from ? `${LIFECYCLE_LABEL[event.from]} → ` : ""}
                    {LIFECYCLE_LABEL[event.to]}
                  </strong>
                  <span>
                    {[event.reason, event.actorName]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {tab === "maintenance" ? (
          <div className="infrastructure__panel">
            {canManage ? (
              <form
                className="infrastructure__inline-form"
                onSubmit={addMaintenance}
              >
                <label>
                  Datum
                  <input
                    onChange={(event) =>
                      setMaintenance({
                        ...maintenance,
                        performedOn: event.target.value,
                      })
                    }
                    type="date"
                    value={maintenance.performedOn}
                  />
                </label>
                <label>
                  Art
                  <select
                    onChange={(event) =>
                      setMaintenance({
                        ...maintenance,
                        kind: event.target.value,
                      })
                    }
                    value={maintenance.kind}
                  >
                    {Object.entries(MAINTENANCE_LABEL).map(([key, text]) => (
                      <option key={key} value={key}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="infrastructure__grow">
                  Was wurde gemacht?
                  <input
                    maxLength={2000}
                    onChange={(event) =>
                      setMaintenance({
                        ...maintenance,
                        note: event.target.value,
                      })
                    }
                    placeholder="z. B. Firmware 17.9.4 eingespielt"
                    value={maintenance.note}
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={busy || !maintenance.note.trim()}
                  type="submit"
                >
                  <Wrench aria-hidden="true" size={15} /> Erfassen
                </button>
              </form>
            ) : null}
            {detail?.maintenance.length ? (
              <ul className="infrastructure__timeline">
                {detail.maintenance.map((entry) => (
                  <li key={entry.id}>
                    <time>{formatDate(entry.performedOn)}</time>
                    <strong>
                      {MAINTENANCE_LABEL[entry.kind] ?? entry.kind}
                    </strong>
                    <span>
                      {entry.note}
                      {entry.actorName ? ` · ${entry.actorName}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">Noch keine Wartungen erfasst.</p>
            )}
            <MaintenancePlanning
              busy={busy}
              canManage={canManage}
              checklist={device.maintenanceChecklist ?? []}
              deviceId={device.id}
              deviceName={device.name}
              hasServiceTask={Boolean(device.serviceTaskTemplateId)}
              intervalMonths={device.maintenanceIntervalMonths}
              key={device.id}
              onRun={run}
              serviceId={device.serviceId}
              services={services}
              windows={detail?.windows ?? []}
            />
          </div>
        ) : null}

        {tab === "connections" ? (
          <div className="infrastructure__panel">
            <h4>Hängt an</h4>
            {device.uplinkAssetId ? (
              <button
                className="infrastructure__link"
                onClick={() => onOpenDevice(device.uplinkAssetId as string)}
                type="button"
              >
                {device.uplinkName ?? "Gerät"}
                {device.uplinkPort ? ` · Port ${device.uplinkPort}` : ""}
              </button>
            ) : (
              <p className="empty-state">Kein Uplink erfasst.</p>
            )}
            <h4>Angeschlossene Geräte ({detail?.connected.length ?? 0})</h4>
            {detail?.connected.length ? (
              <ul className="infrastructure__connected">
                {detail.connected
                  .slice()
                  .sort((a, b) =>
                    (a.port ?? "").localeCompare(b.port ?? "", "de-CH", {
                      numeric: true,
                    }),
                  )
                  .map((entry) => (
                    <li key={entry.id}>
                      <button
                        className="infrastructure__link"
                        onClick={() =>
                          devices.some((item) => item.id === entry.id) &&
                          onOpenDevice(entry.id)
                        }
                        type="button"
                      >
                        {entry.port ? <code>{entry.port}</code> : null}
                        {entry.name}
                      </button>
                      <span>{LIFECYCLE_LABEL[entry.lifecycleState]}</span>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="empty-state">Keine Geräte angeschlossen.</p>
            )}
            <h4>Tickets</h4>
            {detail?.tickets.length ? (
              <ul className="infrastructure__connected">
                {detail.tickets.map((ticket) => (
                  <li key={ticket.id}>
                    <button
                      className="infrastructure__link"
                      onClick={() => onOpenTicket?.(ticket.id)}
                      type="button"
                    >
                      <code>{ticket.ticketNumber}</code>
                      {ticket.subject}
                    </button>
                    <span>{ticket.open ? "Offen" : "Erledigt"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">Keine verknüpften Tickets.</p>
            )}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function DeviceEditor({
  form: initial,
  devices,
  locations,
  services,
  tenantId,
  onCancel,
  onSaved,
  onLocationAdded,
}: {
  form: Form;
  devices: Device[];
  locations: Location[];
  services: Service[];
  tenantId: string;
  onCancel: () => void;
  onSaved: (assetId: string, created: boolean) => void;
  onLocationAdded: (location: Location) => void;
}) {
  const [form, setForm] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newLocation, setNewLocation] = useState("");

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const text = (key: keyof Form, label: string, placeholder = "") => (
    <label>
      {label}
      <input
        onChange={(event) =>
          set(key, (event.target.value || null) as Form[typeof key])
        }
        placeholder={placeholder}
        value={(form[key] as string | null) ?? ""}
      />
    </label>
  );
  const date = (key: keyof Form, label: string) => (
    <label>
      {label}
      <input
        onChange={(event) =>
          set(key, (event.target.value || null) as Form[typeof key])
        }
        type="date"
        value={(form[key] as string | null) ?? ""}
      />
    </label>
  );

  async function addLocation() {
    if (!newLocation.trim()) return;
    try {
      const data = await call<{ location: Location }>({
        type: "addLocation",
        tenantId,
        name: newLocation.trim(),
      });
      onLocationAdded(data.location);
      set("locationId", data.location.id);
      setNewLocation("");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Der Standort konnte nicht angelegt werden.",
      );
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await call<{ assetId: string }>({
        type: "save",
        tenantId,
        device: {
          ...form,
          maintenanceChecklist: (form.maintenanceChecklist ?? [])
            .map((item) => item.trim())
            .filter(Boolean),
        },
      });
      onSaved(data.assetId, !form.id);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Das Gerät konnte nicht gespeichert werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  const uplinkOptions = devices.filter(
    (device) =>
      device.id !== form.id &&
      [
        "switch",
        "router",
        "firewall",
        "server",
        "virtual_host",
        "other",
      ].includes(device.category) &&
      !["retired", "disposed"].includes(device.lifecycleState),
  );

  return (
    <div className="infrastructure__drawer-backdrop">
      <form
        aria-label={form.id ? "Gerät bearbeiten" : "Gerät erfassen"}
        className="infrastructure__drawer infrastructure__editor"
        onSubmit={submit}
      >
        <header>
          <div>
            <h3>{form.id ? "Gerät bearbeiten" : "Gerät erfassen"}</h3>
            <p>Pflicht sind nur Name und Typ – alles andere nach Bedarf.</p>
          </div>
          <button
            aria-label="Abbrechen"
            className="infrastructure__icon-button"
            onClick={onCancel}
            type="button"
          >
            <X aria-hidden="true" size={17} />
          </button>
        </header>
        <fieldset>
          <legend>Grunddaten</legend>
          <div
            className="infrastructure__type-picker"
            role="radiogroup"
            aria-label="Typ"
          >
            {(Object.keys(CATEGORY) as Category[]).map((key) => {
              const { Icon, label } = CATEGORY[key];
              return (
                <button
                  aria-checked={form.category === key}
                  className={form.category === key ? "is-active" : ""}
                  key={key}
                  onClick={() => set("category", key)}
                  role="radio"
                  type="button"
                >
                  <Icon aria-hidden="true" size={16} />
                  {label}
                </button>
              );
            })}
          </div>
          <div className="infrastructure__grid">
            <label className="infrastructure__wide">
              Name
              <input
                maxLength={240}
                onChange={(event) => set("name", event.target.value)}
                placeholder="z. B. SW-Haus-A-EG oder AP Büro 1"
                required
                value={form.name}
              />
            </label>
            {!form.id ? (
              <label>
                Lebenszyklus
                <select
                  onChange={(event) =>
                    set("lifecycleState", event.target.value as Lifecycle)
                  }
                  value={form.lifecycleState}
                >
                  {LIFECYCLE.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              Kritikalität
              <select
                onChange={(event) =>
                  set("criticality", event.target.value as Criticality)
                }
                value={form.criticality}
              >
                {(Object.keys(CRITICALITY_LABEL) as Criticality[]).map(
                  (key) => (
                    <option key={key} value={key}>
                      {CRITICALITY_LABEL[key]}
                    </option>
                  ),
                )}
              </select>
            </label>
            {text("manufacturer", "Hersteller", "z. B. Cisco, Ubiquiti, HPE")}
            {text("model", "Modell")}
            {text("serialNumber", "Seriennummer")}
            {text("inventoryNumber", "Inventarnummer")}
          </div>
        </fieldset>
        <fieldset>
          <legend>Netzwerk</legend>
          <div className="infrastructure__grid">
            {text("hostname", "Hostname")}
            {text("ipAddress", "IP-Adresse", "10.0.0.21")}
            {text("macAddress", "MAC-Adresse", "00:1A:2B:3C:4D:5E")}
            {text("firmwareVersion", "Firmware / Version")}
            <label>
              Uplink (hängt an)
              <select
                onChange={(event) =>
                  set("uplinkAssetId", event.target.value || null)
                }
                value={form.uplinkAssetId ?? ""}
              >
                <option value="">– keiner –</option>
                {uplinkOptions.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name}
                  </option>
                ))}
              </select>
            </label>
            {text("uplinkPort", "Port", "z. B. Gi1/0/12")}
          </div>
        </fieldset>
        <fieldset>
          <legend>Standort</legend>
          <div className="infrastructure__grid">
            <label>
              Standort
              <select
                onChange={(event) =>
                  set("locationId", event.target.value || null)
                }
                value={form.locationId ?? ""}
              >
                <option value="">– kein Standort –</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Neuer Standort
              <span className="infrastructure__inline">
                <input
                  maxLength={160}
                  onChange={(event) => setNewLocation(event.target.value)}
                  placeholder="z. B. Serverraum Haus A"
                  value={newLocation}
                />
                <button
                  className="secondary-button"
                  disabled={!newLocation.trim()}
                  onClick={() => void addLocation()}
                  type="button"
                >
                  Anlegen
                </button>
              </span>
            </label>
            {text("rack", "Rack")}
            {text("rackUnit", "Höheneinheit", "z. B. 12")}
            <label>
              Dienst (für Systemstatus)
              <select
                onChange={(event) =>
                  set("serviceId", event.target.value || null)
                }
                value={form.serviceId ?? ""}
              >
                <option value="">– kein Dienst –</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Beschaffung & Lebenszyklus</legend>
          <div className="infrastructure__grid">
            {date("purchaseDate", "Kaufdatum")}
            <label>
              Kaufpreis (CHF)
              <input
                min={0}
                onChange={(event) =>
                  set(
                    "purchasePrice",
                    event.target.value === ""
                      ? null
                      : Number(event.target.value),
                  )
                }
                step="0.05"
                type="number"
                value={form.purchasePrice ?? ""}
              />
            </label>
            {text("supplier", "Lieferant")}
            {date("warrantyUntil", "Garantie bis")}
            {date("supportUntil", "Herstellersupport bis")}
            {date("endOfLife", "End of Life")}
            {date("plannedReplacement", "Ersatz geplant")}
            <label>
              Wartungsintervall (Monate)
              <input
                max={120}
                min={1}
                onChange={(event) =>
                  set(
                    "maintenanceIntervalMonths",
                    event.target.value === ""
                      ? null
                      : Number(event.target.value),
                  )
                }
                type="number"
                value={form.maintenanceIntervalMonths ?? ""}
              />
            </label>
          </div>
        </fieldset>
        <label className="infrastructure__notes-field">
          Wartungscheckliste (ein Punkt pro Zeile)
          <textarea
            onChange={(event) =>
              set(
                "maintenanceChecklist",
                event.target.value.split("\n").slice(0, 40),
              )
            }
            onBlur={() =>
              set(
                "maintenanceChecklist",
                (form.maintenanceChecklist ?? [])
                  .map((item) => item.trim())
                  .filter(Boolean),
              )
            }
            placeholder={
              "Firmware prüfen\nKonfiguration sichern\nLüfter und Staub kontrollieren"
            }
            rows={4}
            value={(form.maintenanceChecklist ?? []).join("\n")}
          />
        </label>
        <label className="infrastructure__notes-field">
          Notizen
          <textarea
            maxLength={4000}
            onChange={(event) => set("notes", event.target.value || null)}
            rows={3}
            value={form.notes ?? ""}
          />
        </label>
        {error ? (
          <p className="form-message form-message--error" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <button className="secondary-button" onClick={onCancel} type="button">
            Abbrechen
          </button>
          <button
            className="primary-button"
            disabled={busy || !form.name.trim()}
            type="submit"
          >
            {busy ? "Wird gespeichert …" : "Speichern"}
          </button>
        </footer>
      </form>
    </div>
  );
}
