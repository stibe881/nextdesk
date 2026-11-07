import { Check, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { supabase } from "./lib/supabase";
import "./ticket-ai-triage.css";

type Triage = {
  state: string;
  confidence?: number;
  reason?: string;
  applied?: string[];
  categoryName?: string | null;
  priorityLabel?: string | null;
  teamName?: string | null;
  assetName?: string | null;
};

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Die Verbindung ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("ticket-triage", {
    body,
  });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = (await context.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (payload?.error?.message) throw new Error(payload.error.message);
    }
    throw new Error("Die KI-Einordnung ist nicht verfügbar.");
  }
  return (data as { data: T }).data;
}

const APPLIED_LABEL: Record<string, string> = {
  category: "Kategorie",
  priority: "Priorität",
  team: "Team",
  asset: "Gerät",
};

/** Shows the AI triage of a ticket: open proposal (accept/dismiss) or what was applied. */
export function TicketAiTriage({
  tenantId,
  ticketId,
  canUpdate,
  onChanged,
}: {
  tenantId: string;
  ticketId: string;
  canUpdate: boolean;
  onChanged: () => void;
}) {
  const [triage, setTriage] = useState<Triage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await call<{ triage: Triage | null }>({
        type: "get",
        tenantId,
        ticketId,
      });
      setTriage(data.triage);
    } catch {
      setTriage(null);
    }
  }, [tenantId, ticketId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(type: "accept" | "dismiss") {
    setBusy(true);
    setError("");
    try {
      const data = await call<{ triage: Triage | null }>({
        type,
        tenantId,
        ticketId,
      });
      setTriage(data.triage);
      if (type === "accept") onChanged();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!triage || !["suggested", "applied"].includes(triage.state)) return null;
  const parts = [
    triage.categoryName ? `Kategorie ${triage.categoryName}` : null,
    triage.priorityLabel ? `Priorität ${triage.priorityLabel}` : null,
    triage.teamName ? `Team ${triage.teamName}` : null,
    triage.assetName ? `Gerät ${triage.assetName}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  const confidence = Math.round((triage.confidence ?? 0) * 100);

  return (
    <aside
      aria-label="KI-Einordnung"
      className={`ticket-ai-triage ticket-ai-triage--${triage.state}`}
    >
      <Sparkles aria-hidden="true" size={16} />
      <div>
        <strong>
          {triage.state === "applied"
            ? `KI hat eingeordnet (${(triage.applied ?? []).map((key) => APPLIED_LABEL[key] ?? key).join(", ") || "nichts geändert"})`
            : "KI-Vorschlag zur Einordnung"}
        </strong>
        <span>
          {parts.join(" · ")} · Sicherheit {confidence} %
        </span>
        {triage.reason ? <small>{triage.reason}</small> : null}
        {error ? (
          <small className="ticket-ai-triage__error">{error}</small>
        ) : null}
      </div>
      {triage.state === "suggested" && canUpdate ? (
        <span className="ticket-ai-triage__actions">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void decide("accept")}
            type="button"
          >
            <Check aria-hidden="true" size={14} /> Übernehmen
          </button>
          <button
            aria-label="Vorschlag verwerfen"
            className="icon-button"
            disabled={busy}
            onClick={() => void decide("dismiss")}
            type="button"
          >
            <X aria-hidden="true" size={15} />
          </button>
        </span>
      ) : null}
    </aside>
  );
}

/** Tenant setting: AI triage on intake and the confidence for automatic apply. */
export function TicketTriageSettings({ tenantId }: { tenantId: string }) {
  const [settings, setSettings] = useState<{
    enabled: boolean;
    applyThreshold: number;
  } | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void call<{ enabled: boolean; applyThreshold: number }>({
      type: "getSettings",
      tenantId,
    })
      .then(setSettings)
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : String(error)),
      );
  }, [tenantId]);

  async function save(next: { enabled: boolean; applyThreshold: number }) {
    setSettings(next);
    try {
      setSettings(await call({ type: "saveSettings", tenantId, ...next }));
      setMessage("Gespeichert.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="tenant-automation ticket-ai-triage-settings">
      <div className="tenant-automation__heading">
        <div>
          <p className="eyebrow">KI-TRIAGE</p>
          <h2>Neue Tickets automatisch einordnen</h2>
          <p>
            Die KI schlägt für neue Tickets Kategorie, Priorität, Team und das
            betroffene Gerät vor. Ab der eingestellten Sicherheit füllt sie
            leere Felder selbst aus, darunter entscheidet ein Mensch im Ticket.
            Voraussetzung ist die freigegebene KI-Unterstützung.
          </p>
        </div>
      </div>
      {settings ? (
        <div className="ticket-ai-triage-settings__form">
          <label className="tenant-automation__switch">
            <input
              checked={settings.enabled}
              onChange={(event) =>
                void save({ ...settings, enabled: event.target.checked })
              }
              type="checkbox"
            />
            <span>{settings.enabled ? "Eingeschaltet" : "Ausgeschaltet"}</span>
          </label>
          <label>
            Automatisch übernehmen ab{" "}
            {Math.round(settings.applyThreshold * 100)} % Sicherheit
            <input
              disabled={!settings.enabled}
              max={100}
              min={50}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  applyThreshold: Number(event.target.value) / 100,
                })
              }
              onMouseUp={() => void save(settings)}
              onKeyUp={() => void save(settings)}
              onTouchEnd={() => void save(settings)}
              step={5}
              type="range"
              value={Math.round(settings.applyThreshold * 100)}
            />
          </label>
        </div>
      ) : null}
      {message ? <p className="data-caption">{message}</p> : null}
    </section>
  );
}
