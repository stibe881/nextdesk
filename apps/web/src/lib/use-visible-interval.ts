import { useEffect, useRef } from "react";

/**
 * Ruft `callback` alle `intervalMs` auf, aber nur solange der Tab sichtbar
 * ist. Wird der Tab wieder sichtbar oder das Fenster fokussiert, läuft der
 * Aufruf sofort (falls seit dem letzten Lauf mindestens `intervalMs / 2`
 * vergangen sind). Gemeinsamer Ersatz für eigene setInterval-Abfragen.
 */
export function useVisibleInterval(
  callback: () => void,
  intervalMs: number,
  enabled = true,
): void {
  const latest = useRef(callback);
  latest.current = callback;

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;
    let lastRun = Date.now();
    const run = () => {
      lastRun = Date.now();
      latest.current();
    };
    const tick = () => {
      if (document.visibilityState === "visible") run();
    };
    const wake = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastRun >= intervalMs / 2
      ) {
        run();
      }
    };
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [enabled, intervalMs]);
}
