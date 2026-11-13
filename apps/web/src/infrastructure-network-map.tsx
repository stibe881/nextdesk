import { tn } from "./lib/formality";
import { useEffect, useMemo, useState } from "react";
import { buildTopology, type TopologyDevice } from "./lib/network-topology";
import {
  parseOverlay,
  subnetBadge,
  subnetKey,
  subnetLabel,
  subnetLegend,
  subnetsForDevices,
  type NetworkOverlay,
} from "./lib/ipam-network-map";
import { supabase } from "./lib/supabase";
import "./ipam.css";

const NODE_W = 150;
const NODE_H_PLAIN = 46;
const NODE_H_SUBNET = 60;
const GAP_X = 24;
const GAP_Y = 64;
const PAD = 16;

export type MonitoringEntry = {
  sensor: string | null;
  status: string | null;
  message: string | null;
  at: string;
};

type MapDevice = TopologyDevice & {
  category: string;
  ipAddress: string | null;
  uplinkPort: string | null;
  prtgObjectId?: string | null;
};

/**
 * Subnets from the IP address management (function `ipam`, action
 * networkMapOverlay). Without the module or the right the map stays as is.
 */
function useSubnetOverlay(tenantId: string | undefined): NetworkOverlay | null {
  const [overlay, setOverlay] = useState<NetworkOverlay | null>(null);
  useEffect(() => {
    if (!tenantId || !supabase) return;
    let current = true;
    void supabase.functions
      .invoke("ipam", { body: { type: "networkMapOverlay", tenantId } })
      .then(({ data, error }) => {
        if (!current || error) return;
        setOverlay(parseOverlay((data as { data?: unknown } | null)?.data));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [tenantId]);
  return overlay;
}

/**
 * Network topology drawn from the uplinks, with the live PRTG state per device:
 * red = open alert, green = monitored without alert, grey = not monitored.
 * With IP address management, every device also shows its subnet/VLAN and
 * the legend filters the map by VLAN.
 */
export function NetworkMap<T extends MapDevice>({
  devices,
  monitoring,
  categoryLabel,
  onOpen,
  tenantId,
}: {
  devices: T[];
  monitoring: Record<string, MonitoringEntry[]>;
  categoryLabel: (category: string) => string;
  onOpen: (deviceId: string) => void;
  /** Enables the subnet overlay from the IP address management. */
  tenantId?: string;
}) {
  const overlay = useSubnetOverlay(tenantId);
  const [subnetFilter, setSubnetFilter] = useState<string | null>(null);
  const subnets = useMemo(
    () => subnetsForDevices(devices, overlay?.prefixes ?? []),
    [devices, overlay],
  );
  const showSubnets = overlay !== null && overlay.prefixes.length > 0;
  const legend = useMemo(
    () =>
      showSubnets
        ? subnetLegend(
            devices.map((device) => device.id),
            subnets,
          )
        : [],
    [devices, subnets, showSubnets],
  );
  const colorOf = new Map(legend.map((entry) => [entry.key, entry.color]));
  const NODE_H = showSubnets ? NODE_H_SUBNET : NODE_H_PLAIN;
  const { nodes, columns, depth } = buildTopology(devices);
  if (nodes.length === 0) {
    return <p className="empty-state">Keine Geräte für die Netzwerkkarte.</p>;
  }
  if (!devices.some((device) => device.uplinkAssetId)) {
    return (
      <p className="empty-state">
        {tn(
          "Noch keine Verbindungen erfasst. Hinterlege bei den Geräten das «Uplink-Gerät», damit die Netzwerkkarte die Topologie zeichnen kann.",
          "Noch keine Verbindungen erfasst. Hinterlegen Sie bei den Geräten das «Uplink-Gerät», damit die Netzwerkkarte die Topologie zeichnen kann.",
        )}
      </p>
    );
  }
  const width = PAD * 2 + columns * NODE_W + Math.max(0, columns - 1) * GAP_X;
  const height = PAD * 2 + (depth + 1) * NODE_H + depth * GAP_Y;
  const position = new Map(
    nodes.map((node) => [
      node.device.id,
      {
        x: PAD + node.x * (NODE_W + GAP_X),
        y: PAD + node.depth * (NODE_H + GAP_Y),
      },
    ]),
  );
  const down = nodes.filter(
    (node) => monitoring[node.device.id]?.length,
  ).length;
  const state = (device: T) =>
    monitoring[device.id]?.length
      ? "down"
      : device.prtgObjectId
        ? "up"
        : "unknown";

  return (
    <div className="network-map">
      <div className="network-map__legend" aria-hidden="true">
        <span className="network-map__dot network-map__dot--down" /> Störung
        <span className="network-map__dot network-map__dot--up" /> Überwacht, OK
        <span className="network-map__dot network-map__dot--unknown" /> Nicht
        überwacht
        <strong>
          {down === 0
            ? "Keine offenen PRTG-Störungen"
            : `${down} ${down === 1 ? "Gerät" : "Geräte"} mit Störung`}
        </strong>
      </div>
      {legend.length > 1 ? (
        <div
          aria-label="Nach VLAN oder Subnetz filtern"
          className="network-map__subnets"
          role="group"
        >
          <button
            aria-pressed={subnetFilter === null}
            className={subnetFilter === null ? "is-active" : ""}
            onClick={() => setSubnetFilter(null)}
            type="button"
          >
            Alle Subnetze
          </button>
          {legend.map((entry) => (
            <button
              aria-pressed={subnetFilter === entry.key}
              className={subnetFilter === entry.key ? "is-active" : ""}
              key={entry.key}
              onClick={() =>
                setSubnetFilter((current) =>
                  current === entry.key ? null : entry.key,
                )
              }
              type="button"
            >
              <i
                className={`network-map__swatch network-map__swatch--c${entry.color}`}
              />
              {entry.label} <span>{entry.count}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="network-map__scroll">
        <svg
          aria-label="Netzwerkkarte"
          height={height}
          role="img"
          viewBox={`0 0 ${width} ${height}`}
          width={width}
        >
          {nodes.map((node) => {
            if (!node.parentId) return null;
            const from = position.get(node.parentId)!;
            const to = position.get(node.device.id)!;
            const x1 = from.x + NODE_W / 2;
            const y1 = from.y + NODE_H;
            const x2 = to.x + NODE_W / 2;
            const y2 = to.y;
            const mid = (y1 + y2) / 2;
            const broken =
              state(node.device) === "down" ? " network-map__link--down" : "";
            return (
              <g key={`link-${node.device.id}`}>
                <path
                  className={`network-map__link${broken}`}
                  d={`M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`}
                />
                {node.device.uplinkPort ? (
                  <text className="network-map__port" x={x2 + 4} y={y2 - 6}>
                    {node.device.uplinkPort}
                  </text>
                ) : null}
              </g>
            );
          })}
          {nodes.map((node) => {
            const { x, y } = position.get(node.device.id)!;
            const alerts = monitoring[node.device.id] ?? [];
            const subnet = subnets.get(node.device.id);
            const key = subnetKey(subnet);
            const dimmed = subnetFilter !== null && subnetFilter !== key;
            const title = [
              node.device.name,
              categoryLabel(node.device.category),
              node.device.ipAddress,
              showSubnets
                ? `Subnetz: ${subnetLabel(subnet)}${subnet ? ` (${subnet.prefix})` : ""}`
                : null,
              ...alerts.map((alert) =>
                `Achtung: ${alert.sensor ?? "Sensor"}: ${alert.status ?? ""} ${alert.message ?? ""}`.trim(),
              ),
            ]
              .filter(Boolean)
              .join("\n");
            return (
              <g
                className={`network-map__node network-map__node--${state(node.device)}${dimmed ? " network-map__node--dimmed" : ""}`}
                key={node.device.id}
                onClick={() => onOpen(node.device.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(node.device.id);
                  }
                }}
                role="button"
                tabIndex={0}
                transform={`translate(${x},${y})`}
              >
                <title>{title}</title>
                <rect height={NODE_H} rx={8} width={NODE_W} />
                {showSubnets && subnet ? (
                  <rect
                    className={`network-map__subnet network-map__swatch--c${colorOf.get(key) ?? 0}`}
                    height={NODE_H - 12}
                    rx={2}
                    width={4}
                    x={3}
                    y={6}
                  />
                ) : null}
                <circle cx={14} cy={NODE_H_PLAIN / 2} r={5} />
                <text className="network-map__name" x={26} y={19}>
                  {truncate(node.device.name, 19)}
                </text>
                <text className="network-map__meta" x={26} y={35}>
                  {truncate(
                    node.device.ipAddress ??
                      categoryLabel(node.device.category),
                    22,
                  )}
                </text>
                {showSubnets ? (
                  <text
                    className="network-map__meta network-map__vlan"
                    x={26}
                    y={50}
                  >
                    {truncate(subnetBadge(subnet) ?? "Ohne Subnetz", 22)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
