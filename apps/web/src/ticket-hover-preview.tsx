import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "./lib/supabase";
import "./ticket-hover-preview.css";

type Preview = {
  description: string;
  lastComment: {
    body: string;
    internal: boolean;
    createdAt: string;
  } | null;
};

const cache = new Map<string, Preview | null>();
const SHOW_DELAY_MS = 450;
const MAX_CHARS = 420;

/** Shortens text for the preview and strips simple markup. */
export function previewText(value: string, max = MAX_CHARS): string {
  const plain = value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

async function loadPreview(ticketId: string): Promise<Preview | null> {
  if (cache.has(ticketId)) return cache.get(ticketId) ?? null;
  if (!supabase) return null;
  const [ticket, comment] = await Promise.all([
    supabase
      .from("tickets")
      .select("description")
      .eq("id", ticketId)
      .maybeSingle(),
    supabase
      .from("ticket_comments")
      .select("body, visibility, created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const preview: Preview | null = ticket.data
    ? {
        description: String(ticket.data.description ?? ""),
        lastComment: comment.data
          ? {
              body: String(comment.data.body ?? ""),
              internal: comment.data.visibility === "internal",
              createdAt: String(comment.data.created_at),
            }
          : null,
      }
    : null;
  cache.set(ticketId, preview);
  return preview;
}

/**
 * Hover preview for ticket rows and Kanban cards: after a short pause the
 * description and the latest comment appear next to the element, so a ticket
 * can be judged without opening it. Only for devices with a real pointer.
 */
export function useTicketHoverPreview() {
  const [state, setState] = useState<{
    ticketId: string;
    title: string;
    rect: DOMRect;
    preview: Preview | null | "loading";
  } | null>(null);
  const timer = useRef<number | null>(null);
  const active = useRef<string | null>(null);

  const hide = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    active.current = null;
    setState(null);
  }, []);

  useEffect(() => {
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("scroll", hide, true);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [hide]);

  const bind = useCallback(
    (ticketId: string, title: string) => ({
      onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
        if (!window.matchMedia?.("(hover: hover)").matches) return;
        const element = event.currentTarget;
        if (timer.current) window.clearTimeout(timer.current);
        active.current = ticketId;
        timer.current = window.setTimeout(() => {
          if (active.current !== ticketId) return;
          const rect = element.getBoundingClientRect();
          setState({ ticketId, title, rect, preview: "loading" });
          void loadPreview(ticketId)
            .catch(() => null)
            .then((preview) => {
              if (active.current === ticketId) {
                setState((current) =>
                  current?.ticketId === ticketId
                    ? { ...current, preview }
                    : current,
                );
              }
            });
        }, SHOW_DELAY_MS);
      },
      onMouseLeave: hide,
      onMouseDown: hide,
    }),
    [hide],
  );

  const overlay = state ? <PreviewCard {...state} /> : null;
  return { bind, overlay };
}

function PreviewCard({
  title,
  rect,
  preview,
}: {
  title: string;
  rect: DOMRect;
  preview: Preview | null | "loading";
}) {
  const width = 340;
  const spaceRight = window.innerWidth - rect.right;
  const left =
    spaceRight > width + 16
      ? rect.right + 8
      : Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const below = spaceRight > width + 16 ? rect.top : rect.bottom + 6;
  const top = Math.max(8, Math.min(below, window.innerHeight - 260));
  return (
    <div
      aria-hidden="true"
      className="ticket-hover-preview"
      style={{ left, top, width }}
    >
      <strong>{title}</strong>
      {preview === "loading" ? (
        <p className="ticket-hover-preview__muted">Wird geladen …</p>
      ) : preview === null ? (
        <p className="ticket-hover-preview__muted">Keine Vorschau verfügbar.</p>
      ) : (
        <>
          <p>{previewText(preview.description) || "Keine Beschreibung."}</p>
          {preview.lastComment ? (
            <div className="ticket-hover-preview__comment">
              <span>
                {preview.lastComment.internal
                  ? "Interne Notiz"
                  : "Letzte Antwort"}{" "}
                ·{" "}
                {new Date(preview.lastComment.createdAt).toLocaleString(
                  "de-CH",
                  {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  },
                )}
              </span>
              <p>{previewText(preview.lastComment.body, 240)}</p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
