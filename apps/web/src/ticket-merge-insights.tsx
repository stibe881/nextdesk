import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  Copy,
  GitMerge,
  LoaderCircle,
  Paperclip,
  Undo2,
  Users,
} from "lucide-react";

import { supabase } from "./lib/supabase";
import { functionErrorMessage } from "./lib/function-error";
import { confirmDialog } from "./app-dialog";
import {
  parseMergePreview,
  type MergePreview,
} from "./lib/ticket-merge-preview";

export { parseMergePreview, type MergePreview };

export type MergedTicketComment = {
  id: string;
  visibility: "external" | "internal";
  body: string;
  createdAt: string;
  authorName: string | null;
};

export type MergedTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  createdAt: string;
  mergedAt: string | null;
  requesterName: string | null;
  comments: MergedTicketComment[];
  attachments: { id: string; fileName: string; size: number }[];
};

export type MergeInsights = {
  mergedTickets: MergedTicket[];
  affectedPeople: number;
  mergedInto: { id: string; ticketNumber: string; subject: string } | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/** Liest die Zusatzfelder aus der Antwort von `getTicket` (fehlen bei älteren Functions). */
export function parseMergeInsights(data: unknown): MergeInsights {
  const record = asRecord(data);
  const mergedTickets: MergedTicket[] = [];
  for (const item of Array.isArray(record?.mergedTickets)
    ? record.mergedTickets
    : []) {
    const row = asRecord(item);
    const id = text(row?.id);
    const ticketNumber = text(row?.ticketNumber);
    if (!row || !id || !ticketNumber) continue;
    mergedTickets.push({
      id,
      ticketNumber,
      subject: text(row.subject) ?? "",
      createdAt: text(row.createdAt) ?? "",
      mergedAt: text(row.mergedAt),
      requesterName: text(row.requesterName),
      comments: (Array.isArray(row.comments) ? row.comments : []).flatMap(
        (entry) => {
          const comment = asRecord(entry);
          const commentId = text(comment?.id);
          if (!comment || !commentId) return [];
          return [
            {
              id: commentId,
              visibility:
                comment.visibility === "internal" ? "internal" : "external",
              body: text(comment.body) ?? "",
              createdAt: text(comment.createdAt) ?? "",
              authorName: text(comment.authorName),
            } satisfies MergedTicketComment,
          ];
        },
      ),
      attachments: (Array.isArray(row.attachments)
        ? row.attachments
        : []
      ).flatMap((entry) => {
        const attachment = asRecord(entry);
        const attachmentId = text(attachment?.id);
        if (!attachment || !attachmentId) return [];
        return [
          {
            id: attachmentId,
            fileName: text(attachment.fileName) ?? "Anhang",
            size: typeof attachment.size === "number" ? attachment.size : 0,
          },
        ];
      }),
    });
  }
  const into = asRecord(record?.mergedInto);
  return {
    mergedTickets,
    affectedPeople:
      typeof record?.affectedPeople === "number"
        ? Math.max(1, record.affectedPeople)
        : 1,
    mergedInto:
      into && text(into.id) && text(into.ticketNumber)
        ? {
            id: String(into.id),
            ticketNumber: String(into.ticketNumber),
            subject: text(into.subject) ?? "",
          }
        : null,
  };
}

async function ticketOperation(
  body: Record<string, unknown>,
): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("ticket-operations", {
    body,
  });
  if (error) throw error;
  return asRecord(data)?.data ?? null;
}

function formatDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("de-CH", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} Std. ${rest} Min.` : `${hours} Std.`;
}

/** Lädt die Vorschau zu einer geplanten Zusammenführung. */
export async function loadMergePreview(
  tenantId: string,
  ticketId: string,
  ticketIds: string[],
  primaryTicketId: string | null,
): Promise<MergePreview | null> {
  return parseMergePreview(
    await ticketOperation({
      type: "mergePreview",
      tenantId,
      ticketId,
      ticketIds,
      primaryTicketId,
    }),
  );
}

/**
 * Zusammenfassung vor dem Bestätigen: was ins Haupt-Ticket übernommen wird
 * und wer eine Mail erhält.
 */
export function MergePreviewSummary({ preview }: { preview: MergePreview }) {
  const primary = preview.tickets.find(
    (ticket) => ticket.id === preview.primaryId,
  );
  if (!primary) return null;
  const others = preview.tickets.filter(
    (ticket) => ticket.id !== preview.primaryId && !ticket.mergedInto,
  );
  const highest = [primary, ...others].reduce((best, ticket) =>
    (ticket.prioritySort ?? -1) > (best.prioritySort ?? -1) ? ticket : best,
  );
  const dueDates = [primary, ...others]
    .map((ticket) => ticket.resolutionDueAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  const people = new Set(
    [primary, ...others].map(
      (ticket) => ticket.requesterEmail ?? ticket.requesterName ?? ticket.id,
    ),
  );
  const minutes = others.reduce((sum, ticket) => sum + ticket.timeMinutes, 0);
  const checklist = others.reduce(
    (sum, ticket) => sum + ticket.openChecklistItems,
    0,
  );
  const mails = others.filter((ticket) => ticket.mailChannel).length;
  const agent =
    primary.assignedAgentName ??
    others.find((ticket) => ticket.assignedAgentName)?.assignedAgentName;
  const team =
    primary.teamName ?? others.find((ticket) => ticket.teamName)?.teamName;
  return (
    <ul className="ticket-merge-preview">
      <li>
        <strong>Haupt-Ticket:</strong> {primary.ticketNumber} –{" "}
        {primary.subject}
      </li>
      <li>
        <strong>Priorität danach:</strong> {highest.priorityLabel ?? "–"}
        {highest.id !== primary.id ? " (höchste übernommen)" : ""}
      </li>
      {dueDates[0] ? (
        <li>
          <strong>Lösungsfrist danach:</strong> {formatDateTime(dueDates[0])}
        </li>
      ) : null}
      {agent || team ? (
        <li>
          <strong>Zuständig:</strong>{" "}
          {[agent, team].filter(Boolean).join(" · ")}
        </li>
      ) : null}
      <li>
        <strong>Betroffene Personen:</strong> {people.size}
      </li>
      {minutes > 0 || checklist > 0 ? (
        <li>
          <strong>Wird verschoben:</strong>{" "}
          {[
            minutes > 0 ? `${formatMinutes(minutes)} erfasste Zeit` : "",
            checklist > 0 ? `${checklist} offene Checklistenpunkte` : "",
          ]
            .filter(Boolean)
            .join(", ")}
        </li>
      ) : null}
      <li>
        <strong>Info-Mail:</strong>{" "}
        {mails > 0
          ? `${mails} ${mails === 1 ? "Person erhält" : "Personen erhalten"} eine Mail mit dem Hinweis auf ${primary.ticketNumber}`
          : "keine (kein Mail-Ticket betroffen)"}
      </li>
    </ul>
  );
}

/** Pille «N Personen betroffen» für den Kopf des Tickets. */
export function AffectedPeopleBadge({ count }: { count: number }) {
  if (count < 2) return null;
  return (
    <span
      className="ticket-affected-badge"
      title="Anzahl verschiedener Personen in diesem und den zusammengeführten Tickets"
    >
      <Users aria-hidden="true" size={14} />
      {count} Personen betroffen
    </span>
  );
}

/** Hinweis auf einem zusammengeführten Ticket mit «Zusammenführung aufheben». */
export function MergedIntoBanner({
  tenantId,
  ticketId,
  mergedInto,
  canUnmerge,
  onOpenTicket,
  onChanged,
}: {
  tenantId: string;
  ticketId: string;
  mergedInto: MergeInsights["mergedInto"];
  canUnmerge: boolean;
  onOpenTicket?: ((ticketId: string) => void) | undefined;
  onChanged: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (!mergedInto) return null;
  const target = mergedInto;

  async function unmerge() {
    const confirmed = await confirmDialog(
      `Zusammenführung aufheben? Das Ticket wird wieder eigenständig geöffnet. Verschobene Zeiten und Checklistenpunkte kommen aus ${target.ticketNumber} zurück.`,
      { confirmLabel: "Aufheben" },
    );
    if (!confirmed) return;
    setPending(true);
    setError("");
    try {
      await ticketOperation({ type: "unmerge", tenantId, ticketId });
      await onChanged();
    } catch (nextError) {
      setError(
        await functionErrorMessage(
          nextError,
          "Die Zusammenführung konnte nicht aufgehoben werden.",
        ),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="ticket-detail-message warning ticket-merge-banner"
      role="status"
    >
      <GitMerge aria-hidden="true" size={17} />
      <span>
        Zusammengeführt in{" "}
        {onOpenTicket ? (
          <button
            className="text-button"
            onClick={() => onOpenTicket(target.id)}
            type="button"
          >
            {target.ticketNumber}
          </button>
        ) : (
          <strong>{target.ticketNumber}</strong>
        )}{" "}
        ({target.subject}). Die Bearbeitung läuft dort weiter.
        {error ? (
          <span className="ticket-merge-banner__error" role="alert">
            {" "}
            {error}
          </span>
        ) : null}
      </span>
      {canUnmerge ? (
        <button
          className="secondary-button"
          disabled={pending}
          onClick={() => void unmerge()}
          type="button"
        >
          {pending ? (
            <LoaderCircle
              aria-hidden="true"
              className="ticket-detail-spinner"
              size={16}
            />
          ) : (
            <Undo2 aria-hidden="true" size={16} />
          )}
          Zusammenführung aufheben
        </button>
      ) : null}
    </div>
  );
}

type DuplicateCandidate = {
  id: string;
  ticketNumber: string;
  subject: string;
  createdAt: string;
  sameRequester: boolean;
  sameSubject: boolean;
};

/**
 * Vorschläge für mögliche Duplikate: gleiche Person in den letzten Tagen
 * oder gleicher Betreff. Mit Vorschau und Zusammenführen in dieses Ticket.
 */
export function DuplicateSuggestions({
  tenantId,
  ticketId,
  refreshKey,
  onOpenTicket,
  onChanged,
}: {
  tenantId: string;
  ticketId: string;
  refreshKey: string;
  onOpenTicket?: ((ticketId: string) => void) | undefined;
  onChanged: () => void | Promise<void>;
}) {
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);

  useEffect(() => {
    const requestId = ++sequence.current;
    setSelected(null);
    setPreview(null);
    void ticketOperation({ type: "duplicateCandidates", tenantId, ticketId })
      .then((data) => {
        if (requestId !== sequence.current) return;
        const list = asRecord(data)?.candidates;
        setCandidates(
          (Array.isArray(list) ? list : []).flatMap((item) => {
            const row = asRecord(item);
            const id = text(row?.id);
            const ticketNumber = text(row?.ticketNumber);
            if (!row || !id || !ticketNumber) return [];
            return [
              {
                id,
                ticketNumber,
                subject: text(row.subject) ?? "",
                createdAt: text(row.createdAt) ?? "",
                sameRequester: row.sameRequester === true,
                sameSubject: row.sameSubject === true,
              },
            ];
          }),
        );
      })
      .catch(() => {
        // Die Vorschläge sind optional (z. B. ältere Function).
        if (requestId === sequence.current) setCandidates([]);
      });
  }, [tenantId, ticketId, refreshKey]);

  useEffect(() => setDismissed([]), [ticketId]);

  const visible = candidates.filter((item) => !dismissed.includes(item.id));
  if (!visible.length) return null;

  async function choose(candidateId: string) {
    setSelected(candidateId);
    setPreview(null);
    setError("");
    try {
      setPreview(
        await loadMergePreview(
          tenantId,
          ticketId,
          [ticketId, candidateId],
          ticketId,
        ),
      );
    } catch (nextError) {
      setError(
        await functionErrorMessage(
          nextError,
          "Die Vorschau konnte nicht geladen werden.",
        ),
      );
    }
  }

  async function merge(candidateId: string) {
    setPending(true);
    setError("");
    try {
      await ticketOperation({
        type: "markMerged",
        tenantId,
        ticketId: candidateId,
        primaryTicketId: ticketId,
      });
      setSelected(null);
      setPreview(null);
      setCandidates((current) =>
        current.filter((item) => item.id !== candidateId),
      );
      await onChanged();
    } catch (nextError) {
      setError(
        await functionErrorMessage(
          nextError,
          "Die Tickets konnten nicht zusammengeführt werden.",
        ),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="ticket-duplicates-heading"
      className="ticket-duplicate-suggestions"
    >
      <p
        className="ticket-duplicate-suggestions__title"
        id="ticket-duplicates-heading"
      >
        <Copy aria-hidden="true" size={16} />
        Mögliche Duplikate
      </p>
      <ul>
        {visible.map((candidate) => (
          <li key={candidate.id}>
            <div className="ticket-duplicate-suggestions__row">
              <span>
                {onOpenTicket ? (
                  <button
                    className="text-button"
                    onClick={() => onOpenTicket(candidate.id)}
                    type="button"
                  >
                    {candidate.ticketNumber}
                  </button>
                ) : (
                  <strong>{candidate.ticketNumber}</strong>
                )}{" "}
                {candidate.subject}
                <small>
                  {[
                    candidate.sameRequester ? "gleiche Person" : "",
                    candidate.sameSubject ? "gleicher Betreff" : "",
                    formatDateTime(candidate.createdAt),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </span>
              <span className="ticket-duplicate-suggestions__actions">
                <button
                  className="secondary-button"
                  disabled={pending}
                  onClick={() => void choose(candidate.id)}
                  type="button"
                >
                  <GitMerge aria-hidden="true" size={15} />
                  Hierhin zusammenführen
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    setDismissed((current) => [...current, candidate.id])
                  }
                  type="button"
                >
                  Kein Duplikat
                </button>
              </span>
            </div>
            {selected === candidate.id ? (
              <div className="ticket-duplicate-suggestions__confirm">
                {preview ? (
                  <MergePreviewSummary preview={preview} />
                ) : !error ? (
                  <p className="data-caption" role="status">
                    Vorschau wird geladen …
                  </p>
                ) : null}
                <div className="ticket-detail-actions">
                  <button
                    className="primary-button"
                    disabled={pending || !preview}
                    onClick={() => void merge(candidate.id)}
                    type="button"
                  >
                    {pending ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="ticket-detail-spinner"
                        size={16}
                      />
                    ) : null}
                    Zusammenführen bestätigen
                  </button>
                  <button
                    className="secondary-button"
                    disabled={pending}
                    onClick={() => {
                      setSelected(null);
                      setPreview(null);
                    }}
                    type="button"
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p className="ticket-detail-message error" role="alert">
          <AlertCircle aria-hidden="true" size={17} />
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Verlauf und Anhänge der Tickets, die in dieses Ticket zusammengeführt wurden. */
export function MergedTicketsSection({
  mergedTickets,
  onOpenTicket,
}: {
  mergedTickets: MergedTicket[];
  onOpenTicket?: ((ticketId: string) => void) | undefined;
}) {
  if (!mergedTickets.length) return null;
  return (
    <section
      aria-labelledby="ticket-merged-heading"
      className="ticket-detail-comments ticket-merged-tickets"
    >
      <div className="ticket-detail-section-heading">
        <div>
          <p className="eyebrow">ZUSAMMENGEFÜHRT</p>
          <h3 id="ticket-merged-heading">
            Zusammengeführte Tickets ({mergedTickets.length})
          </h3>
        </div>
      </div>
      {mergedTickets.map((merged) => (
        <details className="ticket-merged-tickets__item" key={merged.id}>
          <summary>
            <span>
              <strong>{merged.ticketNumber}</strong> {merged.subject}
              <small>
                {[
                  merged.requesterName ? `von ${merged.requesterName}` : "",
                  merged.mergedAt
                    ? `zusammengeführt ${formatDateTime(merged.mergedAt)}`
                    : formatDateTime(merged.createdAt),
                  merged.comments.length
                    ? `${merged.comments.length} Beiträge`
                    : "",
                  merged.attachments.length
                    ? `${merged.attachments.length} Anhänge`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </span>
            <ChevronDown aria-hidden="true" size={16} />
          </summary>
          {merged.comments.length ? (
            <ol className="ticket-comment-list">
              {merged.comments.map((comment) => (
                <li
                  className={
                    comment.visibility === "internal"
                      ? "ticket-comment internal"
                      : "ticket-comment"
                  }
                  key={comment.id}
                >
                  <div className="ticket-comment-meta">
                    <strong>
                      {comment.authorName ??
                        merged.requesterName ??
                        "Anfragende Person"}
                    </strong>
                    <span>
                      {comment.visibility === "internal"
                        ? "Interne Notiz · "
                        : ""}
                      {formatDateTime(comment.createdAt)}
                    </span>
                  </div>
                  <p className="ticket-merged-tickets__body">{comment.body}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="data-caption">Keine Beiträge.</p>
          )}
          {merged.attachments.length ? (
            <ul className="ticket-merged-tickets__attachments">
              {merged.attachments.map((attachment) => (
                <li key={attachment.id}>
                  <Paperclip aria-hidden="true" size={14} />
                  {attachment.fileName}
                </li>
              ))}
            </ul>
          ) : null}
          {onOpenTicket ? (
            <button
              className="text-button"
              onClick={() => onOpenTicket(merged.id)}
              type="button"
            >
              {merged.ticketNumber} öffnen (Anhänge herunterladen)
            </button>
          ) : null}
        </details>
      ))}
    </section>
  );
}
