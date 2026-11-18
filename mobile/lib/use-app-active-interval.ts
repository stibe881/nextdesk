import { useEffect, useRef } from "react";
import { AppState } from "react-native";

/**
 * Calls `callback` every `intervalMs` while the app is in the foreground
 * (and `enabled`, e.g. while the screen is focused). Coming back to the
 * foreground runs it at once if the last run is at least half an interval
 * ago. Counterpart of the web hook useVisibleInterval.
 */
export function useAppActiveInterval(
  callback: () => void,
  intervalMs: number,
  enabled = true,
): void {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  }, [callback]);

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
      if (state === "active" && Date.now() - lastRun >= intervalMs / 2) run();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [enabled, intervalMs]);
}
