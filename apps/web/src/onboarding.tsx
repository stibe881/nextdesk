import { tn } from "./lib/formality";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { OnboardingDepartmentTasks } from "./onboarding-department-tasks";
import {
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Plus,
  RefreshCw,
  UserRound,
  Wrench,
} from "lucide-react";
import {
  FormCard,
  FormDialog,
  FormField,
  FormGrid,
  FormNote,
  FormSummary,
} from "./form-kit";
import "./onboarding.css";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";

type TaskStatus = "open" | "in_progress" | "blocked" | "completed";
type Person = { id: string; displayName: string };
type Template = { id: string; key: string; name: string };
type Task = {
  id: string;
  title: string;
  dueOn: string;
  responsibleName: string;
  departmentId?: string | null;
  departmentName?: string | null;
  status: TaskStatus;
  canUpdate: boolean;
  exception: { ticketNumber: string; reason: string } | null;
};
type Entry = {
  id: string;
  employeeName: string;
  startsOn: string;
  organisationUnit: string | null;
  location: string | null;
  managerName: string;
  ictResponsibleName: string;
  templateId: string;
  kind?: "onboarding" | "offboarding";
  canEdit?: boolean;
  source?: "email" | "manual";
  sourceTicketNumber?: string | null;
  details?: Record<string, unknown>;
  tasks: Task[];
};
type Workspace = {
  permissions: { canRequest: boolean; canManage: boolean };
  people: Person[];
  templates: Template[];
  entries: Entry[];
};
const statuses: Record<TaskStatus, string> = {
  open: "Offen",
  in_progress: "In Arbeit",
  blocked: "Blockiert",
  completed: "Erledigt",
};
const emptyDraft = () => ({
  employeeName: "",
  startsOn: new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
  }).format(new Date()),
  organisationUnit: "",
  location: "",
  managerUserId: "",
  ictResponsibleUserId: "",
  templateId: "",
  kind: "onboarding" as "onboarding" | "offboarding",
});
function isWorkspace(value: unknown): value is Workspace {
  return Boolean(
    value &&
    typeof value === "object" &&
    Array.isArray((value as Workspace).entries) &&
    Array.isArray((value as Workspace).people) &&
    Array.isArray((value as Workspace).templates),
  );
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}
const detailText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const yesNo = (value: unknown): string | null =>
  typeof value === "boolean" ? (value ? "Ja" : "Nein") : null;

/** Angaben aus der Eintrittsmeldung der Personal-App als Beschriftung/Wert. */
function entryDetailRows(
  details: Record<string, unknown> | undefined,
): { label: string; value: string }[] {
  if (!details) return [];
  const functions = Array.isArray(details.functions)
    ? (details.functions as Record<string, unknown>[])
    : [];
  const rows: { label: string; value: string | null }[] = [
    { label: "Ausgefüllt von", value: detailText(details.filledBy) },
    { label: "Berufsbezeichnung", value: detailText(details.jobTitle) },
    { label: "Vorgesetzte Person", value: detailText(details.supervisor) },
    { label: "Geschlecht", value: detailText(details.gender) },
    ...functions.map((entry, index) => ({
      label: `Funktion ${index + 1}`,
      value:
        [entry.offer, entry.team, entry.role, entry.special]
          .map(detailText)
          .filter(Boolean)
          .join(" · ") || null,
    })),
    {
      label: "Anstellung",
      value:
        details.fixedTerm === true
          ? `befristet${detailText(details.endDate) ? ` bis ${dateLabel(String(details.endDate))}` : ""}`
          : details.fixedTerm === false
            ? "unbefristet"
            : null,
    },
    { label: "Raum", value: detailText(details.room) },
    { label: "Schlüssel", value: yesNo(details.needsKey) },
    { label: "ICT-Ausstattung", value: detailText(details.ictEquipment) },
    { label: "ICT-Zugänge", value: detailText(details.ictAccess) },
    { label: "Gruppenpostfächer", value: detailText(details.groupMailboxes) },
    {
      label: "Doppelname",
      value:
        details.doubleName === true
          ? (detailText(details.aliasName) ?? "Ja")
          : null,
    },
    { label: "Bemerkung", value: detailText(details.remarks) },
  ];
  return rows.filter(
    (row): row is { label: string; value: string } => row.value !== null,
  );
}
function departmentProgress(tasks: Task[]) {
  const groups = new Map<
    string,
    { name: string; done: number; total: number }
  >();
  for (const task of tasks) {
    if (!task.departmentName) continue;
    const group = groups.get(task.departmentName) ?? {
      name: task.departmentName,
      done: 0,
      total: 0,
    };
    group.total += 1;
    if (task.status === "completed") group.done += 1;
    groups.set(task.departmentName, group);
  }
  return [...groups.values()];
}

type ReturnRequester = {
  id: string;
  displayName: string;
  email: string | null;
};
type ReturnAsset = {
  assignmentId: string;
  assetId: string;
  name: string;
  inventoryNumber: string | null;
  serialNumber: string | null;
  assignedAt: string;
  returnedAt: string | null;
  returnTask: { taskId: string; status: string; sameEntry: boolean } | null;
};
type LinkedTask = { taskId: string; status: string; sameEntry: boolean };
type ReturnLoan = {
  lineId: string;
  orderNumber: string | null;
  itemName: string;
  quantity: number;
  loanUntil: string | null;
  returned: boolean;
  returnTask: LinkedTask | null;
};
type ReturnLicense = {
  assignmentId: string;
  licenseTitle: string;
  assignedAt: string;
  released: boolean;
  revokeTask: LinkedTask | null;
};
type ReturnLocation = { id: string; name: string };
type ReturnOverview = {
  matches: ReturnRequester[];
  requesters: ReturnRequester[];
  selectedRequesterId: string | null;
  assets: ReturnAsset[];
  loans: ReturnLoan[];
  licenses: ReturnLicense[];
  locations: ReturnLocation[];
  defaultLocationId: string | null;
};
function isReturnOverview(value: unknown): value is ReturnOverview {
  return Boolean(
    value &&
    typeof value === "object" &&
    Array.isArray((value as ReturnOverview).matches) &&
    Array.isArray((value as ReturnOverview).requesters) &&
    Array.isArray((value as ReturnOverview).assets) &&
    Array.isArray((value as ReturnOverview).loans) &&
    Array.isArray((value as ReturnOverview).licenses) &&
    Array.isArray((value as ReturnOverview).locations),
  );
}
function linkedTaskLabel(
  task: LinkedTask | null,
  done: boolean,
  doneLabel: string,
  kind: string,
) {
  if (done) return doneLabel;
  if (!task) return null;
  if (!task.sameEntry) return `${kind} in anderem Austritt`;
  const labels: Record<string, string> = {
    open: `${kind} offen`,
    in_progress: `${kind} in Arbeit`,
    blocked: `${kind} blockiert`,
    completed: `${kind} erledigt`,
  };
  return labels[task.status] ?? `${kind} offen`;
}
function requesterLabel(requester: ReturnRequester) {
  return requester.email
    ? `${requester.displayName} (${requester.email})`
    : requester.displayName;
}
function returnStateLabel(asset: ReturnAsset) {
  if (asset.returnedAt) return "Zurückgegeben";
  if (!asset.returnTask) return null;
  if (!asset.returnTask.sameEntry)
    return "Rückgabe-Aufgabe in anderem Austritt";
  const labels: Record<string, string> = {
    open: "Rückgabe-Aufgabe offen",
    in_progress: "Rückgabe-Aufgabe in Arbeit",
    blocked: "Rückgabe-Aufgabe blockiert",
    completed: "Rückgabe-Aufgabe erledigt",
  };
  return labels[asset.returnTask.status] ?? "Rückgabe-Aufgabe offen";
}

/**
 * Geräte, offene Shop-Ausleihen und Lizenzen der austretenden Person. Pro
 * gewähltem Eintrag entsteht eine Aufgabe; ist sie erledigt, kommt das Gerät
 * bzw. die Ausleihe an den gewählten Lagerort zurück, die Lizenz wird
 * entzogen.
 */
function AssetReturnsPanel({
  entry,
  onCreated,
  tenantId,
}: {
  entry: Entry;
  onCreated: () => Promise<void>;
  tenantId: string;
}) {
  const [open, setOpen] = useState(false);
  const [overview, setOverview] = useState<ReturnOverview | null>(null);
  const [requesterId, setRequesterId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedLoans, setSelectedLoans] = useState<string[]>([]);
  const [selectedLicenses, setSelectedLicenses] = useState<string[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const taskSignature = entry.tasks
    .map((task) => `${task.id}:${task.status}`)
    .join(",");
  const load = async (nextRequesterId: string | null) => {
    if (!supabase) return;
    setBusy(true);
    setError("");
    try {
      const { data, error: loadError } = await supabase.functions.invoke(
        "onboarding",
        {
          body: {
            type: "offboardingAssets",
            tenantId,
            entryId: entry.id,
            ...(nextRequesterId ? { requesterId: nextRequesterId } : {}),
          },
        },
      );
      if (loadError) throw loadError;
      const value =
        data && typeof data === "object"
          ? (data as { data?: unknown }).data
          : null;
      if (!isReturnOverview(value)) throw new Error("invalid_asset_returns");
      setOverview(value);
      setRequesterId(value.selectedRequesterId);
      setSelected((current) =>
        current.filter((id) =>
          value.assets.some(
            (asset) => asset.assignmentId === id && !asset.returnTask,
          ),
        ),
      );
      setSelectedLoans((current) =>
        current.filter((id) =>
          value.loans.some((loan) => loan.lineId === id && !loan.returnTask),
        ),
      );
      setSelectedLicenses((current) =>
        current.filter((id) =>
          value.licenses.some(
            (license) => license.assignmentId === id && !license.revokeTask,
          ),
        ),
      );
      setLocationId((current) =>
        current && value.locations.some((location) => location.id === current)
          ? current
          : value.defaultLocationId,
      );
    } catch (loadError) {
      setError(
        await functionErrorMessage(
          loadError,
          tn("Die Geräte konnten nicht geladen werden. Bitte versuche es erneut.", "Die Geräte konnten nicht geladen werden. Bitte versuchen Sie es erneut."),
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (open) void load(requesterId);
    // Reload when the panel opens or a task of this entry changed state.
  }, [open, taskSignature]);
  const selectedCount =
    selected.length + selectedLoans.length + selectedLicenses.length;
  async function createTasks() {
    if (!supabase || !selectedCount) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { data, error: createError } = await supabase.functions.invoke(
        "onboarding",
        {
          body: {
            type: "createReturnTasks",
            tenantId,
            entryId: entry.id,
            assignmentIds: selected,
            ...(selectedLoans.length ? { loanLineIds: selectedLoans } : {}),
            ...(selectedLicenses.length
              ? { licenseAssignmentIds: selectedLicenses }
              : {}),
            ...(locationId ? { returnLocationId: locationId } : {}),
          },
        },
      );
      if (createError) throw createError;
      const created =
        data && typeof data === "object"
          ? Number(
              (data as { data?: { created?: unknown } }).data?.created ?? 0,
            )
          : 0;
      setSelected([]);
      setSelectedLoans([]);
      setSelectedLicenses([]);
      setNotice(
        created === 1
          ? "Eine Aufgabe wurde erstellt."
          : `${created} Aufgaben wurden erstellt.`,
      );
      // New tasks change the entry's task list, which reloads this panel.
      await onCreated();
      if (created === 0) await load(requesterId);
    } catch (createError) {
      setError(
        await functionErrorMessage(
          createError,
          "Die Rückgabe-Aufgaben konnten nicht erstellt werden.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  const pickerOptions = overview
    ? overview.matches.length > 1
      ? overview.matches
      : overview.requesters
    : [];
  const showPicker = Boolean(overview && overview.matches.length !== 1);
  const selectable = (overview?.assets ?? []).filter(
    (asset) => !asset.returnTask && !asset.returnedAt,
  );
  const selectableLoans = (overview?.loans ?? []).filter(
    (loan) => !loan.returnTask && !loan.returned,
  );
  const selectableLicenses = (overview?.licenses ?? []).filter(
    (license) => !license.revokeTask && !license.released,
  );
  const selectableCount =
    selectable.length + selectableLoans.length + selectableLicenses.length;
  const toggle = (
    setter: (update: (current: string[]) => string[]) => void,
    id: string,
    checked: boolean,
  ) =>
    setter((current) =>
      checked ? [...current, id] : current.filter((entry) => entry !== id),
    );
  return (
    <details
      className="onboarding__details onboarding__returns"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Rückgaben und Lizenzen</summary>
      {error ? (
        <p
          className="onboarding__message onboarding__message--error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          className="onboarding__message onboarding__message--success"
          role="status"
        >
          {notice}
        </p>
      ) : null}
      {!overview ? (
        <p className="onboarding__hint" aria-busy={busy}>
          {busy ? "Geräte werden geladen …" : ""}
        </p>
      ) : (
        <>
          {showPicker ? (
            <div className="onboarding__returns-picker">
              <p className="onboarding__hint">
                {overview.matches.length > 1
                  ? tn(
                      `Mehrere Personen heissen «${entry.employeeName}». Bitte wähle die richtige Person aus.`,
                      `Mehrere Personen heissen «${entry.employeeName}». Bitte wählen Sie die richtige Person aus.`,
                    )
                  : tn(
                      `Zu «${entry.employeeName}» wurde keine Person mit Geräten gefunden. Bitte wähle die Person aus, deren Geräte zurückgegeben werden.`,
                      `Zu «${entry.employeeName}» wurde keine Person mit Geräten gefunden. Bitte wählen Sie die Person aus, deren Geräte zurückgegeben werden.`,
                    )}
              </p>
              <label>
                Person
                <select
                  disabled={busy}
                  value={requesterId ?? ""}
                  onChange={(event) => {
                    const next = event.target.value || null;
                    setRequesterId(next);
                    setSelected([]);
                    void load(next);
                  }}
                >
                  <option value="">Person auswählen …</option>
                  {pickerOptions.map((requester) => (
                    <option key={requester.id} value={requester.id}>
                      {requesterLabel(requester)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          {overview.assets.length ? (
            <ul className="onboarding__returns-list">
              {overview.assets.map((asset) => {
                const state = returnStateLabel(asset);
                const checkable = !asset.returnTask && !asset.returnedAt;
                return (
                  <li key={asset.assignmentId}>
                    <label>
                      <input
                        checked={selected.includes(asset.assignmentId)}
                        disabled={!checkable || busy}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, asset.assignmentId]
                              : current.filter(
                                  (id) => id !== asset.assignmentId,
                                ),
                          )
                        }
                        type="checkbox"
                      />
                      <span>
                        <strong>{asset.name}</strong>
                        <small>
                          {[
                            asset.inventoryNumber
                              ? `Inventar ${asset.inventoryNumber}`
                              : null,
                            asset.serialNumber
                              ? `Seriennummer ${asset.serialNumber}`
                              : null,
                            `zugewiesen seit ${dateLabel(asset.assignedAt.slice(0, 10))}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </span>
                    </label>
                    {state ? (
                      <em
                        className={
                          asset.returnedAt ||
                          asset.returnTask?.status === "completed"
                            ? "is-done"
                            : ""
                        }
                      >
                        {state}
                      </em>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : requesterId ? (
            <p className="onboarding__hint">
              Dieser Person sind keine Geräte zugewiesen.
            </p>
          ) : null}
          {overview.loans.length ? (
            <>
              <h4 className="onboarding__returns-heading">
                Offene Shop-Ausleihen
              </h4>
              <ul className="onboarding__returns-list">
                {overview.loans.map((loan) => {
                  const state = linkedTaskLabel(
                    loan.returnTask,
                    loan.returned,
                    "Zurückgegeben",
                    "Rückgabe-Aufgabe",
                  );
                  const checkable = !loan.returnTask && !loan.returned;
                  return (
                    <li key={loan.lineId}>
                      <label>
                        <input
                          checked={selectedLoans.includes(loan.lineId)}
                          disabled={!checkable || busy}
                          onChange={(event) =>
                            toggle(
                              setSelectedLoans,
                              loan.lineId,
                              event.target.checked,
                            )
                          }
                          type="checkbox"
                        />
                        <span>
                          <strong>
                            {loan.quantity > 1 ? `${loan.quantity} × ` : ""}
                            {loan.itemName}
                          </strong>
                          <small>
                            {[
                              loan.orderNumber
                                ? `Bestellung ${loan.orderNumber}`
                                : null,
                              loan.loanUntil
                                ? `Rückgabe bis ${dateLabel(loan.loanUntil)}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </span>
                      </label>
                      {state ? (
                        <em
                          className={
                            loan.returned ||
                            loan.returnTask?.status === "completed"
                              ? "is-done"
                              : ""
                          }
                        >
                          {state}
                        </em>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
          {overview.licenses.length ? (
            <>
              <h4 className="onboarding__returns-heading">Lizenzen</h4>
              <ul className="onboarding__returns-list">
                {overview.licenses.map((license) => {
                  const state = linkedTaskLabel(
                    license.revokeTask,
                    license.released,
                    "Entzogen",
                    "Entzug",
                  );
                  const checkable = !license.revokeTask && !license.released;
                  return (
                    <li key={license.assignmentId}>
                      <label>
                        <input
                          checked={selectedLicenses.includes(
                            license.assignmentId,
                          )}
                          disabled={!checkable || busy}
                          onChange={(event) =>
                            toggle(
                              setSelectedLicenses,
                              license.assignmentId,
                              event.target.checked,
                            )
                          }
                          type="checkbox"
                        />
                        <span>
                          <strong>{license.licenseTitle}</strong>
                          <small>
                            zugewiesen seit{" "}
                            {dateLabel(license.assignedAt.slice(0, 10))}
                          </small>
                        </span>
                      </label>
                      {state ? (
                        <em
                          className={
                            license.released ||
                            license.revokeTask?.status === "completed"
                              ? "is-done"
                              : ""
                          }
                        >
                          {state}
                        </em>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
          {selectableCount && overview.locations.length ? (
            <div className="onboarding__returns-picker">
              <label>
                Rücknahme an Lagerort
                <select
                  disabled={busy}
                  onChange={(event) =>
                    setLocationId(event.target.value || null)
                  }
                  value={locationId ?? ""}
                >
                  <option value="">Standard-Lagerort bzw. Herkunftsort</option>
                  {overview.locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                      {location.id === overview.defaultLocationId
                        ? " (Standard)"
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          {selectableCount ? (
            <div className="onboarding__actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  const all = selectedCount === selectableCount;
                  setSelected(
                    all ? [] : selectable.map((asset) => asset.assignmentId),
                  );
                  setSelectedLoans(
                    all ? [] : selectableLoans.map((loan) => loan.lineId),
                  );
                  setSelectedLicenses(
                    all
                      ? []
                      : selectableLicenses.map(
                          (license) => license.assignmentId,
                        ),
                  );
                }}
                type="button"
              >
                {selectedCount === selectableCount
                  ? "Auswahl aufheben"
                  : "Alle auswählen"}
              </button>
              <button
                className="primary-button"
                disabled={busy || !selectedCount}
                onClick={() => void createTasks()}
                type="button"
              >
                {busy ? "Wird erstellt …" : "Aufgaben erstellen"}
              </button>
            </div>
          ) : null}
          <p className="onboarding__hint">
            Die Aufgaben sind am Austrittsdatum fällig und gehen an die
            ICT-Verantwortung. Sobald eine Rückgabe erledigt ist, gilt das Gerät
            bzw. die Ausleihe als zurückgegeben und wird an den gewählten
            Lagerort gebucht; erledigte Lizenz-Aufgaben geben die Lizenz frei.
          </p>
        </>
      )}
    </details>
  );
}

function progress(tasks: Task[]) {
  const done = tasks.filter((task) => task.status === "completed").length;
  return {
    done,
    total: tasks.length,
    percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
  };
}

export function Onboarding({
  focusEntryId,
  tenantId,
}: {
  focusEntryId?: string | undefined;
  tenantId: string;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [editor, setEditor] = useState(false);
  const [departmentConfig, setDepartmentConfig] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [draft, setDraft] = useState(emptyDraft);
  const [exceptionTarget, setExceptionTarget] = useState<{
    entryId: string;
    taskId: string;
    taskTitle: string;
  } | null>(null);
  const [ticketNumber, setTicketNumber] = useState("");
  const [exceptionReason, setExceptionReason] = useState("");
  const load = async (preserve = false) => {
    if (!supabase) return;
    setLoading(true);
    if (!preserve) setErrorMessage("");
    try {
      const { data, error } = await supabase.functions.invoke("onboarding", {
        body: {
          type: "listWorkspace",
          tenantId,
          ...(focusEntryId ? { focusEntryId } : {}),
        },
      });
      if (error) throw error;
      const value =
        data && typeof data === "object"
          ? (data as { data?: unknown }).data
          : null;
      if (!isWorkspace(value)) throw new Error("invalid_onboarding_workspace");
      setWorkspace(value);
    } catch (error) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          tn("Die Eintritte konnten nicht geladen werden. Bitte versuche es erneut.", "Die Eintritte konnten nicht geladen werden. Bitte versuchen Sie es erneut."),
        ),
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [focusEntryId, tenantId]);
  useEffect(() => {
    if (
      !focusEntryId ||
      !workspace?.entries.some((entry) => entry.id === focusEntryId)
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(`onboarding-entry-${focusEntryId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusEntryId, workspace?.entries]);
  useEffect(() => {
    if (!workspace) return;
    setDraft((current) => ({
      ...current,
      templateId: current.templateId || workspace.templates[0]?.id || "",
    }));
  }, [workspace]);
  const counts = useMemo(() => {
    const entries = workspace?.entries ?? [];
    const tasks = entries.flatMap((entry) => entry.tasks);
    return {
      entries: entries.length,
      due: tasks.filter(
        (task) =>
          task.status !== "completed" &&
          task.dueOn <=
            new Intl.DateTimeFormat("en-CA", {
              timeZone: "Europe/Zurich",
            }).format(new Date()),
      ).length,
      completed: tasks.filter((task) => task.status === "completed").length,
    };
  }, [workspace]);
  async function createEntry(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    if (
      !draft.employeeName.trim() ||
      !draft.startsOn ||
      !draft.managerUserId ||
      !draft.ictResponsibleUserId ||
      !draft.templateId
    ) {
      setErrorMessage(
        tn("Bitte fülle Name, Eintrittsdatum, Führungsperson, ICT-Verantwortung und Vorlage aus.", "Bitte füllen Sie Name, Eintrittsdatum, Führungsperson, ICT-Verantwortung und Vorlage aus."),
      );
      return;
    }
    setPending(true);
    setErrorMessage("");
    try {
      const { error } = await supabase.functions.invoke("onboarding", {
        body: {
          type: "createEntry",
          tenantId,
          employeeName: draft.employeeName,
          startsOn: draft.startsOn,
          organisationUnit: draft.organisationUnit.trim() || null,
          location: draft.location.trim() || null,
          managerUserId: draft.managerUserId,
          ictResponsibleUserId: draft.ictResponsibleUserId,
          templateId: draft.templateId,
          kind: draft.kind,
        },
      });
      if (error) throw error;
      setDraft(emptyDraft());
      setEditor(false);
      setNotice(
        draft.kind === "offboarding"
          ? "Der Austritt wurde geplant. Die Aufgaben sind relativ zum Austrittsdatum terminiert."
          : "Der Eintritt wurde geplant. Die Aufgaben sind relativ zum Eintrittsdatum terminiert.",
      );
      await load(true);
    } catch (error) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          tn("Der Eintritt konnte nicht erstellt werden. Bitte versuche es erneut.", "Der Eintritt konnte nicht erstellt werden. Bitte versuchen Sie es erneut."),
        ),
      );
    } finally {
      setPending(false);
    }
  }
  async function changeTask(taskId: string, status: TaskStatus) {
    if (!supabase) return;
    setPending(true);
    setErrorMessage("");
    try {
      const { error } = await supabase.functions.invoke("onboarding", {
        body: { type: "updateTaskStatus", tenantId, taskId, status },
      });
      if (error) throw error;
      await load(true);
    } catch (error) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          "Der Aufgabenstatus konnte nicht aktualisiert werden.",
        ),
      );
    } finally {
      setPending(false);
    }
  }
  async function linkException(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !exceptionTarget) return;
    setPending(true);
    setErrorMessage("");
    try {
      const { error } = await supabase.functions.invoke("onboarding", {
        body: {
          type: "linkExceptionTicket",
          tenantId,
          entryId: exceptionTarget.entryId,
          taskId: exceptionTarget.taskId,
          ticketNumber,
          reason: exceptionReason,
        },
      });
      if (error) throw error;
      setNotice(
        "Das Ausnahmeticket wurde mit der Onboarding-Aufgabe verknüpft.",
      );
      setExceptionTarget(null);
      setTicketNumber("");
      setExceptionReason("");
      await load(true);
    } catch (error) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          "Das Ausnahmeticket konnte nicht verknüpft werden.",
        ),
      );
    } finally {
      setPending(false);
    }
  }
  if (loading && !workspace)
    return (
      <section className="onboarding panel" aria-busy="true">
        <p className="empty-state">Eintritte werden geladen …</p>
      </section>
    );
  const entries = workspace?.entries ?? [];
  const canRequest = workspace?.permissions.canRequest ?? false;
  return (
    <section className="onboarding" aria-labelledby="onboarding-heading">
      <header className="onboarding__hero panel">
        <div>
          <p className="eyebrow">Planung statt Ticket</p>
          <h2 id="onboarding-heading">Eintritte & Austritte</h2>
          <p>
            Ein- und Austritte werden mit klaren Verantwortlichkeiten
            vorbereitet. Die beteiligten Abteilungen erhalten ihre Teilaufgaben
            automatisch. Tickets entstehen nur bewusst bei Ausnahmen oder
            Verzögerungen.
          </p>
        </div>
        <div className="onboarding__actions">
          {canRequest ? (
            <button
              className="primary-button"
              onClick={() => setEditor(true)}
              type="button"
            >
              <Plus size={17} /> Eintritt oder Austritt planen
            </button>
          ) : null}
          {workspace?.permissions.canManage ? (
            <button
              className="secondary-button"
              onClick={() => setDepartmentConfig((current) => !current)}
              type="button"
            >
              Abteilungsaufgaben
            </button>
          ) : null}
        </div>
      </header>
      {departmentConfig && workspace?.permissions.canManage ? (
        <OnboardingDepartmentTasks tenantId={tenantId} />
      ) : null}
      <div className="onboarding__metrics">
        <article>
          <UserRound size={18} />
          <span>Geplante Eintritte</span>
          <strong>{counts.entries}</strong>
        </article>
        <article>
          <CalendarDays size={18} />
          <span>Offene Fälligkeiten</span>
          <strong>{counts.due}</strong>
        </article>
        <article>
          <CheckCircle2 size={18} />
          <span>Erledigte Aufgaben</span>
          <strong>{counts.completed}</strong>
        </article>
      </div>
      {errorMessage ? (
        <p
          className="onboarding__message onboarding__message--error"
          role="alert"
        >
          {errorMessage}
        </p>
      ) : null}
      {notice ? (
        <p
          className="onboarding__message onboarding__message--success"
          role="status"
        >
          {notice}
        </p>
      ) : null}
      {editor && canRequest ? (
        <FormDialog
          eyebrow="Neuer Eintritt"
          error={errorMessage}
          onClose={() => setEditor(false)}
          onSubmit={createEntry}
          side={
            <FormSummary
              eyebrow={draft.kind === "offboarding" ? "Austritt" : "Eintritt"}
              rows={[
                [
                  draft.kind === "offboarding" ? "Austrittsdatum" : "Datum",
                  draft.startsOn,
                ],
                ["Abteilung", draft.organisationUnit],
                ["Standort", draft.location],
                [
                  "Vorlage",
                  workspace?.templates.find(
                    (template) => template.id === draft.templateId,
                  )?.name ?? "",
                ],
              ]}
              title={draft.employeeName}
            />
          }
          submitLabel="Eintritt planen"
          submitting={pending}
          title="Onboarding planen"
        >
          <FormCard title="Person">
            <FormGrid cols={3}>
              <FormField label="Art" required>
                <select
                  value={draft.kind}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      kind:
                        event.target.value === "offboarding"
                          ? "offboarding"
                          : "onboarding",
                    })
                  }
                >
                  <option value="onboarding">Eintritt</option>
                  <option value="offboarding">Austritt</option>
                </select>
              </FormField>
              <FormField label="Name" required>
                <input
                  required
                  minLength={2}
                  maxLength={160}
                  value={draft.employeeName}
                  onChange={(event) =>
                    setDraft({ ...draft, employeeName: event.target.value })
                  }
                  placeholder="Vor- und Nachname"
                />
              </FormField>
              <FormField
                label={
                  draft.kind === "offboarding"
                    ? "Austrittsdatum"
                    : "Eintrittsdatum"
                }
                required
              >
                <input
                  required
                  type="date"
                  value={draft.startsOn}
                  onChange={(event) =>
                    setDraft({ ...draft, startsOn: event.target.value })
                  }
                />
              </FormField>
            </FormGrid>
          </FormCard>
          <FormCard title="Einsatz">
            <FormGrid cols={2}>
              <FormField label="Abteilung / Angebot" required>
                <input
                  required
                  minLength={2}
                  maxLength={160}
                  value={draft.organisationUnit}
                  onChange={(event) =>
                    setDraft({ ...draft, organisationUnit: event.target.value })
                  }
                  placeholder="z. B. Schule oder ICT"
                />
              </FormField>
              <FormField label="Standort" required>
                <input
                  required
                  minLength={2}
                  maxLength={160}
                  value={draft.location}
                  onChange={(event) =>
                    setDraft({ ...draft, location: event.target.value })
                  }
                  placeholder="Standort"
                />
              </FormField>
            </FormGrid>
          </FormCard>
          <FormCard title="Verantwortung">
            <FormGrid cols={2}>
              <FormField label="Führungsperson" required>
                <select
                  required
                  value={draft.managerUserId}
                  onChange={(event) =>
                    setDraft({ ...draft, managerUserId: event.target.value })
                  }
                >
                  <option value="">Person auswählen …</option>
                  {workspace?.people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.displayName}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="ICT-Verantwortung" required>
                <select
                  required
                  value={draft.ictResponsibleUserId}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      ictResponsibleUserId: event.target.value,
                    })
                  }
                >
                  <option value="">Person auswählen …</option>
                  {workspace?.people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.displayName}
                    </option>
                  ))}
                </select>
              </FormField>
            </FormGrid>
          </FormCard>
          <FormCard title="Vorlage">
            <FormField label="Onboarding-Vorlage" required>
              <select
                required
                value={draft.templateId}
                onChange={(event) =>
                  setDraft({ ...draft, templateId: event.target.value })
                }
              >
                {workspace?.templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormNote>
              Die Aufgaben werden jetzt einmalig relativ zum Eintrittsdatum
              terminiert. Es gibt keinen Scheduler und keine automatische
              Ticketanlage.
            </FormNote>
          </FormCard>
        </FormDialog>
      ) : null}
      {exceptionTarget ? (
        <FormDialog
          eyebrow="Bewusste Ausnahme"
          error={errorMessage}
          onClose={() => setExceptionTarget(null)}
          onSubmit={linkException}
          submitLabel="Ticket verknüpfen"
          submitting={pending}
          title="Ausnahmeticket verknüpfen"
        >
          <FormCard title="Ausnahmeticket">
            <FormNote>
              {tn(
                <>
                  Erstelle das Ticket zuerst bewusst im Bereich «Tickets».
                  Danach verknüpfst du dessen Ticketnummer mit «
                  {exceptionTarget.taskTitle}».
                </>,
                <>
                  Erstellen Sie das Ticket zuerst bewusst im Bereich «Tickets».
                  Danach verknüpfen Sie dessen Ticketnummer mit «
                  {exceptionTarget.taskTitle}».
                </>,
              )}
            </FormNote>
            <FormGrid cols={2}>
              <FormField label="Ticketnummer" required>
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  value={ticketNumber}
                  onChange={(event) => setTicketNumber(event.target.value)}
                  placeholder="z. B. ICT-2026-000123"
                />
              </FormField>
              <FormField label="Grund der Ausnahme" required>
                <input
                  required
                  minLength={3}
                  maxLength={500}
                  value={exceptionReason}
                  onChange={(event) => setExceptionReason(event.target.value)}
                  placeholder="z. B. Lieferverzögerung Gerät"
                />
              </FormField>
            </FormGrid>
          </FormCard>
        </FormDialog>
      ) : null}
      <section className="onboarding__workspace panel">
        <div className="onboarding__workspace-heading">
          <div>
            <p className="eyebrow">Fortschritt</p>
            <h3>Meine sichtbaren Eintritte</h3>
          </div>
          <ClipboardList size={22} />
        </div>
        {entries.length ? (
          <div className="onboarding__list">
            {entries.map((entry) => {
              const state = progress(entry.tasks);
              return (
                <article
                  className={`onboarding__entry${focusEntryId === entry.id ? " global-search-target" : ""}`}
                  id={`onboarding-entry-${entry.id}`}
                  key={entry.id}
                >
                  <header>
                    <div>
                      <h4>
                        {entry.employeeName}{" "}
                        <span
                          className={`onboarding__kind onboarding__kind--${entry.kind ?? "onboarding"}`}
                        >
                          {entry.kind === "offboarding"
                            ? "Austritt"
                            : "Eintritt"}
                        </span>
                      </h4>
                      <p>
                        {entry.kind === "offboarding" ? "Austritt" : "Eintritt"}{" "}
                        am {dateLabel(entry.startsOn)}
                        {entry.organisationUnit
                          ? ` · ${entry.organisationUnit}`
                          : ""}
                        {entry.location ? ` · ${entry.location}` : ""}
                      </p>
                    </div>
                    <strong>
                      {state.done}/{state.total} erledigt
                    </strong>
                  </header>
                  <div
                    className="onboarding__progress"
                    aria-label={`${state.percent}% erledigt`}
                  >
                    <span style={{ width: `${state.percent}%` }} />
                  </div>
                  {departmentProgress(entry.tasks).length ? (
                    <ul
                      aria-label="Fortschritt pro Abteilung"
                      className="onboarding__departments"
                    >
                      {departmentProgress(entry.tasks).map((department) => (
                        <li
                          className={
                            department.done === department.total
                              ? "is-done"
                              : ""
                          }
                          key={department.name}
                        >
                          <span>{department.name}</span>
                          <span
                            aria-hidden="true"
                            className="onboarding__department-bar"
                          >
                            <span
                              style={{
                                width: `${Math.round((department.done / department.total) * 100)}%`,
                              }}
                            />
                          </span>
                          <strong>
                            {department.done}/{department.total}
                          </strong>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <dl>
                    <div>
                      <dt>Führung</dt>
                      <dd>{entry.managerName}</dd>
                    </div>
                    <div>
                      <dt>ICT</dt>
                      <dd>{entry.ictResponsibleName}</dd>
                    </div>
                  </dl>
                  {entry.source === "email" ? (
                    <details className="onboarding__details">
                      <summary>
                        Angaben aus der Eintrittsmeldung
                        {entry.sourceTicketNumber
                          ? ` (E-Mail ${entry.sourceTicketNumber})`
                          : ""}
                      </summary>
                      <dl>
                        {entryDetailRows(entry.details).map((row) => (
                          <div key={row.label}>
                            <dt>{row.label}</dt>
                            <dd>{row.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  ) : null}
                  <div className="onboarding__tasks">
                    {entry.tasks.map((task) => (
                      <div
                        className={`onboarding__task onboarding__task--${task.status}`}
                        key={task.id}
                      >
                        <div>
                          <strong>{task.title}</strong>
                          <span>
                            Fällig {dateLabel(task.dueOn)} ·{" "}
                            {task.responsibleName}
                          </span>
                          {task.exception ? (
                            <small>
                              Ausnahmeticket {task.exception.ticketNumber}{" "}
                              verknüpft
                            </small>
                          ) : null}
                        </div>
                        {task.canUpdate ? (
                          <label>
                            <span className="sr-only">
                              Status für {task.title}
                            </span>
                            <select
                              value={task.status}
                              disabled={pending}
                              onChange={(event) =>
                                void changeTask(
                                  task.id,
                                  event.target.value as TaskStatus,
                                )
                              }
                            >
                              {Object.entries(statuses).map(([key, label]) => (
                                <option key={key} value={key}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <em>{statuses[task.status]}</em>
                        )}
                        {task.canUpdate && !task.exception ? (
                          <button
                            className="text-button"
                            disabled={pending}
                            onClick={() =>
                              setExceptionTarget({
                                entryId: entry.id,
                                taskId: task.id,
                                taskTitle: task.title,
                              })
                            }
                            type="button"
                          >
                            Ausnahmeticket
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {entry.kind === "offboarding" && entry.canEdit ? (
                    <AssetReturnsPanel
                      entry={entry}
                      onCreated={() => load(true)}
                      tenantId={tenantId}
                    />
                  ) : null}
                  <p className="onboarding__exception">
                    <Wrench size={15} /> Bei einer Ausnahme oder Verzögerung
                    wird ein Ticket bewusst im Bereich «Tickets» erstellt und
                    danach mit diesem Eintritt verknüpft; aus dem Onboarding
                    entstehen nie automatisch Tickets.
                  </p>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="onboarding__empty">
            <BadgeCheck size={25} />
            <div>
              <strong>Noch keine Eintritte sichtbar</strong>
              <p>
                {tn(
                  "Plane einen Eintritt, damit Zuständigkeiten und Fälligkeiten vorbereitet sind.",
                  "Planen Sie einen Eintritt, damit Zuständigkeiten und Fälligkeiten vorbereitet sind.",
                )}
              </p>
            </div>
          </div>
        )}
      </section>
    </section>
  );
}
