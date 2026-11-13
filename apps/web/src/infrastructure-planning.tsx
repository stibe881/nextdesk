import { tn } from "./lib/formality";
import { useState, type FormEvent } from "react";
import { CalendarClock, ClipboardList } from "lucide-react";
import { FormCard, FormField, FormGrid, FormSwitch } from "./form-kit";

/** One point of the maintenance checklist with the date the user set. */
export type ChecklistItem = { label: string; date: string | null };

/** Checklist from the API: plain strings (older devices) or items. */
export function checklistItems(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ChecklistItem[] => {
    if (typeof entry === "string") {
      return entry.trim() ? [{ label: entry.trim(), date: null }] : [];
    }
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label.trim() : "";
    if (!label) return [];
    const date =
      typeof record.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.date)
        ? record.date
        : null;
    return [{ label, date }];
  });
}

export function formatChecklistDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

export type MaintenanceWindow = {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  state: "scheduled" | "active" | "completed" | "cancelled";
  publicEnabled: boolean;
};
type Service = { id: string; name: string };

const STATE_LABEL: Record<MaintenanceWindow["state"], string> = {
  scheduled: "Geplant",
  active: "Läuft",
  completed: "Abgeschlossen",
  cancelled: "Abgesagt",
};

const moment = (value: string) =>
  new Intl.DateTimeFormat("de-CH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  }).format(new Date(value));

/** Value for <input type="datetime-local"> in local time. */
function localInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/**
 * Planning on a device: a maintenance window for the system status (with the
 * affected services) and the maintenance checklist as a recurring service task.
 */
export function MaintenancePlanning({
  deviceId,
  deviceName,
  serviceId,
  checklist,
  intervalMonths,
  hasServiceTask,
  services,
  windows,
  canManage,
  busy,
  onRun,
}: {
  deviceId: string;
  deviceName: string;
  serviceId: string | null;
  checklist: ChecklistItem[];
  intervalMonths: number | null;
  hasServiceTask: boolean;
  services: Service[];
  windows: MaintenanceWindow[];
  canManage: boolean;
  busy: boolean;
  onRun: (body: Record<string, unknown>, message: string) => Promise<boolean>;
}) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(19, 0, 0, 0);
  const [plan, setPlan] = useState(() => ({
    title: `Wartung ${deviceName}`,
    description: "",
    startsAt: localInput(tomorrow),
    endsAt: localInput(new Date(tomorrow.getTime() + 2 * 3_600_000)),
    publicEnabled: true,
    serviceIds: serviceId ? [serviceId] : ([] as string[]),
  }));
  const [schedule, setSchedule] = useState(() => ({
    intervalMonths: intervalMonths ?? 6,
    startsOn: new Date().toISOString().slice(0, 10),
  }));

  async function planWindow(event: FormEvent) {
    event.preventDefault();
    const done = await onRun(
      {
        type: "planMaintenance",
        assetIds: [deviceId],
        serviceIds: plan.serviceIds,
        title: plan.title.trim(),
        description: plan.description.trim() || null,
        startsAt: new Date(plan.startsAt).toISOString(),
        endsAt: new Date(plan.endsAt).toISOString(),
        publicEnabled: plan.publicEnabled,
      },
      "Wartungsfenster geplant. Es erscheint im Systemstatus; Betroffene werden 24 Stunden vorher informiert.",
    );
    if (done) setPlan((current) => ({ ...current, description: "" }));
  }

  return (
    <div className="infrastructure__planning">
      <section>
        <h4>
          <CalendarClock aria-hidden="true" size={15} /> Wartungsfenster
        </h4>
        {windows.length ? (
          <ul className="infrastructure__timeline">
            {windows.map((entry) => (
              <li key={entry.id}>
                <time>{moment(entry.startsAt)}</time>
                <strong>
                  {entry.title} · {STATE_LABEL[entry.state]}
                </strong>
                <span>
                  bis {moment(entry.endsAt)}
                  {entry.publicEnabled
                    ? " · im Systemstatus öffentlich"
                    : " · intern"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">Keine geplanten Wartungsfenster.</p>
        )}
        {canManage ? (
          <form onSubmit={planWindow}>
            <FormCard
              sub="Erscheint im Systemstatus, Betroffene werden 24 Stunden vorher informiert."
              title="Wartungsfenster planen"
            >
              <FormGrid cols={1}>
                <FormField label="Titel" required>
                  <input
                    maxLength={180}
                    onChange={(event) =>
                      setPlan({ ...plan, title: event.target.value })
                    }
                    value={plan.title}
                  />
                </FormField>
              </FormGrid>
              <FormGrid cols={2}>
                <FormField label="Beginn" required>
                  <input
                    onChange={(event) =>
                      setPlan({ ...plan, startsAt: event.target.value })
                    }
                    type="datetime-local"
                    value={plan.startsAt}
                  />
                </FormField>
                <FormField label="Ende" required>
                  <input
                    onChange={(event) =>
                      setPlan({ ...plan, endsAt: event.target.value })
                    }
                    type="datetime-local"
                    value={plan.endsAt}
                  />
                </FormField>
              </FormGrid>
              <FormGrid cols={1}>
                <FormField
                  hint="Mehrfachauswahl mit Ctrl bzw. Cmd. Ohne Dienst kann kein Wartungsfenster im Systemstatus erscheinen."
                  label="Betroffene Dienste"
                  required
                >
                  <select
                    multiple
                    onChange={(event) =>
                      setPlan({
                        ...plan,
                        serviceIds: [...event.target.selectedOptions].map(
                          (option) => option.value,
                        ),
                      })
                    }
                    size={Math.min(6, Math.max(3, services.length))}
                    value={plan.serviceIds}
                  >
                    {services.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Hinweis für Betroffene">
                  <textarea
                    maxLength={2000}
                    onChange={(event) =>
                      setPlan({ ...plan, description: event.target.value })
                    }
                    rows={2}
                    value={plan.description}
                  />
                </FormField>
              </FormGrid>
              <FormSwitch
                checked={plan.publicEnabled}
                hint="Für alle Mitarbeitenden sichtbar."
                label="Im Systemstatus anzeigen"
                onChange={(checked) =>
                  setPlan({ ...plan, publicEnabled: checked })
                }
              />
              <div>
                <button
                  className="primary-button"
                  disabled={
                    busy ||
                    plan.title.trim().length < 2 ||
                    plan.serviceIds.length === 0 ||
                    !plan.startsAt ||
                    !plan.endsAt ||
                    new Date(plan.endsAt) <= new Date(plan.startsAt)
                  }
                  type="submit"
                >
                  Wartungsfenster planen
                </button>
              </div>
            </FormCard>
          </form>
        ) : null}
      </section>

      <section>
        <h4>
          <ClipboardList aria-hidden="true" size={15} /> Wartungscheckliste
        </h4>
        {checklist.length ? (
          <ol className="infrastructure__checklist">
            {checklist.map((item, index) => (
              <li key={`${index}:${item.label}`}>
                {item.label}
                {item.date ? (
                  <span className="infrastructure__checklist-date">
                    {formatChecklistDate(item.date)}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="empty-state">
            {tn(
              "Noch keine Checkliste. Erfasse die Punkte unter «Bearbeiten».",
              "Noch keine Checkliste. Erfassen Sie die Punkte unter «Bearbeiten».",
            )}
          </p>
        )}
        {canManage && checklist.length ? (
          <form
            className="infrastructure__form"
            onSubmit={(event) => {
              event.preventDefault();
              void onRun(
                {
                  type: "scheduleChecklist",
                  assetId: deviceId,
                  intervalMonths: schedule.intervalMonths,
                  startsOn: schedule.startsOn,
                  assigneeId: null,
                },
                hasServiceTask
                  ? "Serviceaufgabe aktualisiert."
                  : "Wiederkehrende Serviceaufgabe erstellt.",
              );
            }}
          >
            <label>
              Alle … Monate
              <input
                max={60}
                min={1}
                onChange={(event) =>
                  setSchedule({
                    ...schedule,
                    intervalMonths: Number(event.target.value) || 1,
                  })
                }
                type="number"
                value={schedule.intervalMonths}
              />
            </label>
            <label>
              Erstmals am
              <input
                onChange={(event) =>
                  setSchedule({ ...schedule, startsOn: event.target.value })
                }
                type="date"
                value={schedule.startsOn}
              />
            </label>
            <button
              className="secondary-button"
              disabled={busy || !schedule.startsOn}
              type="submit"
            >
              {hasServiceTask
                ? "Serviceaufgabe aktualisieren"
                : "Als Serviceaufgabe planen"}
            </button>
            <small className="infrastructure__wide">
              Erledigte Serviceaufgaben werden hier automatisch als Wartung
              eingetragen.
            </small>
          </form>
        ) : null}
      </section>
    </div>
  );
}
