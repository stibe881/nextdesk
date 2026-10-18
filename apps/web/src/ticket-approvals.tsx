import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  Check,
  ChevronDown,
  ClipboardCheck,
  LoaderCircle,
  X,
} from "lucide-react";
import { supabase } from "./lib/supabase";

type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";
type Decision = "approved" | "rejected";
type ApprovalDecision = {
  id: string;
  approverId: string;
  approverName: string;
  decision: Decision;
  comment: string | null;
  decidedAt: string;
};
type Approval = {
  id: string;
  approvalKind: string;
  status: ApprovalStatus;
  requiredApprovals: number;
  requestedBy: string;
  requestedByName: string;
  reason: string;
  requestedAt: string;
  decidedAt: string | null;
  decisions: ApprovalDecision[];
};
type ApprovalPayload = {
  canRequest: boolean;
  canDecide: boolean;
  approvals: Approval[];
};
type ApprovalAction =
  | { type: "list"; tenantId: string; ticketId: string }
  | {
      type: "request";
      tenantId: string;
      ticketId: string;
      approvalKind: string;
      reason: string;
      requiredApprovals: number;
    }
  | {
      type: "decide";
      tenantId: string;
      ticketId: string;
      approvalId: string;
      decision: Decision;
      comment?: string;
    }
  | { type: "cancel"; tenantId: string; ticketId: string; approvalId: string };

const APPROVAL_KIND_LABELS: Record<string, string> = {
  access: "Zugriff",
  change: "Änderung",
  exception: "Ausnahme",
  purchase: "Beschaffung",
  other: "Sonstiges",
};
const STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: "Ausstehend",
  approved: "Freigegeben",
  rejected: "Abgelehnt",
  cancelled: "Abgebrochen",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function messageFor(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Die Freigabeaktion konnte nicht abgeschlossen werden.";
}
function formatDateTime(value: string | null) {
  if (!value) return "–";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? "–"
    : new Intl.DateTimeFormat("de-CH", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(parsed);
}

async function invokeApprovalAction(action: ApprovalAction): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("ticket-approvals", {
    body: action,
  });
  if (error) throw error;
  if (!isRecord(data)) throw new Error("Ungültige Antwort der Freigabe-API.");
  if (isRecord(data.error)) {
    throw new Error(
      typeof data.error.code === "string"
        ? `Freigabeaktion nicht möglich (${data.error.code}).`
        : "Die Freigabeaktion wurde abgelehnt.",
    );
  }
  return data.data;
}

function parsePayload(value: unknown): ApprovalPayload {
  if (!isRecord(value) || !Array.isArray(value.approvals)) {
    throw new Error("Ungültige Freigabeantwort.");
  }
  return {
    canRequest: value.canRequest === true,
    canDecide: value.canDecide === true,
    approvals: value.approvals.filter(
      (approval): approval is Approval =>
        isRecord(approval) &&
        typeof approval.id === "string" &&
        typeof approval.approvalKind === "string" &&
        typeof approval.status === "string" &&
        typeof approval.requiredApprovals === "number" &&
        typeof approval.requestedBy === "string" &&
        typeof approval.requestedByName === "string" &&
        typeof approval.reason === "string" &&
        typeof approval.requestedAt === "string" &&
        Array.isArray(approval.decisions),
    ),
  };
}

export function TicketApprovals({
  tenantId,
  ticketId,
}: {
  tenantId: string;
  ticketId: string;
}) {
  const [payload, setPayload] = useState<ApprovalPayload | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [kind, setKind] = useState("change");
  const [reason, setReason] = useState("");
  const [requiredApprovals, setRequiredApprovals] = useState(1);
  const [expanded, setExpanded] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [result, userResult] = await Promise.all([
        invokeApprovalAction({ type: "list", tenantId, ticketId }),
        supabase?.auth.getUser(),
      ]);
      setPayload(parsePayload(result));
      setCurrentUserId(userResult?.data.user?.id ?? null);
    } catch (nextError) {
      setPayload(null);
      setError(messageFor(nextError));
    } finally {
      setLoading(false);
    }
  }, [tenantId, ticketId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = useMemo(
    () =>
      payload?.approvals.filter((approval) => approval.status === "pending")
        .length ?? 0,
    [payload],
  );

  async function requestApproval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) {
      setError("Bitte begründe die Freigabe mit mindestens drei Zeichen.");
      return;
    }
    setPendingId("request");
    setError("");
    try {
      await invokeApprovalAction({
        type: "request",
        tenantId,
        ticketId,
        approvalKind: kind,
        reason: trimmedReason,
        requiredApprovals,
      });
      setReason("");
      setRequiredApprovals(1);
      setExpanded(false);
      await load();
    } catch (nextError) {
      setError(messageFor(nextError));
    } finally {
      setPendingId(null);
    }
  }

  async function decide(approvalId: string, decision: Decision) {
    const comment = window.prompt(
      decision === "approved"
        ? "Optionaler Kommentar zur Freigabe"
        : "Optionaler Grund für die Ablehnung",
      "",
    );
    if (comment === null) return;
    setPendingId(`${decision}:${approvalId}`);
    setError("");
    try {
      await invokeApprovalAction({
        type: "decide",
        tenantId,
        ticketId,
        approvalId,
        decision,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      await load();
    } catch (nextError) {
      setError(messageFor(nextError));
    } finally {
      setPendingId(null);
    }
  }

  async function cancel(approvalId: string) {
    if (!window.confirm("Diese offene Freigabe wirklich abbrechen?")) return;
    setPendingId(`cancel:${approvalId}`);
    setError("");
    try {
      await invokeApprovalAction({
        type: "cancel",
        tenantId,
        ticketId,
        approvalId,
      });
      await load();
    } catch (nextError) {
      setError(messageFor(nextError));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section
      className="ticket-approvals"
      aria-labelledby="ticket-approvals-heading"
    >
      <button
        aria-expanded={expanded}
        className="ticket-approvals__heading"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span className="ticket-approvals__heading-copy">
          <span className="eyebrow">FREIGABEN</span>
          <span id="ticket-approvals-heading">Freigaben</span>
        </span>
        <span className="ticket-approvals__heading-actions">
          {pendingCount > 0 && (
            <span className="data-caption">{pendingCount} offen</span>
          )}
          <ChevronDown
            aria-hidden="true"
            className={expanded ? "is-open" : ""}
            size={18}
          />
        </span>
      </button>

      {expanded && (
        <div className="ticket-approvals__content">
          {error && (
            <p className="ticket-detail-message error" role="alert">
              {error}
            </p>
          )}
          {loading ? (
            <p className="ticket-detail-loading" role="status">
              <LoaderCircle
                aria-hidden="true"
                className="ticket-detail-spinner"
                size={18}
              />
              Freigaben werden geladen …
            </p>
          ) : (
            <>
              {payload?.canRequest && (
                <form
                  className="ticket-approvals__request"
                  onSubmit={requestApproval}
                >
                  <div className="ticket-approvals__request-heading">
                    <ClipboardCheck aria-hidden="true" size={18} />
                    <strong>Freigabe anfordern</strong>
                  </div>
                  <div className="ticket-approvals__form-grid">
                    <label>
                      Art
                      <select
                        disabled={pendingId !== null}
                        onChange={(event) => setKind(event.target.value)}
                        value={kind}
                      >
                        {Object.entries(APPROVAL_KIND_LABELS).map(
                          ([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      Benötigte Freigaben
                      <select
                        disabled={pendingId !== null}
                        onChange={(event) =>
                          setRequiredApprovals(Number(event.target.value))
                        }
                        value={requiredApprovals}
                      >
                        {[1, 2, 3, 4, 5].map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    Begründung
                    <textarea
                      disabled={pendingId !== null}
                      maxLength={2000}
                      minLength={3}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Weshalb ist diese Freigabe erforderlich?"
                      required
                      value={reason}
                    />
                  </label>
                  <button
                    className="secondary-button"
                    disabled={pendingId !== null}
                    type="submit"
                  >
                    {pendingId === "request" ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="ticket-detail-spinner"
                        size={16}
                      />
                    ) : (
                      <ClipboardCheck aria-hidden="true" size={16} />
                    )}
                    Freigabe anfordern
                  </button>
                </form>
              )}

              {!payload?.canRequest && !payload?.approvals.length ? (
                <p className="empty-state">
                  Für dieses Ticket liegen keine Freigaben vor.
                </p>
              ) : null}

              {payload?.approvals.length ? (
                <ol className="ticket-approvals__list">
                  {payload.approvals.map((approval) => {
                    const ownDecision = approval.decisions.some(
                      (decision) => decision.approverId === currentUserId,
                    );
                    const canDecide =
                      approval.status === "pending" &&
                      payload.canDecide &&
                      approval.requestedBy !== currentUserId &&
                      !ownDecision;
                    const canCancel =
                      approval.status === "pending" &&
                      (approval.requestedBy === currentUserId ||
                        payload.canRequest);
                    const approvedCount = approval.decisions.filter(
                      (decision) => decision.decision === "approved",
                    ).length;
                    return (
                      <li className="ticket-approvals__item" key={approval.id}>
                        <div className="ticket-approvals__meta">
                          <div>
                            <strong>
                              {APPROVAL_KIND_LABELS[approval.approvalKind] ??
                                approval.approvalKind}
                            </strong>
                            <span>
                              Beantragt von {approval.requestedByName} ·{" "}
                              {formatDateTime(approval.requestedAt)}
                            </span>
                          </div>
                          <span
                            className={`ticket-approvals__status ticket-approvals__status--${approval.status}`}
                          >
                            {STATUS_LABELS[approval.status]}
                          </span>
                        </div>
                        <p>{approval.reason}</p>
                        <p className="data-caption">
                          {approvedCount} von {approval.requiredApprovals}{" "}
                          benötigten Freigaben erteilt
                        </p>
                        {approval.decisions.length > 0 && (
                          <ul className="ticket-approvals__decisions">
                            {approval.decisions.map((entry) => (
                              <li key={entry.id}>
                                <span
                                  className={
                                    entry.decision === "approved"
                                      ? "is-approved"
                                      : "is-rejected"
                                  }
                                >
                                  {entry.decision === "approved"
                                    ? "Freigegeben"
                                    : "Abgelehnt"}
                                </span>
                                <strong>{entry.approverName}</strong>
                                <span>{formatDateTime(entry.decidedAt)}</span>
                                {entry.comment && <em>„{entry.comment}“</em>}
                              </li>
                            ))}
                          </ul>
                        )}
                        {(canDecide || canCancel) && (
                          <div className="ticket-approvals__actions">
                            {canDecide && (
                              <>
                                <button
                                  className="primary-button"
                                  disabled={pendingId !== null}
                                  onClick={() =>
                                    void decide(approval.id, "approved")
                                  }
                                  type="button"
                                >
                                  {pendingId === `approved:${approval.id}` ? (
                                    <LoaderCircle
                                      aria-hidden="true"
                                      className="ticket-detail-spinner"
                                      size={16}
                                    />
                                  ) : (
                                    <Check aria-hidden="true" size={16} />
                                  )}
                                  Freigeben
                                </button>
                                <button
                                  className="secondary-button"
                                  disabled={pendingId !== null}
                                  onClick={() =>
                                    void decide(approval.id, "rejected")
                                  }
                                  type="button"
                                >
                                  <X aria-hidden="true" size={16} /> Ablehnen
                                </button>
                              </>
                            )}
                            {canCancel && (
                              <button
                                className="text-button"
                                disabled={pendingId !== null}
                                onClick={() => void cancel(approval.id)}
                                type="button"
                              >
                                Freigabe abbrechen
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              ) : null}
            </>
          )}
        </div>
      )}
    </section>
  );
}
