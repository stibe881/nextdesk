import { tn } from "./lib/formality";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  Building2,
  GitBranch,
  LoaderCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "./lib/supabase";
import { functionErrorMessage } from "./lib/function-error";
import {
  MAX_SPLIT_CHILDREN,
  newSplitChild,
  openChildCount,
  splitPayload,
  updateSplitChild,
  validateSplitDraft,
  type SplitDraftChild,
  type SplitValidation,
} from "./lib/ticket-split";
import {
  formatTimelineDuration,
  type TimelineInput,
} from "./lib/ticket-timeline";
import { TicketTimeline } from "./ticket-timeline";
import "./ticket-coordination.css";

type ChildTicket = {
  id: string;
  ticketNumber: string;
  subject: string | null;
  statusLabel: string;
  isClosed: boolean;
  departmentName: string | null;
  assigneeName: string | null;
  createdAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  readable: boolean;
};

type VendorCase = {
  id: string;
  vendorName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  reminderAfterHours: number;
  externalCaseNumber: string | null;
  openedAt: string | null;
  lastVendorUpdateAt: string | null;
  closedAt: string | null;
  note: string | null;
};

type Vendor = { id: string; name: string; reminderAfterHours: number };

type Overview = {
  ticketIsClosed: boolean;
  parent: {
    id: string;
    ticketNumber: string;
    subject: string | null;
    statusLabel: string | null;
    readable: boolean;
  } | null;
  children: ChildTicket[];
  vendorCases: VendorCase[];
  vendors: Vendor[];
  timeline: TimelineInput;
  permissions: {
    canSplit: boolean;
    canManageVendorCases: boolean;
    canManageVendors: boolean;
  };
};

type SplitOptions = {
  departments: { id: string; name: string; canAssign: boolean }[];
  teams: { id: string; name: string; departmentId: string }[];
};

type Agent = { id: string; displayName: string };

type TicketCoordinationProps = {
  tenantId: string;
  ticketId: string;
  ticketNumber: string;
  subject: string;
  description: string;
  /** Changes whenever the ticket changed elsewhere in the detail view. */
  refreshKey: string;
  onChanged: () => void;
  onOpenTicket?: ((ticketId: string) => void) | undefined;
  /** Support level block shown at the top of the card. */
  supportLevel?: ReactNode;
  /**
   * Where the «Ticket-Zeitachse» is shown (above the description). Without a
   * host it follows the card.
   */
  timelineHost?: HTMLElement | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function parseCoordinationOverview(value: unknown): Overview | null {
  const data = isRecord(value) && isRecord(value.data) ? value.data : null;
  if (!data || !isRecord(data.ticket) || !isRecord(data.permissions)) {
    return null;
  }
  const ticket = data.ticket;
  const createdAt = str(ticket.createdAt);
  if (!createdAt) return null;
  const parent = isRecord(data.parent) ? data.parent : null;
  const children: ChildTicket[] = list(data.children).map((row) => ({
    id: String(row.id),
    ticketNumber: String(row.ticketNumber ?? ""),
    subject: str(row.subject),
    statusLabel: str(row.statusLabel) ?? "Unbekannt",
    isClosed: row.isClosed === true,
    departmentName: str(row.departmentName),
    assigneeName: str(row.assigneeName),
    createdAt: str(row.createdAt),
    resolvedAt: str(row.resolvedAt),
    closedAt: str(row.closedAt),
    readable: row.readable === true,
  }));
  const vendorCases: VendorCase[] = list(data.vendorCases).map((row) => ({
    id: String(row.id),
    vendorName: str(row.vendorName) ?? "Drittanbieter",
    contactEmail: str(row.contactEmail),
    contactPhone: str(row.contactPhone),
    reminderAfterHours:
      typeof row.reminderAfterHours === "number" ? row.reminderAfterHours : 48,
    externalCaseNumber: str(row.externalCaseNumber),
    openedAt: str(row.openedAt),
    lastVendorUpdateAt: str(row.lastVendorUpdateAt),
    closedAt: str(row.closedAt),
    note: str(row.note),
  }));
  const isClosed = ticket.isClosed === true;
  return {
    ticketIsClosed: isClosed,
    parent: parent
      ? {
          id: String(parent.id),
          ticketNumber: String(parent.ticketNumber ?? ""),
          subject: str(parent.subject),
          statusLabel: str(parent.statusLabel),
          readable: parent.readable === true,
        }
      : null,
    children,
    vendorCases,
    vendors: list(data.vendors).map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      reminderAfterHours:
        typeof row.reminderAfterHours === "number"
          ? row.reminderAfterHours
          : 48,
    })),
    timeline: {
      ticket: {
        createdAt,
        firstRespondedAt: str(ticket.firstRespondedAt),
        responseDueAt: str(ticket.responseDueAt),
        resolutionDueAt: str(ticket.resolutionDueAt),
        resolvedAt: str(ticket.resolvedAt),
        closedAt: str(ticket.closedAt),
        isClosed,
        slaPausedAt: isClosed ? null : str(ticket.slaPausedAt),
      },
      events: list(data.events).map((row) => ({
        id: String(row.id),
        type: String(row.type ?? ""),
        createdAt: String(row.createdAt ?? ""),
        payload: isRecord(row.payload) ? row.payload : {},
      })),
      comments: list(data.comments).map((row) => ({
        id: String(row.id),
        visibility: row.visibility === "internal" ? "internal" : "external",
        createdAt: String(row.createdAt ?? ""),
        fromRequester: row.fromRequester === true,
      })),
      vendorCases: vendorCases.map((vendorCase) => ({
        id: vendorCase.id,
        vendorName: vendorCase.vendorName,
        externalCaseNumber: vendorCase.externalCaseNumber,
        openedAt: vendorCase.openedAt,
        closedAt: vendorCase.closedAt,
      })),
      children: children.map((child) => ({
        id: child.id,
        ticketNumber: child.ticketNumber,
        createdAt: child.createdAt,
        resolvedAt: child.resolvedAt,
        closedAt: child.closedAt,
        isClosed: child.isClosed,
      })),
      statuses: list(data.statuses).map((row) => ({
        key: String(row.key ?? ""),
        label: String(row.label ?? ""),
        isClosed: row.isClosed === true,
      })),
    },
    permissions: {
      canSplit: data.permissions.canSplit === true,
      canManageVendorCases: data.permissions.canManageVendorCases === true,
      canManageVendors: data.permissions.canManageVendors === true,
    },
  };
}

async function invokeCoordination(
  body: Record<string, unknown>,
): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke(
    "ticket-coordination",
    { body },
  );
  if (error) throw error;
  return data;
}

const DATE_TIME = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Zurich",
});

function formatDateTime(value: string | null): string {
  if (!value) return "–";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "–" : DATE_TIME.format(date);
}

function since(value: string | null, now: number): string {
  if (!value) return "–";
  const time = Date.parse(value);
  return Number.isNaN(time) ? "–" : formatTimelineDuration(now - time);
}

async function coordinationError(
  error: unknown,
  fallback: string,
): Promise<string> {
  const status =
    isRecord(error) && error.context instanceof Response
      ? error.context.status
      : null;
  let code: string | null = null;
  if (isRecord(error) && error.context instanceof Response) {
    try {
      const body: unknown = await error.context.clone().json();
      if (isRecord(body) && isRecord(body.error)) code = str(body.error.code);
    } catch {
      code = null;
    }
  }
  switch (code) {
    case "ticket_split_parent_closed":
      return "Ein gelöstes, geschlossenes oder zusammengeführtes Ticket kann nicht aufgeteilt werden.";
    case "ticket_split_department_invalid":
      return tn(
        "Mindestens eine gewählte Abteilung ist nicht mehr aktiv. Bitte prüfe die Auswahl.",
        "Mindestens eine gewählte Abteilung ist nicht mehr aktiv. Bitte prüfen Sie die Auswahl.",
      );
    case "ticket_split_team_invalid":
      return "Mindestens ein gewähltes Team gehört nicht zur Abteilung oder ist nicht aktiv.";
    case "assigned_agent_invalid":
    case "ticket_split_assignment_invalid":
      return "Mindestens eine gewählte Person ist für Abteilung oder Team nicht zuweisbar.";
    case "ticket_assign_denied":
      return tn(
        "Für die Zuweisung in mindestens einer Abteilung fehlt dir die Berechtigung. Lass Team und Person leer.",
        "Für die Zuweisung in mindestens einer Abteilung fehlt Ihnen die Berechtigung. Lassen Sie Team und Person leer.",
      );
    case "vendor_case_exists":
      return "Für diesen Drittanbieter ist bereits ein offener Fall erfasst.";
    case "vendor_case_ticket_closed":
      return "Ein gelöstes oder geschlossenes Ticket kann nicht an einen Drittanbieter übergeben werden.";
    case "vendor_invalid":
      return "Der gewählte Drittanbieter ist nicht mehr aktiv.";
    case "vendor_case_not_found":
      return "Der Lieferantenfall ist bereits abgeschlossen oder nicht mehr verfügbar.";
    case "ticket_update_denied":
    case "ticket_coordination_denied":
      return tn(
        "Für diese Aktion fehlt dir die Berechtigung.",
        "Für diese Aktion fehlt Ihnen die Berechtigung.",
      );
  }
  if (status === 403)
    return tn(
      "Für diese Aktion fehlt dir die Berechtigung.",
      "Für diese Aktion fehlt Ihnen die Berechtigung.",
    );
  return functionErrorMessage(error, fallback);
}

export function TicketCoordination({
  tenantId,
  ticketId,
  ticketNumber,
  subject,
  description,
  refreshKey,
  onChanged,
  onOpenTicket,
  supportLevel,
  timelineHost,
}: TicketCoordinationProps) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [splitOpen, setSplitOpen] = useState(false);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [updateCaseId, setUpdateCaseId] = useState<string | null>(null);
  const [caseNote, setCaseNote] = useState("");
  const [notice, setNotice] = useState("");
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const data = await invokeCoordination({
        type: "overview",
        tenantId,
        ticketId,
      });
      if (request !== requestRef.current) return;
      const parsed = parseCoordinationOverview(data);
      setOverview(parsed);
      setNow(Date.now());
      setError(parsed ? "" : "Die Koordinationsdaten sind unvollständig.");
    } catch (nextError) {
      if (request !== requestRef.current) return;
      setOverview(null);
      // People without agent rights simply do not see the section.
      if (
        isRecord(nextError) &&
        nextError.context instanceof Response &&
        nextError.context.status === 403
      ) {
        setError("");
        return;
      }
      setError(
        await coordinationError(
          nextError,
          "Teil-Tickets, Lieferantenfälle und Zeitachse konnten nicht geladen werden.",
        ),
      );
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [tenantId, ticketId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // The waiting clock moves on without reloading.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function afterChange() {
    onChanged();
    await load();
  }

  async function vendorCaseAction(
    type: "recordVendorUpdate" | "closeVendorCase",
    caseId: string,
    note: string,
  ) {
    setBusy(`${type}:${caseId}`);
    setError("");
    try {
      await invokeCoordination({
        type,
        tenantId,
        ticketId,
        caseId,
        note: note.trim() || null,
      });
      setUpdateCaseId(null);
      setCaseNote("");
      await afterChange();
    } catch (nextError) {
      setError(
        await coordinationError(
          nextError,
          "Der Lieferantenfall konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  const cardHeading = (
    <div className="ticket-detail-section-heading">
      <div>
        <p className="eyebrow">KOORDINATION</p>
        <h3 id="ticket-coordination-heading">Koordination</h3>
      </div>
    </div>
  );

  if (loading && !overview) {
    return (
      <section
        aria-labelledby="ticket-coordination-heading"
        className="ticket-detail-primary ticket-coordination"
      >
        {cardHeading}
        {supportLevel}
        <p className="ticket-coordination__muted">
          <LoaderCircle
            aria-hidden="true"
            className="ticket-detail-spinner"
            size={16}
          />{" "}
          Koordination und Zeitachse werden geladen …
        </p>
      </section>
    );
  }
  if (!overview) {
    return (
      <section
        aria-labelledby="ticket-coordination-heading"
        className="ticket-detail-primary ticket-coordination"
      >
        {cardHeading}
        {supportLevel}
        {error ? (
          <p className="ticket-detail-message error" role="alert">
            <AlertCircle aria-hidden="true" size={17} />
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  const openCases = overview.vendorCases.filter((item) => !item.closedAt);
  const closedCases = overview.vendorCases.filter((item) => item.closedAt);
  const openChildren = openChildCount(overview.children);
  const canHandOver =
    overview.permissions.canManageVendorCases && !overview.ticketIsClosed;
  const hasContent =
    overview.parent !== null ||
    overview.children.length > 0 ||
    overview.vendorCases.length > 0 ||
    overview.permissions.canSplit ||
    canHandOver;
  const waitingSince = openCases
    .map((item) => item.openedAt)
    .filter((value): value is string => Boolean(value))
    .sort()[0];

  const timeline = <TicketTimeline input={overview.timeline} now={now} />;

  return (
    <>
      <section
        aria-labelledby="ticket-coordination-heading"
        className="ticket-detail-primary ticket-coordination"
      >
        {cardHeading}
        {supportLevel}
        {hasContent ? (
          <div className="ticket-coordination__group">
            <div className="ticket-coordination__group-heading">
              <h4>Teil-Tickets und Drittanbieter</h4>
              <div className="ticket-coordination__actions">
                {overview.permissions.canSplit ? (
                  <button
                    className="secondary-button"
                    disabled={busy !== null}
                    onClick={() => setSplitOpen(true)}
                    type="button"
                  >
                    <GitBranch aria-hidden="true" size={15} />
                    Aufteilen
                  </button>
                ) : null}
                {canHandOver ? (
                  <button
                    className="secondary-button"
                    disabled={busy !== null}
                    onClick={() => setVendorOpen(true)}
                    type="button"
                  >
                    <Building2 aria-hidden="true" size={15} />
                    An Drittanbieter übergeben
                  </button>
                ) : null}
              </div>
            </div>

            {error ? (
              <p className="ticket-detail-message error" role="alert">
                <AlertCircle aria-hidden="true" size={17} />
                {error}
              </p>
            ) : null}

            {notice ? (
              <p className="ticket-coordination__hint" role="status">
                {notice}
              </p>
            ) : null}

            {overview.parent ? (
              <p className="ticket-coordination__parent">
                Teil-Ticket von{" "}
                {onOpenTicket && overview.parent.readable ? (
                  <button
                    className="ticket-coordination__link"
                    onClick={() => onOpenTicket(overview.parent!.id)}
                    type="button"
                  >
                    {overview.parent.ticketNumber}
                  </button>
                ) : (
                  <strong>{overview.parent.ticketNumber}</strong>
                )}
                {overview.parent.subject ? ` · ${overview.parent.subject}` : ""}
                {overview.parent.statusLabel ? (
                  <span className="tone-chip tone-chip--neutral">
                    {overview.parent.statusLabel}
                  </span>
                ) : null}
              </p>
            ) : null}

            {waitingSince ? (
              <p className="ticket-coordination__clock" role="status">
                <span className="tone-chip tone-chip--warning">
                  Wartet auf Drittanbieter seit {since(waitingSince, now)}
                </span>
                <small>seit {formatDateTime(waitingSince)}</small>
              </p>
            ) : null}

            {overview.children.length > 0 ? (
              <div className="ticket-coordination__block">
                <h4>
                  Teil-Tickets{" "}
                  <span className="data-caption">
                    {overview.children.length - openChildren} von{" "}
                    {overview.children.length} erledigt
                  </span>
                </h4>
                {openChildren > 0 ? (
                  <p className="ticket-coordination__hint">
                    Dieses Ticket kann erst gelöst oder geschlossen werden, wenn
                    alle Teil-Tickets gelöst oder geschlossen sind (
                    {openChildren} offen).
                  </p>
                ) : null}
                <ul className="ticket-coordination__list">
                  {overview.children.map((child) => (
                    <li key={child.id}>
                      <span className="ticket-coordination__item-main">
                        {onOpenTicket && child.readable ? (
                          <button
                            className="ticket-coordination__link"
                            onClick={() => onOpenTicket(child.id)}
                            type="button"
                          >
                            {child.ticketNumber}
                          </button>
                        ) : (
                          <strong>{child.ticketNumber}</strong>
                        )}
                        <span>
                          {child.subject ?? "Teil-Ticket ohne Leseberechtigung"}
                        </span>
                      </span>
                      <span className="ticket-coordination__item-meta">
                        {[child.departmentName, child.assigneeName]
                          .filter(Boolean)
                          .join(" · ") || "Nicht zugewiesen"}
                      </span>
                      <span
                        className={`tone-chip ${child.isClosed ? "tone-chip--success" : "tone-chip--info"}`}
                      >
                        {child.statusLabel}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {overview.vendorCases.length > 0 ? (
              <div className="ticket-coordination__block">
                <h4>Lieferantenfälle</h4>
                <ul className="ticket-coordination__list">
                  {openCases.map((item) => {
                    const lastContact =
                      item.lastVendorUpdateAt ?? item.openedAt;
                    const silentHours = lastContact
                      ? (now - Date.parse(lastContact)) / 3_600_000
                      : 0;
                    const overdue = silentHours >= item.reminderAfterHours;
                    return (
                      <li className="ticket-coordination__case" key={item.id}>
                        <span className="ticket-coordination__item-main">
                          <strong>{item.vendorName}</strong>
                          <span>
                            {item.externalCaseNumber
                              ? `Fallnummer ${item.externalCaseNumber}`
                              : "Ohne externe Fallnummer"}
                          </span>
                        </span>
                        <span className="ticket-coordination__item-meta">
                          Offen seit {formatDateTime(item.openedAt)} · letzte
                          Rückmeldung{" "}
                          {item.lastVendorUpdateAt
                            ? formatDateTime(item.lastVendorUpdateAt)
                            : "noch keine"}
                          {item.contactEmail || item.contactPhone
                            ? ` · ${[item.contactEmail, item.contactPhone].filter(Boolean).join(", ")}`
                            : ""}
                        </span>
                        <span
                          className={`tone-chip ${overdue ? "tone-chip--danger" : "tone-chip--warning"}`}
                          title={`Erinnerung nach ${item.reminderAfterHours} Std. ohne Rückmeldung`}
                        >
                          {overdue
                            ? `Seit ${since(lastContact, now)} ohne Rückmeldung`
                            : `Erinnerung in ${formatTimelineDuration(
                                (item.reminderAfterHours - silentHours) *
                                  3_600_000,
                              )}`}
                        </span>
                        {item.note ? (
                          <span className="ticket-coordination__note">
                            {item.note}
                          </span>
                        ) : null}
                        {overview.permissions.canManageVendorCases ? (
                          updateCaseId === item.id ? (
                            <form
                              className="ticket-coordination__case-form"
                              onSubmit={(event) => {
                                event.preventDefault();
                                void vendorCaseAction(
                                  "recordVendorUpdate",
                                  item.id,
                                  caseNote,
                                );
                              }}
                            >
                              <label>
                                Was hat der Drittanbieter gemeldet?
                                <textarea
                                  maxLength={2000}
                                  onChange={(event) =>
                                    setCaseNote(event.target.value)
                                  }
                                  rows={2}
                                  value={caseNote}
                                />
                              </label>
                              <div className="ticket-coordination__actions">
                                <button
                                  className="secondary-button"
                                  onClick={() => {
                                    setUpdateCaseId(null);
                                    setCaseNote("");
                                  }}
                                  type="button"
                                >
                                  Abbrechen
                                </button>
                                <button
                                  className="primary-button"
                                  disabled={busy !== null}
                                  type="submit"
                                >
                                  Rückmeldung speichern
                                </button>
                              </div>
                            </form>
                          ) : (
                            <span className="ticket-coordination__actions">
                              <button
                                className="secondary-button"
                                disabled={busy !== null}
                                onClick={() => {
                                  setUpdateCaseId(item.id);
                                  setCaseNote("");
                                }}
                                type="button"
                              >
                                Rückmeldung erhalten
                              </button>
                              <button
                                className="secondary-button"
                                disabled={busy !== null}
                                onClick={() =>
                                  void vendorCaseAction(
                                    "closeVendorCase",
                                    item.id,
                                    "",
                                  )
                                }
                                type="button"
                              >
                                {busy === `closeVendorCase:${item.id}` ? (
                                  <LoaderCircle
                                    aria-hidden="true"
                                    className="ticket-detail-spinner"
                                    size={14}
                                  />
                                ) : null}
                                Fall abschliessen
                              </button>
                            </span>
                          )
                        ) : null}
                      </li>
                    );
                  })}
                  {closedCases.map((item) => (
                    <li
                      className="ticket-coordination__case ticket-coordination__case--closed"
                      key={item.id}
                    >
                      <span className="ticket-coordination__item-main">
                        <strong>{item.vendorName}</strong>
                        <span>
                          {item.externalCaseNumber
                            ? `Fallnummer ${item.externalCaseNumber}`
                            : "Ohne externe Fallnummer"}
                        </span>
                      </span>
                      <span className="ticket-coordination__item-meta">
                        {formatDateTime(item.openedAt)} –{" "}
                        {formatDateTime(item.closedAt)}
                      </span>
                      <span className="tone-chip tone-chip--success">
                        Abgeschlossen
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {timelineHost ? createPortal(timeline, timelineHost) : timeline}

      {splitOpen ? (
        <TicketSplitDialog
          description={description}
          onClose={() => setSplitOpen(false)}
          onSplit={async () => {
            setSplitOpen(false);
            await afterChange();
          }}
          subject={subject}
          tenantId={tenantId}
          ticketId={ticketId}
          ticketNumber={ticketNumber}
        />
      ) : null}
      {vendorOpen ? (
        <VendorCaseDialog
          canManageVendors={overview.permissions.canManageVendors}
          onClose={() => setVendorOpen(false)}
          onOpened={async (message) => {
            setVendorOpen(false);
            setNotice(message ?? "");
            await afterChange();
          }}
          tenantId={tenantId}
          ticketId={ticketId}
          vendors={overview.vendors}
        />
      ) : null}
    </>
  );
}

function TicketSplitDialog({
  tenantId,
  ticketId,
  ticketNumber,
  subject,
  description,
  onClose,
  onSplit,
}: {
  tenantId: string;
  ticketId: string;
  ticketNumber: string;
  subject: string;
  description: string;
  onClose: () => void;
  onSplit: () => Promise<void>;
}) {
  const parent = useMemo(
    () => ({ ticketNumber, subject, description }),
    [ticketNumber, subject, description],
  );
  const keyRef = useRef(2);
  const [children, setChildren] = useState<SplitDraftChild[]>(() => [
    newSplitChild("1", parent),
    newSplitChild("2", parent),
  ]);
  const [options, setOptions] = useState<SplitOptions | null>(null);
  const [agents, setAgents] = useState<Record<string, Agent[]>>({});
  const [validation, setValidation] = useState<SplitValidation | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    invokeCoordination({ type: "splitOptions", tenantId, ticketId })
      .then((value) => {
        if (!active) return;
        const data =
          isRecord(value) && isRecord(value.data) ? value.data : null;
        setOptions({
          departments: list(data?.departments).map((row) => ({
            id: String(row.id),
            name: String(row.name ?? ""),
            canAssign: row.canAssign === true,
          })),
          teams: list(data?.teams).map((row) => ({
            id: String(row.id),
            name: String(row.name ?? ""),
            departmentId: String(row.departmentId ?? ""),
          })),
        });
      })
      .catch(async (nextError: unknown) => {
        if (!active) return;
        setError(
          await coordinationError(
            nextError,
            "Die Abteilungen konnten nicht geladen werden.",
          ),
        );
      });
    return () => {
      active = false;
    };
  }, [tenantId, ticketId]);

  const agentKeys = children
    .filter(
      (child) =>
        child.departmentId &&
        options?.departments.find((item) => item.id === child.departmentId)
          ?.canAssign,
    )
    .map((child) => `${child.departmentId}|${child.teamId}`);
  const missingAgentKey = agentKeys.find((key) => !(key in agents));

  useEffect(() => {
    if (!missingAgentKey) return;
    const [departmentId, teamId] = missingAgentKey.split("|");
    setAgents((current) => ({ ...current, [missingAgentKey]: [] }));
    invokeCoordination({
      type: "assignableAgents",
      tenantId,
      ticketId,
      departmentId,
      teamId: teamId || null,
    })
      .then((value) => {
        const data =
          isRecord(value) && isRecord(value.data) ? value.data : null;
        setAgents((current) => ({
          ...current,
          [missingAgentKey]: list(data?.agents).map((row) => ({
            id: String(row.id),
            displayName: String(row.displayName ?? ""),
          })),
        }));
      })
      .catch(() => undefined);
  }, [missingAgentKey, tenantId, ticketId]);

  function change(key: string, update: Partial<Omit<SplitDraftChild, "key">>) {
    setChildren((current) =>
      current.map((child) =>
        child.key === key ? updateSplitChild(child, update) : child,
      ),
    );
  }

  async function submit() {
    const result = validateSplitDraft(children);
    setValidation(result);
    if (!result.valid) return;
    setSaving(true);
    setError("");
    try {
      await invokeCoordination({
        type: "split",
        tenantId,
        ticketId,
        children: splitPayload(children),
      });
      await onSplit();
    } catch (nextError) {
      setError(
        await coordinationError(
          nextError,
          "Das Ticket konnte nicht aufgeteilt werden.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="ticket-coordination__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
      role="presentation"
    >
      <div
        aria-labelledby="ticket-split-heading"
        aria-modal="true"
        className="ticket-coordination__dialog ticket-coordination__dialog--wide"
        role="dialog"
      >
        <div className="ticket-coordination__dialog-heading">
          <div>
            <p className="eyebrow">TICKET-AUFTEILUNG</p>
            <h3 id="ticket-split-heading">Ticket {ticketNumber} aufteilen</h3>
            <p className="ticket-coordination__muted">
              Jedes Teil-Ticket wird mit diesem Ticket verknüpft. Das
              Hauptticket kann erst gelöst werden, wenn alle Teil-Tickets
              erledigt sind.
            </p>
          </div>
          <button
            aria-label="Dialog schliessen"
            className="more-button"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        {error ? (
          <p className="ticket-detail-message error" role="alert">
            <AlertCircle aria-hidden="true" size={17} />
            {error}
          </p>
        ) : null}
        {validation?.formError ? (
          <p className="ticket-detail-message error" role="alert">
            {validation.formError}
          </p>
        ) : null}

        <form
          className="ticket-coordination__split-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {children.map((child, index) => {
            const errors = validation?.childErrors[index] ?? {};
            const department = options?.departments.find(
              (item) => item.id === child.departmentId,
            );
            const teams =
              options?.teams.filter(
                (team) => team.departmentId === child.departmentId,
              ) ?? [];
            const agentOptions =
              agents[`${child.departmentId}|${child.teamId}`] ?? [];
            return (
              <fieldset className="ticket-coordination__child" key={child.key}>
                <legend>Teil-Ticket {index + 1}</legend>
                {children.length > 1 ? (
                  <button
                    aria-label={`Teil-Ticket ${index + 1} entfernen`}
                    className="icon-button ticket-coordination__remove"
                    onClick={() =>
                      setChildren((current) =>
                        current.filter((item) => item.key !== child.key),
                      )
                    }
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={15} />
                  </button>
                ) : null}
                <label>
                  Betreff
                  <input
                    aria-invalid={Boolean(errors.subject)}
                    maxLength={240}
                    onChange={(event) =>
                      change(child.key, { subject: event.target.value })
                    }
                    value={child.subject}
                  />
                  {errors.subject ? (
                    <small className="ticket-coordination__error">
                      {errors.subject}
                    </small>
                  ) : null}
                </label>
                <label>
                  Beschreibung
                  <textarea
                    aria-invalid={Boolean(errors.description)}
                    onChange={(event) =>
                      change(child.key, { description: event.target.value })
                    }
                    rows={4}
                    value={child.description}
                  />
                  {errors.description ? (
                    <small className="ticket-coordination__error">
                      {errors.description}
                    </small>
                  ) : null}
                </label>
                <div className="ticket-coordination__child-grid">
                  <label>
                    Abteilung
                    <select
                      aria-invalid={Boolean(errors.departmentId)}
                      disabled={!options}
                      onChange={(event) =>
                        change(child.key, { departmentId: event.target.value })
                      }
                      value={child.departmentId}
                    >
                      <option value="">Abteilung wählen</option>
                      {options?.departments.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    {errors.departmentId ? (
                      <small className="ticket-coordination__error">
                        {errors.departmentId}
                      </small>
                    ) : null}
                  </label>
                  <label>
                    Team
                    <select
                      disabled={!department?.canAssign || teams.length === 0}
                      onChange={(event) =>
                        change(child.key, { teamId: event.target.value })
                      }
                      value={child.teamId}
                    >
                      <option value="">Kein Team</option>
                      {teams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Person
                    <select
                      disabled={!department?.canAssign}
                      onChange={(event) =>
                        change(child.key, { agentId: event.target.value })
                      }
                      value={child.agentId}
                    >
                      <option value="">Nicht zugewiesen</option>
                      {agentOptions.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {department && !department.canAssign ? (
                  <small className="ticket-coordination__muted">
                    {tn(
                      "In dieser Abteilung darfst du nicht zuweisen; das Teil-Ticket landet in der Abteilungsqueue.",
                      "In dieser Abteilung dürfen Sie nicht zuweisen; das Teil-Ticket landet in der Abteilungsqueue.",
                    )}
                  </small>
                ) : null}
              </fieldset>
            );
          })}
          <div className="ticket-coordination__dialog-footer">
            <button
              className="secondary-button"
              disabled={children.length >= MAX_SPLIT_CHILDREN || saving}
              onClick={() => {
                keyRef.current += 1;
                setChildren((current) => [
                  ...current,
                  newSplitChild(String(keyRef.current), parent),
                ]);
              }}
              type="button"
            >
              <Plus aria-hidden="true" size={15} />
              Weiteres Teil-Ticket
            </button>
            <span className="ticket-coordination__actions">
              <button
                className="secondary-button"
                disabled={saving}
                onClick={onClose}
                type="button"
              >
                Abbrechen
              </button>
              <button
                className="primary-button"
                disabled={saving || !options}
                type="submit"
              >
                {saving ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="ticket-detail-spinner"
                    size={15}
                  />
                ) : null}
                {children.length === 1
                  ? "1 Teil-Ticket erstellen"
                  : `${children.length} Teil-Tickets erstellen`}
              </button>
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}

function VendorCaseDialog({
  tenantId,
  ticketId,
  vendors,
  canManageVendors,
  onClose,
  onOpened,
}: {
  tenantId: string;
  ticketId: string;
  vendors: Vendor[];
  canManageVendors: boolean;
  onClose: () => void;
  onOpened: (notice: string | null) => Promise<void>;
}) {
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [caseNumber, setCaseNumber] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const vendor = vendors.find((item) => item.id === vendorId);

  async function submit() {
    if (!vendorId) {
      setError(
        tn(
          "Bitte wähle einen Drittanbieter.",
          "Bitte wählen Sie einen Drittanbieter.",
        ),
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await invokeCoordination({
        type: "openVendorCase",
        tenantId,
        ticketId,
        vendorId,
        externalCaseNumber: caseNumber.trim() || null,
        note: note.trim() || null,
      });
      const data =
        isRecord(result) && isRecord(result.data) ? result.data : null;
      await onOpened(
        typeof data?.statusSkipped === "string"
          ? data.statusSkipped === "ticket_assignee_required"
            ? "Der Lieferantenfall wurde erfasst. Der Status bleibt «Neu», bis das Ticket einer Person zugewiesen ist."
            : "Der Lieferantenfall wurde erfasst. Der Status konnte nicht auf «Wartend auf Drittanbieter» gesetzt werden."
          : null,
      );
    } catch (nextError) {
      setError(
        await coordinationError(
          nextError,
          "Der Lieferantenfall konnte nicht erfasst werden.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="ticket-coordination__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
      role="presentation"
    >
      <div
        aria-labelledby="vendor-case-heading"
        aria-modal="true"
        className="ticket-coordination__dialog"
        role="dialog"
      >
        <div className="ticket-coordination__dialog-heading">
          <div>
            <p className="eyebrow">LIEFERANTENFALL</p>
            <h3 id="vendor-case-heading">An Drittanbieter übergeben</h3>
            <p className="ticket-coordination__muted">
              {tn(
                "Das Ticket wechselt auf «Wartend auf Drittanbieter». Ohne Rückmeldung wirst du automatisch erinnert.",
                "Das Ticket wechselt auf «Wartend auf Drittanbieter». Ohne Rückmeldung werden Sie automatisch erinnert.",
              )}
            </p>
          </div>
          <button
            aria-label="Dialog schliessen"
            className="more-button"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        {error ? (
          <p className="ticket-detail-message error" role="alert">
            <AlertCircle aria-hidden="true" size={17} />
            {error}
          </p>
        ) : null}
        {vendors.length === 0 ? (
          <p className="ticket-coordination__hint">
            Es sind noch keine Drittanbieter erfasst.{" "}
            {canManageVendors
              ? tn(
                  "Erfasse Drittanbieter in den Mandanteneinstellungen unter Automationen.",
                  "Erfassen Sie Drittanbieter in den Mandanteneinstellungen unter Automationen.",
                )
              : tn(
                  "Bitte wende dich an die Mandantenadministration.",
                  "Bitte wenden Sie sich an die Mandantenadministration.",
                )}
          </p>
        ) : (
          <form
            className="ticket-coordination__split-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label>
              Drittanbieter
              <select
                onChange={(event) => setVendorId(event.target.value)}
                value={vendorId}
              >
                {vendors.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              {vendor ? (
                <small className="ticket-coordination__muted">
                  Erinnerung nach {vendor.reminderAfterHours} Std. ohne
                  Rückmeldung
                </small>
              ) : null}
            </label>
            <label>
              Externe Fallnummer (optional)
              <input
                maxLength={120}
                onChange={(event) => setCaseNumber(event.target.value)}
                value={caseNumber}
              />
            </label>
            <label>
              Notiz (optional)
              <textarea
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                value={note}
              />
            </label>
            <div className="ticket-coordination__dialog-footer">
              <span />
              <span className="ticket-coordination__actions">
                <button
                  className="secondary-button"
                  disabled={saving}
                  onClick={onClose}
                  type="button"
                >
                  Abbrechen
                </button>
                <button
                  className="primary-button"
                  disabled={saving}
                  type="submit"
                >
                  Übergeben
                </button>
              </span>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
