import { useCallback, useEffect, useState } from "react";
import { AlarmClockOff } from "lucide-react";
import { supabase } from "./lib/supabase";
import {
  SLA_BREACH_NOTE_MAX,
  SLA_BREACH_REASON_OPTIONS,
  breachesWithoutReason,
  describeBreachKinds,
  slaBreachKindLabel,
  validateReasonDraft,
  type SlaBreach,
  type SlaBreachReasonCode,
} from "./lib/sla-breach-reasons";
import "./ticket-sla-breach-reason.css";

type ListResult = { breaches: SlaBreach[]; canRecord: boolean };

async function invokeSlaBreachReasons(
  body: Record<string, unknown>,
): Promise<ListResult> {
  if (!supabase) throw new Error("Die Verbindung ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke(
    "sla-breach-reasons",
    { body },
  );
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = (await context.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (payload?.error?.message) throw new Error(payload.error.message);
    }
    throw new Error("Die SLA-Ursache konnte nicht verarbeitet werden.");
  }
  return (data as { data: ListResult }).data;
}

const dateTime = (value: string) =>
  new Intl.DateTimeFormat("de-CH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  }).format(new Date(value));

/**
 * Asks for the cause of an SLA breach. «prompt» appears in the ticket
 * sidebar while a breach has no reason; «closing» is shown inside the close
 * confirmation so the cause can be set right when resolving. After a reason
 * is saved, the recorded causes are listed compactly.
 */
export function TicketSlaBreachReason({
  tenantId,
  ticketId,
  variant = "prompt",
  refreshKey,
}: {
  tenantId: string;
  ticketId: string;
  variant?: "prompt" | "closing";
  refreshKey?: string | number;
}) {
  const [result, setResult] = useState<ListResult | null>(null);
  const [code, setCode] = useState<SlaBreachReasonCode | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    try {
      setResult(
        await invokeSlaBreachReasons({ type: "list", tenantId, ticketId }),
      );
    } catch {
      // Optional helper: hide on failure instead of disturbing the ticket.
      setResult(null);
    }
  }, [tenantId, ticketId]);

  useEffect(() => {
    setDismissed(false);
    setCode("");
    setNote("");
    setError("");
    void load();
  }, [load, refreshKey]);

  if (!result?.canRecord || result.breaches.length === 0) return null;
  const open = breachesWithoutReason(result.breaches);
  const recorded = result.breaches.filter((breach) => breach.reason);

  async function save() {
    const message = validateReasonDraft(code, note);
    if (message) {
      setError(message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      setResult(
        await invokeSlaBreachReasons({
          type: "record",
          tenantId,
          ticketId,
          reasonCode: code,
          note: note.trim() || null,
        }),
      );
      setCode("");
      setNote("");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Ursache konnte nicht gespeichert werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (open.length === 0) {
    if (variant === "closing") return null;
    return (
      <div className="sla-breach-reason sla-breach-reason--done">
        <AlarmClockOff aria-hidden="true" size={15} />
        <ul>
          {recorded.map((breach) => (
            <li key={breach.kind}>
              <strong>SLA {slaBreachKindLabel(breach.kind)} verletzt:</strong>{" "}
              {breach.reason?.label}
              {breach.reason?.note ? ` – ${breach.reason.note}` : ""}
              {breach.reason?.recordedByName
                ? ` (${breach.reason.recordedByName})`
                : ""}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (dismissed && variant === "prompt") return null;

  const fieldId = `sla-breach-reason-${variant}-${ticketId}`;
  return (
    <section
      aria-labelledby={`${fieldId}-title`}
      className={`sla-breach-reason sla-breach-reason--${variant}`}
    >
      <div className="sla-breach-reason__head">
        <AlarmClockOff aria-hidden="true" size={17} />
        <div>
          <strong id={`${fieldId}-title`}>
            {variant === "closing"
              ? "Ursache der SLA-Verletzung (optional)"
              : `SLA verletzt: ${describeBreachKinds(open)}`}
          </strong>
          <p>
            {open
              .map(
                (breach) =>
                  `${slaBreachKindLabel(breach.kind)} fällig ${dateTime(breach.dueAt)}`,
              )
              .join(" · ")}
            . Was war der Hauptgrund? Die Angabe fliesst in die Teamauswertung
            ein.
          </p>
        </div>
      </div>
      <div
        aria-label="Ursache"
        className="sla-breach-reason__options"
        role="radiogroup"
      >
        {SLA_BREACH_REASON_OPTIONS.map((option) => (
          <button
            aria-checked={code === option.code}
            className={code === option.code ? "is-active" : ""}
            disabled={busy}
            key={option.code}
            onClick={() => setCode(option.code)}
            role="radio"
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      <label className="sla-breach-reason__note" htmlFor={`${fieldId}-note`}>
        {code === "other" ? "Beschreibung (erforderlich)" : "Notiz (optional)"}
      </label>
      <input
        id={`${fieldId}-note`}
        maxLength={SLA_BREACH_NOTE_MAX}
        onChange={(event) => setNote(event.target.value)}
        placeholder="z. B. «Lieferant meldete sich erst nach 3 Tagen»"
        type="text"
        value={note}
      />
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="sla-breach-reason__actions">
        <button
          className="primary-button"
          disabled={busy || !code}
          onClick={() => void save()}
          type="button"
        >
          {busy ? "Wird gespeichert …" : "Ursache speichern"}
        </button>
        {variant === "prompt" ? (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => setDismissed(true)}
            type="button"
          >
            Später
          </button>
        ) : null}
      </div>
    </section>
  );
}
