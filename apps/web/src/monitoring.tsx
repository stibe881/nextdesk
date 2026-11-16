import {
  ArrowLeft,
  Download,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  Radar,
  Search,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  CATEGORY_LABELS,
  chartGeometry,
  draftFromSensor,
  emptyDraft,
  formatAgo,
  formatMs,
  formatSince,
  INTERVAL_OPTIONS,
  intervalLabel,
  KIND_LABELS,
  matchesSearch,
  monitoringCall,
  RANGE_LABELS,
  sensorCountsText,
  sensorTarget,
  STATE_LABELS,
  STATE_ORDER,
  type MonitoringAgent,
  type MonitoringAssetChoice,
  type MonitoringDeviceDetail,
  type MonitoringOverview,
  type MonitoringRange,
  type MonitoringSensor,
  type MonitoringSeries,
  type MonitoringState,
  type SensorDraft,
  type SensorKind,
} from "./lib/monitoring";
import { tn } from "./lib/formality";

import "./monitoring.css";

const REFRESH_MS = 30_000;

type Props = {
  tenantId: string;
  onOpenIncident?: ((incidentId: string) => void) | undefined;
};

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

export function Monitoring({ tenantId, onOpenIncident }: Props) {
  const [assetId, setAssetId] = useState<string | null>(null);
  return assetId ? (
    <DeviceView
      assetId={assetId}
      key={assetId}
      onBack={() => setAssetId(null)}
      onOpenDevice={setAssetId}
      onOpenIncident={onOpenIncident}
      tenantId={tenantId}
    />
  ) : (
    <OverviewView
      onOpenDevice={setAssetId}
      onOpenIncident={onOpenIncident}
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
}: Props & { onOpenDevice: (assetId: string) => void }) {
  const [data, setData] = useState<MonitoringOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MonitoringState | "all">("all");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [addingProbe, setAddingProbe] = useState(false);

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

  const devices = useMemo(
    () =>
      (data?.devices ?? []).filter(
        (device) =>
          (filter === "all" || device.state === filter) &&
          matchesSearch(device, search),
      ),
    [data, filter, search],
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
            Gerät hinzufügen
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
                ? " Unter «Sonden» lässt sich eine Sonde anlegen und ihre Konfiguration herunterladen."
                : ""}
            </p>
          ) : null}

          <div className="monitoring__columns">
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
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <ProbeCard
              data={data}
              now={now}
              onAdd={() => setAddingProbe(true)}
              onError={setError}
              tenantId={tenantId}
            />
          </div>

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
                <table className="monitoring-table">
                  <thead>
                    <tr>
                      <th scope="col">Status</th>
                      <th scope="col">Gerät</th>
                      <th scope="col">Sensoren</th>
                      <th scope="col">Antwortzeit</th>
                      <th scope="col">Letzte Prüfung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((device) => (
                      <tr key={device.assetId}>
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
                              CATEGORY_LABELS[device.category ?? ""] ?? "Gerät",
                              device.ipAddress ?? device.hostname,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </td>
                        <td>{sensorCountsText(device.counts)}</td>
                        <td>{formatMs(device.responseMs)}</td>
                        <td className="monitoring-muted">
                          {formatAgo(device.lastCheckAt, now)}
                        </td>
                      </tr>
                    ))}
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
            onOpenDevice(savedAssetId);
          }}
          tenantId={tenantId}
        />
      ) : null}
      {addingProbe ? (
        <ProbeDialog
          onClose={() => {
            setAddingProbe(false);
            load();
          }}
          tenantId={tenantId}
        />
      ) : null}
    </section>
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

function ProbeCard({
  tenantId,
  data,
  now,
  onAdd,
  onError,
}: {
  tenantId: string;
  data: MonitoringOverview;
  now: number;
  onAdd: () => void;
  onError: (message: string | null) => void;
}) {
  const [downloading, setDownloading] = useState(false);
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
}: Props & {
  assetId: string;
  onBack: () => void;
  onOpenDevice: (assetId: string) => void;
}) {
  const [data, setData] = useState<MonitoringDeviceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [range, setRange] = useState<MonitoringRange>("24h");
  const [series, setSeries] = useState<MonitoringSeries | null>(null);
  const [draft, setDraft] = useState<SensorDraft | null>(null);
  const [busy, setBusy] = useState(false);

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
          <header className="monitoring__hero">
            <div>
              <div className="monitoring__title">
                <h2 id="monitoring-device-title">{data.device.name}</h2>
                <StateChip state={data.device.state} />
              </div>
              <p>
                {[
                  CATEGORY_LABELS[data.device.category ?? ""] ?? "Gerät",
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
                      void act({
                        type: "pauseDevice",
                        assetId,
                        paused: !allPaused,
                      })
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
                      <h3>{sensor.name} · Antwortzeit</h3>
                      <span className="monitoring-muted">
                        Aktuell {formatMs(sensor.lastValue)}
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
                            onDelete={() => {
                              if (
                                window.confirm(
                                  `Sensor «${entry.name}» mit seinem Verlauf löschen?`,
                                )
                              ) {
                                void act({
                                  type: "deleteSensor",
                                  sensorId: entry.id,
                                });
                              }
                            }}
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
            </div>

            <article className="monitoring-card">
              <div className="monitoring-card__head">
                <h3>Verknüpft in nextDesk</h3>
              </div>
              <dl className="monitoring-facts">
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

      {draft && data ? (
        <SensorDialog
          agents={data.agents}
          draft={draft}
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
          {KIND_LABELS[sensor.kind]} · {sensorTarget(sensor, device)} ·{" "}
          {agent ? agent.name : "keine Sonde zugewiesen"}
        </span>
      </td>
      <td>
        {sensor.state === "down"
          ? (sensor.lastMessage ?? "Keine Antwort")
          : formatMs(sensor.lastValue)}
        {sensor.warningAbove !== null ? (
          <span className="monitoring-muted">
            Warnung ab {formatMs(sensor.warningAbove)}
          </span>
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
}: {
  series: MonitoringSeries;
  now: number;
  warningAbove: number | null;
}) {
  const chart = useMemo(
    () => chartGeometry(series, Math.max(now, Date.now()), warningAbove),
    [series, now, warningAbove],
  );
  const failed = chart.failures.length;
  return (
    <svg
      aria-label={`Antwortzeit über ${RANGE_LABELS[series.range]} in Millisekunden${failed ? `, ${failed} Abschnitte mit fehlgeschlagenen Prüfungen` : ""}`}
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
      {chart.lines.map((path) => (
        <path className="monitoring-chart__line" d={path} key={path} />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Dialoge

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

function AgentSelect({
  agents,
  value,
  onChange,
}: {
  agents: MonitoringAgent[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <label className="monitoring-field">
      <span>Sonde</span>
      <select
        onChange={(event) => onChange(event.target.value || null)}
        value={value ?? ""}
      >
        <option value="">Keine (Sensor wird nicht gemessen)</option>
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

function SensorFields({
  draft,
  onChange,
}: {
  draft: SensorDraft;
  onChange: (patch: Partial<SensorDraft>) => void;
}) {
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
      <label className="monitoring-field">
        <span>Warnung ab Antwortzeit in ms (optional)</span>
        <input
          inputMode="numeric"
          min={1}
          onChange={(event) =>
            onChange({
              warningAbove: event.target.value
                ? Number(event.target.value)
                : null,
            })
          }
          type="number"
          value={draft.warningAbove ?? ""}
        />
      </label>
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
    </>
  );
}

function SensorDialog({
  tenantId,
  draft: initial,
  agents,
  onClose,
  onSaved,
}: {
  tenantId: string;
  draft: SensorDraft;
  agents: MonitoringAgent[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
            onChange={(event) =>
              change({
                kind: event.target.value as SensorKind,
                port: null,
                url: null,
              })
            }
            value={draft.kind}
          >
            <option value="ping">Ping (Gerät erreichbar)</option>
            <option value="tcp">TCP-Port (Dienst erreichbar)</option>
            <option value="http">HTTP (Webseite antwortet)</option>
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
        <AgentSelect
          agents={agents}
          onChange={(agentId) => change({ agentId })}
          value={draft.agentId}
        />
        <SensorFields draft={draft} onChange={change} />
        <label className="monitoring-check">
          <input
            checked={draft.paused}
            onChange={(event) => change({ paused: event.target.checked })}
            type="checkbox"
          />
          <span>Pausiert (wird nicht gemessen, kein Alarm)</span>
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
            {saving ? "Wird gespeichert …" : "Speichern"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function AddDeviceDialog({
  tenantId,
  agents,
  onClose,
  onSaved,
}: {
  tenantId: string;
  agents: MonitoringAgent[];
  onClose: () => void;
  onSaved: (assetId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<MonitoringAssetChoice[] | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(
    agents.find((agent) => agent.online)?.id ?? agents[0]?.id ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      monitoringCall<{ assets: MonitoringAssetChoice[] }>({
        type: "assets",
        tenantId,
        query,
      })
        .then((result) => {
          if (!cancelled) setChoices(result.assets);
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!assetId) return;
    setSaving(true);
    setError(null);
    try {
      await monitoringCall({
        type: "saveSensor",
        tenantId,
        sensor: emptyDraft(assetId, agentId),
      });
      onSaved(assetId);
    } catch (failure) {
      setError(message(failure));
      setSaving(false);
    }
  };

  return (
    <Dialog onClose={onClose} title="Gerät hinzufügen">
      <form
        className="monitoring-form"
        onSubmit={(event) => void submit(event)}
      >
        <p className="monitoring-muted">
          Überwacht werden Geräte aus der Infrastruktur. Das Gerät erhält einen
          Ping-Sensor; weitere Sensoren lassen sich danach hinzufügen.
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
        <div
          aria-label="Gerät wählen"
          className="monitoring-choices"
          role="radiogroup"
        >
          {choices === null ? (
            <Spinner label="Geräte werden geladen …" />
          ) : choices.length === 0 ? (
            <p className="monitoring__empty">
              Kein Gerät gefunden. Erfasse es zuerst unter Infrastruktur.
            </p>
          ) : (
            choices.map((choice) => (
              <label className="monitoring-choice" key={choice.assetId}>
                <input
                  checked={assetId === choice.assetId}
                  name="monitoring-asset"
                  onChange={() => setAssetId(choice.assetId)}
                  type="radio"
                />
                <span>
                  <strong>{choice.name}</strong>
                  <span className="monitoring-muted">
                    {[
                      CATEGORY_LABELS[choice.category ?? ""] ?? "Gerät",
                      choice.ipAddress ?? choice.hostname ?? "ohne Adresse",
                      choice.monitored ? "wird bereits überwacht" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </label>
            ))
          )}
        </div>
        <AgentSelect agents={agents} onChange={setAgentId} value={agentId} />
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
            disabled={!assetId || saving}
            type="submit"
          >
            <Radar aria-hidden="true" size={16} />
            {saving ? "Wird hinzugefügt …" : "Überwachen"}
          </button>
        </div>
      </form>
    </Dialog>
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
          <div className="monitoring-form__actions">
            <button
              className="secondary-button"
              onClick={() => {
                if (
                  downloaded ||
                  window.confirm(
                    "Die Konfiguration wurde noch nicht heruntergeladen und lässt sich später nicht mehr anzeigen. Trotzdem schliessen?",
                  )
                ) {
                  onClose();
                }
              }}
              type="button"
            >
              Schliessen
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
