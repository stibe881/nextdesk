import { buildRacks, type RackDevice } from "./lib/rack-layout";

const UNIT_PX = 18;
const RACK_WIDTH = 260;
const LABEL_WIDTH = 28;

/**
 * Graphical rack view: devices at their height units, coloured by category,
 * with uplink lines between devices of the same rack.
 */
export function RackView<T extends RackDevice>({
  devices,
  categoryLabel,
  onOpen,
  selectedRackKeys,
  onToggleRack,
  onSelectRackDevices,
}: {
  devices: T[];
  categoryLabel: (category: string) => string;
  onOpen: (deviceId: string) => void;
  /** Racks selected for label printing. */
  selectedRackKeys?: ReadonlySet<string> | undefined;
  onToggleRack?: ((rackKey: string, checked: boolean) => void) | undefined;
  onSelectRackDevices?: ((deviceIds: string[]) => void) | undefined;
}) {
  const racks = buildRacks(devices);
  if (racks.length === 0) {
    return (
      <p className="empty-state">
        Noch keine Geräte mit Rack-Angabe. Erfassen Sie bei den Geräten «Rack»
        und «Höheneinheit» (z. B. 12 oder 10-11).
      </p>
    );
  }
  return (
    <div className="rack-view">
      {racks.map((rack) => {
        const height = rack.units * UNIT_PX;
        const center = new Map(
          rack.placed.map((entry) => [
            entry.device.id,
            (rack.units - (entry.start + entry.height - 1)) * UNIT_PX +
              (entry.height * UNIT_PX) / 2,
          ]),
        );
        const links = rack.placed.flatMap((entry) => {
          const from = center.get(entry.device.id);
          const to = entry.device.uplinkAssetId
            ? center.get(entry.device.uplinkAssetId)
            : undefined;
          return from !== undefined && to !== undefined
            ? [{ id: entry.device.id, from, to }]
            : [];
        });
        return (
          <figure className="rack-view__rack" key={rack.key}>
            <figcaption>
              <strong>Rack {rack.name}</strong>
              {rack.locationName ? <span>{rack.locationName}</span> : null}
              <small>
                {rack.units} HE · {rack.placed.length} Geräte
              </small>
              {onToggleRack ? (
                <label className="asset-label-check rack-view__label-check">
                  <input
                    checked={selectedRackKeys?.has(rack.key) ?? false}
                    onChange={(event) =>
                      onToggleRack(rack.key, event.target.checked)
                    }
                    type="checkbox"
                  />
                  Rack-Etikett
                </label>
              ) : null}
              {onSelectRackDevices ? (
                <button
                  className="text-button rack-view__label-devices"
                  onClick={() =>
                    onSelectRackDevices([
                      ...rack.placed.map((entry) => entry.device.id),
                      ...rack.unplaced.map((device) => device.id),
                    ])
                  }
                  type="button"
                >
                  Geräte-Etiketten auswählen
                </button>
              ) : null}
            </figcaption>
            <svg
              aria-label={`Rack ${rack.name}`}
              height={height + 2}
              role="img"
              viewBox={`0 0 ${RACK_WIDTH + LABEL_WIDTH + 40} ${height + 2}`}
              width="100%"
            >
              {Array.from({ length: rack.units }, (_, index) => (
                <g key={index}>
                  <rect
                    className="rack-view__slot"
                    height={UNIT_PX}
                    width={RACK_WIDTH}
                    x={LABEL_WIDTH}
                    y={index * UNIT_PX + 1}
                  />
                  <text
                    className="rack-view__unit"
                    x={LABEL_WIDTH - 6}
                    y={index * UNIT_PX + UNIT_PX * 0.7 + 1}
                  >
                    {rack.units - index}
                  </text>
                </g>
              ))}
              {rack.placed.map((entry) => {
                const top =
                  (rack.units - (entry.start + entry.height - 1)) * UNIT_PX + 1;
                return (
                  <g
                    className={`rack-view__device rack-view__device--${entry.device.category}`}
                    key={entry.device.id}
                    onClick={() => onOpen(entry.device.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpen(entry.device.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <title>{`${entry.device.name} · ${categoryLabel(entry.device.category)} · HE ${entry.start}${entry.height > 1 ? `–${entry.start + entry.height - 1}` : ""}`}</title>
                    <rect
                      height={entry.height * UNIT_PX - 2}
                      rx={3}
                      width={RACK_WIDTH - 4}
                      x={LABEL_WIDTH + 2}
                      y={top + 1}
                    />
                    <text x={LABEL_WIDTH + 10} y={top + UNIT_PX * 0.7}>
                      {entry.device.name.slice(0, 34)}
                    </text>
                  </g>
                );
              })}
              {links.map((link, index) => {
                const x = LABEL_WIDTH + RACK_WIDTH + 8 + (index % 4) * 7;
                return (
                  <path
                    className="rack-view__link"
                    d={`M ${LABEL_WIDTH + RACK_WIDTH - 2} ${link.from} H ${x} V ${link.to} H ${LABEL_WIDTH + RACK_WIDTH - 2}`}
                    key={link.id}
                  />
                );
              })}
            </svg>
            {rack.unplaced.length ? (
              <p className="data-caption">
                Ohne Höheneinheit:{" "}
                {rack.unplaced.map((device, index) => (
                  <button
                    className="text-button"
                    key={device.id}
                    onClick={() => onOpen(device.id)}
                    type="button"
                  >
                    {device.name}
                    {index < rack.unplaced.length - 1 ? "," : ""}
                  </button>
                ))}
              </p>
            ) : null}
          </figure>
        );
      })}
    </div>
  );
}
