import { useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  buildRacks,
  type Rack,
  type RackDefinition,
  type RackDevice,
} from "./lib/rack-layout";

export type RackInput = {
  id: string | null;
  /** Rack so far only known from its devices: these move with it. */
  sourceName?: string | null;
  sourceLocationId?: string | null;
  name: string;
  locationId: string | null;
  heightUnits: number;
  notes: string | null;
};

type RackLocation = { id: string; name: string };

/** Create or edit a rack: name, location, height (HE), notes. */
function RackForm({
  initial,
  locations,
  minUnits,
  deviceCount,
  onSave,
  onDelete,
  onCancel,
}: {
  initial: RackInput;
  locations: RackLocation[];
  /** Highest unit used by a device; the rack cannot be smaller. */
  minUnits: number;
  deviceCount: number;
  onSave: (input: RackInput) => Promise<boolean>;
  onDelete?: (() => Promise<boolean>) | undefined;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const tooSmall = form.heightUnits < minUnits;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !form.name.trim() || tooSmall) return;
    setBusy(true);
    const saved = await onSave({
      ...form,
      name: form.name.trim(),
      notes: form.notes?.trim() || null,
    });
    setBusy(false);
    if (saved) onCancel();
  }

  return (
    <form className="rack-form" onSubmit={(event) => void submit(event)}>
      <label>
        Name
        <input
          autoFocus
          maxLength={80}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder="z. B. Rack 01"
          required
          value={form.name}
        />
      </label>
      <label>
        Standort
        <select
          onChange={(event) =>
            setForm({ ...form, locationId: event.target.value || null })
          }
          value={form.locationId ?? ""}
        >
          <option value="">Ohne Standort</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Höhe (HE)
        <input
          max={60}
          min={Math.max(1, minUnits)}
          onChange={(event) =>
            setForm({ ...form, heightUnits: Number(event.target.value) || 0 })
          }
          required
          type="number"
          value={form.heightUnits || ""}
        />
        {tooSmall ? (
          <small className="rack-form__error">
            Mindestens {minUnits} HE – so hoch sind die Geräte montiert.
          </small>
        ) : null}
      </label>
      <label className="rack-form__wide">
        Notizen
        <textarea
          maxLength={1000}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
          placeholder="z. B. Serverraum UG, Schlüssel bei ICT"
          rows={2}
          value={form.notes ?? ""}
        />
      </label>
      {(initial.id || initial.sourceName) && deviceCount > 0 ? (
        <p className="rack-form__hint rack-form__wide">
          Neuer Name oder Standort gilt auch für{" "}
          {deviceCount === 1 ? "das Gerät" : `die ${deviceCount} Geräte`} im
          Rack.
        </p>
      ) : null}
      <div className="rack-form__actions rack-form__wide">
        {onDelete ? (
          <button
            className="text-button rack-form__delete"
            disabled={busy || deviceCount > 0}
            onClick={() => {
              if (!window.confirm(`Rack «${initial.name}» löschen?`)) return;
              setBusy(true);
              void onDelete().then((deleted) => {
                setBusy(false);
                if (deleted) onCancel();
              });
            }}
            title={
              deviceCount > 0
                ? "Nur leere Racks können gelöscht werden."
                : "Rack löschen"
            }
            type="button"
          >
            <Trash2 aria-hidden="true" size={15} /> Löschen
          </button>
        ) : null}
        <button
          className="secondary-button"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          Abbrechen
        </button>
        <button
          className="primary-button"
          disabled={busy || !form.name.trim() || tooSmall}
          type="submit"
        >
          {initial.id || initial.sourceName
            ? "Rack speichern"
            : "Rack erfassen"}
        </button>
      </div>
    </form>
  );
}

/** «Rack 01» stays, «R1» becomes «Rack R1». */
function rackTitle(name: string): string {
  return /^rack\b/i.test(name.trim()) ? name : `Rack ${name}`;
}

function rackInput<T extends RackDevice>(
  rack: Rack<T>,
  locations: RackLocation[],
): RackInput {
  return rack.definition
    ? {
        id: rack.definition.id,
        name: rack.definition.name,
        locationId: rack.definition.locationId,
        heightUnits: rack.definition.heightUnits,
        notes: rack.definition.notes,
      }
    : (() => {
        const locationId =
          locations.find((location) => location.name === rack.locationName)
            ?.id ?? null;
        return {
          id: null,
          sourceName: rack.name,
          sourceLocationId: locationId,
          name: rack.name,
          locationId,
          heightUnits: rack.units,
          notes: null,
        };
      })();
}

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
  definitions = [],
  locations = [],
  onSaveRack,
  onDeleteRack,
}: {
  devices: T[];
  /** Racks recorded by the user, shown even without devices. */
  definitions?: readonly RackDefinition[];
  locations?: RackLocation[];
  /** Managers only: create and edit racks. */
  onSaveRack?: ((input: RackInput) => Promise<boolean>) | undefined;
  onDeleteRack?: ((id: string) => Promise<boolean>) | undefined;
  categoryLabel: (category: string) => string;
  onOpen: (deviceId: string) => void;
  /** Racks selected for label printing. */
  selectedRackKeys?: ReadonlySet<string> | undefined;
  onToggleRack?: ((rackKey: string, checked: boolean) => void) | undefined;
  onSelectRackDevices?: ((deviceIds: string[]) => void) | undefined;
}) {
  const racks = buildRacks(devices, definitions);
  const [editing, setEditing] = useState<string | null>(null);
  const newRackForm =
    onSaveRack && editing === "new" ? (
      <figure className="rack-view__rack rack-view__rack--new">
        <figcaption>
          <div className="rack-view__head">
            <div className="rack-view__title">
              <strong>Neues Rack</strong>
              <small>Name, Standort und Höhe</small>
            </div>
          </div>
        </figcaption>
        <RackForm
          deviceCount={0}
          initial={{
            id: null,
            name: "",
            locationId: null,
            heightUnits: 42,
            notes: null,
          }}
          locations={locations}
          minUnits={1}
          onCancel={() => setEditing(null)}
          onSave={onSaveRack}
        />
      </figure>
    ) : null;
  const toolbar =
    onSaveRack && editing !== "new" ? (
      <div className="rack-view__toolbar">
        <button
          className="secondary-button"
          onClick={() => setEditing("new")}
          type="button"
        >
          <Plus aria-hidden="true" size={16} /> Rack erfassen
        </button>
      </div>
    ) : null;
  if (racks.length === 0 && !newRackForm) {
    return (
      <>
        {toolbar}
        <p className="empty-state">
          Noch keine Racks. Erfassen Sie ein Rack oder tragen Sie bei den
          Geräten «Rack» und «Höheneinheit» ein (z. B. 12 oder 10-11).
        </p>
      </>
    );
  }
  return (
    <>
      {toolbar}
      <div className="rack-view">
        {newRackForm}
        {racks.map((rack) => {
          const usedUnits = Math.max(
            0,
            ...rack.placed.map((entry) => entry.start + entry.height - 1),
          );
          const deviceCount = rack.placed.length + rack.unplaced.length;
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
                <div className="rack-view__head">
                  <div className="rack-view__title">
                    <strong>{rackTitle(rack.name)}</strong>
                    <small>
                      {[
                        rack.locationName,
                        `${rack.units} HE`,
                        `${deviceCount} ${deviceCount === 1 ? "Gerät" : "Geräte"}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </div>
                  {onSaveRack && editing !== rack.key ? (
                    <button
                      aria-label={`Rack ${rack.name} bearbeiten`}
                      className="rack-view__edit"
                      onClick={() => setEditing(rack.key)}
                      title="Rack bearbeiten"
                      type="button"
                    >
                      <Pencil aria-hidden="true" size={14} />
                    </button>
                  ) : null}
                </div>
                {rack.definition?.notes ? (
                  <span className="rack-view__notes">
                    {rack.definition.notes}
                  </span>
                ) : null}
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
              {onSaveRack && editing === rack.key ? (
                <RackForm
                  deviceCount={deviceCount}
                  initial={rackInput(rack, locations)}
                  locations={locations}
                  minUnits={usedUnits}
                  onCancel={() => setEditing(null)}
                  onDelete={
                    rack.definition && onDeleteRack
                      ? () => onDeleteRack(rack.definition!.id)
                      : undefined
                  }
                  onSave={onSaveRack}
                />
              ) : null}
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
                    (rack.units - (entry.start + entry.height - 1)) * UNIT_PX +
                    1;
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
    </>
  );
}
