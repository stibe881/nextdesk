import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Download,
  FlaskConical,
  LoaderCircle,
  ListPlus,
  Pause,
  Pencil,
  Play,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Trash2,
  Network,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  Fragment,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  CATEGORY_LABELS,
  categoryText,
  kindFields,
  kindValue,
  chartGeometry,
  CLOUD_KINDS,
  draftFromSensor,
  emptyDraft,
  formatAgo,
  formatMs,
  formatSince,
  connectedPorts,
  groupServiceOptions,
  formatValue,
  guessCategory,
  LINK_SOURCE_LABELS,
  linkDiagram,
  type MonitoringPort,
  PORT_STATE_LABELS,
  portGroups,
  portNumber,
  portState,
  type MonitoringConnections,
  portLinkText,
  INTERVAL_OPTIONS,
  intervalLabel,
  kindLabel,
  type DeviceSort,
  type DeviceSortKey,
  matchesSearch,
  sortDevices,
  monitoringCall,
  RANGE_LABELS,
  sensorCountsText,
  sensorTarget,
  sensorValueText,
  thresholdText,
  trafficDraft,
  valueLabel,
  STATE_LABELS,
  STATE_ORDER,
  type InterfaceRow,
  type MonitoringAddressChoice,
  type AvailabilityRange,
  eventCountsText,
  type EventRange,
  EVENT_RANGE_LABELS,
  eventText,
  eventTime,
  type MonitoringEvent,
  type MonitoringEvents,
  AVAILABILITY_RANGE_LABELS,
  formatDowntime,
  formatPercent,
  type MonitoringAvailability,
  type MonitoringAgent,
  type MonitoringAssetChoice,
  type MonitoringDeviceDetail,
  type MonitoringOverview,
  type MonitoringRange,
  type MonitoringSensor,
  type MonitoringSeries,
  type MonitoringState,
  type SensorDraft,
  type SnmpMetric,
} from "./lib/monitoring";
import { tn } from "./lib/formality";
import { confirmDialog, promptDialog } from "./app-dialog";

import "./monitoring.css";

const REFRESH_MS = 30_000;

type Props = {
  tenantId: string;
  onOpenIncident?: ((incidentId: string) => void) | undefined;
  /** Opens the device in the infrastructure view (same asset). */
  onOpenInfrastructure?: ((assetId: string) => void) | undefined;
  /** Opens a ticket; set for agents, who may create tickets from an outage. */
  onOpenTicket?: ((ticketId: string) => void) | undefined;
};

/**
 * Asks for the reason of a pause (3–300 characters). null: cancelled.
 * `what` names what is paused, e.g. «SW-CORE-01» or «3 Geräte».
 */
async function askPauseReason(what: string): Promise<string | null> {
  let hint = "";
  for (;;) {
    const answer = await promptDialog(
      `${hint}Grund für das Pausieren von ${what}:`,
      { confirmLabel: "Pausieren", multiline: false },
    );
    if (answer === null) return null;
    const reason = answer.replace(/\s+/g, " ").trim();
    if (reason.length >= 3 && reason.length <= 300) return reason;
    hint = "Bitte 3 bis 300 Zeichen angeben. ";
  }
}

/** «Pausiert von Mara Keller: Wartung» for a paused sensor or device. */
function pauseText(pause: {
  reason?: string | null;
  by?: string | null;
}): string {
  const who = pause.by ? `Pausiert von ${pause.by}` : "Pausiert";
  return pause.reason ? `${who}: ${pause.reason}` : who;
}

/**
 * Creates a ticket for a device after a confirmation and opens it. Returns
 * the busy device and the action; failures go to `onError`.
 */
function useDeviceTicket(
  tenantId: string,
  onOpenTicket: Props["onOpenTicket"],
  onError: (text: string) => void,
) {
  const [busy, setBusy] = useState<string | null>(null);
  const create = async (assetId: string, deviceName: string) => {
    if (!onOpenTicket || busy) return;
    const confirmed = await confirmDialog(
      `Für «${deviceName}» ein Ticket mit den Angaben zum Ausfall erstellen? Es geht an das Team aus den Überwachungseinstellungen.`,
      { confirmLabel: "Ticket erstellen" },
    );
    if (!confirmed) return;
    setBusy(assetId);
    try {
      const result = await monitoringCall<{ ticketId: string }>({
        type: "deviceTicket",
        tenantId,
        assetId,
      });
      onOpenTicket(result.ticketId);
    } catch (failure) {
      onError(message(failure));
    } finally {
      setBusy(null);
    }
  };
  return { busy, create };
}

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Die Überwachung ist gerade nicht erreichbar.";
}

function StateChip({ state }: { state: MonitoringState }) {
  return (
    <span className={`monitoring-chip monitoring-chip--${state}`}>
      {STATE_LABELS[state]}
    </span>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <p className="monitoring__empty" role="status">
      <LoaderCircle
        aria-hidden="true"
        className="ticket-detail-spinner"
        size={16}
      />
      {label}
    </p>
  );
}

/** Reloads `load` every 30 s while the tab is visible. */
function useNow(reload: () => void): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible") reload();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [reload]);
  return now;
}

export function Monitoring({
  tenantId,
  onOpenIncident,
  onOpenInfrastructure,
  onOpenTicket,
}: Props) {
  const [assetId, setAssetId] = useState<string | null>(null);
  return assetId ? (
    <DeviceView
      assetId={assetId}
      key={assetId}
      onBack={() => setAssetId(null)}
      onOpenDevice={setAssetId}
      onOpenIncident={onOpenIncident}
      onOpenInfrastructure={onOpenInfrastructure}
      onOpenTicket={onOpenTicket}
      tenantId={tenantId}
    />
  ) : (
    <OverviewView
      onOpenDevice={setAssetId}
      onOpenIncident={onOpenIncident}
      onOpenTicket={onOpenTicket}
      tenantId={tenantId}
    />
  );
}

// ---------------------------------------------------------------------------
// Übersicht

function OverviewView({
  tenantId,
  onOpenDevice,
  onOpenIncident,
  onOpenTicket,
}: Props & { onOpenDevice: (assetId: string) => void }) {
  const [data, setData] = useState<MonitoringOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ticket = useDeviceTicket(tenantId, onOpenTicket, setError);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [pausing, setPausing] = useState<string | null>(null);
  const [sensorRevision, setSensorRevision] = useState(0);
  // Several devices and sensors can be chosen and paused together.
  const [chosenDevices, setChosenDevices] = useState<Set<string>>(
    () => new Set(),
  );
  const [chosenSensors, setChosenSensors] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleIn =
    (setter: (update: (current: Set<string>) => Set<string>) => void) =>
    (id: string) =>
      setter((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
  const toggleDevice = toggleIn(setChosenDevices);
  const toggleSensor = toggleIn(setChosenSensors);
  const clearChosen = () => {
    setChosenDevices(new Set());
    setChosenSensors(new Set());
  };
  const toggleExpanded = (assetId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  const [filter, setFilter] = useState<MonitoringState | "all">("all");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    monitoringCall<MonitoringOverview>({ type: "overview", tenantId })
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((failure) => setError(message(failure)));
  }, [tenantId]);
  useEffect(load, [load]);
  // Pauses or resumes a whole device or one sensor, then reloads the list
  // and the open sensor rows.
  const setPaused = async (
    key: string,
    body: Record<string, unknown>,
    what: string,
  ): Promise<boolean> => {
    let reason: string | null = null;
    if (body.paused === true) {
      reason = await askPauseReason(what);
      if (reason === null) return false;
    }
    setPausing(key);
    try {
      await monitoringCall({
        ...body,
        ...(reason ? { reason } : {}),
        tenantId,
      });
      setSensorRevision((current) => current + 1);
      load();
      return true;
    } catch (failure) {
      setError(message(failure));
      return false;
    } finally {
      setPausing(null);
    }
  };
  const pauseChosen = async (paused: boolean) => {
    const parts = [
      chosenDevices.size === 1
        ? "1 Gerät"
        : chosenDevices.size
          ? `${chosenDevices.size} Geräten`
          : null,
      chosenSensors.size === 1
        ? "1 Sensor"
        : chosenSensors.size
          ? `${chosenSensors.size} Sensoren`
          : null,
    ].filter(Boolean);
    const done = await setPaused(
      "chosen",
      {
        type: "pauseMany",
        assetIds: [...chosenDevices],
        sensorIds: [...chosenSensors],
        paused,
      },
      parts.join(" und "),
    );
    if (done) clearChosen();
  };
  const now = useNow(load);

  const [sort, setSort] = useState<DeviceSort>({
    key: "state",
    descending: false,
  });
  const devices = useMemo(
    () =>
      sortDevices(
        (data?.devices ?? []).filter(
          (device) =>
            (filter === "all" || device.state === filter) &&
            matchesSearch(device, search),
        ),
        sort,
      ),
    [data, filter, search, sort],
  );
  const sortHeader = (key: DeviceSortKey, label: string) => (
    <th
      aria-sort={
        sort.key === key
          ? sort.descending
            ? "descending"
            : "ascending"
          : "none"
      }
      scope="col"
    >
      <button
        className="monitoring-table__sort"
        onClick={() =>
          setSort((current) => ({
            key,
            descending: current.key === key ? !current.descending : false,
          }))
        }
        type="button"
      >
        {label}
        <span aria-hidden="true">
          {sort.key === key ? (sort.descending ? "▼" : "▲") : "↕"}
        </span>
      </button>
    </th>
  );
  const alarms = (data?.devices ?? []).filter((device) => device.problem);
  const onlineAgents = (data?.agents ?? []).filter((agent) => agent.online);

  return (
    <section className="monitoring" aria-labelledby="monitoring-title">
      <header className="monitoring__hero">
        <div>
          <p className="eyebrow">BETRIEB</p>
          <h2 id="monitoring-title">Überwachung</h2>
          <p>
            {data
              ? `${data.deviceCount} Geräte · ${data.sensorCount} Sensoren · aktualisiert ${formatAgo(data.checkedAt, now)}`
              : "Geräte mit eigenen Sensoren überwachen. Fällt ein Gerät aus, öffnet nextDesk eine Störung."}
          </p>
        </div>
        {data?.canManage ? (
          <button
            className="primary-button"
            onClick={() => setAdding(true)}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
            Geräte hinzufügen
          </button>
        ) : null}
      </header>

      {error ? (
        <p className="ticket-detail-message error" role="alert">
          {error}
        </p>
      ) : null}
      {!data && !error ? <Spinner label="Überwachung wird geladen …" /> : null}

      {data ? (
        <>
          <div className="monitoring__tiles">
            {STATE_ORDER.map((state) => (
              <button
                aria-pressed={filter === state}
                className={`monitoring-tile monitoring-tile--${state}`}
                key={state}
                onClick={() => setFilter(filter === state ? "all" : state)}
                type="button"
              >
                <span className="monitoring-tile__label">
                  {STATE_LABELS[state]}
                </span>
                <strong>{data.totals[state]}</strong>
              </button>
            ))}
            <div className="monitoring-tile">
              <span className="monitoring-tile__label">Sonden online</span>
              <strong>
                {onlineAgents.length} / {data.agents.length}
              </strong>
            </div>
          </div>

          {data.agents.length === 0 ? (
            <p className="monitoring__notice" role="status">
              {tn(
                "Es ist noch keine Sonde eingerichtet. Eine Sonde läuft auf einem Server in deinem Netz, misst die Geräte und meldet die Resultate verschlüsselt an nextDesk.",
                "Es ist noch keine Sonde eingerichtet. Eine Sonde läuft auf einem Server in Ihrem Netz, misst die Geräte und meldet die Resultate verschlüsselt an nextDesk.",
              )}
              {data.canManage
                ? " Unter «Einstellungen → Monitoring» lässt sich eine Sonde anlegen und ihre Konfiguration herunterladen."
                : ""}
            </p>
          ) : null}
          {data.agents
            .filter(
              (agent) =>
                agent.active &&
                (agent.sensorCount ?? 0) > 0 &&
                (!agent.online || agent.updateAvailable),
            )
            .map((agent) => (
              <p
                className="monitoring__notice monitoring__notice--test"
                key={agent.id}
                role="status"
              >
                <span className="monitoring-chip monitoring-chip--warning">
                  Sonde
                </span>
                <span>
                  <strong>{agent.name}</strong>{" "}
                  {agent.online
                    ? `läuft mit Version ${agent.version ?? "?"}; eine neuere steht bereit.`
                    : `meldet sich nicht (zuletzt ${formatAgo(agent.lastSeenAt, now)}). Die ${agent.sensorCount} Sensoren dieser Sonde gelten als «Unbekannt».`}{" "}
                  <span className="monitoring-muted">
                    Sonden verwalten: Einstellungen → Monitoring.
                  </span>
                </span>
              </p>
            ))}

          <div className="monitoring__columns monitoring__columns--even">
            <EventsCard
              now={now}
              onOpenDevice={onOpenDevice}
              onOpenIncident={onOpenIncident}
              tenantId={tenantId}
            />
            <AvailabilityCard onOpenDevice={onOpenDevice} tenantId={tenantId} />
          </div>

          <article className="monitoring-card">
            <div className="monitoring-card__head">
              <h3>Aktive Alarme</h3>
              <span className="monitoring-muted">{alarms.length}</span>
            </div>
            {alarms.length === 0 ? (
              <p className="monitoring__empty">
                Kein Sensor meldet einen Ausfall oder eine Warnung.
              </p>
            ) : (
              <ul className="monitoring-alarms">
                {alarms.map((device) => (
                  <li key={device.assetId}>
                    <StateChip state={device.problem!.state} />
                    <button
                      className="monitoring-alarms__main"
                      onClick={() => onOpenDevice(device.assetId)}
                      type="button"
                    >
                      <strong>
                        {device.name} · {device.problem!.sensorName}
                      </strong>
                      <span>
                        {device.problem!.message ?? "Keine Angabe"}
                        {device.problem!.since
                          ? ` · ${formatSince(device.problem!.since, now)}`
                          : ""}
                      </span>
                    </button>
                    {device.problem!.services?.length ? (
                      <span className="monitoring-alarms__services">
                        {device.problem!.services.map((service) => (
                          <span
                            className="monitoring-service-chip"
                            key={service}
                          >
                            {service}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    <div className="monitoring-alarms__actions">
                      {device.incident && onOpenIncident ? (
                        <button
                          className="text-button"
                          onClick={() => onOpenIncident(device.incident!.id)}
                          type="button"
                        >
                          Störung {device.incident.number}
                          {device.incident.acknowledged ? " (bestätigt)" : ""}
                        </button>
                      ) : null}
                      {onOpenTicket ? (
                        <button
                          className="text-button"
                          disabled={ticket.busy !== null}
                          onClick={() =>
                            void ticket.create(device.assetId, device.name)
                          }
                          type="button"
                        >
                          {ticket.busy === device.assetId
                            ? "Ticket wird erstellt …"
                            : "Ticket erstellen"}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="monitoring-card monitoring-card--flush">
            <div className="monitoring__toolbar">
              <div
                aria-label="Geräte filtern"
                className="queue-tabs"
                role="group"
              >
                {(["all", ...STATE_ORDER] as const).map((entry) => (
                  <button
                    aria-pressed={filter === entry}
                    className={
                      filter === entry ? "queue-tab selected" : "queue-tab"
                    }
                    key={entry}
                    onClick={() => setFilter(entry)}
                    type="button"
                  >
                    {entry === "all"
                      ? `Alle ${data.deviceCount}`
                      : `${STATE_LABELS[entry]} ${data.totals[entry]}`}
                  </button>
                ))}
              </div>
              <label className="monitoring__search">
                <Search aria-hidden="true" size={15} />
                <span className="sr-only">Geräte durchsuchen</span>
                <input
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Gerät, IP oder Hostname"
                  type="search"
                  value={search}
                />
              </label>
            </div>
            {devices.length === 0 ? (
              <p className="monitoring__empty">
                {data.deviceCount === 0
                  ? "Noch wird kein Gerät überwacht."
                  : "Kein Gerät passt zu Filter und Suche."}
              </p>
            ) : (
              <div className="monitoring__scroll">
                {chosenDevices.size + chosenSensors.size > 0 ? (
                  <div
                    aria-label="Auswahl pausieren"
                    className="monitoring-bulk"
                    role="region"
                  >
                    <strong>
                      {[
                        chosenDevices.size === 1
                          ? "1 Gerät"
                          : chosenDevices.size
                            ? `${chosenDevices.size} Geräte`
                            : null,
                        chosenSensors.size === 1
                          ? "1 Sensor"
                          : chosenSensors.size
                            ? `${chosenSensors.size} Sensoren`
                            : null,
                      ]
                        .filter(Boolean)
                        .join(" und ")}{" "}
                      ausgewählt
                    </strong>
                    <button
                      className="secondary-button"
                      disabled={pausing !== null}
                      onClick={() => void pauseChosen(true)}
                      type="button"
                    >
                      <Pause aria-hidden="true" size={15} /> Pausieren
                    </button>
                    <button
                      className="secondary-button"
                      disabled={pausing !== null}
                      onClick={() => void pauseChosen(false)}
                      type="button"
                    >
                      <Play aria-hidden="true" size={15} /> Fortsetzen
                    </button>
                    <button
                      className="text-button"
                      onClick={clearChosen}
                      type="button"
                    >
                      Auswahl aufheben
                    </button>
                  </div>
                ) : null}
                <table className="monitoring-table">
                  <thead>
                    <tr>
                      {data.canManage ? (
                        <th className="monitoring-table__check">
                          <input
                            aria-label="Alle angezeigten Geräte auswählen"
                            checked={
                              devices.length > 0 &&
                              devices.every((device) =>
                                chosenDevices.has(device.assetId),
                              )
                            }
                            onChange={(event) =>
                              setChosenDevices(
                                event.target.checked
                                  ? new Set(
                                      devices.map((device) => device.assetId),
                                    )
                                  : new Set(),
                              )
                            }
                            type="checkbox"
                          />
                        </th>
                      ) : null}
                      <th>
                        <span className="sr-only">Sensoren aufklappen</span>
                      </th>
                      {sortHeader("state", "Status")}
                      {sortHeader("name", "Gerät")}
                      {sortHeader("sensors", "Sensoren")}
                      {sortHeader("response", "Antwortzeit")}
                      {sortHeader("lastCheck", "Letzte Prüfung")}
                      {data.canManage ? (
                        <th>
                          <span className="sr-only">Überwachung pausieren</span>
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((device) => {
                      const open = expanded.has(device.assetId);
                      const devicePaused = device.state === "paused";
                      return (
                        <Fragment key={device.assetId}>
                          <tr>
                            {data.canManage ? (
                              <td className="monitoring-table__check">
                                <input
                                  aria-label={`${device.name} auswählen`}
                                  checked={chosenDevices.has(device.assetId)}
                                  onChange={() => toggleDevice(device.assetId)}
                                  type="checkbox"
                                />
                              </td>
                            ) : null}
                            <td className="monitoring-table__toggle">
                              <button
                                aria-expanded={open}
                                aria-label={
                                  open
                                    ? `Sensoren von ${device.name} zuklappen`
                                    : `Sensoren von ${device.name} aufklappen`
                                }
                                className="monitoring-table__expand"
                                onClick={() => toggleExpanded(device.assetId)}
                                type="button"
                              >
                                {open ? (
                                  <ChevronDown aria-hidden="true" size={16} />
                                ) : (
                                  <ChevronRight aria-hidden="true" size={16} />
                                )}
                              </button>
                            </td>
                            <td>
                              <StateChip state={device.state} />
                            </td>
                            <td>
                              <button
                                className="text-button monitoring-table__name"
                                onClick={() => onOpenDevice(device.assetId)}
                                type="button"
                              >
                                {device.name}
                              </button>
                              <span className="monitoring-muted">
                                {[
                                  categoryText(
                                    device.category,
                                    device.categoryLabel,
                                  ),
                                  device.ipAddress ?? device.hostname,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                              {devicePaused && device.pause ? (
                                <span className="monitoring-pause-note">
                                  {pauseText(device.pause)}
                                </span>
                              ) : null}
                            </td>
                            <td>{sensorCountsText(device.counts)}</td>
                            <td>{formatMs(device.responseMs)}</td>
                            <td className="monitoring-muted">
                              {formatAgo(device.lastCheckAt, now)}
                            </td>
                            {data.canManage ? (
                              <td className="monitoring-table__action">
                                {device.sensorCount > 0 ? (
                                  <button
                                    className="text-button"
                                    disabled={pausing !== null}
                                    onClick={() =>
                                      void setPaused(
                                        `device:${device.assetId}`,
                                        {
                                          type: "pauseDevice",
                                          assetId: device.assetId,
                                          paused: !devicePaused,
                                        },
                                        `«${device.name}»`,
                                      )
                                    }
                                    type="button"
                                  >
                                    {devicePaused ? (
                                      <Play aria-hidden="true" size={14} />
                                    ) : (
                                      <Pause aria-hidden="true" size={14} />
                                    )}
                                    {pausing === `device:${device.assetId}`
                                      ? "…"
                                      : devicePaused
                                        ? "Fortsetzen"
                                        : "Pausieren"}
                                  </button>
                                ) : null}
                              </td>
                            ) : null}
                          </tr>
                          {open ? (
                            <tr className="monitoring-table__sensors">
                              <td colSpan={data.canManage ? 8 : 6}>
                                <DeviceSensorList
                                  assetId={device.assetId}
                                  canManage={data.canManage}
                                  chosen={chosenSensors}
                                  now={now}
                                  onChoose={toggleSensor}
                                  onPause={(sensorId, paused, name) =>
                                    void setPaused(
                                      `sensor:${sensorId}`,
                                      {
                                        type: "pauseSensor",
                                        sensorId,
                                        paused,
                                      },
                                      `«${name}» (${device.name})`,
                                    )
                                  }
                                  pausing={pausing}
                                  revision={sensorRevision}
                                  tenantId={tenantId}
                                />
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </>
      ) : null}

      {adding && data ? (
        <AddDeviceDialog
          agents={data.agents}
          onClose={() => setAdding(false)}
          onSaved={(savedAssetId) => {
            setAdding(false);
            if (savedAssetId) onOpenDevice(savedAssetId);
            else load();
          }}
          tenantId={tenantId}
        />
      ) : null}
    </section>
  );
}

/** Sensors of one device, shown when its row in the list is expanded. */
function DeviceSensorList({
  assetId,
  canManage,
  chosen,
  now,
  onChoose,
  onPause,
  pausing,
  revision,
  tenantId,
}: {
  assetId: string;
  canManage: boolean;
  chosen: ReadonlySet<string>;
  now: number;
  onChoose: (sensorId: string) => void;
  onPause: (sensorId: string, paused: boolean, name: string) => void;
  pausing: string | null;
  revision: number;
  tenantId: string;
}) {
  const [sensors, setSensors] = useState<MonitoringSensor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    monitoringCall<MonitoringDeviceDetail>({
      type: "device",
      tenantId,
      assetId,
    })
      .then((result) => {
        if (!active) return;
        setSensors(result.sensors);
        setError(null);
      })
      .catch((failure) => {
        if (active) setError(message(failure));
      });
    return () => {
      active = false;
    };
  }, [assetId, revision, tenantId]);

  if (error) return <p className="monitoring__empty">{error}</p>;
  if (!sensors)
    return <p className="monitoring-muted">Sensoren werden geladen …</p>;
  if (sensors.length === 0)
    return <p className="monitoring-muted">Dieses Gerät hat keine Sensoren.</p>;
  return (
    <ul className="monitoring-sensor-rows">
      {sensors.map((sensor) => (
        <li
          className={canManage ? "monitoring-sensor-rows__item--check" : ""}
          key={sensor.id}
        >
          {canManage ? (
            <input
              aria-label={`Sensor ${sensor.name} auswählen`}
              checked={chosen.has(sensor.id)}
              onChange={() => onChoose(sensor.id)}
              type="checkbox"
            />
          ) : null}
          <StateChip state={sensor.state} />
          <span className="monitoring-sensor-rows__name">
            <strong>{sensor.name}</strong>
            <span className="monitoring-muted">
              {[
                kindLabel(sensor),
                sensor.paused ? null : sensorValueText(sensor),
                sensor.paused ? null : sensor.lastMessage,
                sensor.lastCheckAt ? formatAgo(sensor.lastCheckAt, now) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {sensor.paused ? (
              <span className="monitoring-pause-note">
                {pauseText({
                  reason: sensor.pausedReason ?? null,
                  by: sensor.pausedByName ?? null,
                })}
                {sensor.pausedAt ? ` · ${formatAgo(sensor.pausedAt, now)}` : ""}
              </span>
            ) : null}
          </span>
          {canManage ? (
            <button
              className="text-button"
              disabled={pausing !== null}
              onClick={() => onPause(sensor.id, !sensor.paused, sensor.name)}
              type="button"
            >
              {sensor.paused ? (
                <Play aria-hidden="true" size={14} />
              ) : (
                <Pause aria-hidden="true" size={14} />
              )}
              {pausing === `sensor:${sensor.id}`
                ? "…"
                : sensor.paused
                  ? "Fortsetzen"
                  : "Pausieren"}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Sonden

function formatSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toLocaleString("de-CH", { maximumFractionDigits: 1 })} MB`;
}

/** Starts the download of the newest probe package (short-lived link). */
async function downloadProbePackage(tenantId: string): Promise<void> {
  const result = await monitoringCall<{ url: string }>({
    type: "probePackage",
    tenantId,
  });
  window.location.assign(result.url);
}

const EVENT_LABELS: Record<MonitoringEvent["kind"], string> = {
  down: "Ausfall",
  warning: "Warnung",
  up: "behoben",
  paused: "pausiert",
  resumed: "fortgesetzt",
};

/**
 * Latest events of the sensors: how many, when (a bar per hour or day), and
 * folded in the list with device, services affected and incident. Built like
 * the availability card, so both fold at the same height.
 */
function EventsCard({
  tenantId,
  now,
  onOpenDevice,
  onOpenIncident,
}: {
  tenantId: string;
  now: number;
  onOpenDevice: (assetId: string) => void;
  onOpenIncident?: ((incidentId: string) => void) | undefined;
}) {
  const [range, setRange] = useState<EventRange>("24h");
  const [data, setData] = useState<MonitoringEvents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      monitoringCall<MonitoringEvents>({ type: "events", tenantId, range })
        .then((result) => {
          if (cancelled) return;
          setData(result);
          setError(null);
        })
        .catch((failure) => {
          if (!cancelled) setError(message(failure));
        });
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tenantId, range]);
  const shown = data && data.range === range ? data : null;
  const total = shown
    ? shown.counts.down + shown.counts.warning + shown.counts.up
    : 0;
  const events = shown ? (all ? shown.events : shown.events.slice(0, 5)) : [];
  return (
    <article className="monitoring-card">
      <div className="monitoring-card__head">
        <h3>Letzte Ereignisse</h3>
        <div
          aria-label="Zeitraum der Ereignisse"
          className="monitoring-toggle"
          role="group"
        >
          {(Object.keys(EVENT_RANGE_LABELS) as EventRange[]).map((key) => (
            <button
              aria-pressed={range === key}
              key={key}
              onClick={() => setRange(key)}
              type="button"
            >
              {EVENT_RANGE_LABELS[key]}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <p className="ticket-detail-message error" role="alert">
          {error}
        </p>
      ) : null}
      {!shown && !error ? <Spinner label="Wird geladen …" /> : null}
      {shown ? (
        <>
          <p className="monitoring-availability__value">
            <strong>{total}</strong>
            <span className="monitoring-muted">
              {eventCountsText(shown.counts)}
            </span>
          </p>
          <div
            aria-label={`Ereignisse je ${range === "24h" ? "Stunde" : "Tag"}`}
            className="monitoring-availability__bars"
            role="img"
          >
            {shown.buckets.map((bucket) => (
              <span
                className={`monitoring-availability__bar monitoring-availability__bar--${
                  bucket.level === "up" ? "ok" : bucket.level
                }`}
                key={bucket.from}
                title={`${eventTime(bucket.from, now)}: ${
                  bucket.level === "none"
                    ? "kein Ereignis"
                    : EVENT_LABELS[bucket.level]
                }`}
              />
            ))}
          </div>
          <div className="monitoring-availability__axis">
            <span>vor {range === "24h" ? "24 Stunden" : "7 Tagen"}</span>
            <span>jetzt</span>
          </div>
          <button
            aria-expanded={expanded}
            className="monitoring-availability__toggle"
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            <span>Ereignisse anzeigen{total ? ` (${total})` : ""}</span>
            <ChevronDown aria-hidden="true" size={16} />
          </button>
          {expanded ? (
            shown.events.length === 0 ? (
              <p className="monitoring__empty">
                In diesem Zeitraum hat sich kein Zustand geändert.
              </p>
            ) : (
              <>
                <ul className="monitoring-events">
                  {events.map((event) => (
                    <li key={event.id}>
                      <span className="monitoring-events__time">
                        {eventTime(event.at, now)}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`monitoring-dot monitoring-dot--${
                          event.kind === "up"
                            ? "up"
                            : event.kind === "warning"
                              ? "warning"
                              : event.kind === "down"
                                ? "down"
                                : "paused"
                        }`}
                      />
                      <div className="monitoring-events__main">
                        <span>
                          {event.assetId ? (
                            <button
                              className="text-button"
                              onClick={() => onOpenDevice(event.assetId!)}
                              type="button"
                            >
                              {event.deviceName}
                            </button>
                          ) : (
                            <strong>{event.deviceName}</strong>
                          )}
                          {event.sensorName ? ` · ${event.sensorName}` : ""}
                          {event.test ? (
                            <span className="monitoring-chip monitoring-chip--warning">
                              Test
                            </span>
                          ) : null}
                        </span>
                        <span className="monitoring-muted">
                          {eventText(event)}
                        </span>
                        {event.kind === "paused" ||
                        event.kind === "resumed" ? null : (
                          <span className="monitoring-events__services">
                            {event.services.length ? (
                              event.services.map((service) => (
                                <span
                                  className="monitoring-service-chip"
                                  key={service}
                                >
                                  {service}
                                </span>
                              ))
                            ) : (
                              <span className="monitoring-muted">
                                kein Dienst verknüpft
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                      {event.incident && onOpenIncident ? (
                        <button
                          className="text-button"
                          onClick={() => onOpenIncident(event.incident!.id)}
                          type="button"
                        >
                          {event.incident.number}
                        </button>
                      ) : (
                        <span
                          className={`monitoring-chip monitoring-chip--${
                            event.kind === "up" ? "up" : event.kind
                          }`}
                        >
                          {EVENT_LABELS[event.kind]}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {shown.events.length > 5 ? (
                  <button
                    className="text-button monitoring-form__all"
                    onClick={() => setAll((value) => !value)}
                    type="button"
                  >
                    {all
                      ? "Weniger anzeigen"
                      : `Weitere ${shown.events.length - 5} anzeigen`}
                  </button>
                ) : null}
              </>
            )
          ) : null}
        </>
      ) : null}
    </article>
  );
}

/**
 * Availability of the monitored devices: overall value, a bar per day, and
 * the devices that were down most with the services affected.
 */
function AvailabilityCard({
  tenantId,
  onOpenDevice,
}: {
  tenantId: string;
  onOpenDevice: (assetId: string) => void;
}) {
  const [range, setRange] = useState<AvailabilityRange>("30d");
  const [data, setData] = useState<MonitoringAvailability | null>(null);
  // The list of devices is folded in until it is asked for.
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      monitoringCall<MonitoringAvailability>({
        type: "availability",
        tenantId,
        range,
      })
        .then((result) => {
          if (cancelled) return;
          setData(result);
          setError(null);
        })
        .catch((failure) => {
          if (!cancelled) setError(message(failure));
        });
    void load();
    // Outages end and begin; the value drifts slowly.
    const timer = window.setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tenantId, range]);
  const shown = data && data.range === range ? data : null;
  const unit = range === "1y" ? "Woche" : "Tag";
  return (
    <article className="monitoring-card">
      <div className="monitoring-card__head">
        <h3>Verfügbarkeit</h3>
        <div
          aria-label="Zeitraum der Verfügbarkeit"
          className="monitoring-toggle"
          role="group"
        >
          {(Object.keys(AVAILABILITY_RANGE_LABELS) as AvailabilityRange[]).map(
            (key) => (
              <button
                aria-pressed={range === key}
                key={key}
                onClick={() => setRange(key)}
                type="button"
              >
                {AVAILABILITY_RANGE_LABELS[key]}
              </button>
            ),
          )}
        </div>
      </div>
      {error ? (
        <p className="ticket-detail-message error" role="alert">
          {error}
        </p>
      ) : null}
      {!shown && !error ? <Spinner label="Wird berechnet …" /> : null}
      {shown ? (
        <>
          <p className="monitoring-availability__value">
            <strong>
              {shown.overall === null ? "–" : formatPercent(shown.overall)}
            </strong>
            <span className="monitoring-muted">
              {shown.devices === 0
                ? "noch kein Gerät überwacht"
                : shown.devices === 1
                  ? "über 1 Gerät"
                  : `über alle ${shown.devices} Geräte`}
            </span>
          </p>
          <div
            aria-label={`Verfügbarkeit je ${unit}`}
            className="monitoring-availability__bars"
            role="img"
          >
            {shown.buckets.map((bucket) => (
              <span
                className={`monitoring-availability__bar monitoring-availability__bar--${bucket.level}`}
                key={bucket.from}
                title={`${new Date(bucket.from).toLocaleDateString("de-CH")}: ${
                  bucket.availability === null
                    ? "noch nicht überwacht"
                    : formatPercent(bucket.availability)
                }`}
              />
            ))}
          </div>
          <div className="monitoring-availability__axis">
            <span>
              vor{" "}
              {AVAILABILITY_RANGE_LABELS[range]
                .replace("Tage", "Tagen")
                .replace("1 Jahr", "einem Jahr")}
            </span>
            <span>heute</span>
          </div>
          <button
            aria-expanded={expanded}
            className="monitoring-availability__toggle"
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            <span>
              Am häufigsten ausgefallen
              {shown.worst.length ? ` (${shown.worst.length})` : ""}
            </span>
            <ChevronDown aria-hidden="true" size={16} />
          </button>
          {expanded ? (
            <>
              {shown.worst.length === 0 ? (
                <p className="monitoring__empty">
                  In diesem Zeitraum ist kein Gerät ausgefallen.
                </p>
              ) : (
                <ul className="monitoring-availability__list">
                  {shown.worst.map((device) => (
                    <li key={device.assetId}>
                      <div className="monitoring-availability__device">
                        <span>
                          <button
                            className="text-button"
                            onClick={() => onOpenDevice(device.assetId)}
                            type="button"
                          >
                            {device.name}
                          </button>
                          {device.services.length ? (
                            device.services.map((service) => (
                              <span
                                className="monitoring-service-chip"
                                key={service}
                              >
                                {service}
                              </span>
                            ))
                          ) : (
                            <span className="monitoring-muted">
                              kein Dienst verknüpft
                            </span>
                          )}
                        </span>
                        <span className="monitoring-muted">
                          {device.outages === 1
                            ? "1 Ausfall"
                            : `${device.outages} Ausfälle`}{" "}
                          · {formatDowntime(device.downSeconds)} gesamt
                        </span>
                      </div>
                      <span
                        aria-hidden="true"
                        className="monitoring-availability__meter"
                      >
                        <i
                          className={
                            device.availability >= 99.5
                              ? "is-ok"
                              : device.availability >= 98
                                ? "is-warning"
                                : "is-down"
                          }
                          style={{
                            width: `${Math.max(device.availability, 2)}%`,
                          }}
                        />
                      </span>
                      <strong>{formatPercent(device.availability)}</strong>
                    </li>
                  ))}
                </ul>
              )}
              <p className="monitoring-muted">
                Aus den Ausfällen der eigenen Sensoren, ab dem Tag der
                Überwachung. Warnungen und simulierte Ausfälle zählen nicht.
              </p>
            </>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

function ProbeCard({
  tenantId,
  data,
  now,
  onAdd,
  onChanged,
  onError,
}: {
  tenantId: string;
  data: MonitoringOverview;
  now: number;
  onAdd: () => void;
  /** A probe was renamed, deactivated or removed. */
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [editing, setEditing] = useState<MonitoringAgent | null>(null);
  const [removing, setRemoving] = useState<MonitoringAgent | null>(null);
  const download = async () => {
    setDownloading(true);
    onError(null);
    try {
      await downloadProbePackage(tenantId);
    } catch (failure) {
      onError(message(failure));
    } finally {
      setDownloading(false);
    }
  };
  const outdated = data.agents.some((agent) => agent.updateAvailable);
  return (
    <article className="monitoring-card">
      <div className="monitoring-card__head">
        <h3>Sonden</h3>
        {data.canManage ? (
          <button className="secondary-button" onClick={onAdd} type="button">
            <Plus aria-hidden="true" size={16} />
            Sonde hinzufügen
          </button>
        ) : null}
      </div>
      {data.agents.length === 0 ? (
        <p className="monitoring__empty">Keine Sonde vorhanden.</p>
      ) : (
        <ul className="monitoring-agents">
          {data.agents.map((agent) => (
            <li key={agent.id}>
              <span
                aria-hidden="true"
                className={`monitoring-dot monitoring-dot--${agent.online ? "up" : "down"}`}
              />
              <span className="monitoring-agents__main">
                <strong>{agent.name}</strong>
                <span>
                  {agent.online
                    ? "online"
                    : agent.active
                      ? "meldet sich nicht"
                      : "deaktiviert"}
                  {` · ${agent.sensorCount ?? 0} Sensoren`}
                  {agent.version ? ` · Version ${agent.version}` : ""}
                </span>
              </span>
              {agent.updateAvailable ? (
                <span className="monitoring-chip monitoring-chip--warning">
                  Aktualisierung verfügbar
                </span>
              ) : null}
              <span className="monitoring-muted">
                {formatAgo(agent.lastSeenAt, now)}
              </span>
              {data.canManage ? (
                <span className="monitoring-table__actions">
                  <button
                    aria-label={`Sonde ${agent.name} bearbeiten`}
                    className="icon-button"
                    onClick={() => setEditing(agent)}
                    title="Bearbeiten"
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={16} />
                  </button>
                  <button
                    aria-label={`Sonde ${agent.name} löschen`}
                    className="icon-button"
                    onClick={() => setRemoving(agent)}
                    title="Löschen"
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={16} />
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {data.canManage ? (
        <div className="monitoring-package">
          <div>
            <strong>Installationspaket</strong>
            <span className="monitoring-muted">
              {data.probePackage
                ? `Version ${data.probePackage.version} · ${formatSize(data.probePackage.size)} · gebaut ${formatAgo(data.probePackage.builtAt, now)}`
                : "Noch nicht veröffentlicht."}
            </span>
            {outdated ? (
              <span className="monitoring-muted">
                Zum Aktualisieren das Paket auf dem Server entpacken und das
                Installationsskript erneut ausführen. Die Konfiguration bleibt
                erhalten.
              </span>
            ) : null}
          </div>
          <button
            className="secondary-button"
            disabled={!data.probePackage || downloading}
            onClick={() => void download()}
            type="button"
          >
            <Download aria-hidden="true" size={16} />
            Sonde herunterladen
          </button>
        </div>
      ) : null}
      {editing ? (
        <AgentDialog
          agent={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
          tenantId={tenantId}
        />
      ) : null}
      {removing ? (
        <RemoveAgentDialog
          agent={removing}
          agents={data.agents}
          onClose={() => setRemoving(null)}
          onRemoved={() => {
            setRemoving(null);
            onChanged();
          }}
          tenantId={tenantId}
        />
      ) : null}
    </article>
  );
}

/** Einstellungen → Monitoring: Sonden und Installationspaket. */
export function MonitoringProbeSettings({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<MonitoringOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => {
    monitoringCall<MonitoringOverview>({ type: "overview", tenantId })
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((failure) => setError(message(failure)));
  }, [tenantId]);
  useEffect(load, [load]);
  const now = useNow(load);
  return (
    <section className="monitoring" aria-labelledby="monitoring-probes-title">
      <header className="monitoring__hero">
        <div>
          <h2 id="monitoring-probes-title">Überwachung</h2>
          <p>
            Sonden messen die überwachten Geräte vor Ort. Hier lassen sich
            Sonden anlegen und das Installationspaket herunterladen. Geräte und
            Sensoren werden unter «Dienste und Überwachung → Überwachung»
            verwaltet.
          </p>
        </div>
      </header>
      {error ? (
        <p className="ticket-detail-message error" role="alert">
          {error}
        </p>
      ) : null}
      {!data && !error ? <Spinner label="Sonden werden geladen …" /> : null}
      {data ? (
        <ProbeCard
          data={data}
          now={now}
          onAdd={() => setAdding(true)}
          onChanged={load}
          onError={setError}
          tenantId={tenantId}
        />
      ) : null}
      {adding ? (
        <ProbeDialog
          onClose={() => {
            setAdding(false);
            load();
          }}
          tenantId={tenantId}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Gerätedetail

function DeviceView({
  tenantId,
  assetId,
  onBack,
  onOpenDevice,
  onOpenIncident,
  onOpenInfrastructure,
  onOpenTicket,
}: Props & {
  assetId: string;
  onBack: () => void;
  onOpenDevice: (assetId: string) => void;
}) {
  const [data, setData] = useState<MonitoringDeviceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ticket = useDeviceTicket(tenantId, onOpenTicket, setError);
  const [selected, setSelected] = useState<string | null>(null);
  const [range, setRange] = useState<MonitoringRange>("24h");
  const [series, setSeries] = useState<MonitoringSeries | null>(null);
  const [draft, setDraft] = useState<SensorDraft | null>(null);
  const [addingPorts, setAddingPorts] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const [simulating, setSimulating] = useState(false);

  const load = useCallback(() => {
    monitoringCall<MonitoringDeviceDetail>({
      type: "device",
      tenantId,
      assetId,
    })
      .then((result) => {
        setData(result);
        setError(null);
        setSelected((current) =>
          current && result.sensors.some((sensor) => sensor.id === current)
            ? current
            : (result.sensors[0]?.id ?? null),
        );
      })
      .catch((failure) => setError(message(failure)));
  }, [tenantId, assetId]);
  useEffect(load, [load]);
  const now = useNow(load);

  useEffect(() => {
    if (!selected) {
      setSeries(null);
      return;
    }
    let cancelled = false;
    monitoringCall<MonitoringSeries>({
      type: "series",
      tenantId,
      sensorId: selected,
      range,
    })
      .then((result) => {
        if (!cancelled) setSeries(result);
      })
      .catch(() => {
        if (!cancelled) setSeries(null);
      });
    return () => {
      cancelled = true;
    };
    // The chart follows the periodic reload of the device.
  }, [tenantId, selected, range, data?.checkedAt]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await monitoringCall({ ...body, tenantId });
      load();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  const sensor = data?.sensors.find((entry) => entry.id === selected) ?? null;
  const allPaused =
    !!data?.sensors.length && data.sensors.every((entry) => entry.paused);
  const defaultAgent =
    data?.sensors.find((entry) => entry.agentId)?.agentId ??
    data?.agents.find((agent) => agent.active)?.id ??
    null;

  return (
    <section className="monitoring" aria-labelledby="monitoring-device-title">
      <button
        className="text-button monitoring__back"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft aria-hidden="true" size={15} />
        Überwachung
      </button>
      {error ? (
        <p className="ticket-detail-message error" role="alert">
          {error}
        </p>
      ) : null}
      {!data && !error ? <Spinner label="Gerät wird geladen …" /> : null}
      {data ? (
        <>
          {(() => {
            const running = data.sensors.filter(
              (sensor) => sensor.simulateUntil,
            );
            if (!running.length) return null;
            const until = running
              .map((sensor) => Date.parse(sensor.simulateUntil!))
              .sort((a, b) => b - a)[0]!;
            return (
              <p className="monitoring__notice monitoring__notice--test">
                <FlaskConical aria-hidden="true" size={16} />
                <span>
                  <strong>Simulation läuft</strong> für{" "}
                  {running.length === 1
                    ? `Sensor «${running[0]!.name}»`
                    : `${running.length} Sensoren`}{" "}
                  bis{" "}
                  {new Date(until).toLocaleTimeString("de-CH", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  Uhr. Die Messwerte gelten solange als Ausfall; Störung und
                  Alarmierung sind echt.
                </span>
                {data.canManage ? (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      monitoringCall({
                        type: "simulate",
                        tenantId,
                        assetId,
                        sensorId: null,
                        minutes: 0,
                      })
                        .then(load)
                        .catch((failure) => setError(message(failure)))
                        .finally(() => setBusy(false));
                    }}
                    type="button"
                  >
                    Simulation beenden
                  </button>
                ) : null}
              </p>
            );
          })()}
          <header className="monitoring__hero monitoring__hero--stack">
            <div>
              <div className="monitoring__title">
                <h2 id="monitoring-device-title">{data.device.name}</h2>
                <StateChip state={data.device.state} />
              </div>
              <p>
                {[
                  categoryText(data.device.category, data.device.categoryLabel),
                  data.device.ipAddress,
                  data.device.hostname,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {data.canManage ? (
              <div className="monitoring__actions">
                {data.sensors.length ? (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void (async () => {
                        const reason = allPaused
                          ? null
                          : await askPauseReason(`«${data.device.name}»`);
                        if (!allPaused && reason === null) return;
                        await act({
                          type: "pauseDevice",
                          assetId,
                          paused: !allPaused,
                          ...(reason ? { reason } : {}),
                        });
                      })()
                    }
                    type="button"
                  >
                    {allPaused ? (
                      <Play aria-hidden="true" size={16} />
                    ) : (
                      <Pause aria-hidden="true" size={16} />
                    )}
                    {allPaused ? "Fortsetzen" : "Pausieren"}
                  </button>
                ) : null}
                {onOpenInfrastructure ? (
                  <button
                    className="secondary-button"
                    onClick={() => onOpenInfrastructure(assetId)}
                    type="button"
                  >
                    <Network aria-hidden="true" size={16} />
                    In Infrastruktur öffnen
                  </button>
                ) : null}
                <button
                  className="secondary-button"
                  onClick={() => setEditing(true)}
                  type="button"
                >
                  <Pencil aria-hidden="true" size={16} />
                  Bearbeiten
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    setConfirming({
                      title: "Gerät aus der Überwachung entfernen",
                      text: `«${data.device.name}» aus der Überwachung entfernen? Alle Sensoren und ihr Verlauf werden gelöscht. Das Gerät bleibt in der Infrastruktur.`,
                      label: "Entfernen",
                      run: () => {
                        setBusy(true);
                        monitoringCall({
                          type: "removeDevice",
                          tenantId,
                          assetId,
                        })
                          .then(onBack)
                          .catch((failure) => {
                            setError(message(failure));
                            setBusy(false);
                          });
                      },
                    })
                  }
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={16} />
                  Entfernen
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setSimulating(true)}
                  type="button"
                >
                  <FlaskConical aria-hidden="true" size={16} />
                  Ausfall simulieren
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setAddingPorts(true)}
                  type="button"
                >
                  <ListPlus aria-hidden="true" size={16} />
                  Ports hinzufügen
                </button>
                <button
                  className="primary-button"
                  onClick={() => setDraft(emptyDraft(assetId, defaultAgent))}
                  type="button"
                >
                  <Plus aria-hidden="true" size={16} />
                  Sensor hinzufügen
                </button>
              </div>
            ) : null}
          </header>

          <div className="monitoring__columns monitoring__columns--detail">
            <div className="monitoring__stack">
              {sensor ? (
                <article className="monitoring-card">
                  <div className="monitoring-card__head">
                    <div>
                      <h3>
                        {sensor.name} · {valueLabel(sensor.unit)}
                      </h3>
                      <span className="monitoring-muted">
                        Aktuell {sensorValueText(sensor)}
                        {series?.availability !== null &&
                        series?.availability !== undefined
                          ? ` · Verfügbarkeit ${series.availability.toLocaleString("de-CH")} %`
                          : ""}
                      </span>
                    </div>
                    <div
                      aria-label="Zeitraum"
                      className="queue-tabs"
                      role="group"
                    >
                      {(Object.keys(RANGE_LABELS) as MonitoringRange[]).map(
                        (entry) => (
                          <button
                            aria-pressed={range === entry}
                            className={
                              range === entry
                                ? "queue-tab selected"
                                : "queue-tab"
                            }
                            key={entry}
                            onClick={() => setRange(entry)}
                            type="button"
                          >
                            {RANGE_LABELS[entry]}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                  {series &&
                  series.sensorId === sensor.id &&
                  series.points.length ? (
                    <Chart
                      now={now}
                      series={series}
                      traffic={sensor.snmpMetric === "traffic"}
                      unit={sensor.unit}
                      warningAbove={sensor.warningAbove}
                    />
                  ) : (
                    <p className="monitoring__empty">
                      Für diesen Zeitraum liegen noch keine Messwerte vor.
                    </p>
                  )}
                </article>
              ) : null}

              <article className="monitoring-card monitoring-card--flush">
                <div className="monitoring-card__head monitoring-card__head--padded">
                  <h3>Sensoren</h3>
                  <span className="monitoring-muted">
                    {data.sensors.length}
                  </span>
                </div>
                {data.sensors.length === 0 ? (
                  <p className="monitoring__empty">
                    Dieses Gerät hat noch keinen Sensor.
                  </p>
                ) : (
                  <div className="monitoring__scroll">
                    <table className="monitoring-table">
                      <thead>
                        <tr>
                          <th scope="col">Status</th>
                          <th scope="col">Sensor</th>
                          <th scope="col">Messwert</th>
                          <th scope="col">Intervall</th>
                          <th scope="col">Letzte Prüfung</th>
                          {data.canManage ? (
                            <th scope="col">
                              <span className="sr-only">Aktionen</span>
                            </th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {data.sensors.map((entry) => (
                          <SensorRow
                            agents={data.agents}
                            busy={busy}
                            canManage={data.canManage}
                            device={data.device}
                            key={entry.id}
                            now={now}
                            onDelete={() =>
                              setConfirming({
                                title: "Sensor löschen",
                                text: `Sensor «${entry.name}» mit seinem Verlauf löschen?`,
                                label: "Löschen",
                                run: () =>
                                  void act({
                                    type: "deleteSensor",
                                    sensorId: entry.id,
                                  }),
                              })
                            }
                            onEdit={() => setDraft(draftFromSensor(entry))}
                            onSelect={() => setSelected(entry.id)}
                            selected={entry.id === selected}
                            sensor={entry}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>

              <ConnectionsCard
                assetId={assetId}
                now={now}
                onOpenDevice={onOpenDevice}
                onOpenInfrastructure={onOpenInfrastructure}
                tenantId={tenantId}
              />
            </div>

            <article className="monitoring-card">
              <div className="monitoring-card__head">
                <h3>Verknüpft in nextDesk</h3>
              </div>
              <dl className="monitoring-facts">
                <dt>Infrastruktur</dt>
                <dd>
                  {onOpenInfrastructure ? (
                    <button
                      className="text-button"
                      onClick={() => onOpenInfrastructure(assetId)}
                      type="button"
                    >
                      {data.device.name} öffnen
                    </button>
                  ) : (
                    data.device.name
                  )}
                </dd>
                <dt>Störung</dt>
                <dd>
                  {data.device.incident ? (
                    onOpenIncident ? (
                      <button
                        className="text-button"
                        onClick={() => onOpenIncident(data.device.incident!.id)}
                        type="button"
                      >
                        {data.device.incident.number} ·{" "}
                        {data.device.incident.acknowledged
                          ? "bestätigt"
                          : "offen"}
                      </button>
                    ) : (
                      data.device.incident.number
                    )
                  ) : (
                    "keine offene Störung"
                  )}
                </dd>
                {onOpenTicket &&
                (data.device.state === "down" ||
                  data.device.state === "warning") ? (
                  <>
                    <dt>Ticket</dt>
                    <dd>
                      <button
                        className="text-button"
                        disabled={ticket.busy !== null}
                        onClick={() =>
                          void ticket.create(assetId, data.device.name)
                        }
                        type="button"
                      >
                        {ticket.busy
                          ? "Ticket wird erstellt …"
                          : "Ticket zum Ausfall erstellen"}
                      </button>
                    </dd>
                  </>
                ) : null}
                <dt>Services</dt>
                <dd>
                  {data.device.services.length
                    ? data.device.services.map((entry) => entry.name).join(", ")
                    : "keine verknüpft"}
                </dd>
                <dt>Uplink</dt>
                <dd>
                  {data.device.uplink ? (
                    <button
                      className="text-button"
                      onClick={() => onOpenDevice(data.device.uplink!.assetId)}
                      type="button"
                    >
                      {data.device.uplink.name}
                    </button>
                  ) : (
                    "nicht erfasst"
                  )}
                </dd>
              </dl>
              <p className="monitoring-muted">
                Services und Uplink werden unter Infrastruktur gepflegt. Bei
                einem Ausfall gelten Geräte hinter diesem Gerät als
                Folgestörung.
              </p>
            </article>
          </div>
        </>
      ) : null}

      {simulating && data ? (
        <SimulateDialog
          assetId={assetId}
          deviceName={data.device.name}
          onClose={() => setSimulating(false)}
          onStarted={() => {
            setSimulating(false);
            load();
          }}
          sensors={data.sensors}
          tenantId={tenantId}
        />
      ) : null}
      {confirming ? (
        <ConfirmDialog
          confirmation={confirming}
          onClose={() => setConfirming(null)}
        />
      ) : null}
      {editing && data ? (
        <DeviceDialog
          device={data.device}
          kinds={data.kinds ?? []}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
          tenantId={tenantId}
        />
      ) : null}
      {addingPorts && data ? (
        <PortsDialog
          agents={data.agents}
          assetId={assetId}
          defaultAgent={defaultAgent}
          existing={data.sensors}
          onClose={() => {
            setAddingPorts(false);
            load();
          }}
          tenantId={tenantId}
        />
      ) : null}
      {draft && data ? (
        <SensorDialog
          agents={data.agents}
          deviceServices={data.device.services.map((entry) => entry.name)}
          draft={draft}
          services={data.serviceOptions ?? []}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            load();
          }}
          tenantId={tenantId}
        />
      ) : null}
    </section>
  );
}

function SensorRow({
  sensor,
  device,
  agents,
  now,
  selected,
  canManage,
  busy,
  onSelect,
  onEdit,
  onDelete,
}: {
  sensor: MonitoringSensor;
  device: MonitoringDeviceDetail["device"];
  agents: MonitoringAgent[];
  now: number;
  selected: boolean;
  canManage: boolean;
  busy: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const agent = agents.find((entry) => entry.id === sensor.agentId);
  return (
    <tr className={selected ? "monitoring-table__row--selected" : undefined}>
      <td>
        <StateChip state={sensor.state} />
        {sensor.simulateUntil ? (
          <span className="monitoring-chip monitoring-chip--warning">
            Simulation
          </span>
        ) : null}
      </td>
      <td>
        <button
          aria-pressed={selected}
          className="text-button monitoring-table__name"
          onClick={onSelect}
          type="button"
        >
          {sensor.name}
        </button>
        <span className="monitoring-muted">
          {kindLabel(sensor)} · {sensorTarget(sensor, device)} ·{" "}
          {sensor.cloud
            ? "nextDesk Cloud"
            : agent
              ? agent.name
              : "keine Sonde zugewiesen"}
        </span>
        {sensor.paused ? (
          <span className="monitoring-pause-note">
            {pauseText({
              reason: sensor.pausedReason ?? null,
              by: sensor.pausedByName ?? null,
            })}
            {sensor.pausedAt ? ` · ${formatAgo(sensor.pausedAt, now)}` : ""}
          </span>
        ) : null}
      </td>
      <td>
        {sensor.state === "down"
          ? (sensor.lastMessage ?? "Keine Antwort")
          : sensorValueText(sensor)}
        {thresholdText(sensor) ? (
          <span className="monitoring-muted">{thresholdText(sensor)}</span>
        ) : null}
      </td>
      <td>{intervalLabel(sensor.intervalSeconds)}</td>
      <td className="monitoring-muted">{formatAgo(sensor.lastCheckAt, now)}</td>
      {canManage ? (
        <td className="monitoring-table__actions">
          <button
            aria-label={`Sensor ${sensor.name} bearbeiten`}
            className="icon-button"
            disabled={busy}
            onClick={onEdit}
            type="button"
          >
            <Pencil aria-hidden="true" size={15} />
          </button>
          <button
            aria-label={`Sensor ${sensor.name} löschen`}
            className="icon-button"
            disabled={busy}
            onClick={onDelete}
            type="button"
          >
            <Trash2 aria-hidden="true" size={15} />
          </button>
        </td>
      ) : null}
    </tr>
  );
}

function Chart({
  series,
  now,
  warningAbove,
  unit,
  traffic,
}: {
  series: MonitoringSeries;
  now: number;
  warningAbove: number | null;
  unit: string | null;
  traffic: boolean;
}) {
  const chart = useMemo(
    () =>
      chartGeometry(
        { ...series, unit },
        Math.max(now, Date.now()),
        warningAbove,
      ),
    [series, now, warningAbove, unit],
  );
  const failed = chart.failures.length;
  return (
    <>
      {traffic ? (
        <p className="monitoring-legend">
          <span className="monitoring-legend__in">eingehend</span>
          <span className="monitoring-legend__out">ausgehend</span>
        </p>
      ) : null}
      <svg
        aria-label={`${valueLabel(unit)} über ${RANGE_LABELS[series.range]}${traffic ? ", eingehend und ausgehend" : ""}${failed ? `, ${failed} Abschnitte mit fehlgeschlagenen Prüfungen` : ""}`}
        className="monitoring-chart"
        role="img"
        viewBox={`0 0 ${chart.width} ${chart.height}`}
      >
        {chart.yTicks.map((tick) => (
          <g key={tick.y}>
            <line
              className="monitoring-chart__grid"
              x1={46}
              x2={chart.width - 10}
              y1={tick.y}
              y2={tick.y}
            />
            <text
              className="monitoring-chart__label"
              textAnchor="end"
              x={40}
              y={tick.y + 4}
            >
              {tick.label}
            </text>
          </g>
        ))}
        {chart.xTicks.map((tick, index) => (
          <text
            className="monitoring-chart__label"
            key={tick.x}
            textAnchor={
              index === 0
                ? "start"
                : index === chart.xTicks.length - 1
                  ? "end"
                  : "middle"
            }
            x={tick.x}
            y={chart.height - 6}
          >
            {tick.label}
          </text>
        ))}
        {chart.failures.map((failure) => (
          <rect
            className="monitoring-chart__failure"
            height={chart.height - 32}
            key={failure.x}
            opacity={0.25 + failure.share * 0.5}
            width={failure.width}
            x={failure.x}
            y={10}
          />
        ))}
        {chart.bands.map((path) => (
          <path className="monitoring-chart__band" d={path} key={path} />
        ))}
        {chart.threshold !== null ? (
          <line
            className="monitoring-chart__threshold"
            x1={46}
            x2={chart.width - 10}
            y1={chart.threshold}
            y2={chart.threshold}
          />
        ) : null}
        {chart.lines2.map((path) => (
          <path className="monitoring-chart__line2" d={path} key={path} />
        ))}
        {chart.lines.map((path) => (
          <path className="monitoring-chart__line" d={path} key={path} />
        ))}
      </svg>
    </>
  );
}

// ---------------------------------------------------------------------------
// Dialoge

const SIMULATION_MINUTES = [5, 10, 15, 30, 60];

/**
 * Starts a simulated outage of the device or of one sensor, to test the
 * chain from the sensor to incident, alerting and banner.
 */
function SimulateDialog({
  tenantId,
  assetId,
  deviceName,
  sensors,
  onClose,
  onStarted,
}: {
  tenantId: string;
  assetId: string;
  deviceName: string;
  sensors: MonitoringSensor[];
  onClose: () => void;
  onStarted: () => void;
}) {
  const active = sensors.filter((sensor) => !sensor.paused);
  const [sensorId, setSensorId] = useState("");
  const [minutes, setMinutes] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await monitoringCall({
        type: "simulate",
        tenantId,
        assetId,
        sensorId: sensorId || null,
        minutes,
      });
      onStarted();
    } catch (failure) {
      setError(message(failure));
      setSaving(false);
    }
  };
  return (
    <Dialog onClose={onClose} title="Ausfall simulieren">
      <form
        className="monitoring-form"
        onSubmit={(event) => void submit(event)}
      >
        <p className="monitoring-muted">
          Die Messwerte gelten für die gewählte Dauer als fehlgeschlagen. Das
          Gerät selbst wird nicht berührt.
        </p>
        <label className="monitoring-field">
          <span>Was soll ausfallen?</span>
          <select
            onChange={(event) => setSensorId(event.target.value)}
            value={sensorId}
          >
            <option value="">
              Ganzes Gerät «{deviceName}» ({active.length}{" "}
              {active.length === 1 ? "Sensor" : "Sensoren"})
            </option>
            {active.map((sensor) => (
              <option key={sensor.id} value={sensor.id}>
                Nur Sensor «{sensor.name}»
              </option>
            ))}
          </select>
        </label>
        <label className="monitoring-field">
          <span>Dauer</span>
          <select
            onChange={(event) => setMinutes(Number(event.target.value))}
            value={minutes}
          >
            {SIMULATION_MINUTES.map((value) => (
              <option key={value} value={value}>
                {value} Minuten
              </option>
            ))}
          </select>
          <span className="monitoring-muted">
            Die Simulation endet danach von selbst und lässt sich vorher
            beenden.
          </span>
        </label>
        <p className="ticket-detail-message error" role="note">
          Alles Weitere ist echt: nextDesk öffnet eine Störung, alarmiert das
          Team, ändert den Systemstatus der betroffenen Dienste und zeigt –
          falls eingeschaltet – den Banner für alle. Der Ausfall erscheint mit
          der nächsten Messung des Sensors.
        </p>
        {active.length === 0 ? (
          <p className="ticket-detail-message error" role="alert">
            Das Gerät hat keinen aktiven Sensor.
          </p>
        ) : null}
        {error ? (
          <p className="ticket-detail-message error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="monitoring-form__actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Abbrechen
          </button>
          <button
            className="primary-button monitoring-danger"
            disabled={saving || active.length === 0}
            type="submit"
          >
            <FlaskConical aria-hidden="true" size={16} />
            Simulation starten
          </button>
        </div>
      </form>
    </Dialog>
  );
}

type Confirmation = {
  title: string;
  text: string;
  /** Label of the confirming button, e.g. «Entfernen». */
  label: string;
  run: () => void;
};

/** Question before something is deleted, in the look of nextDesk. */
function ConfirmDialog({
  confirmation,
  onClose,
}: {
  confirmation: Confirmation;
  onClose: () => void;
}) {
  return (
    <Dialog onClose={onClose} title={confirmation.title}>
      <div className="monitoring-form">
        <p>{confirmation.text}</p>
        <div className="monitoring-form__actions">
          <button
            autoFocus
            className="secondary-button"
            onClick={onClose}
            type="button"
          >
            Abbrechen
          </button>
          <button
            className="primary-button monitoring-danger"
            onClick={() => {
              onClose();
              confirmation.run();
            }}
            type="button"
          >
            <Trash2 aria-hidden="true" size={16} />
            {confirmation.label}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      aria-labelledby={titleId}
      className="monitoring-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={ref}
    >
      <h3 id={titleId}>{title}</h3>
      {children}
    </dialog>
  );
}

const CLOUD = "cloud";

/**
 * Who measures: a probe, or (for kinds nextDesk can reach itself) the cloud.
 * Without `onCloud` the cloud option is hidden.
 */
function AgentSelect({
  agents,
  value,
  onChange,
  cloud,
  onCloud,
}: {
  agents: MonitoringAgent[];
  value: string | null;
  onChange: (value: string | null) => void;
  cloud?: boolean;
  onCloud?: (cloud: boolean) => void;
}) {
  return (
    <label className="monitoring-field">
      <span>{onCloud ? "Gemessen von" : "Sonde"}</span>
      <select
        onChange={(event) => {
          const next = event.target.value;
          if (onCloud) onCloud(next === CLOUD);
          onChange(next && next !== CLOUD ? next : null);
        }}
        value={cloud ? CLOUD : (value ?? "")}
      >
        <option value="">Keine (Sensor wird nicht gemessen)</option>
        {onCloud ? (
          <option value={CLOUD}>
            nextDesk Cloud (ohne Sonde, nur öffentliche Ziele)
          </option>
        ) : null}
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
            {agent.online ? "" : " (offline)"}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  step,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  step?: string;
}) {
  return (
    <label className="monitoring-field">
      <span>{label}</span>
      <input
        inputMode="decimal"
        min={min}
        onChange={(event) =>
          onChange(
            event.target.value === "" ? null : Number(event.target.value),
          )
        }
        step={step ?? "any"}
        type="number"
        value={value ?? ""}
      />
    </label>
  );
}

function SensorFields({
  draft,
  onChange,
}: {
  draft: SensorDraft;
  onChange: (patch: Partial<SensorDraft>) => void;
}) {
  const snmpValue = draft.kind === "snmp" && draft.snmpMetric === "value";
  const unit = draft.unit ? ` in ${draft.unit}` : "";
  return (
    <>
      {draft.kind === "tcp" ? (
        <label className="monitoring-field">
          <span>Port</span>
          <input
            inputMode="numeric"
            max={65535}
            min={1}
            onChange={(event) =>
              onChange({
                port: event.target.value ? Number(event.target.value) : null,
              })
            }
            required
            type="number"
            value={draft.port ?? ""}
          />
        </label>
      ) : null}
      {draft.kind === "snmp" && draft.snmpMetric === "traffic" ? (
        <label className="monitoring-field">
          <span>Port-Nummer auf dem Gerät (ifIndex)</span>
          <input
            inputMode="numeric"
            min={1}
            onChange={(event) =>
              onChange({
                snmpIndex: event.target.value
                  ? Number(event.target.value)
                  : null,
              })
            }
            required
            type="number"
            value={draft.snmpIndex ?? ""}
          />
        </label>
      ) : null}
      {snmpValue ? (
        <>
          <label className="monitoring-field">
            <span>OID</span>
            <input
              onChange={(event) => onChange({ snmpOid: event.target.value })}
              placeholder="1.3.6.1.4.1.318.1.1.1.2.2.1.0"
              required
              type="text"
              value={draft.snmpOid ?? ""}
            />
          </label>
          <div className="monitoring-field-row">
            <NumberField
              label="Faktor"
              onChange={(scale) => onChange({ scale: scale ?? 1 })}
              value={draft.scale}
            />
            <label className="monitoring-field">
              <span>Einheit (optional)</span>
              <input
                maxLength={12}
                onChange={(event) =>
                  onChange({ unit: event.target.value || null })
                }
                placeholder="%, °C, V …"
                type="text"
                value={draft.unit ?? ""}
              />
            </label>
          </div>
        </>
      ) : null}
      {draft.kind === "http" ? (
        <label className="monitoring-field">
          <span>Adresse (URL)</span>
          <input
            onChange={(event) => onChange({ url: event.target.value })}
            placeholder="https://intranet.example.ch/"
            required
            type="url"
            value={draft.url ?? ""}
          />
        </label>
      ) : draft.kind === "cert" || draft.kind === "dns" ? (
        <>
          <label className="monitoring-field">
            <span>
              {draft.kind === "cert"
                ? "Hostname des Zertifikats"
                : "Name, der aufgelöst wird"}
            </span>
            <input
              onChange={(event) =>
                onChange({ target: event.target.value || null })
              }
              placeholder="intranet.example.ch"
              required
              type="text"
              value={draft.target ?? ""}
            />
          </label>
          {draft.kind === "cert" ? (
            <NumberField
              label="Port"
              min={1}
              onChange={(port) => onChange({ port })}
              step="1"
              value={draft.port ?? 443}
            />
          ) : (
            <label className="monitoring-field">
              <span>Erwartete IP-Adresse (optional)</span>
              <input
                onChange={(event) =>
                  onChange({ expect: event.target.value || null })
                }
                placeholder="z. B. 203.0.113.10"
                type="text"
                value={draft.expect ?? ""}
              />
            </label>
          )}
        </>
      ) : (
        <label className="monitoring-field">
          <span>Abweichendes Ziel (optional)</span>
          <input
            onChange={(event) =>
              onChange({ target: event.target.value || null })
            }
            placeholder="Standard: IP-Adresse des Geräts"
            type="text"
            value={draft.target ?? ""}
          />
        </label>
      )}
      <label className="monitoring-field">
        <span>Intervall</span>
        <select
          onChange={(event) =>
            onChange({ intervalSeconds: Number(event.target.value) })
          }
          value={draft.intervalSeconds}
        >
          {INTERVAL_OPTIONS.map((option) => (
            <option key={option.seconds} value={option.seconds}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {snmpValue ? (
        <>
          <div className="monitoring-field-row">
            <NumberField
              label={`Warnung über${unit}`}
              onChange={(warningAbove) => onChange({ warningAbove })}
              value={draft.warningAbove}
            />
            <NumberField
              label={`Warnung unter${unit}`}
              onChange={(warningBelow) => onChange({ warningBelow })}
              value={draft.warningBelow}
            />
          </div>
          <div className="monitoring-field-row">
            <NumberField
              label={`Ausfall über${unit}`}
              onChange={(downAbove) => onChange({ downAbove })}
              value={draft.downAbove}
            />
            <NumberField
              label={`Ausfall unter${unit}`}
              onChange={(downBelow) => onChange({ downBelow })}
              value={draft.downBelow}
            />
          </div>
        </>
      ) : draft.kind === "cert" ? (
        <div className="monitoring-field-row">
          <NumberField
            label="Warnung unter (Tage)"
            onChange={(warningBelow) => onChange({ warningBelow })}
            value={draft.warningBelow}
          />
          <NumberField
            label="Ausfall unter (Tage)"
            onChange={(downBelow) => onChange({ downBelow })}
            value={draft.downBelow}
          />
        </div>
      ) : draft.kind === "snmp" ? null : (
        <NumberField
          label="Warnung ab Antwortzeit in ms (optional)"
          min={1}
          onChange={(warningAbove) => onChange({ warningAbove })}
          value={draft.warningAbove}
        />
      )}
      <label className="monitoring-field">
        <span>Ausfall nach Fehlversuchen in Folge</span>
        <input
          inputMode="numeric"
          max={10}
          min={1}
          onChange={(event) =>
            onChange({ failuresToDown: Number(event.target.value) || 2 })
          }
          required
          type="number"
          value={draft.failuresToDown}
        />
      </label>
      {draft.kind === "snmp" ? (
        <p className="monitoring-muted">
          Die SNMP-Zugangsdaten stehen in der config.json der Sonde, nicht in
          nextDesk.
        </p>
      ) : null}
    </>
  );
}

function SensorDialog({
  tenantId,
  draft: initial,
  agents,
  services,
  deviceServices,
  onClose,
  onSaved,
}: {
  tenantId: string;
  draft: SensorDraft;
  agents: MonitoringAgent[];
  /** Services of the status page that can be linked. */
  services: { id: string; name: string; category?: string | null }[];
  /** Names of the services linked to the device (apply without own choice). */
  deviceServices: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [serviceQuery, setServiceQuery] = useState("");
  const serviceGroups = groupServiceOptions(services, serviceQuery);
  // Headings only when the services have categories at all.
  const grouped = services.some((service) => service.category);
  const change = (patch: Partial<SensorDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await monitoringCall({ type: "saveSensor", tenantId, sensor: draft });
      onSaved();
    } catch (failure) {
      setError(message(failure));
      setSaving(false);
    }
  };

  return (
    <Dialog
      onClose={onClose}
      title={draft.id ? "Sensor bearbeiten" : "Sensor hinzufügen"}
    >
      <form
        className="monitoring-form"
        onSubmit={(event) => void submit(event)}
      >
        <label className="monitoring-field">
          <span>Art</span>
          <select
            disabled={!!draft.id}
            onChange={(event) => {
              const [kind, metric] = event.target.value.split(":");
              const next = kind as SensorDraft["kind"];
              change({
                kind: next,
                snmpMetric: (metric as SnmpMetric | undefined) ?? null,
                port: null,
                url: null,
                snmpIndex: null,
                snmpOid: null,
                scale: 1,
                expect: null,
                target: null,
                // Only some kinds can be measured from the cloud.
                cloud: draft.cloud && CLOUD_KINDS.includes(next),
                unit:
                  next === "cert"
                    ? "Tg."
                    : metric === "traffic"
                      ? "bit/s"
                      : metric === "uptime"
                        ? "s"
                        : null,
                warningAbove: null,
                warningBelow: next === "cert" ? 30 : null,
                downAbove: null,
                downBelow: next === "cert" ? 7 : null,
              });
            }}
            value={
              draft.kind === "snmp"
                ? `snmp:${draft.snmpMetric ?? "value"}`
                : draft.kind
            }
          >
            <option value="ping">Ping (Gerät erreichbar)</option>
            <option value="tcp">TCP-Port (Dienst erreichbar)</option>
            <option value="http">HTTP (Webseite antwortet)</option>
            <option value="cert">Zertifikat (Ablaufdatum)</option>
            <option value="dns">DNS (Name wird aufgelöst)</option>
            <option value="snmp:traffic">
              SNMP Port-Traffic (ein Port von Hand)
            </option>
            <option value="snmp:uptime">SNMP Laufzeit</option>
            <option value="snmp:value">SNMP Wert (eigene OID)</option>
          </select>
        </label>
        <label className="monitoring-field">
          <span>Name (optional)</span>
          <input
            maxLength={120}
            onChange={(event) => change({ name: event.target.value })}
            placeholder="wird sonst aus der Art gebildet"
            type="text"
            value={draft.name}
          />
        </label>
        {CLOUD_KINDS.includes(draft.kind) ? (
          <AgentSelect
            agents={agents}
            cloud={draft.cloud}
            onChange={(agentId) => change({ agentId })}
            onCloud={(cloud) => change({ cloud })}
            value={draft.agentId}
          />
        ) : (
          <AgentSelect
            agents={agents}
            onChange={(agentId) => change({ agentId })}
            value={draft.agentId}
          />
        )}
        <SensorFields draft={draft} onChange={change} />
        {services.length > 0 ? (
          <fieldset className="monitoring-services">
            <legend>Betroffene Dienste</legend>
            <p className="monitoring-muted">
              {draft.serviceIds?.length
                ? "Bei einem Ausfall dieses Sensors gelten nur die gewählten Dienste als gestört."
                : deviceServices.length
                  ? `Ohne Auswahl gelten die Dienste des Geräts: ${deviceServices.join(", ")}.`
                  : "Ohne Auswahl ist bei einem Ausfall kein Dienst betroffen (am Gerät ist keiner hinterlegt)."}
            </p>
            {draft.serviceIds?.length ? (
              <ul
                aria-label="Gewählte Dienste"
                className="monitoring-services__chosen"
              >
                {services
                  .filter((service) => draft.serviceIds!.includes(service.id))
                  .map((service) => (
                    <li key={service.id}>
                      {service.name}
                      <button
                        aria-label={`${service.name} entfernen`}
                        onClick={() =>
                          change({
                            serviceIds: draft.serviceIds!.filter(
                              (id) => id !== service.id,
                            ),
                          })
                        }
                        type="button"
                      >
                        ×
                      </button>
                    </li>
                  ))}
              </ul>
            ) : null}
            <label className="monitoring__search monitoring-services__search">
              <Search aria-hidden="true" size={15} />
              <span className="sr-only">Dienst suchen</span>
              <input
                onChange={(event) => setServiceQuery(event.target.value)}
                placeholder={`In ${services.length} Diensten suchen (Name oder Kategorie)`}
                type="search"
                value={serviceQuery}
              />
            </label>
            <div className="monitoring-services__list">
              {serviceGroups.map((group) => (
                <div
                  className="monitoring-services__group"
                  key={group.category}
                >
                  {grouped ? (
                    <div className="monitoring-services__category">
                      <span>{group.category}</span>
                      <span>
                        {
                          group.services.filter((service) =>
                            draft.serviceIds?.includes(service.id),
                          ).length
                        }{" "}
                        / {group.services.length}
                      </span>
                    </div>
                  ) : null}
                  {group.services.map((service) => {
                    const chosen =
                      draft.serviceIds?.includes(service.id) ?? false;
                    return (
                      <label
                        className="monitoring-services__item"
                        key={service.id}
                      >
                        <input
                          checked={chosen}
                          onChange={() =>
                            change({
                              serviceIds: chosen
                                ? (draft.serviceIds ?? []).filter(
                                    (id) => id !== service.id,
                                  )
                                : [...(draft.serviceIds ?? []), service.id],
                            })
                          }
                          type="checkbox"
                        />
                        <span>{service.name}</span>
                      </label>
                    );
                  })}
                </div>
              ))}
              {serviceGroups.length === 0 ? (
                <p className="monitoring-muted">Kein Dienst passt zur Suche.</p>
              ) : null}
            </div>
          </fieldset>
        ) : null}
        {error ? (
          <p className="ticket-detail-message error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="monitoring-form__actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Abbrechen
          </button>
          <button className="primary-button" disabled={saving} type="submit">
            {saving ? "Wird gespeichert …" : "Speichern"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Reads the ports of the device through the probe and adds traffic sensors. */
function PortsDialog({
  tenantId,
  assetId,
  agents,
  defaultAgent,
  existing,
  onClose,
}: {
  tenantId: string;
  assetId: string;
  agents: MonitoringAgent[];
  defaultAgent: string | null;
  existing: MonitoringSensor[];
  onClose: () => void;
}) {
  const [agentId, setAgentId] = useState<string | null>(defaultAgent);
  const [ports, setPorts] = useState<InterfaceRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [onlyUp, setOnlyUp] = useState(true);
  const [interval, setIntervalSeconds] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const cancelled = useRef(false);
  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );
  const monitored = useMemo(
    () =>
      new Set(
        existing
          .filter((sensor) => sensor.snmpMetric === "traffic")
          .map((sensor) => sensor.snmpIndex),
      ),
    [existing],
  );

  const read = async () => {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    setPorts(null);
    try {
      const { jobId } = await monitoringCall<{ jobId: string }>({
        type: "listInterfaces",
        tenantId,
        assetId,
        agentId,
      });
      // The probe fetches jobs about once a minute.
      for (let attempt = 0; attempt < 50 && !cancelled.current; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
        const result = await monitoringCall<{
          status: "pending" | "done" | "failed";
          error: string | null;
          interfaces: InterfaceRow[];
        }>({ type: "interfaces", tenantId, jobId });
        if (result.status === "done") {
          setPorts(result.interfaces);
          return;
        }
        if (result.status === "failed") {
          throw new Error(
            result.error ?? "Die Sonde konnte die Ports nicht auslesen.",
          );
        }
      }
      if (!cancelled.current) {
        throw new Error(
          "Die Sonde hat nicht geantwortet. Ist sie online und auf Version 1.2.0 oder neuer?",
        );
      }
    } catch (failure) {
      if (!cancelled.current) setError(message(failure));
    } finally {
      if (!cancelled.current) setLoading(false);
    }
  };

  const visible = (ports ?? []).filter((port) => !onlyUp || port.up);
  const toggle = (index: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!agentId || !ports) return;
    const chosen = ports.filter(
      (port) => selected.has(port.index) && !monitored.has(port.index),
    );
    setError(null);
    try {
      for (const [position, port] of chosen.entries()) {
        setSaving(`${position + 1} von ${chosen.length}`);
        await monitoringCall({
          type: "saveSensor",
          tenantId,
          sensor: trafficDraft(assetId, agentId, port, interval),
        });
      }
      onClose();
    } catch (failure) {
      setError(message(failure));
      setSaving(null);
    }
  };

  return (
    <Dialog onClose={onClose} title="Ports hinzufügen">
      <form
        className="monitoring-form"
        onSubmit={(event) => void submit(event)}
      >
        <p className="monitoring-muted">
          Die Sonde liest die Ports des Geräts per SNMP aus. Für jeden gewählten
          Port entsteht ein Sensor, der den Datenverkehr und den
          Verbindungszustand misst.
        </p>
        <AgentSelect agents={agents} onChange={setAgentId} value={agentId} />
        <button
          className="secondary-button"
          disabled={!agentId || loading}
          onClick={() => void read()}
          type="button"
        >
          {loading ? "Ports werden ausgelesen …" : "Ports auslesen"}
        </button>
        {loading ? <Spinner label="Das dauert bis zu einer Minute." /> : null}
        {ports ? (
          <>
            <label className="monitoring-check">
              <input
                checked={onlyUp}
                onChange={(event) => setOnlyUp(event.target.checked)}
                type="checkbox"
              />
              <span>Nur verbundene Ports zeigen</span>
            </label>
            <div className="monitoring-choices">
              {visible.length === 0 ? (
                <p className="monitoring__empty">Keine Ports gefunden.</p>
              ) : (
                visible.map((port) => (
                  <label className="monitoring-choice" key={port.index}>
                    <input
                      checked={
                        monitored.has(port.index) || selected.has(port.index)
                      }
                      disabled={monitored.has(port.index)}
                      onChange={() => toggle(port.index)}
                      type="checkbox"
                    />
                    <span>
                      <strong>
                        {port.name}
                        {port.alias ? ` · ${port.alias}` : ""}
                      </strong>
                      <span className="monitoring-muted">
                        {[
                          `Port ${port.index}`,
                          port.up ? "verbunden" : "nicht verbunden",
                          port.speedMbps
                            ? formatValue(port.speedMbps * 1e6, "bit/s")
                            : null,
                          monitored.has(port.index)
                            ? "wird bereits überwacht"
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
            <label className="monitoring-field">
              <span>Intervall</span>
              <select
                onChange={(event) =>
                  setIntervalSeconds(Number(event.target.value))
                }
                value={interval}
              >
                {INTERVAL_OPTIONS.map((option) => (
                  <option key={option.seconds} value={option.seconds}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        {error ? (
          <p className="ticket-detail-message error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="monitoring-form__actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Abbrechen
          </button>
          <button
            className="primary-button"
            disabled={selected.size === 0 || saving !== null}
            type="submit"
          >
            {saving
              ? `Sensor ${saving} wird angelegt …`
              : `${selected.size} ${selected.size === 1 ? "Sensor" : "Sensoren"} anlegen`}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Name, kind and address of a monitored device. */
function DeviceDialog({
  tenantId,
  device,
  kinds,
  onClose,
  onSaved,
}: {
  tenantId: string;
  device: MonitoringDeviceDetail["device"];
  kinds: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(device.name);
  const [kind, setKind] = useState(
    kindValue(device.category, device.categoryLabel),
  );
  const [ipAddress, setIpAddress] = useState(device.ipAddress ?? "");
  const [hostname, setHostname] = useState(device.hostname ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await monitoringCall({
        type: "updateDevice",
        tenantId,
        assetId: device.assetId,
        device: { name, ...kindFields(kind), ipAddress, hostname },
      });
      onSaved();
    } catch (failure) {
      setError(message(failure));
      setSaving(false);
    }
  };

  return (
    <Dialog onClose={onClose} title="Gerät bearbeiten">
      <form
        className="monitoring-form"
        onSubmit={(event) => void submit(event)}
      >
        <label className="monitoring-field">
          <span>Name des Geräts</span>
          <input
            autoFocus
            maxLength={160}
            onChange={(event) => setName(event.target.value)}
            required
            type="text"
            value={name}
          />
        </label>
        <KindSelect kinds={kinds} label="Art" onChange={setKind} value={kind} />
        <div className="monitoring-field-row">
          <label className="monitoring-field">
            <span>IP-Adresse</span>
            <input
              onChange={(event) => setIpAddress(event.target.value)}
              placeholder="z. B. 10.0.0.11"
              type="text"
              value={ipAddress}
            />
          </label>
          <label className="monitoring-field">
            <span>Hostname</span>
            <input
              onChange={(event) => setHostname(event.target.value)}
              type="text"
              value={hostname}
            />
          </label>
        </div>
        <p className="monitoring-muted">
          Die Änderung gilt auch in der Infrastruktur. Sensoren ohne eigenes
          Ziel messen danach die neue Adresse (zuerst die IP-Adresse, sonst den
          Hostnamen). Standort, Uplink und Services werden unter Infrastruktur
          gepflegt.
        </p>
        {error ? (
          <p className="ticket-detail-message error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="monitoring-form__actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Abbrechen
          </button>
          <button className="primary-button" disabled={saving} type="submit">
            {saving ? "Wird gespeichert …" : "Speichern"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const AUTO_CATEGORY = "auto";
const NEW_KIND = "new";

/**
 * Kind of a device: the fixed kinds, the own kinds of the tenant, and «Neue
 * Art erstellen …» for a kind that does not exist yet.
 */
function KindSelect({
  label,
  value,
  kinds,
  onChange,
  auto = false,
  hint,
}: {
  label: string;
  /** A value of `kindValue`, or AUTO_CATEGORY. */
  value: string;
  kinds: string[];
  onChange: (value: string) => void;
  /** Offers «Automatisch aus Name und Beschreibung». */
  auto?: boolean;
  hint?: string;
}) {
  const current = value === AUTO_CATEGORY ? null : kindFields(value);
  const known =
    current === null ||
    current.categoryLabel === null ||
    kinds.includes(current.categoryLabel);
  // An own kind that is not in the list yet is being typed in.
  const [creating, setCreating] = useState(!known);
  // As typed (spaces included); a single blank stands for «nothing yet».
  const typed =
    value.startsWith("custom:") && value !== "custom: "
      ? value.slice("custom:".length)
      : "";
  return (
    <div className="monitoring-field">
      <label className="monitoring-field">
        <span>{label}</span>
        <select
          onChange={(event) => {
            const next = event.target.value;
            setCreating(next === NEW_KIND);
            onChange(next === NEW_KIND ? kindValue("other", " ") : next);
          }}
          value={creating ? NEW_KIND : value}
        >
          {auto ? (
            <option value={AUTO_CATEGORY}>
              Automatisch aus Name und Beschreibung
            </option>
          ) : null}
          {Object.entries(CATEGORY_LABELS).map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
          {kinds.map((kind) => (
            <option key={kind} value={kindValue("other", kind)}>
              {kind}
            </option>
          ))}
          <option value={NEW_KIND}>Neue Art erstellen …</option>
        </select>
      </label>
      {creating ? (
        <label className="monitoring-field">
          <span>Name der neuen Art</span>
          <input
            autoFocus
            maxLength={60}
            onChange={(event) =>
              onChange(kindValue("other", event.target.value || " "))
            }
            placeholder="z. B. iLO, Drucker, Kamera"
            required
            type="text"
            value={typed}
          />
        </label>
      ) : null}
      {hint ? <span className="monitoring-muted">{hint}</span> : null}
    </div>
  );
}

/**
 * Adds devices to the monitoring. Sources: devices of the infrastructure and
 * addresses of the IP address management that are no device yet (several at
 * once), or one device entered right here.
 */
function AddDeviceDialog({
  tenantId,
  agents,
  onClose,
  onSaved,
}: {
  tenantId: string;
  agents: MonitoringAgent[];
  onClose: () => void;
  /** The device to open, or null when several were added. */
  onSaved: (assetId: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<MonitoringAssetChoice[] | null>(null);
  const [addresses, setAddresses] = useState<MonitoringAddressChoice[]>([]);
  // Picked entries stay picked while the search text changes.
  const [assets, setAssets] = useState<Map<string, MonitoringAssetChoice>>(
    new Map(),
  );
  const [entries, setEntries] = useState<Map<string, MonitoringAddressChoice>>(
    new Map(),
  );
  const [creating, setCreating] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(
    agents.find((agent) => agent.online)?.id ?? agents[0]?.id ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("server");
  const [kinds, setKinds] = useState<string[]>([]);
  const [addressKind, setAddressKind] = useState(AUTO_CATEGORY);
  const [address, setAddress] = useState("");

  const count = assets.size + entries.size;
  const withoutAddress = [...assets.values()].filter(
    (choice) => !choice.ipAddress && !choice.hostname,
  );
  // One device without address can get its target here; several cannot.
  const needsTarget = !creating && count === 1 && withoutAddress.length === 1;
  const blocked = !creating && count > 1 && withoutAddress.length > 0;

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      monitoringCall<{
        assets: MonitoringAssetChoice[];
        addresses?: MonitoringAddressChoice[];
        kinds?: string[];
      }>({ type: "assets", tenantId, query })
        .then((result) => {
          if (cancelled) return;
          setChoices(result.assets);
          setAddresses(result.addresses ?? []);
          setKinds(result.kinds ?? []);
        })
        .catch((failure) => {
          if (!cancelled) setError(message(failure));
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tenantId, query]);

  const toggleAsset = (choice: MonitoringAssetChoice) => {
    setCreating(false);
    setAssets((current) => {
      const next = new Map(current);
      if (!next.delete(choice.assetId)) next.set(choice.assetId, choice);
      return next;
    });
  };
  const toggleEntry = (entry: MonitoringAddressChoice) => {
    setCreating(false);
    setEntries((current) => {
      const next = new Map(current);
      if (!next.delete(entry.addressId)) next.set(entry.addressId, entry);
      return next;
    });
  };
  const selectable = (choices ?? []).filter(
    (choice) =>
      !choice.monitored &&
      (choice.ipAddress !== null || choice.hostname !== null),
  );
  const allShown =
    selectable.length + addresses.length > 0 &&
    selectable.every((choice) => assets.has(choice.assetId)) &&
    addresses.every((entry) => entries.has(entry.addressId));
  const toggleAll = () => {
    setCreating(false);
    setAssets((current) => {
      const next = new Map(current);
      for (const choice of selectable) {
        if (allShown) next.delete(choice.assetId);
        else next.set(choice.assetId, choice);
      }
      return next;
    });
    setEntries((current) => {
      const next = new Map(current);
      for (const entry of addresses) {
        if (allShown) next.delete(entry.addressId);
        else next.set(entry.addressId, entry);
      }
      return next;
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const added: string[] = [];
    try {
      if (creating) {
        setSaving("1 von 1");
        const result = await monitoringCall<{ assetId: string }>({
          type: "addDevice",
          tenantId,
          device: {
            name,
            ...kindFields(kind),
            address,
            agentId,
            ipamAddressId: null,
          },
        });
        onSaved(result.assetId);
        return;
      }
      const total = count;
      for (const choice of assets.values()) {
        setSaving(`${added.length + 1} von ${total}`);
        await monitoringCall({
          type: "saveSensor",
          tenantId,
          sensor: {
            ...emptyDraft(choice.assetId, agentId),
            target: needsTarget ? target.trim() : null,
          },
        });
        added.push(choice.assetId);
      }
      for (const entry of entries.values()) {
        setSaving(`${added.length + 1} von ${total}`);
        const result = await monitoringCall<{ assetId: string }>({
          type: "addDevice",
          tenantId,
          device: {
            name: entry.hostname ?? entry.address,
            ...kindFields(
              addressKind === AUTO_CATEGORY
                ? guessCategory(entry.hostname, entry.description)
                : addressKind,
            ),
            address: entry.address,
            agentId,
            ipamAddressId: entry.addressId,
          },
        });
        added.push(result.assetId);
      }
      onSaved(added.length === 1 ? (added[0] ?? null) : null);
    } catch (failure) {
      setError(
        added.length
          ? `${added.length} von ${count} hinzugefügt, dann: ${message(failure)}`
          : message(failure),
      );
      // What was added is no longer offered again.
      setAssets((current) => {
        const next = new Map(current);
        for (const id of added) next.delete(id);
        return next;
      });
      setSaving(null);
    }
  };

  return (
    <Dialog onClose={onClose} title="Geräte hinzufügen">
      <form
        className="monitoring-form"
        onSubmit={(event) => void submit(event)}
      >
        <p className="monitoring-muted">
          Gesucht wird in der Infrastruktur und in der IP-Adressverwaltung.
          Mehrere Geräte lassen sich zusammen hinzufügen. Jedes erhält einen
          Ping-Sensor; weitere Sensoren folgen danach.
        </p>
        <label className="monitoring-field">
          <span>Gerät suchen</span>
          <input
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, Hostname oder IP-Adresse"
            type="search"
            value={query}
          />
        </label>
        {choices !== null && selectable.length + addresses.length > 1 ? (
          <button
            className="text-button monitoring-form__all"
            onClick={toggleAll}
            type="button"
          >
            {allShown
              ? "Auswahl der angezeigten aufheben"
              : `Alle ${selectable.length + addresses.length} angezeigten auswählen`}
          </button>
        ) : null}
        <div
          aria-label="Geräte wählen"
          className="monitoring-choices"
          role="group"
        >
          {choices === null ? (
            <Spinner label="Geräte werden geladen …" />
          ) : (
            <>
              {choices
                .filter((choice) => !choice.monitored)
                .map((choice) => (
                  <label className="monitoring-choice" key={choice.assetId}>
                    <input
                      checked={assets.has(choice.assetId)}
                      disabled={choice.monitored}
                      onChange={() => toggleAsset(choice)}
                      type="checkbox"
                    />
                    <span>
                      <strong>{choice.name}</strong>
                      <span className="monitoring-muted">
                        {[
                          categoryText(choice.category, choice.categoryLabel),
                          choice.ipAddress ?? choice.hostname ?? "ohne Adresse",
                          choice.monitored ? "wird bereits überwacht" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </label>
                ))}
              {addresses.map((entry) => (
                <label className="monitoring-choice" key={entry.addressId}>
                  <input
                    checked={entries.has(entry.addressId)}
                    onChange={() => toggleEntry(entry)}
                    type="checkbox"
                  />
                  <span>
                    <strong>{entry.hostname ?? entry.address}</strong>
                    <span className="monitoring-muted">
                      {[
                        "IP-Adressverwaltung",
                        entry.address,
                        entry.description,
                        "noch kein Gerät",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </label>
              ))}
              <label className="monitoring-choice">
                <input
                  checked={creating}
                  onChange={(event) => {
                    setCreating(event.target.checked);
                    if (event.target.checked) {
                      setAssets(new Map());
                      setEntries(new Map());
                      setName(query.trim());
                      setAddress("");
                    }
                  }}
                  type="checkbox"
                />
                <span>
                  <strong>Neues Gerät erfassen</strong>
                  <span className="monitoring-muted">
                    {choices.length + addresses.length === 0
                      ? "Nichts gefunden. Das Gerät mit Name und Adresse anlegen."
                      : "Das Gerät ist nicht in der Liste."}
                  </span>
                </span>
              </label>
              {/* Already monitored: at the very end, they cannot be picked. */}
              {choices
                .filter((choice) => choice.monitored)
                .map((choice) => (
                  <label className="monitoring-choice" key={choice.assetId}>
                    <input
                      checked={assets.has(choice.assetId)}
                      disabled={choice.monitored}
                      onChange={() => toggleAsset(choice)}
                      type="checkbox"
                    />
                    <span>
                      <strong>{choice.name}</strong>
                      <span className="monitoring-muted">
                        {[
                          categoryText(choice.category, choice.categoryLabel),
                          choice.ipAddress ?? choice.hostname ?? "ohne Adresse",
                          choice.monitored ? "wird bereits überwacht" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </label>
                ))}
            </>
          )}
        </div>
        {creating ? (
          <>
            <label className="monitoring-field">
              <span>Name des Geräts</span>
              <input
                maxLength={160}
                onChange={(event) => setName(event.target.value)}
                required
                type="text"
                value={name}
              />
            </label>
            <div className="monitoring-field-row">
              <KindSelect
                kinds={kinds}
                label="Art"
                onChange={setKind}
                value={kind}
              />
              <label className="monitoring-field">
                <span>IP-Adresse oder Hostname</span>
                <input
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder="z. B. 10.0.1.108"
                  required
                  type="text"
                  value={address}
                />
              </label>
            </div>
          </>
        ) : null}
        {entries.size > 0 ? (
          <KindSelect
            auto
            hint="Einträge der IP-Adressverwaltung werden als Gerät in der Infrastruktur angelegt. Die Art lässt sich später ändern."
            kinds={kinds}
            label={
              entries.size === 1
                ? "Art des neuen Geräts"
                : `Art der ${entries.size} neuen Geräte`
            }
            onChange={setAddressKind}
            value={addressKind}
          />
        ) : null}
        {needsTarget ? (
          <label className="monitoring-field">
            <span>IP-Adresse oder Hostname des Geräts</span>
            <input
              onChange={(event) => setTarget(event.target.value)}
              placeholder="z. B. 172.16.128.20"
              required
              type="text"
              value={target}
            />
            <span className="monitoring-muted">
              In der Infrastruktur ist für dieses Gerät keine Adresse erfasst.
              Die Angabe gilt für diesen Sensor.
            </span>
          </label>
        ) : null}
        {blocked ? (
          <p className="ticket-detail-message error" role="alert">
            {withoutAddress.length === 1
              ? `«${withoutAddress[0]?.name}» hat keine Adresse und lässt sich nur einzeln hinzufügen.`
              : `${withoutAddress.length} gewählte Geräte haben keine Adresse und lassen sich nur einzeln hinzufügen.`}
          </p>
        ) : null}
        <AgentSelect agents={agents} onChange={setAgentId} value={agentId} />
        {error ? (
          <p className="ticket-detail-message error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="monitoring-form__actions">
          <button className="secondary-button" onClick={onClose} type="button">
            {saving === null && error && count === 0
              ? "Schliessen"
              : "Abbrechen"}
          </button>
          <button
            className="primary-button"
            disabled={(!creating && count === 0) || blocked || saving !== null}
            type="submit"
          >
            <Radar aria-hidden="true" size={16} />
            {saving !== null
              ? `Gerät ${saving} wird hinzugefügt …`
              : creating
                ? "Anlegen und überwachen"
                : count > 1
                  ? `${count} Geräte überwachen`
                  : "Überwachen"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Connections of the device: its ports with what hangs on them, and the
 * switch ports it hangs on. The probe reads them via SNMP.
 */
function ConnectionsCard({
  tenantId,
  assetId,
  now,
  onOpenDevice,
  onOpenInfrastructure,
}: {
  tenantId: string;
  assetId: string;
  now: number;
  onOpenDevice: (assetId: string) => void;
  onOpenInfrastructure?: ((assetId: string) => void) | undefined;
}) {
  const [data, setData] = useState<MonitoringConnections | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"list" | "matrix">("list");

  const load = useCallback(() => {
    monitoringCall<MonitoringConnections>({
      type: "connections",
      tenantId,
      assetId,
    })
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((failure) => setError(message(failure)));
  }, [tenantId, assetId]);
  useEffect(load, [load]);
  // While the probe is asked, look again every few seconds.
  const pending = data?.pending ?? false;
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [pending, load]);

  const refresh = () => {
    setBusy(true);
    monitoringCall({ type: "refreshConnections", tenantId, assetId })
      .then(load)
      .catch((failure) => setError(message(failure)))
      .finally(() => setBusy(false));
  };
  // A monitored neighbour opens here, any other device in the infrastructure.
  const open = (target: { assetId: string | null; monitored: boolean }) =>
    target.assetId === null
      ? undefined
      : target.monitored
        ? () => onOpenDevice(target.assetId!)
        : onOpenInfrastructure
          ? () => onOpenInfrastructure(target.assetId!)
          : undefined;

  const ports = data ? (all ? data.ports : connectedPorts(data.ports)) : [];
  return (
    <article className="monitoring-card monitoring-card--flush">
      <div className="monitoring-card__head monitoring-card__head--padded">
        <div>
          <h3>Verbindungen</h3>
          <span className="monitoring-muted">
            {data === null
              ? "wird geladen …"
              : data.pending
                ? "Die Sonde liest die Verbindungen aus …"
                : data.scannedAt
                  ? `Stand ${formatAgo(data.scannedAt, now)}`
                  : "noch nicht ausgelesen"}
          </span>
        </div>
        <div className="monitoring__actions">
          {data && data.ports.length > 0 ? (
            <div
              aria-label="Darstellung der Verbindungen"
              className="monitoring-toggle"
              role="group"
            >
              {(
                [
                  ["list", "Liste"],
                  ["matrix", "Matrix"],
                ] as const
              ).map(([key, text]) => (
                <button
                  aria-pressed={view === key}
                  key={key}
                  onClick={() => setView(key)}
                  type="button"
                >
                  {text}
                </button>
              ))}
            </div>
          ) : null}
          {data?.canManage ? (
            <button
              className="secondary-button"
              disabled={busy || data.pending}
              onClick={refresh}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={16} />
              Jetzt auslesen
            </button>
          ) : null}
        </div>
      </div>
      {(error ?? data?.error) ? (
        <p
          className="ticket-detail-message error monitoring__inset"
          role="alert"
        >
          {error ?? data?.error}
        </p>
      ) : null}
      {data?.attachedTo.length ? (
        <ul className="monitoring-attached">
          {data.attachedTo.map((entry) => {
            const action = open(entry);
            return (
              <li key={`${entry.assetId}|${entry.port}`}>
                Hängt an{" "}
                {action ? (
                  <button
                    className="text-button"
                    onClick={action}
                    type="button"
                  >
                    {entry.name}
                  </button>
                ) : (
                  <strong>{entry.name}</strong>
                )}
                , Port {entry.port}{" "}
                <span className="monitoring-muted">
                  ({LINK_SOURCE_LABELS[entry.source]})
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {data && data.ports.length > 0 && view === "matrix" ? (
        <PortMatrix open={open} ports={data.ports} />
      ) : data && data.ports.length > 0 ? (
        <>
          <div className="monitoring__scroll">
            <table className="monitoring-table">
              <thead>
                <tr>
                  <th scope="col">Port</th>
                  <th scope="col">Status</th>
                  <th scope="col">Verbunden mit</th>
                  <th scope="col">Quelle</th>
                </tr>
              </thead>
              <tbody>
                {ports.map((port) => {
                  const action = port.link ? open(port.link) : undefined;
                  return (
                    <tr key={port.port}>
                      <td>
                        <strong>{port.port}</strong>
                        {port.alias ? (
                          <span className="monitoring-muted">{port.alias}</span>
                        ) : null}
                      </td>
                      <td>
                        {port.up === null
                          ? "–"
                          : port.up
                            ? [
                                "aktiv",
                                port.speedMbps
                                  ? formatValue(port.speedMbps * 1e6, "bit/s")
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            : "kein Link"}
                      </td>
                      <td>
                        {action ? (
                          <button
                            className="text-button monitoring-table__name"
                            onClick={action}
                            type="button"
                          >
                            {portLinkText(port)}
                          </button>
                        ) : (
                          portLinkText(port)
                        )}
                        {port.link ? (
                          <span className="monitoring-muted">
                            {[port.link.address, port.link.mac]
                              .filter(
                                (value) => value && value !== port.link!.name,
                              )
                              .join(" · ")}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {port.link ? LINK_SOURCE_LABELS[port.link.source] : "–"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {ports.length === 0 ? (
            <p className="monitoring__empty">
              An keinem Port wurde eine Gegenstelle erkannt.
            </p>
          ) : null}
          <p className="monitoring__empty">
            <button
              className="text-button"
              onClick={() => setAll((value) => !value)}
              type="button"
            >
              {all
                ? "Nur Ports mit Gegenstelle zeigen"
                : `Alle ${data.ports.length} Ports zeigen`}
            </button>
          </p>
        </>
      ) : data && !data.pending && !data.error && !data.attachedTo.length ? (
        <p className="monitoring__empty">
          {data.scannedAt
            ? "Das Gerät meldet keine Ports."
            : "Für Switches, Firewalls und Router liest die Sonde die Verbindungen per SNMP aus (alle sechs Stunden). Voraussetzung sind SNMP-Zugangsdaten auf der Sonde."}
        </p>
      ) : null}
    </article>
  );
}

/** Name and state of a probe, and a new token for it. */
function AgentDialog({
  tenantId,
  agent,
  onClose,
  onSaved,
}: {
  tenantId: string;
  agent: MonitoringAgent;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [active, setActive] = useState(agent.active);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmToken, setConfirmToken] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await monitoringCall({
        type: "updateAgent",
        tenantId,
        agentId: agent.id,
        name,
        active,
      });
      onSaved();
    } catch (failure) {
      setError(message(failure));
      setSaving(false);
    }
  };
  const rotate = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await monitoringCall<{ token: string }>({
        type: "rotateAgentToken",
        tenantId,
        agentId: agent.id,
      });
      setToken(result.token);
      setConfirmToken(false);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      onClose={token ? onSaved : onClose}
      title={`Sonde «${agent.name}» bearbeiten`}
    >
      <form
        className="monitoring-form"
        onSubmit={(event) => void submit(event)}
      >
        <label className="monitoring-field">
          <span>Name der Sonde</span>
          <input
            autoFocus
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            required
            type="text"
            value={name}
          />
        </label>
        <label className="monitoring-check">
          <input
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
            type="checkbox"
          />
          <span>
            Aktiv
            <span className="monitoring-muted">
              {" "}
              – eine deaktivierte Sonde wird abgewiesen, ihre Sensoren gelten
              als «Unbekannt».
            </span>
          </span>
        </label>
        <div className="monitoring-package">
          <div>
            <strong>Token</strong>
            <span className="monitoring-muted">
              Ein neuer Token ersetzt den bisherigen sofort. Die Sonde meldet
              sich erst wieder, wenn er in ihrer config.json steht.
            </span>
          </div>
          {token ? null : confirmToken ? (
            <button
              className="primary-button monitoring-danger"
              disabled={saving}
              onClick={() => void rotate()}
              type="button"
            >
              Jetzt ersetzen
            </button>
          ) : (
            <button
              className="secondary-button"
              disabled={saving}
              onClick={() => setConfirmToken(true)}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={16} />
              Neuen Token erzeugen
            </button>
          )}
        </div>
        {token ? (
          <div className="monitoring-field">
            <span>Neuer Token (wird nur jetzt angezeigt)</span>
            <input
              aria-label="Neuer Token"
              onFocus={(event) => event.target.select()}
              readOnly
              type="text"
              value={token}
            />
            <button
              className="secondary-button monitoring-form__all"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(token)
                  .then(() => setCopied(true));
              }}
              type="button"
            >
              {copied ? "Kopiert" : "Token kopieren"}
            </button>
            <span className="monitoring-muted">
              Auf dem Server der Sonde in der config.json den Wert von
              «agentToken» durch diesen Token ersetzen und den Dienst neu
              starten. Die übrigen Einträge (z. B. SNMP) bleiben stehen.
            </span>
          </div>
        ) : null}
        {error ? (
          <p className="ticket-detail-message error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="monitoring-form__actions">
          <button
            className="secondary-button"
            onClick={token ? onSaved : onClose}
            type="button"
          >
            {token ? "Schliessen" : "Abbrechen"}
          </button>
          <button className="primary-button" disabled={saving} type="submit">
            Speichern
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Removes a probe; its sensors move to another probe or stay without one. */
function RemoveAgentDialog({
  tenantId,
  agent,
  agents,
  onClose,
  onRemoved,
}: {
  tenantId: string;
  agent: MonitoringAgent;
  agents: MonitoringAgent[];
  onClose: () => void;
  onRemoved: () => void;
}) {
  const others = agents.filter(
    (entry) => entry.id !== agent.id && entry.active,
  );
  const sensors = agent.sensorCount ?? 0;
  const [target, setTarget] = useState(others[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const remove = () => {
    setSaving(true);
    setError(null);
    monitoringCall({
      type: "removeAgent",
      tenantId,
      agentId: agent.id,
      moveSensorsTo: sensors > 0 && target ? target : null,
    })
      .then(onRemoved)
      .catch((failure) => {
        setError(message(failure));
        setSaving(false);
      });
  };
  return (
    <Dialog onClose={onClose} title={`Sonde «${agent.name}» löschen`}>
      <div className="monitoring-form">
        <p>
          Der Token der Sonde wird widerrufen; sie kann sich danach nicht mehr
          anmelden, auch nicht für die IP-Adressverwaltung. Das Programm auf dem
          Server bleibt installiert und lässt sich dort deinstallieren.
        </p>
        {sensors > 0 ? (
          others.length > 0 ? (
            <label className="monitoring-field">
              <span>
                {sensors === 1
                  ? "Den Sensor dieser Sonde übernimmt"
                  : `Die ${sensors} Sensoren dieser Sonde übernimmt`}
              </span>
              <select
                onChange={(event) => setTarget(event.target.value)}
                value={target}
              >
                {others.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
                <option value="">Keine Sonde (wird nicht mehr gemessen)</option>
              </select>
            </label>
          ) : (
            <p className="ticket-detail-message error" role="alert">
              {sensors === 1
                ? "Der Sensor dieser Sonde wird danach nicht mehr gemessen."
                : `Die ${sensors} Sensoren dieser Sonde werden danach nicht mehr gemessen.`}{" "}
              Es gibt keine andere aktive Sonde, die sie übernehmen könnte.
            </p>
          )
        ) : null}
        {error ? (
          <p className="ticket-detail-message error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="monitoring-form__actions">
          <button
            autoFocus
            className="secondary-button"
            onClick={onClose}
            type="button"
          >
            Abbrechen
          </button>
          <button
            className="primary-button monitoring-danger"
            disabled={saving}
            onClick={remove}
            type="button"
          >
            <Trash2 aria-hidden="true" size={16} />
            Sonde löschen
          </button>
        </div>
      </div>
    </Dialog>
  );
}

type OpenTarget = (target: {
  assetId: string | null;
  monitored: boolean;
}) => (() => void) | undefined;

/**
 * Connections as a picture: the ports of each unit as a front panel
 * (coloured by state), and below a diagram with a line from every port to
 * the device it leads to.
 */
function PortMatrix({
  ports,
  open,
}: {
  ports: MonitoringPort[];
  open: OpenTarget;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const groups = useMemo(() => portGroups(ports), [ports]);
  const diagram = useMemo(() => linkDiagram(ports), [ports]);
  const current = ports.find((port) => port.port === selected) ?? null;
  const currentAction = current?.link ? open(current.link) : undefined;
  return (
    <div className="monitoring-matrix">
      <ul className="monitoring-matrix__legend">
        {(["linked", "trunk", "up", "down"] as const).map((state) => (
          <li key={state}>
            <span
              aria-hidden="true"
              className={`monitoring-port monitoring-port--${state}`}
            />
            {PORT_STATE_LABELS[state]}
          </li>
        ))}
      </ul>
      {groups.map((group) => {
        // Without a link nothing is to see on VLANs, LAGs and the like.
        const shown = group.panel
          ? group.ports
          : group.ports.filter((port) => portState(port) !== "down");
        if (!shown.length) return null;
        return (
          <section className="monitoring-matrix__group" key={group.key}>
            <h4>{group.label}</h4>
            <div
              className={
                group.panel
                  ? "monitoring-matrix__panel"
                  : "monitoring-matrix__panel monitoring-matrix__panel--free"
              }
            >
              {shown.map((port) => {
                const state = portState(port);
                return (
                  <button
                    aria-label={`Port ${port.port}: ${PORT_STATE_LABELS[state]}${port.link ? `, ${portLinkText(port)}` : ""}`}
                    aria-pressed={selected === port.port}
                    className={`monitoring-port monitoring-port--${state}`}
                    key={port.port}
                    onClick={() =>
                      setSelected(selected === port.port ? null : port.port)
                    }
                    title={`${port.port}${port.alias ? ` · ${port.alias}` : ""} → ${portLinkText(port)}`}
                    type="button"
                  >
                    {group.panel
                      ? (portNumber(port.port) ?? port.port)
                      : port.port}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      <p className="monitoring-matrix__detail" role="status">
        {current ? (
          <>
            <strong>Port {current.port}</strong>
            {current.alias ? ` · ${current.alias}` : ""} ·{" "}
            {current.up === false
              ? "kein Link"
              : [
                  "aktiv",
                  current.speedMbps
                    ? formatValue(current.speedMbps * 1e6, "bit/s")
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}{" "}
            →{" "}
            {currentAction ? (
              <button
                className="text-button"
                onClick={currentAction}
                type="button"
              >
                {portLinkText(current)}
              </button>
            ) : (
              portLinkText(current)
            )}
            {current.link ? (
              <span className="monitoring-muted">
                {" "}
                ({LINK_SOURCE_LABELS[current.link.source]}
                {current.link.address ? ` · ${current.link.address}` : ""})
              </span>
            ) : null}
          </>
        ) : (
          <span className="monitoring-muted">
            Einen Port anklicken, um die Gegenstelle zu sehen.
          </span>
        )}
      </p>
      {diagram.links.length > 0 ? (
        <section className="monitoring-matrix__group">
          <h4>Verbindungen zu bekannten Geräten</h4>
          <div className="monitoring__scroll">
            <svg
              aria-label="Diagramm der Verbindungen"
              className="monitoring-links"
              role="img"
              style={{ minWidth: 560 }}
              viewBox={`0 0 ${diagram.width} ${diagram.height}`}
            >
              {diagram.links.map((link) => (
                <path
                  className={`monitoring-links__line monitoring-links__line--${link.source}${selected === link.key ? " is-selected" : ""}`}
                  d={link.path}
                  key={link.key}
                />
              ))}
              {diagram.ports.map((port) => (
                <g
                  className={`monitoring-links__port${selected === port.port ? " is-selected" : ""}`}
                  key={port.port}
                  onClick={() => setSelected(port.port)}
                >
                  <rect height={22} rx={6} width={166} x={2} y={port.y - 11} />
                  <text x={12} y={port.y + 4}>
                    {port.port}
                    {port.alias ? ` · ${port.alias.slice(0, 16)}` : ""}
                  </text>
                </g>
              ))}
              {diagram.neighbours.map((entry) => {
                const action = open(entry);
                return (
                  <g
                    className={`monitoring-links__device${action ? " is-link" : ""}`}
                    key={entry.key}
                    onClick={action}
                    onKeyDown={(event) => {
                      if (
                        action &&
                        (event.key === "Enter" || event.key === " ")
                      )
                        action();
                    }}
                    role={action ? "link" : undefined}
                    tabIndex={action ? 0 : undefined}
                  >
                    <rect
                      height={24}
                      rx={6}
                      width={diagram.width - 502}
                      x={500}
                      y={entry.y - 12}
                    />
                    <text x={510} y={entry.y + 4}>
                      {entry.name.slice(0, 30)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          {diagram.hidden > 0 ? (
            <p className="monitoring-muted">
              {diagram.hidden} weitere Verbindungen stehen in der Liste.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function ProbeDialog({
  tenantId,
  onClose,
}: {
  tenantId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{
    name: string;
    config: string;
  } | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await monitoringCall<{
        agent: { name: string };
        config: string;
      }>({ type: "createAgent", tenantId, name });
      setCreated({ name: result.agent.name, config: result.config });
    } catch (failure) {
      setError(message(failure));
    } finally {
      setSaving(false);
    }
  };

  const download = () => {
    if (!created) return;
    const url = URL.createObjectURL(
      new Blob([created.config], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "config.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  };

  if (created) {
    return (
      <Dialog onClose={onClose} title={`Sonde «${created.name}» angelegt`}>
        <div className="monitoring-form">
          <p>
            Die Konfiguration jetzt herunterladen: Die Datei enthält die Adresse
            dieses Mandanten und den Zugangsschlüssel der Sonde. nextDesk zeigt
            den Schlüssel nur dieses eine Mal.
          </p>
          <button className="primary-button" onClick={download} type="button">
            <Download aria-hidden="true" size={16} />
            config.json herunterladen
          </button>
          <button
            className="secondary-button"
            onClick={() =>
              void downloadProbePackage(tenantId).catch((failure) =>
                setError(message(failure)),
              )
            }
            type="button"
          >
            <Download aria-hidden="true" size={16} />
            Sonde herunterladen (Installationspaket)
          </button>
          {error ? (
            <p className="ticket-detail-message error" role="alert">
              {error}
            </p>
          ) : null}
          <ol className="monitoring-steps">
            <li>
              Das Paket auf einem Server im Netz entpacken und die{" "}
              <code>config.json</code> in den Ordner <code>nextdesk-sonde</code>{" "}
              legen.
            </li>
            <li>
              Windows (Node.js 22 LTS nötig): als Administrator{" "}
              <code>windows\install-service.ps1</code> ausführen. Linux mit
              Docker: <code>sudo linux/install.sh</code>.
            </li>
            <li>
              Das Skript prüft die Verbindung und startet die Sonde. Nach etwa
              einer Minute erscheint die Sonde hier als «online».
            </li>
          </ol>
          <p className="monitoring-muted">
            Die Datei ist wie ein Passwort zu behandeln und nach der
            Installation aus dem Download-Ordner zu löschen.
          </p>
          {leaving && !downloaded ? (
            <p className="ticket-detail-message error" role="alert">
              Die Konfiguration wurde noch nicht heruntergeladen und lässt sich
              später nicht mehr anzeigen.
            </p>
          ) : null}
          <div className="monitoring-form__actions">
            <button
              className="secondary-button"
              onClick={() => {
                if (downloaded || leaving) onClose();
                else setLeaving(true);
              }}
              type="button"
            >
              {leaving && !downloaded ? "Trotzdem schliessen" : "Schliessen"}
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog onClose={onClose} title="Sonde hinzufügen">
      <form
        className="monitoring-form"
        onSubmit={(event) => void submit(event)}
      >
        <p className="monitoring-muted">
          Eine Sonde pro Standort oder Netz genügt in der Regel. Nötig ist nur
          eine ausgehende HTTPS-Verbindung zu nextDesk.
        </p>
        <label className="monitoring-field">
          <span>Name</span>
          <input
            autoFocus
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            placeholder="z. B. Sonde Rechenzentrum"
            required
            type="text"
            value={name}
          />
        </label>
        {error ? (
          <p className="ticket-detail-message error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="monitoring-form__actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Abbrechen
          </button>
          <button className="primary-button" disabled={saving} type="submit">
            {saving ? "Wird angelegt …" : "Sonde anlegen"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
