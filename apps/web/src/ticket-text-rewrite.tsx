import { LoaderCircle, Sparkles, Undo2 } from "lucide-react";
import { useState } from "react";

import { supabase } from "./lib/supabase";

export type RewriteLength = "short" | "detailed";

const ERRORS: Record<string, string> = {
  ai_feature_disabled:
    "Die KI-Unterstützung ist für diesen Mandanten nicht aktiviert.",
  ai_provider_not_approved:
    "Die KI-Unterstützung ist für diesen Mandanten noch nicht freigegeben.",
  ai_purpose_not_approved:
    "Die KI-Unterstützung für Textentwürfe ist noch nicht freigegeben.",
  ai_budget_exceeded:
    "Das stündliche KI-Kontingent ist erreicht. Bitte später erneut versuchen.",
  ai_provider_rate_limited:
    "Der KI-Dienst ist gerade ausgelastet. Bitte in einer Minute erneut versuchen.",
  ai_provider_not_configured: "Die KI-Anbindung ist noch nicht eingerichtet.",
};

async function errorCode(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (!(context instanceof Response)) return "";
  try {
    const body = (await context.clone().json()) as {
      error?: { code?: unknown };
    };
    return typeof body.error?.code === "string" ? body.error.code : "";
  } catch {
    return "";
  }
}

/**
 * «Mit KI umformulieren»: lets the AI rewrite the text just written, short or
 * detailed, always professional, personal and friendly. The original stays
 * available until the next change («Original wiederherstellen»).
 */
export function TicketTextRewrite({
  audience,
  disabled,
  onApply,
  tenantId,
  text,
}: {
  audience: "customer" | "internal";
  disabled?: boolean;
  onApply: (text: string) => void;
  tenantId: string;
  text: string;
}) {
  const [pending, setPending] = useState<RewriteLength | null>(null);
  const [error, setError] = useState("");
  const [original, setOriginal] = useState<string | null>(null);
  const blocked = Boolean(disabled) || pending !== null || text.trim().length < 2;

  async function rewrite(length: RewriteLength) {
    if (!supabase || blocked) return;
    setPending(length);
    setError("");
    const source = text;
    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        "ai-assist",
        {
          body: { type: "polishText", tenantId, text: source, audience, length },
        },
      );
      if (invokeError) {
        const code = await errorCode(invokeError);
        setError(
          ERRORS[code] ??
            "Der Text konnte nicht umformuliert werden. Bitte versuchen Sie es erneut.",
        );
        return;
      }
      const result = (data as { data?: { text?: unknown } } | null)?.data?.text;
      if (typeof result !== "string" || !result.trim()) {
        setError("Die KI hat keinen Text geliefert. Bitte erneut versuchen.");
        return;
      }
      setOriginal(source);
      onApply(result.trim());
    } finally {
      setPending(null);
    }
  }

  return (
    <div
      aria-label="Text mit KI umformulieren"
      className="ticket-rewrite"
      role="group"
    >
      <span className="ticket-rewrite__label">
        <Sparkles aria-hidden="true" size={15} strokeWidth={1.8} />
        Mit KI umformulieren
      </span>
      {(
        [
          ["short", "Kurz"],
          ["detailed", "Ausführlich"],
        ] as const
      ).map(([length, label]) => (
        <button
          className="ticket-rewrite__button"
          disabled={blocked}
          key={length}
          onClick={() => void rewrite(length)}
          title={
            length === "short"
              ? "Knapp und auf den Punkt, freundlich"
              : "Vollständig und gut erklärt, freundlich"
          }
          type="button"
        >
          {pending === length ? (
            <LoaderCircle
              aria-hidden="true"
              className="ticket-detail-spinner"
              size={14}
            />
          ) : null}
          {label}
        </button>
      ))}
      {original !== null ? (
        <button
          className="ticket-rewrite__undo"
          disabled={Boolean(disabled) || pending !== null}
          onClick={() => {
            onApply(original);
            setOriginal(null);
          }}
          type="button"
        >
          <Undo2 aria-hidden="true" size={14} strokeWidth={1.8} />
          Original wiederherstellen
        </button>
      ) : null}
      {error ? (
        <p className="ticket-rewrite__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
