import { useSyncExternalStore } from "react";

/**
 * Brücke zwischen dem Modul Projekte und den übrigen Modulen: Ticket-,
 * Bestell-, IPAM- und Gerätedetails zeigen ihren Projektbezug nur, wenn die
 * Person Projekte nutzen darf, und öffnen ein Projekt, ohne dass jede Ansicht
 * dafür eigene Eigenschaften durchreichen muss.
 */

const OPEN_EVENT = "nextdesk:open-project";
let available = false;
const listeners = new Set<() => void>();

export function setProjectsAvailable(next: boolean): void {
  if (available === next) return;
  available = next;
  for (const listener of listeners) listener();
}

export function useProjectsAvailable(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => available,
    () => false,
  );
}

export function requestOpenProject(projectId: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: projectId }));
}

export function onOpenProjectRequest(
  handler: (projectId: string) => void,
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail === "string") handler(detail);
  };
  window.addEventListener(OPEN_EVENT, listener);
  return () => window.removeEventListener(OPEN_EVENT, listener);
}
