import { useCallback, useEffect, useRef, useState } from "react";

import { deleteMobileTicket } from "@/lib/mobile-ticket-actions";
import type { MobileTicket } from "@/lib/nextdesk-tickets";

const UNDO_WINDOW_MS = 6000;

/**
 * Löscht ein Ticket erst nach einer kurzen Rückgängig-Frist. Das Ticket wird
 * sofort ausgeblendet; die eigentliche Löschung beim Server erfolgt nach sechs
 * Sekunden oder sofort, wenn der Bildschirm verlassen wird.
 */
export function useUndoableDelete(options: {
  onDeleted: (ticket: MobileTicket) => void;
  onFailed: (message: string) => void;
}) {
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [lastDeleted, setLastDeleted] = useState<MobileTicket | null>(null);
  const pending = useRef(
    new Map<
      string,
      { ticket: MobileTicket; timer: ReturnType<typeof setTimeout> }
    >(),
  );
  const callbacks = useRef(options);
  callbacks.current = options;

  const unhide = useCallback((id: string) => {
    setHiddenIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const commit = useCallback(
    async (ticket: MobileTicket) => {
      pending.current.delete(ticket.id);
      setLastDeleted((current) => (current?.id === ticket.id ? null : current));
      try {
        await deleteMobileTicket(ticket.id);
        callbacks.current.onDeleted(ticket);
      } catch (error) {
        unhide(ticket.id);
        callbacks.current.onFailed(
          error instanceof Error
            ? error.message
            : "Das Ticket konnte nicht gelöscht werden.",
        );
      }
    },
    [unhide],
  );

  const schedule = useCallback(
    (ticket: MobileTicket) => {
      setHiddenIds((current) => new Set(current).add(ticket.id));
      setLastDeleted(ticket);
      const timer = setTimeout(() => void commit(ticket), UNDO_WINDOW_MS);
      pending.current.set(ticket.id, { ticket, timer });
    },
    [commit],
  );

  const undo = useCallback(
    (ticket: MobileTicket) => {
      const entry = pending.current.get(ticket.id);
      if (entry) clearTimeout(entry.timer);
      pending.current.delete(ticket.id);
      unhide(ticket.id);
      setLastDeleted((current) => (current?.id === ticket.id ? null : current));
    },
    [unhide],
  );

  useEffect(() => {
    const entries = pending.current;
    return () => {
      for (const { ticket, timer } of entries.values()) {
        clearTimeout(timer);
        void deleteMobileTicket(ticket.id).catch(() => undefined);
      }
      entries.clear();
    };
  }, []);

  return { hiddenIds, lastDeleted, schedule, undo };
}
