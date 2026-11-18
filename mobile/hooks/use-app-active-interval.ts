import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { shouldRunOnWake } from "@/lib/active-interval";

/**
 * Ruft `callback` alle `intervalMs` auf, aber nur solange die App im
 * Vordergrund ist (Gegenstück zu useVisibleInterval der Web-App). Kommt die
 * App zurück und ist seit dem letzten Lauf mindestens die halbe Zeit
 * vergangen, läuft der Aufruf sofort.
 */
export function useAppActiveInterval(
  callback: () => void,
  intervalMs: number,
  enabled = true,
): void {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;
    let lastRun = Date.now();
    const run = () => {
      lastRun = Date.now();
      latest.current();
    };
    const timer = setInterval(() => {
      if (AppState.currentState === "active") run();
    }, intervalMs);
    const subscription = AppState.addEventListener("change", (state) => {
      if (shouldRunOnWake(state, lastRun, Date.now(), intervalMs)) run();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [enabled, intervalMs]);
}
