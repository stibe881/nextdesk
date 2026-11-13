import { tn } from "./lib/formality";
import { useEffect, useState, type ReactNode } from "react";
import {
  FolderPlus,
  GitMerge,
  LoaderCircle,
  MessageSquareText,
} from "lucide-react";
import { supabase } from "./lib/supabase";

type ControlTool = "merge" | "case" | "supervisor";

type SupervisorCandidate = {
  userId: string;
  displayName: string;
  isManager: boolean;
};

type SupervisorRequest = {
  id: string;
  recipientId: string;
  question: string;
  answer: string | null;
  status: "open" | "answered";
  createdAt: string;
  answeredAt: string | null;
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("de-CH", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
}

/**
 * "Ticket steuern": merge the ticket into another one, open a case (problem)
 * from it, or ask a supervising agent. Each action opens its own small form.
 */
export function TicketControlPanel({
  tenantId,
  ticketId,
  ticketSubject,
  ticketDescription,
  departmentId,
  canMerge,
  canOpenCase,
  canAskSupervisor,
  mergeContent,
  onChanged,
}: {
  tenantId: string;
  ticketId: string;
  ticketSubject: string;
  ticketDescription: string;
  departmentId: string | null;
  canMerge: boolean;
  canOpenCase: boolean;
  canAskSupervisor: boolean;
  mergeContent: ReactNode;
  onChanged: () => void | Promise<void>;
}) {
  const tools: {
    key: ControlTool;
    label: string;
    hint: string;
    Icon: typeof GitMerge;
  }[] = [
    ...(canMerge
      ? [
          {
            key: "merge" as const,
            label: "Tickets zusammenführen",
            hint: "Dieses Ticket als Duplikat in ein Hauptticket überführen",
            Icon: GitMerge,
          },
        ]
      : []),
    ...(canOpenCase
      ? [
          {
            key: "case" as const,
            label: "Fall eröffnen",
            hint: "Aus diesem Ticket einen Fall (Problem) anlegen und verknüpfen",
            Icon: FolderPlus,
          },
        ]
      : []),
    ...(canAskSupervisor
      ? [
          {
            key: "supervisor" as const,
            label: "Vorgesetzte Person fragen",
            hint: "Frage stellen, die Antwort erscheint als interne Notiz",
            Icon: MessageSquareText,
          },
        ]
      : []),
  ];
  const [active, setActive] = useState<ControlTool | null>(null);

  if (tools.length === 0) {
    return (
      <p className="data-caption">
        Für dieses Ticket stehen keine Steuerungsaktionen zur Verfügung.
      </p>
    );
  }

  return (
    <div className="ticket-control">
      <div className="ticket-control__tiles" role="group" aria-label="Aktionen">
        {tools.map(({ key, label, hint, Icon }) => (
          <button
            aria-pressed={active === key}
            className="ticket-control__tile"
            key={key}
            onClick={() =>
              setActive((current) => (current === key ? null : key))
            }
            type="button"
          >
            <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
            <span>
              <strong>{label}</strong>
              <small>{hint}</small>
            </span>
          </button>
        ))}
      </div>
      {active === "merge" ? (
        <div className="ticket-control__panel">{mergeContent}</div>
      ) : null}
      {active === "case" ? (
        <div className="ticket-control__panel">
          <OpenCaseForm
            departmentId={departmentId}
            onChanged={onChanged}
            tenantId={tenantId}
            ticketDescription={ticketDescription}
            ticketId={ticketId}
            ticketSubject={ticketSubject}
          />
        </div>
      ) : null}
      {active === "supervisor" ? (
        <div className="ticket-control__panel">
          <SupervisorRequestForm onChanged={onChanged} ticketId={ticketId} />
        </div>
      ) : null}
    </div>
  );
}

function OpenCaseForm({
  tenantId,
  ticketId,
  ticketSubject,
  ticketDescription,
  departmentId,
  onChanged,
}: {
  tenantId: string;
  ticketId: string;
  ticketSubject: string;
  ticketDescription: string;
  departmentId: string | null;
  onChanged: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState(ticketSubject.slice(0, 240));
  const [description, setDescription] = useState(
    ticketDescription.slice(0, 50_000),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<string | null>(null);

  async function submit() {
    if (!supabase || saving) return;
    const cleanTitle = title.trim();
    if ([...cleanTitle].length < 3) {
      setError("Der Titel muss mindestens 3 Zeichen haben.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { data, error: createError } = await supabase.functions.invoke(
        "service-assets",
        {
          body: {
            type: "manageProblem",
            tenantId,
            operation: "create",
            title: cleanTitle,
            description,
            status: "open",
            workaround: null,
            rootCause: null,
            ownerId: null,
            ...(departmentId ? { departmentId } : {}),
          },
        },
      );
      if (createError) throw createError;
      const problemId = (data as { data?: { problem?: { id?: unknown } } })
        ?.data?.problem?.id;
      if (typeof problemId !== "string") throw new Error("invalid_problem");
      const { error: linkError } = await supabase.functions.invoke(
        "service-assets",
        {
          body: {
            type: "linkTicket",
            tenantId,
            ticketId,
            kind: "problem",
            targetId: problemId,
          },
        },
      );
      if (linkError) throw linkError;
      setCreated(cleanTitle);
      await onChanged();
    } catch {
      setError(
        tn(
          "Der Fall konnte nicht eröffnet werden. Prüfe, ob du Fälle verwalten darfst.",
          "Der Fall konnte nicht eröffnet werden. Prüfen Sie, ob Sie Fälle verwalten dürfen.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  if (created) {
    return (
      <p className="ticket-control__success" role="status">
        Der Fall «{created}» wurde eröffnet und mit diesem Ticket verknüpft.
      </p>
    );
  }

  return (
    <form
      className="ticket-control__form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3>Fall eröffnen</h3>
      <p className="data-caption">
        Ein Fall bündelt die Ursachenklärung für wiederkehrende oder grössere
        Störungen. Titel und Beschreibung sind aus dem Ticket übernommen.
      </p>
      <label>
        Titel
        <input
          disabled={saving}
          maxLength={240}
          onChange={(event) => setTitle(event.target.value)}
          required
          value={title}
        />
      </label>
      <label>
        Beschreibung
        <textarea
          disabled={saving}
          onChange={(event) => setDescription(event.target.value)}
          rows={5}
          value={description}
        />
      </label>
      {error ? (
        <p className="ticket-detail-message error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="ticket-detail-actions">
        <button className="primary-button" disabled={saving} type="submit">
          {saving ? (
            <LoaderCircle
              aria-hidden="true"
              className="ticket-detail-spinner"
              size={16}
            />
          ) : null}
          Fall eröffnen
        </button>
      </div>
    </form>
  );
}

function SupervisorRequestForm({
  ticketId,
  onChanged,
}: {
  ticketId: string;
  onChanged: () => void | Promise<void>;
}) {
  const [candidates, setCandidates] = useState<SupervisorCandidate[] | null>(
    null,
  );
  const [requests, setRequests] = useState<SupervisorRequest[]>([]);
  const [recipientId, setRecipientId] = useState("");
  const [question, setQuestion] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const client = supabase;
    void Promise.all([
      client.rpc("list_ticket_supervisor_candidates", {
        p_ticket_id: ticketId,
      }),
      client
        .from("ticket_supervisor_requests")
        .select(
          "id, recipient_id, question, answer, status, created_at, answered_at",
        )
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]).then(([candidateResult, requestResult]) => {
      if (!active) return;
      const rows = (candidateResult.data ?? []) as {
        user_id: string;
        display_name: string;
        is_manager: boolean | null;
      }[];
      const next = rows.map((row) => ({
        userId: row.user_id,
        displayName: row.display_name,
        isManager: row.is_manager === true,
      }));
      setCandidates(next);
      setRecipientId(
        (current) =>
          current || next.find((item) => item.isManager)?.userId || "",
      );
      setRequests(
        ((requestResult.data ?? []) as Record<string, unknown>[]).map(
          (row) => ({
            id: String(row.id),
            recipientId: String(row.recipient_id),
            question: String(row.question ?? ""),
            answer: typeof row.answer === "string" ? row.answer : null,
            status: row.status === "answered" ? "answered" : "open",
            createdAt: String(row.created_at),
            answeredAt:
              typeof row.answered_at === "string" ? row.answered_at : null,
          }),
        ),
      );
      if (candidateResult.error) {
        setError("Die Personen konnten nicht geladen werden.");
      }
    });
    return () => {
      active = false;
    };
  }, [ticketId, revision]);

  const nameOf = (userId: string) =>
    candidates?.find((item) => item.userId === userId)?.displayName ?? "Person";

  async function submit() {
    if (!supabase || saving) return;
    const text = question.trim();
    if (!recipientId) {
      setError(tn("Bitte wähle eine Person.", "Bitte wählen Sie eine Person."));
      return;
    }
    if (!text) {
      setError(
        tn("Bitte gib deine Frage ein.", "Bitte geben Sie Ihre Frage ein."),
      );
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    const { error: rpcError } = await supabase.rpc(
      "create_ticket_supervisor_request",
      {
        p_question: text,
        p_recipient_id: recipientId,
        p_ticket_id: ticketId,
      },
    );
    setSaving(false);
    if (rpcError) {
      setError("Die Anfrage konnte nicht gesendet werden.");
      return;
    }
    setQuestion("");
    setNotice(
      `Die Anfrage wurde an ${nameOf(recipientId)} gesendet und als interne Notiz vermerkt.`,
    );
    setRevision((current) => current + 1);
    await onChanged();
  }

  return (
    <form
      className="ticket-control__form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3>Vorgesetzte Person fragen</h3>
      <p className="data-caption">
        Die Person erhält eine Benachrichtigung und kann direkt dort antworten.
        Frage und Antwort werden als interne Notizen im Ticket festgehalten.
      </p>
      <label>
        Person
        <select
          disabled={saving || candidates === null}
          onChange={(event) => setRecipientId(event.target.value)}
          value={recipientId}
        >
          <option value="">
            {candidates === null
              ? "Wird geladen …"
              : candidates.length === 0
                ? "Keine Person verfügbar"
                : "Person wählen"}
          </option>
          {(candidates ?? []).map((candidate) => (
            <option key={candidate.userId} value={candidate.userId}>
              {candidate.displayName}
              {candidate.isManager ? " (Vorgesetzte Person)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        Frage
        <textarea
          disabled={saving}
          maxLength={4000}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={tn(
            "Was möchtest du wissen oder freigeben lassen?",
            "Was möchten Sie wissen oder freigeben lassen?",
          )}
          rows={4}
          value={question}
        />
      </label>
      {error ? (
        <p className="ticket-detail-message error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="ticket-control__success" role="status">
          {notice}
        </p>
      ) : null}
      <div className="ticket-detail-actions">
        <button
          className="primary-button"
          disabled={saving || !question.trim() || !recipientId}
          type="submit"
        >
          {saving ? (
            <LoaderCircle
              aria-hidden="true"
              className="ticket-detail-spinner"
              size={16}
            />
          ) : null}
          Anfrage senden
        </button>
      </div>
      {requests.length > 0 ? (
        <div className="ticket-control__requests">
          <p className="ticket-knowledge__label">Bisherige Anfragen</p>
          <ul>
            {requests.map((request) => (
              <li key={request.id}>
                <span>
                  <strong>{nameOf(request.recipientId)}</strong>
                  <small>
                    {formatDateTime(request.createdAt)} ·{" "}
                    {request.status === "answered" ? "Beantwortet" : "Offen"}
                  </small>
                </span>
                <span className="ticket-control__request-text">
                  {request.question}
                </span>
                {request.answer ? (
                  <span className="ticket-control__request-answer">
                    {request.answer}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
