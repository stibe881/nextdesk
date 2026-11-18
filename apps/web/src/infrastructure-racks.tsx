import { tn } from "./lib/formality";
import { useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  buildRacks,
  type Rack,
  type RackDefinition,
  type RackDevice,
} from "./lib/rack-layout";

import { confirmDialog } from "./app-dialog";
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

const NEW_LOCATION = "__new_location__";

/** Create or edit a rack: name, location, height (HE), notes. */
function RackForm({
  initial,
  locations,
  minUnits,
  deviceCount,
  onSave,
  onDelete,
  onCancel,
  onAddLocation,
}: {
  initial: RackInput;
  /** Creates a location and returns it (null on failure). */
  onAddLocation?: ((name: string) => Promise<RackLocation | null>) | undefined;
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
  const [newLocation, setNewLocation] = useState<string | null>(null);
  const tooSmall = form.heightUnits < minUnits;

  async function addLocation() {
    const name = newLocation?.trim();
    if (!name || !onAddLocation || busy) return;
    setBusy(true);
    const created = await onAddLocation(name);
    setBusy(false);
    if (!created) return;
    setForm((current) => ({ ...current, locationId: created.id }));
    setNewLocation(null);
  }

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
          onChange={(event) => {
            if (event.target.value === NEW_LOCATION) {
              setNewLocation("");
              return;
            }
            setForm({ ...form, locationId: event.target.value || null });
          }}
          value={newLocation !== null ? NEW_LOCATION : (form.locationId ?? "")}
        >
          <option value="">Ohne Standort</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
          {onAddLocation ? (
            <option value={NEW_LOCATION}>+ Neuer Standort …</option>
          ) : null}
        </select>
      </label>
      {newLocation !== null && onAddLocation ? (
        <div className="rack-form__new-location rack-form__wide">
          <input
            aria-label="Name des neuen Standorts"
            autoFocus
            maxLength={160}
            onChange={(event) => setNewLocation(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void addLocation();
              }
              if (event.key === "Escape") setNewLocation(null);
            }}
            placeholder="z. B. Zug, Serverraum UG"
            value={newLocation}
          />
          <button
            className="secondary-button"
            disabled={busy || !newLocation.trim()}
            onClick={() => void addLocation()}
            type="button"
          >
            Standort anlegen
          </button>
          <button
            className="text-button"
            onClick={() => setNewLocation(null)}
            type="button"
          >
            Abbrechen
          </button>
        </div>
      ) : null}
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
            onClick={async () => {
              if (!(await confirmDialog(`Rack «${initial.name}» löschen?`)))
                return;
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

// Geometry of the drawn 19" cabinet (SVG units).
const UNIT_PX = 18;
const CAB_X = 2;
const SIDE = 7; // cabinet side wall
const RAIL = 20; // mounting rail with unit numbers and holes
const INNER = 222; // 19" mounting width between the rails
const TOP = 18; // top cover with ventilation
const BOTTOM = 14; // plinth
const FOOT = 6;
const INNER_X = CAB_X + SIDE + RAIL;
const CAB_WIDTH = SIDE * 2 + RAIL * 2 + INNER;
const LINK_SPACE = 34;

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
  onAddLocation,
  failingDeviceIds,
}: {
  devices: T[];
  /** Devices with an active PRTG incident, drawn red. */
  failingDeviceIds?: ReadonlySet<string> | undefined;
  /** Racks recorded by the user, shown even without devices. */
  definitions?: readonly RackDefinition[];
  locations?: RackLocation[];
  /** Managers only: create and edit racks. */
  onSaveRack?: ((input: RackInput) => Promise<boolean>) | undefined;
  onAddLocation?: ((name: string) => Promise<RackLocation | null>) | undefined;
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
          onAddLocation={onAddLocation}
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
          {tn(
            "Noch keine Racks. Erfasse ein Rack oder trage bei den Geräten «Rack» und «Höheneinheit» ein (z. B. 12 oder 10-11).",
            "Noch keine Racks. Erfassen Sie ein Rack oder tragen Sie bei den Geräten «Rack» und «Höheneinheit» ein (z. B. 12 oder 10-11).",
          )}
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
          const cabinetHeight = TOP + height + BOTTOM;
          const center = new Map(
            rack.placed.map((entry) => [
              entry.device.id,
              TOP +
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
                  onAddLocation={onAddLocation}
                  onSave={onSaveRack}
                />
              ) : null}
              <svg
                aria-label={`Rack ${rack.name}`}
                className="rack-view__svg"
                role="img"
                viewBox={`0 0 ${CAB_X * 2 + CAB_WIDTH + LINK_SPACE} ${cabinetHeight + FOOT}`}
                width="100%"
              >
                {/* Cabinet body, top cover with vents, plinth and feet. */}
                <rect
                  className="rack-view__cabinet"
                  height={cabinetHeight}
                  rx={5}
                  width={CAB_WIDTH}
                  x={CAB_X}
                  y={0}
                />
                {Array.from({ length: 9 }, (_, index) => (
                  <rect
                    className="rack-view__vent"
                    height={2}
                    key={`vent-${index}`}
                    rx={1}
                    width={14}
                    x={INNER_X + 20 + index * 21}
                    y={TOP / 2 - 1}
                  />
                ))}
                <rect
                  className="rack-view__plinth"
                  height={BOTTOM - 4}
                  rx={2}
                  width={CAB_WIDTH - SIDE * 2}
                  x={CAB_X + SIDE}
                  y={TOP + height + 2}
                />
                {[CAB_X + 10, CAB_X + CAB_WIDTH - 30].map((x) => (
                  <rect
                    className="rack-view__foot"
                    height={FOOT}
                    key={`foot-${x}`}
                    rx={1.5}
                    width={20}
                    x={x}
                    y={cabinetHeight}
                  />
                ))}
                {/* Mounting bay between the rails. */}
                <rect
                  className="rack-view__bay"
                  height={height}
                  width={INNER}
                  x={INNER_X}
                  y={TOP}
                />
                {[INNER_X - RAIL, INNER_X + INNER].map((x) => (
                  <rect
                    className="rack-view__rail"
                    height={height}
                    key={`rail-${x}`}
                    width={RAIL}
                    x={x}
                    y={TOP}
                  />
                ))}
                {Array.from({ length: rack.units }, (_, index) => {
                  const y = TOP + index * UNIT_PX;
                  return (
                    <g key={index}>
                      {index > 0 ? (
                        <line
                          className="rack-view__slot"
                          x1={INNER_X}
                          x2={INNER_X + INNER}
                          y1={y}
                          y2={y}
                        />
                      ) : null}
                      <text
                        className="rack-view__unit"
                        x={INNER_X - RAIL + 9}
                        y={y + UNIT_PX * 0.68}
                      >
                        {rack.units - index}
                      </text>
                      {[0.25, 0.75].map((offset) => (
                        <g key={offset}>
                          <rect
                            className="rack-view__hole"
                            height={3}
                            width={3}
                            x={INNER_X - 6}
                            y={y + UNIT_PX * offset - 1.5}
                          />
                          <rect
                            className="rack-view__hole"
                            height={3}
                            width={3}
                            x={INNER_X + INNER + 3}
                            y={y + UNIT_PX * offset - 1.5}
                          />
                        </g>
                      ))}
                    </g>
                  );
                })}
                {rack.placed.map((entry) => {
                  const top =
                    TOP +
                    (rack.units - (entry.start + entry.height - 1)) * UNIT_PX;
                  const deviceHeight = entry.height * UNIT_PX - 1;
                  const textY = top + Math.min(deviceHeight, UNIT_PX) * 0.68;
                  return (
                    <g
                      className={`rack-view__device rack-view__device--${entry.device.category}${failingDeviceIds?.has(entry.device.id) ? " rack-view__device--failing" : ""}`}
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
                      <title>{`${entry.device.name} · ${categoryLabel(entry.device.category)} · HE ${entry.start}${entry.height > 1 ? `–${entry.start + entry.height - 1}` : ""}${failingDeviceIds?.has(entry.device.id) ? " · Störung aktiv" : ""}`}</title>
                      {/* Rack ears screwed to the rails. */}
                      <rect
                        className="rack-view__ear"
                        height={deviceHeight}
                        rx={1}
                        width={INNER + 16}
                        x={INNER_X - 8}
                        y={top + 0.5}
                      />
                      <rect
                        className="rack-view__face"
                        height={deviceHeight}
                        rx={1.5}
                        width={INNER}
                        x={INNER_X}
                        y={top + 0.5}
                      />
                      <rect
                        className="rack-view__accent"
                        height={deviceHeight}
                        width={4}
                        x={INNER_X}
                        y={top + 0.5}
                      />
                      {entry.height > 1
                        ? Array.from(
                            { length: entry.height * 2 - 1 },
                            (_, line) => (
                              <line
                                className="rack-view__grille"
                                key={line}
                                x1={INNER_X + 150}
                                x2={INNER_X + INNER - 22}
                                y1={top + 4 + line * (UNIT_PX / 2)}
                                y2={top + 4 + line * (UNIT_PX / 2)}
                              />
                            ),
                          )
                        : Array.from({ length: 8 }, (_, port) => (
                            <rect
                              className="rack-view__port"
                              height={5}
                              key={port}
                              rx={0.5}
                              width={6}
                              x={INNER_X + 132 + port * 8}
                              y={top + UNIT_PX / 2 - 2}
                            />
                          ))}
                      <circle
                        className="rack-view__led"
                        cx={INNER_X + INNER - 10}
                        cy={top + 6}
                        r={1.8}
                      />
                      <circle
                        className="rack-view__led rack-view__led--activity"
                        cx={INNER_X + INNER - 10}
                        cy={top + 11}
                        r={1.8}
                      />
                      {[INNER_X - 5, INNER_X + INNER + 4].map((x) => (
                        <circle
                          className="rack-view__screw"
                          cx={x}
                          cy={top + deviceHeight / 2 + 0.5}
                          key={x}
                          r={1.6}
                        />
                      ))}
                      <text x={INNER_X + 10} y={textY}>
                        {entry.device.name.slice(0, entry.height > 1 ? 24 : 20)}
                      </text>
                    </g>
                  );
                })}
                {links.map((link, index) => {
                  const edge = CAB_X + CAB_WIDTH;
                  const x = edge + 8 + (index % 4) * 6;
                  return (
                    <path
                      className="rack-view__link"
                      d={`M ${INNER_X + INNER} ${link.from} H ${x} V ${link.to} H ${INNER_X + INNER}`}
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
