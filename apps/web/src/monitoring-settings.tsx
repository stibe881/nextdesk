import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Activity, Copy, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";

import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";

type CreateOn = "down" | "down_and_warning";

export type MonitoringConfig = {
  configured: boolean;
  enabled: boolean;
  teamId: string | null;
  createOn: CreateOn;
  setServiceStatus: boolean;
  realertMinutes: number;
  groupDependencies: boolean;
  suppressInMaintenance: boolean;
  hasToken: boolean;
  tokenRotatedAt: string | null;
  lastReceivedAt: string | null;
};

export type MonitoringAlert = {
  id: string;
  deviceName: string | null;
  sensorName: string | null;
  ticketNumber: string | null;
  state: "open" | "resolved";
  lastStatus: string | null;
  lastMessage: string | null;
  eventCount: number;
  openedAt: string;
  resolvedAt: string | null;
};

type Option = { id: string; name: string };
type TeamOption = { id: string; name: string; departmentId: string | null };

export const PRTG_POSTDATA =
  "device=%device&host=%host&sensor=%sensor&status=%status&message=%message&down=%down&lastvalue=%lastvalue&datetime=%datetime&group=%group&probe=%probe&sensorid=%sensorid&deviceid=%deviceid";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseData(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("Die Serverantwort ist unvollständig.");
  }
  return value.data;
}

export function parseMonitoringConfig(value: unknown): MonitoringConfig | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.enabled !== "boolean" ||
    typeof value.setServiceStatus !== "boolean" ||
    typeof value.hasToken !== "boolean" ||
    (value.createOn !== "down" && value.createOn !== "down_and_warning")
  ) {
    return null;
  }
  const text = (entry: unknown) => (typeof entry === "string" ? entry : null);
  return {
    configured: value.configured === true,
    enabled: value.enabled,
    teamId: text(value.teamId),
    createOn: value.createOn,
    setServiceStatus: value.setServiceStatus,
    realertMinutes:
      typeof value.realertMinutes === "number" ? value.realertMinutes : 15,
    groupDependencies: value.groupDependencies !== false,
    suppressInMaintenance: value.suppressInMaintenance !== false,
    hasToken: value.hasToken,
    tokenRotatedAt: text(value.tokenRotatedAt),
    lastReceivedAt: text(value.lastReceivedAt),
  };
}

function parseAlerts(value: unknown): MonitoringAlert[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string") return [];
    const text = (field: unknown) => (typeof field === "string" ? field : null);
    return [
      {
        id: entry.id,
        deviceName: text(entry.deviceName),
        sensorName: text(entry.sensorName),
        ticketNumber: text(entry.ticketNumber),
        state: entry.state === "resolved" ? "resolved" : "open",
        lastStatus: text(entry.lastStatus),
        lastMessage: text(entry.lastMessage),
        eventCount: typeof entry.eventCount === "number" ? entry.eventCount : 1,
        openedAt: text(entry.openedAt) ?? "",
        resolvedAt: text(entry.resolvedAt),
      },
    ];
  });
}

function dateLabel(value: string | null): string {
  if (!value) return "noch nie";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "unbekannt"
    : date.toLocaleString("de-CH", {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function invokeMonitoring(options: { body: Record<string, unknown> }) {
  if (!supabase) {
    throw new Error("Die Verbindung zu nextDesk ist nicht konfiguriert.");
  }
  return supabase.functions.invoke<unknown>("monitoring-integrations", options);
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

/**
 * Monitoring (PRTG): webhook configuration for tickets and system status
 * from PRTG notifications, token rotation and recent alerts.
 */
export function MonitoringSettings({ tenantId }: { tenantId: string }) {
  const [config, setConfig] = useState<MonitoringConfig | null>(null);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [alerts, setAlerts] = useState<MonitoringAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [closeAlertId, setCloseAlertId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const requestVersion = useRef(0);

  const [enabled, setEnabled] = useState(false);
  const [teamId, setTeamId] = useState("");
  const [createOn, setCreateOn] = useState<CreateOn>("down");
  const [setServiceStatus, setSetServiceStatus] = useState(false);
  const [realertMinutes, setRealertMinutes] = useState(15);
  const [groupDependencies, setGroupDependencies] = useState(true);
  const [suppressInMaintenance, setSuppressInMaintenance] = useState(true);

  const applyConfig = useCallback((next: MonitoringConfig) => {
    setConfig(next);
    setEnabled(next.enabled);
    setTeamId(next.teamId ?? "");
    setCreateOn(next.createOn);
    setSetServiceStatus(next.setServiceStatus);
    setRealertMinutes(next.realertMinutes);
    setGroupDependencies(next.groupDependencies);
    setSuppressInMaintenance(next.suppressInMaintenance);
  }, []);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const { data, error } = await invokeMonitoring({
        body: { type: "get", tenantId },
      });
      if (error) throw error;
      const payload = responseData(data);
      const nextConfig = parseMonitoringConfig(payload.config);
      if (!nextConfig) throw new Error("Die Konfiguration ist unvollständig.");
      if (requestVersion.current !== version) return;
      applyConfig(nextConfig);
      setDepartments(
        Array.isArray(payload.departments)
          ? payload.departments.flatMap((entry) =>
              isRecord(entry) &&
              typeof entry.id === "string" &&
              typeof entry.name === "string"
                ? [{ id: entry.id, name: entry.name }]
                : [],
            )
          : [],
      );
      setTeams(
        Array.isArray(payload.teams)
          ? payload.teams.flatMap((entry) =>
              isRecord(entry) &&
              typeof entry.id === "string" &&
              typeof entry.name === "string"
                ? [
                    {
                      id: entry.id,
                      name: entry.name,
                      departmentId:
                        typeof entry.departmentId === "string"
                          ? entry.departmentId
                          : null,
                    },
                  ]
                : [],
            )
          : [],
      );
      setAlerts(parseAlerts(payload.alerts));
    } catch (error) {
      if (requestVersion.current !== version) return;
      setMessage(
        await functionErrorMessage(
          error,
          "Die Monitoring-Konfiguration konnte nicht geladen werden.",
        ),
      );
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, [applyConfig, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const { data, error } = await invokeMonitoring({
        body: {
          type: "save",
          tenantId,
          config: {
            enabled,
            teamId: teamId || null,
            createOn,
            setServiceStatus,
            realertMinutes,
            groupDependencies,
            suppressInMaintenance,
          },
        },
      });
      if (error) throw error;
      const next = parseMonitoringConfig(responseData(data).config);
      if (next) applyConfig(next);
      setMessage("Die Monitoring-Einstellungen wurden gespeichert.");
    } catch (error) {
      setMessage(
        await functionErrorMessage(
          error,
          "Die Monitoring-Einstellungen konnten nicht gespeichert werden.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function rotate() {
    setRotating(true);
    setConfirmRotate(false);
    setMessage("");
    try {
      const { data, error } = await invokeMonitoring({
        body: { type: "rotateToken", tenantId },
      });
      if (error) throw error;
      const payload = responseData(data);
      if (typeof payload.webhookUrl !== "string") {
        throw new Error("Die Webhook-Adresse fehlt.");
      }
      setNewUrl(payload.webhookUrl);
      const next = parseMonitoringConfig(payload.config);
      if (next) setConfig(next);
    } catch (error) {
      setMessage(
        await functionErrorMessage(
          error,
          "Der Token konnte nicht erzeugt werden.",
        ),
      );
    } finally {
      setRotating(false);
    }
  }

  async function closeAlert(alertId: string) {
    setClosing(true);
    setMessage("");
    try {
      const { data, error } = await invokeMonitoring({
        body: { type: "closeAlert", tenantId, alertId },
      });
      if (error) throw error;
      const result = responseData(data);
      setCloseAlertId(null);
      setMessage(
        result.closed === true
          ? "Der Alarm wurde beendet. Dienste, die nur dieser Alarm gestört hat, sind wieder betriebsbereit."
          : "Der Alarm war bereits beendet.",
      );
      await load();
    } catch (error) {
      setMessage(
        await functionErrorMessage(
          error,
          "Der Alarm konnte nicht beendet werden.",
        ),
      );
    } finally {
      setClosing(false);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await copyText(value);
      setCopied(label);
    } catch {
      setMessage("Kopieren war nicht möglich. Bitte markieren Sie den Text.");
    }
  }

  const busy = loading || saving || rotating;
  const departmentNames = new Map(
    departments.map((department) => [department.id, department.name]),
  );

  return (
    <section
      aria-busy={busy}
      aria-labelledby="monitoring-settings-heading"
      className="asset-intune-settings monitoring-settings panel"
    >
      <div className="panel-heading asset-intune-settings__heading">
        <div>
          <span className="eyebrow">MONITORING</span>
          <h2 id="monitoring-settings-heading">Monitoring (PRTG)</h2>
          <p>
            PRTG Network Monitor meldet Störungen direkt an nextDesk: Jede
            Meldung öffnet oder ergänzt eine Störung im Arbeitsbereich
            «Störungen» (ohne Ticket) und alarmiert das Team sofort per Push und
            Mail. Bei «Up» wird die Störung automatisch abgeschlossen und der
            Systemstatus wiederhergestellt; die Ursache lässt sich nachtragen.
          </p>
        </div>
        <Activity aria-hidden="true" size={25} />
      </div>

      {loading ? <p>Konfiguration wird geladen …</p> : null}
      {!loading && config ? (
        <>
          <form className="asset-intune-settings__form" onSubmit={save}>
            <label className="asset-intune-settings__check">
              <input
                checked={enabled}
                disabled={saving}
                onChange={(event) => setEnabled(event.target.checked)}
                type="checkbox"
              />
              PRTG-Meldungen für diesen Mandanten verarbeiten
            </label>
            <div className="monitoring-settings__grid">
              <label>
                Team für die Alarmierung
                <select
                  disabled={saving}
                  onChange={(event) => setTeamId(event.target.value)}
                  value={teamId}
                >
                  <option value="">Kein Team (alle Agenten)</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                      {team.departmentId &&
                      departmentNames.get(team.departmentId)
                        ? ` (${departmentNames.get(team.departmentId)})`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Störung öffnen bei
                <select
                  disabled={saving}
                  onChange={(event) =>
                    setCreateOn(event.target.value as CreateOn)
                  }
                  value={createOn}
                >
                  <option value="down">Down</option>
                  <option value="down_and_warning">Down und Warning</option>
                </select>
              </label>
              <label>
                Erneut alarmieren, solange unbestätigt
                <select
                  disabled={saving}
                  onChange={(event) =>
                    setRealertMinutes(Number(event.target.value))
                  }
                  value={realertMinutes}
                >
                  {[5, 10, 15, 30, 60].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      alle {minutes} Minuten
                    </option>
                  ))}
                  {[0, 5, 10, 15, 30, 60].includes(realertMinutes) ? null : (
                    <option value={realertMinutes}>
                      alle {realertMinutes} Minuten
                    </option>
                  )}
                  <option value={0}>Nie</option>
                </select>
              </label>
            </div>
            <label className="asset-intune-settings__check">
              <input
                checked={groupDependencies}
                disabled={saving}
                onChange={(event) => setGroupDependencies(event.target.checked)}
                type="checkbox"
              />
              Folgestörungen bündeln: Fällt ein Gerät hinter einem bereits
              gestörten Gerät aus (Uplink in der Infrastruktur), wird es als
              Folgestörung angehängt und nicht separat alarmiert
            </label>
            <label className="asset-intune-settings__check">
              <input
                checked={suppressInMaintenance}
                disabled={saving}
                onChange={(event) =>
                  setSuppressInMaintenance(event.target.checked)
                }
                type="checkbox"
              />
              Während einer Wartung im Systemstatus nicht alarmieren (die
              Störung wird trotzdem erfasst)
            </label>
            <label className="asset-intune-settings__check">
              <input
                checked={setServiceStatus}
                disabled={saving}
                onChange={(event) => setSetServiceStatus(event.target.checked)}
                type="checkbox"
              />
              Systemstatus des verknüpften Dienstes anpassen (Down: teilweiser
              Ausfall, Warning: eingeschränkt)
            </label>
            <p className="asset-intune-settings__help">
              Geräte werden über die PRTG-Objekt-ID in der Infrastruktur, sonst
              über Hostname bzw. IP-Adresse und zuletzt über den Gerätenamen
              zugeordnet. Wartungen und manuell gesetzte grössere Ausfälle im
              Systemstatus werden nie überschrieben.
            </p>
            <div className="asset-intune-settings__status" role="status">
              <ShieldCheck aria-hidden="true" size={17} />
              <span>
                Letzte Meldung: {dateLabel(config.lastReceivedAt)} · Token{" "}
                {config.hasToken
                  ? `erzeugt am ${dateLabel(config.tokenRotatedAt)}`
                  : "noch nicht erzeugt"}
              </span>
            </div>
            <div className="asset-intune-settings__actions">
              <button disabled={busy} type="submit">
                {saving ? "Wird gespeichert …" : "Einstellungen speichern"}
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  config.hasToken ? setConfirmRotate(true) : void rotate()
                }
                type="button"
              >
                <KeyRound aria-hidden="true" size={16} />
                {rotating
                  ? "Token wird erzeugt …"
                  : config.hasToken
                    ? "Neuen Token erzeugen"
                    : "Token erzeugen"}
              </button>
            </div>
          </form>

          {confirmRotate ? (
            <div
              className="asset-intune-settings__status"
              role="alertdialog"
              aria-labelledby="monitoring-rotate-title"
            >
              <KeyRound aria-hidden="true" size={18} />
              <div>
                <strong id="monitoring-rotate-title">
                  Neuen Token erzeugen?
                </strong>
                <p>
                  Die bisherige Webhook-Adresse funktioniert danach nicht mehr.
                  Sie müssen die neue Adresse in PRTG hinterlegen.
                </p>
                <div className="asset-intune-settings__actions">
                  <button onClick={() => void rotate()} type="button">
                    Token erneuern
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => setConfirmRotate(false)}
                    type="button"
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {newUrl ? (
            <div className="monitoring-settings__secret" role="status">
              <strong>Webhook-Adresse (wird nur jetzt angezeigt)</strong>
              <p>
                Kopieren Sie die Adresse jetzt. nextDesk speichert nur einen
                Hash des Tokens und kann die Adresse später nicht mehr anzeigen.
              </p>
              <div className="monitoring-settings__copy">
                <code>{newUrl}</code>
                <button
                  className="secondary-button"
                  onClick={() => void copy(newUrl, "url")}
                  type="button"
                >
                  <Copy aria-hidden="true" size={15} />
                  {copied === "url" ? "Kopiert" : "Kopieren"}
                </button>
              </div>
            </div>
          ) : null}

          <section
            aria-labelledby="monitoring-setup-heading"
            className="asset-intune-settings__history monitoring-settings__setup"
          >
            <div className="panel-heading">
              <div>
                <p className="eyebrow">EINRICHTUNG IN PRTG</p>
                <h3 id="monitoring-setup-heading">So verbinden Sie PRTG</h3>
              </div>
            </div>
            <ol>
              <li>
                Erzeugen Sie oben einen Token und kopieren Sie die
                Webhook-Adresse.
              </li>
              <li>
                Öffnen Sie in PRTG{" "}
                <em>Setup → Kontoeinstellungen → Benachrichtigungsvorlagen</em>{" "}
                und legen Sie eine neue Vorlage an.
              </li>
              <li>
                Aktivieren Sie <em>HTTP-Aktion ausführen</em> (Execute HTTP
                Action), fügen Sie die Webhook-Adresse als URL ein und wählen
                Sie die Methode <strong>POST</strong>.
              </li>
              <li>
                Tragen Sie als Postdata (Payload) Folgendes ein:
                <div className="monitoring-settings__copy">
                  <code>{PRTG_POSTDATA}</code>
                  <button
                    className="secondary-button"
                    onClick={() => void copy(PRTG_POSTDATA, "postdata")}
                    type="button"
                  >
                    <Copy aria-hidden="true" size={15} />
                    {copied === "postdata" ? "Kopiert" : "Kopieren"}
                  </button>
                </div>
              </li>
              <li>
                Hinterlegen Sie die Vorlage als Benachrichtigungs-Trigger
                (Zustand «Down», bei Bedarf «Warning», sowie «Up») auf der
                gewünschten Gruppe oder dem Gerät.
              </li>
              <li>
                Optional: Tragen Sie die PRTG-ID des Geräts oder Sensors in der
                Infrastruktur unter «PRTG-Objekt-ID» ein, damit die Zuordnung
                eindeutig ist.
              </li>
            </ol>
            <p className="asset-intune-settings__help">
              JSON-Bodies und Query-Parameter werden ebenfalls akzeptiert. Der
              Token kann alternativ im Header <code>x-nextdesk-token</code>{" "}
              übergeben werden.
            </p>
          </section>

          <section
            aria-labelledby="monitoring-alerts-heading"
            className="asset-intune-settings__history"
          >
            <div className="panel-heading">
              <div>
                <p className="eyebrow">LETZTE ALARME</p>
                <h3 id="monitoring-alerts-heading">Alarme aus PRTG</h3>
              </div>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void load()}
                type="button"
              >
                <RefreshCw aria-hidden="true" size={15} /> Aktualisieren
              </button>
            </div>
            {alerts.length === 0 ? (
              <p className="empty-state">Noch keine Alarme empfangen.</p>
            ) : (
              <ul aria-label="Alarme aus PRTG">
                {alerts.map((alert) => (
                  <li key={alert.id}>
                    <article>
                      <div>
                        <strong>
                          {alert.deviceName ?? "Unbekanntes Gerät"}
                          {alert.sensorName ? ` – ${alert.sensorName}` : ""}
                        </strong>
                        <p>
                          {alert.state === "open" ? "Offen" : "Behoben"} ·{" "}
                          {alert.lastStatus ?? "–"} · seit{" "}
                          {dateLabel(alert.openedAt)}
                          {alert.resolvedAt
                            ? ` · behoben ${dateLabel(alert.resolvedAt)}`
                            : ""}{" "}
                          · {alert.eventCount}{" "}
                          {alert.eventCount === 1 ? "Meldung" : "Meldungen"}
                          {alert.ticketNumber
                            ? ` · Ticket ${alert.ticketNumber}`
                            : ""}
                        </p>
                        {alert.lastMessage ? <p>{alert.lastMessage}</p> : null}
                      </div>
                      {alert.state === "open" ? (
                        closeAlertId === alert.id ? (
                          <div
                            className="monitoring-settings__row-actions"
                            role="group"
                            aria-label="Alarm beenden bestätigen"
                          >
                            <span>
                              Alarm beenden und gestörte Dienste zurücksetzen?
                            </span>
                            <button
                              disabled={closing}
                              onClick={() => void closeAlert(alert.id)}
                              type="button"
                            >
                              {closing ? "Wird beendet …" : "Ja, beenden"}
                            </button>
                            <button
                              className="secondary-button"
                              disabled={closing}
                              onClick={() => setCloseAlertId(null)}
                              type="button"
                            >
                              Abbrechen
                            </button>
                          </div>
                        ) : (
                          <button
                            className="secondary-button"
                            disabled={busy}
                            onClick={() => setCloseAlertId(alert.id)}
                            type="button"
                          >
                            Alarm beenden
                          </button>
                        )
                      ) : null}
                    </article>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
      {message ? (
        <p
          aria-live="polite"
          className="asset-intune-settings__message"
          role="status"
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}
