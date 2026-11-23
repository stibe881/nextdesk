import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Rendert Nebenbereiche (und damit ihre Datenabfragen) erst bei Bedarf:
 * - «visible»: sobald der Platzhalter in die Nähe des sichtbaren Bereichs kommt
 * - «idle»: kurz nach dem Öffnen, wenn der Browser Leerlauf hat
 * Einmal angezeigt, bleibt der Inhalt bestehen. `resetKey` (z. B. die
 * Ticket-ID) setzt den Zustand bei einem anderen Ticket zurück.
 */
export function Deferred({
  children,
  mode = "visible",
  resetKey,
  rootMargin = "400px",
}: {
  children: ReactNode;
  mode?: "visible" | "idle";
  resetKey?: string;
  rootMargin?: string;
}) {
  const [shown, setShown] = useState(false);
  const placeholder = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setShown(false);
  }, [resetKey]);

  useEffect(() => {
    if (shown) return;
    if (mode === "idle") {
      const idle = window as Window & {
        requestIdleCallback?: (
          callback: () => void,
          options?: { timeout: number },
        ) => number;
        cancelIdleCallback?: (handle: number) => void;
      };
      if (idle.requestIdleCallback) {
        const handle = idle.requestIdleCallback(() => setShown(true), {
          timeout: 1200,
        });
        return () => idle.cancelIdleCallback?.(handle);
      }
      const timer = window.setTimeout(() => setShown(true), 300);
      return () => window.clearTimeout(timer);
    }
    const element = placeholder.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [mode, rootMargin, shown, resetKey]);

  if (shown) return <>{children}</>;
  return (
    <div
      aria-hidden="true"
      className="deferred-placeholder"
      ref={placeholder}
    />
  );
}
