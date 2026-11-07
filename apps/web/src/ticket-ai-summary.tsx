import { LoaderCircle, Sparkles, X } from "lucide-react";
import { useState } from "react";

import { supabase } from "./lib/supabase";

const ERRORS: Record<string, string> = {
  ai_purpose_not_approved:
    "Die KI ist für Zusammenfassungen in diesem Mandanten nicht freigegeben.",
  ai_provider_not_approved:
    "Die KI ist für diesen Mandanten nicht freigegeben.",
  ai_provider_not_configured: "Die KI-Anbindung ist nicht eingerichtet.",
  ai_budget_exceeded:
    "Das KI-Kontingent für diese Stunde ist aufgebraucht. Bitte später erneut versuchen.",
  ticket_not_found: "Das Ticket ist nicht verfügbar.",
};

/** Renders the small Markdown subset of the summary (headings and lists). */
function SummaryText({ markdown }: { markdown: string }) {
  const blocks: { heading: string; items: string[] }[] = [];
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      blocks.push({ heading: line.replace(/^#+\s*/, ""), items: [] });
      continue;
    }
    let current = blocks[blocks.length - 1];
    if (!current) {
      current = { heading: "", items: [] };
      blocks.push(current);
    }
    current.items.push(line.replace(/^[-*•]\s*/, ""));
  }
  return (
    <div className="ticket-ai-summary__body">
      {blocks.map((block, index) => (
        <section key={`${block.heading}-${index}`}>
          {block.heading ? <h4>{block.heading}</h4> : null}
          <ul>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{item.replace(/\*\*/g, "")}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * «Zusammenfassen»: a short AI summary of a long ticket for whoever takes it
 * over (stand-in, handover). Nothing is stored; the text stays on screen.
 */
export function TicketAiSummary({
  tenantId,
  ticketId,
}: {
  tenantId: string;
  ticketId: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [summary, setSummary] = useState<{
    title: string;
    summaryMarkdown: string;
  } | null>(null);
  const [error, setError] = useState("");

  async function summarize() {
    if (!supabase) return;
    setState("loading");
    setError("");
    const { data, error: invokeError } = await supabase.functions.invoke(
      "ai-assist",
      { body: { type: "summarizeTicket", tenantId, ticketId } },
    );
    if (invokeError) {
      let code = "";
      const context = (invokeError as { context?: unknown }).context;
      if (context instanceof Response) {
        const payload = (await context.json().catch(() => null)) as {
          error?: { code?: string };
        } | null;
        code = payload?.error?.code ?? "";
      }
      setError(
        ERRORS[code] ?? "Die Zusammenfassung ist im Moment nicht verfügbar.",
      );
      setState("error");
      return;
    }
    setSummary(
      (data as { data: { title: string; summaryMarkdown: string } }).data,
    );
    setState("done");
  }

  if (state === "done" && summary) {
    return (
      <aside aria-label="KI-Zusammenfassung" className="ticket-ai-summary">
        <header>
          <Sparkles aria-hidden="true" size={16} />
          <strong>{summary.title}</strong>
          <button
            aria-label="Zusammenfassung schliessen"
            className="ticket-ai-summary__close"
            onClick={() => setState("idle")}
            type="button"
          >
            <X aria-hidden="true" size={15} />
          </button>
        </header>
        <SummaryText markdown={summary.summaryMarkdown} />
        <p className="ticket-ai-summary__note">
          KI-generiert – bitte vor dem Weitergeben prüfen.
        </p>
      </aside>
    );
  }
  return (
    <div className="ticket-ai-summary__trigger">
      <button
        className="secondary-button"
        disabled={state === "loading"}
        onClick={() => void summarize()}
        type="button"
      >
        {state === "loading" ? (
          <LoaderCircle
            aria-hidden="true"
            className="ticket-detail-spinner"
            size={15}
          />
        ) : (
          <Sparkles aria-hidden="true" size={15} />
        )}
        {state === "loading" ? "Wird zusammengefasst …" : "Zusammenfassen"}
      </button>
      {state === "error" ? (
        <span className="ticket-ai-summary__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
