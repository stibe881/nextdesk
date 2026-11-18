import { tn } from "./lib/formality";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, LoaderCircle, Sparkles, X } from "lucide-react";
import { supabase } from "./lib/supabase";
import "./ticket-learning.css";

/*
 * Learning from solutions in the ticket detail:
 *  - TicketSolutionPrompt: after closing, offer to save the solution as a
 *    knowledge article (AI draft), never blocking the close.
 *  - TicketIncidentBanner: several similar tickets within a short time.
 *  - TicketListIncidentHint: possible incidents above the agent ticket list.
 *  - TicketPersonDevices: devices of the requesting / affected person.
 */

type Row = Record<string, unknown>;

function asRecord(value: unknown): Row | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Row)
    : null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function errorStatus(error: unknown): number | null {
  const value = asRecord(error);
  if (!value) return null;
  if (typeof value.status === "number") return value.status;
  const context = value.context;
  if (context instanceof Response) return context.status;
  const record = asRecord(context);
  return typeof record?.status === "number" ? record.status : null;
}

/** The German message of a function error response, when it has one. */
async function serverErrorMessage(error: unknown): Promise<string | null> {
  const context = asRecord(error)?.context;
  if (!(context instanceof Response)) return null;
  try {
    const body = asRecord(await context.clone().json());
    const message = asRecord(body?.error)?.message;
    return typeof message === "string" && message.trim()
      ? message.trim()
      : null;
  } catch {
    return null;
  }
}

async function invokeFunction(name: string, body: Row): Promise<Row | null> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw error;
  return asRecord(asRecord(data)?.data);
}

function shorten(value: string, length: number): string {
  const characters = [...value.trim()];
  return characters.length <= length
    ? characters.join("")
    : `${characters
        .slice(0, length - 2)
        .join("")
        .trimEnd()} …`;
}

// ---------------------------------------------------------------------------
// Close prompt

export function TicketSolutionPrompt({
  requestDraft,
  onOpenArticle,
  onDismiss,
}: {
  /** Existing ticket → article AI draft flow (ai-assist). */
  requestDraft: () => Promise<{ articleId: string }>;
  onOpenArticle?: ((articleId: string) => void) | undefined;
  onDismiss: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [createdArticleId, setCreatedArticleId] = useState<string | null>(null);

  async function createDraft() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const created = await requestDraft();
      if (onOpenArticle) {
        onOpenArticle(created.articleId);
        return;
      }
      setCreatedArticleId(created.articleId);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Der KI-Entwurf konnte nicht erstellt werden.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      aria-live="polite"
      className="ticket-learning-banner ticket-learning-banner--info"
      role="status"
    >
      <strong>
        <Sparkles aria-hidden="true" size={16} strokeWidth={1.8} />
        Lösung als Wissensartikel speichern?
      </strong>
      <p>
        {tn(
          "Das Ticket ist abgeschlossen und noch mit keinem Wissensartikel verknüpft. Die KI erstellt aus Betreff, Beschreibung und Verlauf einen internen Entwurf, den du prüfen und veröffentlichen kannst.",
          "Das Ticket ist abgeschlossen und noch mit keinem Wissensartikel verknüpft. Die KI erstellt aus Betreff, Beschreibung und Verlauf einen internen Entwurf, den Sie prüfen und veröffentlichen können.",
        )}
      </p>
      {createdArticleId ? (
        <p>
          Der KI-Entwurf wurde in der Wissensdatenbank angelegt und intern an
          dieses Ticket angehängt.
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="ticket-detail-actions">
        {createdArticleId ? null : (
          <button
            className="primary-button"
            disabled={pending}
            onClick={() => void createDraft()}
            type="button"
          >
            {pending ? (
              <LoaderCircle
                aria-hidden="true"
                className="ticket-detail-spinner"
                size={16}
              />
            ) : (
              <Sparkles aria-hidden="true" size={16} strokeWidth={1.8} />
            )}
            {pending ? "KI erstellt Entwurf …" : "KI-Entwurf erstellen"}
          </button>
        )}
        <button
          className="secondary-button"
          disabled={pending}
          onClick={onDismiss}
          type="button"
        >
          {createdArticleId ? "Schliessen" : "Nicht jetzt"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Incident hint

type IncidentTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
};

type DepartmentOption = { id: string; name: string };

type Incident = {
  windowHours: number;
  ticketCount: number;
  tickets: IncidentTicket[];
  departmentId: string | null;
  /** Department for "Fall erstellen" within the caller's asset scope. */
  problemDepartmentId: string | null;
  /** The caller's asset departments, offered when a choice is needed. */
  problemDepartments: DepartmentOption[];
  canCreateProblem: boolean;
  canPublishNotice: boolean;
};

function parseDepartmentOptions(value: unknown): DepartmentOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const department = asRecord(item);
    return department &&
      isUuid(department.id) &&
      typeof department.name === "string" &&
      department.name.trim()
      ? [{ id: department.id, name: department.name.trim() }]
      : [];
  });
}

export function parseIncident(value: Row | null): Incident | null {
  const incident = asRecord(value?.incident);
  if (!incident || !Array.isArray(incident.tickets)) return null;
  const tickets: IncidentTicket[] = [];
  for (const item of incident.tickets) {
    const ticket = asRecord(item);
    if (
      !ticket ||
      !isUuid(ticket.id) ||
      typeof ticket.ticketNumber !== "string" ||
      typeof ticket.subject !== "string"
    )
      return null;
    tickets.push({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
    });
  }
  if (
    typeof incident.windowHours !== "number" ||
    typeof incident.ticketCount !== "number" ||
    tickets.length === 0
  )
    return null;
  return {
    windowHours: incident.windowHours,
    ticketCount: incident.ticketCount,
    tickets,
    departmentId: isUuid(incident.departmentId) ? incident.departmentId : null,
    problemDepartmentId: isUuid(incident.problemDepartmentId)
      ? incident.problemDepartmentId
      : null,
    problemDepartments: parseDepartmentOptions(incident.problemDepartments),
    canCreateProblem: incident.canCreateProblem === true,
    canPublishNotice: incident.canPublishNotice === true,
  };
}

function incidentHeadline(incident: Incident): string {
  return `Möglicher Störfall: ${incident.ticketCount} ähnliche Tickets in den letzten ${
    incident.windowHours === 1 ? "Stunde" : `${incident.windowHours} Stunden`
  }`;
}

function incidentTicketList(incident: Incident): string {
  return incident.tickets
    .map((ticket) => `${ticket.ticketNumber} – ${ticket.subject}`)
    .join("\n");
}

export function TicketIncidentBanner({
  tenantId,
  ticketId,
  subject,
  refreshKey,
}: {
  tenantId: string;
  ticketId: string;
  subject: string;
  /** Changes when the ticket was reloaded. */
  refreshKey: string;
}) {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [pending, setPending] = useState<"problem" | "notice" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [problemCreated, setProblemCreated] = useState(false);
  const [noticePublished, setNoticePublished] = useState(false);
  const [noticeFormOpen, setNoticeFormOpen] = useState(false);
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeDescription, setNoticeDescription] = useState("");
  const [problemFormOpen, setProblemFormOpen] = useState(false);
  const [problemDepartmentId, setProblemDepartmentId] = useState("");
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++sequence.current;
    try {
      const next = parseIncident(
        await invokeFunction("ticket-operations", {
          type: "detectIncident",
          tenantId,
          ticketId,
        }),
      );
      if (requestId === sequence.current) setIncident(next);
    } catch {
      // The hint is optional: older deployments or a failed lookup hide it.
      if (requestId === sequence.current) setIncident(null);
    }
  }, [tenantId, ticketId]);

  useEffect(() => {
    void load();
    return () => {
      sequence.current += 1;
    };
  }, [load, refreshKey]);

  useEffect(() => {
    setDismissed(false);
    setProblemCreated(false);
    setNoticePublished(false);
    setNoticeFormOpen(false);
    setProblemFormOpen(false);
    setProblemDepartmentId("");
    setNotice("");
    setError("");
  }, [ticketId]);

  if (!incident || dismissed) return null;

  function startProblem() {
    if (!incident || pending) return;
    setError("");
    setNotice("");
    // The ticket's department is outside the caller's asset scope and there
    // are several to choose from: ask first.
    if (
      !incident.problemDepartmentId &&
      incident.problemDepartments.length > 1
    ) {
      setProblemDepartmentId("");
      setNoticeFormOpen(false);
      setProblemFormOpen(true);
      return;
    }
    void createProblem(incident.problemDepartmentId);
  }

  async function createProblem(departmentId: string | null) {
    if (!incident || pending) return;
    setPending("problem");
    setError("");
    setNotice("");
    try {
      const data = await invokeFunction("service-assets", {
        type: "manageProblem",
        operation: "create",
        tenantId,
        title: shorten(`Möglicher Störfall: ${subject}`, 240),
        description: `${incidentHeadline(incident)}.\n\nBetroffene Tickets:\n${incidentTicketList(incident)}`,
        status: "investigating",
        // Without a department the server uses the caller's only asset
        // department (or none) and explains when a choice is needed.
        ...(departmentId ? { departmentId } : {}),
      });
      const problemId = asRecord(data?.problem)?.id;
      if (!isUuid(problemId))
        throw new Error("Die Bestätigung zum Fall ist unvollständig.");
      const results = await Promise.allSettled(
        incident.tickets.map((ticket) =>
          invokeFunction("service-assets", {
            type: "linkTicket",
            tenantId,
            ticketId: ticket.id,
            kind: "problem",
            targetId: problemId,
          }),
        ),
      );
      const linked = results.filter(
        (result) =>
          result.status === "fulfilled" || errorStatus(result.reason) === 409,
      ).length;
      setProblemCreated(true);
      setProblemFormOpen(false);
      setNotice(
        linked === incident.tickets.length
          ? tn(
              `Der Fall wurde erstellt und mit ${linked} Tickets verknüpft. Du findest ihn unter „Fälle“.`,
              `Der Fall wurde erstellt und mit ${linked} Tickets verknüpft. Sie finden ihn unter „Fälle“.`,
            )
          : tn(
              `Der Fall wurde erstellt und mit ${linked} von ${incident.tickets.length} Tickets verknüpft. Für die übrigen Tickets fehlt dir die Berechtigung oder sie sind nicht mehr verfügbar.`,
              `Der Fall wurde erstellt und mit ${linked} von ${incident.tickets.length} Tickets verknüpft. Für die übrigen Tickets fehlt Ihnen die Berechtigung oder sie sind nicht mehr verfügbar.`,
            ),
      );
    } catch (nextError) {
      const status = errorStatus(nextError);
      const message = await serverErrorMessage(nextError);
      setError(
        message ??
          (status === 403
            ? tn(
                "Du bist nicht berechtigt, Fälle zu erstellen.",
                "Sie sind nicht berechtigt, Fälle zu erstellen.",
              )
            : status === 400 || status === 422
              ? tn(
                  "Der Fall konnte für diese Abteilung nicht erstellt werden. Bitte erstelle ihn unter „Fälle“.",
                  "Der Fall konnte für diese Abteilung nicht erstellt werden. Bitte erstellen Sie ihn unter „Fälle“.",
                )
              : tn(
                  "Der Fall konnte nicht erstellt werden. Bitte versuche es erneut.",
                  "Der Fall konnte nicht erstellt werden. Bitte versuchen Sie es erneut.",
                )),
      );
    } finally {
      setPending(null);
    }
  }

  function openNoticeForm() {
    if (!incident) return;
    setNoticeTitle(shorten(`Störung: ${subject}`, 240));
    setNoticeDescription(
      tn(
        "Wir haben mehrere Meldungen zu dieser Störung erhalten und prüfen die Ursache. Du musst kein weiteres Ticket erstellen; wir informieren dich hier über den Stand.",
        "Wir haben mehrere Meldungen zu dieser Störung erhalten und prüfen die Ursache. Sie müssen kein weiteres Ticket erstellen; wir informieren Sie hier über den Stand.",
      ),
    );
    setNoticeFormOpen(true);
    setProblemFormOpen(false);
    setError("");
    setNotice("");
  }

  async function publishNotice() {
    if (!incident || pending) return;
    const title = noticeTitle.trim();
    const description = noticeDescription.trim();
    if ([...title].length < 3 || [...title].length > 240) {
      setError("Der Titel muss zwischen 3 und 240 Zeichen lang sein.");
      return;
    }
    if ([...description].length < 3 || [...description].length > 10_000) {
      setError(
        "Die Beschreibung muss zwischen 3 und 10'000 Zeichen lang sein.",
      );
      return;
    }
    setPending("notice");
    setError("");
    try {
      await invokeFunction("agent-workbench", {
        type: "saveIncidentNotice",
        tenantId,
        title,
        description,
        status: "investigating",
        categoryId: null,
        departmentId: incident.departmentId,
      });
      setNoticePublished(true);
      setNoticeFormOpen(false);
      setNotice(
        "Die Störungsmeldung ist veröffentlicht und für anfragende Personen im Portal sichtbar.",
      );
    } catch (nextError) {
      const message = await serverErrorMessage(nextError);
      setError(
        message ??
          (errorStatus(nextError) === 403
            ? tn(
                "Du bist nicht berechtigt, Störungsmeldungen zu veröffentlichen.",
                "Sie sind nicht berechtigt, Störungsmeldungen zu veröffentlichen.",
              )
            : tn(
                "Die Störungsmeldung konnte nicht veröffentlicht werden. Bitte versuche es erneut.",
                "Die Störungsmeldung konnte nicht veröffentlicht werden. Bitte versuchen Sie es erneut.",
              )),
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <section
      aria-label="Möglicher Störfall"
      className="ticket-learning-banner"
      role="status"
    >
      <strong>
        <AlertCircle aria-hidden="true" size={16} strokeWidth={1.8} />
        {incidentHeadline(incident)}
      </strong>
      <details>
        <summary>Tickets anzeigen</summary>
        <ul>
          {incident.tickets.map((ticket) => (
            <li key={ticket.id}>
              {ticket.ticketNumber} – {ticket.subject}
            </li>
          ))}
        </ul>
      </details>
      {notice ? <p>{notice}</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {noticeFormOpen ? (
        <form
          className="ticket-learning-form"
          onSubmit={(event) => {
            event.preventDefault();
            void publishNotice();
          }}
        >
          <label>
            Titel der Störungsmeldung
            <input
              disabled={pending !== null}
              maxLength={240}
              minLength={3}
              onChange={(event) => setNoticeTitle(event.target.value)}
              required
              value={noticeTitle}
            />
          </label>
          <label>
            Text für anfragende Personen
            <textarea
              disabled={pending !== null}
              maxLength={10_000}
              minLength={3}
              onChange={(event) => setNoticeDescription(event.target.value)}
              required
              rows={3}
              value={noticeDescription}
            />
          </label>
          <div className="ticket-detail-actions">
            <button
              className="primary-button"
              disabled={pending !== null}
              type="submit"
            >
              {pending === "notice" ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={16}
                />
              ) : null}
              Veröffentlichen
            </button>
            <button
              className="secondary-button"
              disabled={pending !== null}
              onClick={() => setNoticeFormOpen(false)}
              type="button"
            >
              Abbrechen
            </button>
          </div>
        </form>
      ) : problemFormOpen ? (
        <form
          className="ticket-learning-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!problemDepartmentId) {
              setError(
                tn(
                  "Bitte wähle eine Abteilung.",
                  "Bitte wählen Sie eine Abteilung.",
                ),
              );
              return;
            }
            void createProblem(problemDepartmentId);
          }}
        >
          <label>
            Abteilung des Falls
            <select
              disabled={pending !== null}
              onChange={(event) => setProblemDepartmentId(event.target.value)}
              required
              value={problemDepartmentId}
            >
              <option value="">Bitte wählen</option>
              {incident.problemDepartments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <div className="ticket-detail-actions">
            <button
              className="primary-button"
              disabled={pending !== null}
              type="submit"
            >
              {pending === "problem" ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={16}
                />
              ) : null}
              Fall erstellen
            </button>
            <button
              className="secondary-button"
              disabled={pending !== null}
              onClick={() => setProblemFormOpen(false)}
              type="button"
            >
              Abbrechen
            </button>
          </div>
        </form>
      ) : (
        <div className="ticket-detail-actions">
          {incident.canCreateProblem && !problemCreated ? (
            <button
              className="secondary-button"
              disabled={pending !== null}
              onClick={startProblem}
              type="button"
            >
              {pending === "problem" ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="ticket-detail-spinner"
                  size={16}
                />
              ) : null}
              Fall erstellen und Tickets verknüpfen
            </button>
          ) : null}
          {incident.canPublishNotice && !noticePublished ? (
            <button
              className="secondary-button"
              disabled={pending !== null}
              onClick={openNoticeForm}
              type="button"
            >
              Störungsmeldung veröffentlichen
            </button>
          ) : null}
          <button
            aria-label="Hinweis auf möglichen Störfall ausblenden"
            className="secondary-button"
            disabled={pending !== null}
            onClick={() => setDismissed(true)}
            type="button"
          >
            <X aria-hidden="true" size={16} strokeWidth={1.8} />
            Ausblenden
          </button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Incident hint above the ticket list

export type ListIncident = {
  subject: string;
  ticketCount: number;
  ticketIds: string[];
};

/** Polling interval of the list hint (at most every two minutes). */
export const INCIDENT_OVERVIEW_POLL_MS = 120_000;

export function parseIncidentOverview(
  value: Row | null,
): { windowHours: number; incidents: ListIncident[] } | null {
  if (
    !value ||
    typeof value.windowHours !== "number" ||
    !Array.isArray(value.incidents)
  )
    return null;
  const incidents: ListIncident[] = [];
  for (const item of value.incidents) {
    const incident = asRecord(item);
    if (
      !incident ||
      typeof incident.subject !== "string" ||
      typeof incident.ticketCount !== "number" ||
      !Array.isArray(incident.ticketIds)
    )
      return null;
    const ticketIds = incident.ticketIds.filter(isUuid);
    if (ticketIds.length === 0) continue;
    incidents.push({
      subject: incident.subject,
      ticketCount: incident.ticketCount,
      ticketIds,
    });
  }
  return { windowHours: value.windowHours, incidents };
}

export function listIncidentHeadline(
  incident: ListIncident,
  windowHours: number,
): string {
  return `Möglicher Störfall: «${shorten(incident.subject, 120)}» – ${
    incident.ticketCount
  } ähnliche Tickets in den letzten ${
    windowHours === 1 ? "Stunde" : `${windowHours} Stunden`
  }`;
}

/**
 * Possible incidents (clusters of similar tickets from the last hours) above
 * the agent ticket list. Polled at most every two minutes while the page is
 * visible; failures hide the hint.
 */
export function TicketListIncidentHint({
  tenantId,
  onShowTickets,
}: {
  tenantId: string;
  onShowTickets: (incident: ListIncident, label: string) => void;
}) {
  const [overview, setOverview] = useState<{
    tenantId: string;
    windowHours: number;
    incidents: ListIncident[];
  } | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const sequence = useRef(0);

  useEffect(() => {
    setOverview(null);
    setDismissed([]);
    let lastLoad = 0;
    const load = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (Date.now() - lastLoad < INCIDENT_OVERVIEW_POLL_MS - 1000) return;
      lastLoad = Date.now();
      const requestId = ++sequence.current;
      void invokeFunction("ticket-operations", {
        type: "incidentOverview",
        tenantId,
      })
        .then((data) => {
          const parsed = parseIncidentOverview(data);
          if (requestId === sequence.current)
            setOverview(parsed ? { tenantId, ...parsed } : null);
        })
        .catch(() => {
          // Optional hint: older deployments or a failed lookup hide it.
          if (requestId === sequence.current) setOverview(null);
        });
    };
    load();
    const timer = window.setInterval(load, INCIDENT_OVERVIEW_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      sequence.current += 1;
    };
  }, [tenantId]);

  if (!overview || overview.tenantId !== tenantId) return null;
  const visible = overview.incidents.filter(
    (incident) => !dismissed.includes(incident.ticketIds[0] ?? ""),
  );
  if (visible.length === 0) return null;

  return (
    <section
      aria-label="Mögliche Störfälle"
      className="ticket-learning-banner ticket-learning-banner--list"
      role="status"
    >
      {visible.map((incident) => {
        const headline = listIncidentHeadline(incident, overview.windowHours);
        return (
          <div
            className="ticket-learning-list-incident"
            key={incident.ticketIds[0]}
          >
            <strong>
              <AlertCircle aria-hidden="true" size={16} strokeWidth={1.8} />
              {headline}
            </strong>
            <div className="ticket-learning-list-incident__actions">
              <button
                className="text-button"
                onClick={() =>
                  onShowTickets(
                    incident,
                    `Möglicher Störfall: «${shorten(incident.subject, 80)}»`,
                  )
                }
                type="button"
              >
                Tickets anzeigen
              </button>
              <button
                aria-label={`Hinweis «${shorten(incident.subject, 80)}» ausblenden`}
                className="ticket-toast-dismiss"
                onClick={() =>
                  setDismissed((current) => [
                    ...current,
                    incident.ticketIds[0] ?? "",
                  ])
                }
                title="Ausblenden"
                type="button"
              >
                <X aria-hidden="true" size={16} strokeWidth={1.8} />
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Devices of the requesting / affected person

type PersonDevice = {
  id: string;
  name: string;
  assetTag: string | null;
  details: string[];
  fromIntune: boolean;
};

export function parsePersonDevices(value: Row | null): PersonDevice[] | null {
  if (!value || !Array.isArray(value.devices)) return null;
  const devices: PersonDevice[] = [];
  for (const item of value.devices) {
    const device = asRecord(item);
    if (!device || !isUuid(device.id) || typeof device.name !== "string")
      return null;
    const text = (field: unknown) =>
      typeof field === "string" && field.trim() ? field.trim() : null;
    devices.push({
      id: device.id,
      name: device.name,
      assetTag: text(device.asset_tag),
      details: [
        [text(device.manufacturer), text(device.model)]
          .filter(Boolean)
          .join(" "),
        text(device.operating_system) ?? "",
      ].filter((entry) => entry.length > 0),
      fromIntune:
        Array.isArray(device.sources) && device.sources.includes("intune"),
    });
  }
  return devices;
}

export function TicketPersonDevices({
  tenantId,
  ticketId,
  refreshKey,
  onOpenAsset,
}: {
  tenantId: string;
  ticketId: string;
  refreshKey: string;
  /** Opens the asset list filtered to the device. */
  onOpenAsset?: ((query: string) => void) | undefined;
}) {
  const [devices, setDevices] = useState<PersonDevice[]>([]);
  const sequence = useRef(0);

  useEffect(() => {
    const requestId = ++sequence.current;
    setDevices([]);
    void (async () => {
      try {
        const next = parsePersonDevices(
          await invokeFunction("asset-registry", {
            type: "ticketPersonDevices",
            tenantId,
            ticketId,
          }),
        );
        if (requestId === sequence.current) setDevices(next ?? []);
      } catch {
        // Module off, no permission or older deployment: hide the section.
        if (requestId === sequence.current) setDevices([]);
      }
    })();
    return () => {
      sequence.current += 1;
    };
  }, [tenantId, ticketId, refreshKey]);

  if (devices.length === 0) return null;

  return (
    <div>
      <dt>Geräte der Person</dt>
      <dd>
        <div
          aria-label="Geräte der anfragenden oder betroffenen Person"
          className="ticket-overview-linked-catalog"
        >
          <ul>
            {devices.map((device) => (
              <li key={device.id}>
                <span>{device.fromIntune ? "Intune" : "Zugewiesen"}</span>
                {onOpenAsset ? (
                  <button
                    className="ticket-learning-link"
                    onClick={() => onOpenAsset(device.assetTag ?? device.name)}
                    title="Asset öffnen"
                    type="button"
                  >
                    {device.name}
                  </button>
                ) : (
                  <strong>{device.name}</strong>
                )}
                {device.assetTag || device.details.length > 0 ? (
                  <small>
                    {[
                      device.assetTag ? `Kennung: ${device.assetTag}` : "",
                      ...device.details,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </dd>
    </div>
  );
}
