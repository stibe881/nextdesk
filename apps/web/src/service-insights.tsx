import { useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { useVisibleInterval } from "./lib/use-visible-interval";
import { formatAvailability } from "./service-status-incidents";
import "./service-status-incidents.css";

/** Gerät eines Dienstes mit Netzwerk- und Monitoring-Kontext. */
export type ServiceDevice = {
  assetId: string;
  name: string;
  active: boolean;
  category: string | null;
  hostname: string | null;
  ipAddress: string | null;
  subnet: string | null;
  vlanNumber: number | null;
  vlanName: string | null;
  switchName: string | null;
  switchPort: string | null;
  incidentNumber: string | null;
  incidentSeverity: string | null;
  openAlerts: number;
  monitoringStatus: string | null;
};

export type ServiceSubnet = {
  prefix: string;
  description: string | null;
  vlanNumber: number | null;
  vlanName: string | null;
  addressCount: number;
};

export type ServiceIncident = {
  number: string;
  title: string;
  severity: string;
  openedAt: string;
  deviceName: string | null;
};

export type ServiceInsights = {
  availability: {
    days30: number | null;
    days90: number | null;
    withoutMaintenance90: number | null;
    maintenance90Percent: number | null;
  };
  devices: ServiceDevice[];
  subnets: ServiceSubnet[];
  incidents: ServiceIncident[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;
const integer = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;
const percent = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Antwort von service-assets `serviceInsights` (tolerant gegen Lücken). */
export function parseServiceInsights(value: unknown): ServiceInsights | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const data = value.data;
  const availability = isRecord(data.availability) ? data.availability : {};
  const dependencies = isRecord(data.dependencies) ? data.dependencies : {};
  const list = (key: string) =>
    Array.isArray(dependencies[key])
      ? (dependencies[key] as unknown[]).filter(isRecord)
      : [];
  return {
    availability: {
      days30: percent(availability.days30),
      days90: percent(availability.days90),
      withoutMaintenance90: percent(availability.withoutMaintenance90),
      maintenance90Percent: percent(availability.maintenance90Percent),
    },
    devices: list("devices").flatMap((device) =>
      typeof device.assetId === "string" && text(device.name)
        ? [
            {
              assetId: device.assetId,
              name: text(device.name)!,
              active: device.active !== false,
              category: text(device.category),
              hostname: text(device.hostname),
              ipAddress: text(device.ipAddress),
              subnet: text(device.subnet),
              vlanNumber: integer(device.vlanNumber),
              vlanName: text(device.vlanName),
              switchName: text(device.switchName),
              switchPort: text(device.switchPort),
              incidentNumber: text(device.incidentNumber),
              incidentSeverity: text(device.incidentSeverity),
              openAlerts: integer(device.openAlerts) ?? 0,
              monitoringStatus: text(device.monitoringStatus),
            },
          ]
        : [],
    ),
    subnets: list("subnets").flatMap((subnet) =>
      text(subnet.prefix)
        ? [
            {
              prefix: text(subnet.prefix)!,
              description: text(subnet.description),
              vlanNumber: integer(subnet.vlanNumber),
              vlanName: text(subnet.vlanName),
              addressCount: integer(subnet.addressCount) ?? 0,
            },
          ]
        : [],
    ),
    incidents: list("incidents").flatMap((incident) =>
      text(incident.number) && text(incident.title)
        ? [
            {
              number: text(incident.number)!,
              title: text(incident.title)!,
              severity: text(incident.severity) ?? "down",
              openedAt: text(incident.openedAt) ?? "",
              deviceName: text(incident.deviceName),
            },
          ]
        : [],
    ),
  };
}

/** Ausgefallene Geräte (offene Störung oder offene Monitoring-Alarme). */
export function failingDevices(devices: readonly ServiceDevice[]) {
  return devices.filter(
    (device) => device.incidentNumber !== null || device.openAlerts > 0,
  );
}

function vlanLabel(number: number | null, name: string | null): string {
  if (number === null) return "–";
  return name ? `${number} · ${name}` : String(number);
}

/**
 * Dienstansicht: Verfügbarkeit (30/90 Tage), Geräte mit IP/Subnetz/VLAN,
 * Subnetze des Dienstes und betroffene Monitoring-Störungen.
 */
export function ServiceInsightsPanel({
  serviceId,
  tenantId,
}: {
  serviceId: string;
  tenantId: string;
}) {
  const [insights, setInsights] = useState<ServiceInsights | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!supabase) {
      setError("Die Verbindung zu Supabase ist nicht konfiguriert.");
      return;
    }
    const { data, error: invokeError } = await supabase.functions.invoke(
      "service-assets",
      { body: { type: "serviceInsights", tenantId, serviceId } },
    );
    const parsed = invokeError ? null : parseServiceInsights(data);
    if (!parsed) {
      setError("Die Details des Dienstes konnten nicht geladen werden.");
      return;
    }
    setError("");
    setInsights(parsed);
  }, [serviceId, tenantId]);

  useEffect(() => {
    setInsights(null);
    void load();
  }, [load]);
  useVisibleInterval(() => void load(), 60_000, insights !== null);

  if (error) {
    return (
      <p className="form-message form-message--error" role="alert">
        {error}
      </p>
    );
  }
  if (!insights) {
    return <p className="empty-state">Details werden geladen …</p>;
  }
  const failing = failingDevices(insights.devices);
  return (
    <section aria-label="Details des Dienstes" className="service-insights">
      <dl className="service-insights__figures">
        <div>
          <dt>Verfügbarkeit 30 Tage</dt>
          <dd>{formatAvailability(insights.availability.days30)}</dd>
        </div>
        <div>
          <dt>Verfügbarkeit 90 Tage</dt>
          <dd>{formatAvailability(insights.availability.days90)}</dd>
        </div>
        <div>
          <dt>davon Wartung (90 Tage)</dt>
          <dd>
            {formatAvailability(insights.availability.maintenance90Percent)}
          </dd>
        </div>
        <div>
          <dt>Ohne Wartung gerechnet</dt>
          <dd>
            {formatAvailability(insights.availability.withoutMaintenance90)}
          </dd>
        </div>
      </dl>
      {failing.length > 0 || insights.incidents.length > 0 ? (
        <p className="service-insights__alert" role="status">
          Betroffen durch Ausfall:{" "}
          {[
            ...failing.map((device) =>
              device.incidentNumber
                ? `${device.name} (${device.incidentNumber})`
                : device.name,
            ),
            ...insights.incidents
              .filter(
                (incident) =>
                  !failing.some(
                    (device) => device.incidentNumber === incident.number,
                  ),
              )
              .map((incident) => `${incident.number} ${incident.title}`),
          ].join(", ")}
        </p>
      ) : null}
      <div>
        <h5>Geräte ({insights.devices.length})</h5>
        {insights.devices.length === 0 ? (
          <p className="empty-state">
            Diesem Dienst sind keine Geräte zugeordnet.
          </p>
        ) : (
          <div className="service-insights__table-wrap">
            <table className="service-insights__table">
              <thead>
                <tr>
                  <th scope="col">Gerät</th>
                  <th scope="col">IP-Adresse</th>
                  <th scope="col">Subnetz</th>
                  <th scope="col">VLAN</th>
                  <th scope="col">Switch-Port</th>
                  <th scope="col">Monitoring</th>
                </tr>
              </thead>
              <tbody>
                {insights.devices.map((device) => (
                  <tr key={device.assetId}>
                    <td>
                      {device.name}
                      {device.hostname ? (
                        <small> · {device.hostname}</small>
                      ) : null}
                    </td>
                    <td>{device.ipAddress ?? "–"}</td>
                    <td>{device.subnet ?? "–"}</td>
                    <td>{vlanLabel(device.vlanNumber, device.vlanName)}</td>
                    <td>
                      {device.switchName
                        ? `${device.switchName}${device.switchPort ? ` / ${device.switchPort}` : ""}`
                        : "–"}
                    </td>
                    <td>
                      {device.incidentNumber ? (
                        <span className="service-insights__down">
                          {device.incidentSeverity === "warning"
                            ? "Warnung"
                            : "Ausgefallen"}{" "}
                          ({device.incidentNumber})
                        </span>
                      ) : device.openAlerts > 0 ? (
                        <span className="service-insights__down">
                          {device.openAlerts} offene Alarme
                        </span>
                      ) : (
                        "In Ordnung"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {insights.subnets.length > 0 ? (
        <div>
          <h5>Subnetze des Dienstes</h5>
          <div className="service-insights__table-wrap">
            <table className="service-insights__table">
              <thead>
                <tr>
                  <th scope="col">Subnetz</th>
                  <th scope="col">VLAN</th>
                  <th scope="col">Adressen</th>
                </tr>
              </thead>
              <tbody>
                {insights.subnets.map((subnet) => (
                  <tr key={subnet.prefix}>
                    <td>
                      {subnet.prefix}
                      {subnet.description ? (
                        <small> · {subnet.description}</small>
                      ) : null}
                    </td>
                    <td>{vlanLabel(subnet.vlanNumber, subnet.vlanName)}</td>
                    <td>{subnet.addressCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
