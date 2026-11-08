import { useCallback, useEffect, useState, type DragEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { supabase } from "./lib/supabase";
import "./my-priorities.css";

export type PriorityItem = {
  position: number;
  id: string;
  ticketNumber: string;
  subject: string;
  statusLabel: string;
  priorityLabel: string;
  resolutionDueAt: string | null;
  reason: string | null;
  aiRank: number | null;
  manual: boolean;
};
type PriorityList = {
  rankedAt: string | null;
  source: "ai" | "rules" | null;
  hasManualOrder: boolean;
  tickets: PriorityItem[];
};

async function call(body: Record<string, unknown>): Promise<PriorityList> {
  if (!supabase) throw new Error("Die Verbindung ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("my-priorities", {
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
    throw new Error("Die Prioritäten konnten nicht geladen werden.");
  }
  return (data as { data: PriorityList }).data;
}

const time = (value: string) =>
  new Intl.DateTimeFormat("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Zurich",
  }).format(new Date(value));

/**
 * «Meine Prioritäten»: the AI orders the tickets assigned to me; I can move
 * them by drag and drop or with the arrow buttons.
 */
export function MyPrioritiesCard({
  tenantId,
  onOpenTicket,
  refreshKey = 0,
  limit = 8,
}: {
  tenantId: string;
  onOpenTicket: (ticketId: string) => void;
  refreshKey?: number;
  limit?: number;
}) {
  const [list, setList] = useState<PriorityList | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"refresh" | "save" | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await call({ type: "list", tenantId }));
      setError("");
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function run(kind: "refresh" | "save", body: Record<string, unknown>) {
    setBusy(kind);
    try {
      setList(await call({ tenantId, ...body }));
      setError("");
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setBusy(null);
    }
  }

  function saveOrder(ids: string[]) {
    if (!list) return;
    // Show the new order right away.
    const byId = new Map(list.tickets.map((ticket) => [ticket.id, ticket]));
    setList({
      ...list,
      hasManualOrder: true,
      tickets: ids.map((id, index) => ({
        ...byId.get(id)!,
        position: index + 1,
        manual: true,
      })),
    });
    void run("save", { type: "reorder", ticketIds: ids });
  }

  function move(id: string, direction: -1 | 1) {
    if (!list) return;
    const ids = list.tickets.map((ticket) => ticket.id);
    const index = ids.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    saveOrder(ids);
  }

  function onDrop(event: DragEvent<HTMLLIElement>, targetId: string) {
    event.preventDefault();
    if (!list || !dragId || dragId === targetId) return;
    const ids = list.tickets
      .map((ticket) => ticket.id)
      .filter((id) => id !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    setDragId(null);
    saveOrder(ids);
  }

  const tickets = list?.tickets ?? [];
  const visible = expanded ? tickets : tickets.slice(0, limit);

  return (
    <article className="panel my-priorities">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">
            <Sparkles aria-hidden="true" size={12} /> KI-Reihenfolge
          </p>
          <h2>Meine Prioritäten</h2>
        </div>
        <div className="my-priorities__actions">
          {list?.hasManualOrder ? (
            <button
              className="icon-button"
              disabled={busy !== null}
              onClick={() => void run("refresh", { type: "resetManual" })}
              title="Eigene Reihenfolge verwerfen"
              type="button"
            >
              <RotateCcw aria-hidden="true" size={15} />
              <span className="sr-only">Eigene Reihenfolge verwerfen</span>
            </button>
          ) : null}
          <button
            className="secondary-button"
            disabled={busy !== null}
            onClick={() =>
              void run("refresh", { type: "refresh", resetManual: false })
            }
            type="button"
          >
            <Sparkles aria-hidden="true" size={14} />
            {busy === "refresh" ? "Wird priorisiert …" : "Neu priorisieren"}
          </button>
        </div>
      </div>
      {list?.rankedAt ? (
        <p className="data-caption">
          {list.source === "ai"
            ? "Von der KI priorisiert"
            : "Nach SLA, Priorität und Wartezeit sortiert"}{" "}
          um {time(list.rankedAt)}
          {list.hasManualOrder ? " · Ihre Anpassungen haben Vorrang" : ""}
        </p>
      ) : null}
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
      {!list ? (
        <p className="empty-state">Prioritäten werden geladen …</p>
      ) : tickets.length === 0 ? (
        <p className="empty-state">
          Ihnen sind keine offenen Tickets zugewiesen.
        </p>
      ) : (
        <ol className="my-priorities__list">
          {visible.map((ticket, index) => (
            <li
              className={[
                "my-priorities__item",
                dragId === ticket.id ? "is-dragging" : "",
              ].join(" ")}
              draggable={busy === null}
              key={ticket.id}
              onDragEnd={() => setDragId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDragStart={(event) => {
                setDragId(ticket.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDrop={(event) => onDrop(event, ticket.id)}
            >
              <span aria-hidden="true" className="my-priorities__grip">
                <GripVertical size={14} />
              </span>
              <span className="my-priorities__rank">{ticket.position}</span>
              <button
                className="my-priorities__ticket"
                onClick={() => onOpenTicket(ticket.id)}
                type="button"
              >
                <span className="my-priorities__number">
                  {ticket.ticketNumber}
                </span>
                <strong>{ticket.subject}</strong>
                <small>
                  {ticket.manual ? "Eigene Einordnung · " : ""}
                  {ticket.reason ?? ticket.priorityLabel}
                </small>
              </button>
              <span className="my-priorities__move">
                <button
                  aria-label={`${ticket.ticketNumber} nach oben`}
                  className="my-priorities__move-button"
                  disabled={busy !== null || index === 0}
                  onClick={() => move(ticket.id, -1)}
                  type="button"
                >
                  <ArrowUp aria-hidden="true" size={14} />
                </button>
                <button
                  aria-label={`${ticket.ticketNumber} nach unten`}
                  className="my-priorities__move-button"
                  disabled={busy !== null || ticket.position === tickets.length}
                  onClick={() => move(ticket.id, 1)}
                  type="button"
                >
                  <ArrowDown aria-hidden="true" size={14} />
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {tickets.length > limit ? (
        <button
          className="text-button"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded ? "Weniger anzeigen" : `Alle ${tickets.length} anzeigen`}
        </button>
      ) : null}
    </article>
  );
}
