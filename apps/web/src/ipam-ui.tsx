// Kleine gemeinsame Bausteine des IPAM-Moduls (Balken, Umschalter, Laden).

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ipamCall } from "./lib/ipam-api";
import { percentText, percentTone } from "./lib/ipam-format";
import type {
  IpamAddress,
  IpamPrefix,
  IpamSite,
  IpamVlan,
  IpamVrf,
} from "./lib/ipam-model";

/** Dialogs opened by the module shell (forms from ipam-forms.tsx). */
export type IpamDialog =
  | { kind: "vrf"; vrf: IpamVrf | null }
  | { kind: "site"; site: IpamSite | null }
  | { kind: "vlan"; vlan: IpamVlan | null; draft?: Partial<IpamVlan> }
  | { kind: "prefix"; prefix: IpamPrefix | null; draft?: Partial<IpamPrefix> }
  | {
      kind: "reserve";
      prefix: IpamPrefix;
      suggestion: string | null;
      /** Several free addresses from the occupancy grid (range reserve). */
      addresses?: string[];
    }
  | { kind: "nextPrefix"; parent: IpamPrefix }
  | { kind: "split"; prefix: IpamPrefix }
  | { kind: "address"; initial: Partial<IpamAddress> & { address: string } };

/** Address drawer: either an address id or a free IP with VRF. */
export type IpamDrawer = {
  addressId: string | null;
  ip: string | null;
  vrfId: string | null;
};

export function errorText(failure: unknown, fallback: string): string {
  return failure instanceof Error ? failure.message : fallback;
}

/**
 * Loads an `ipam` action and reloads when `key` changes. `body` is read on
 * each load; pass everything that changes the request in `key`.
 */
export function useIpamQuery<T>(
  body: Record<string, unknown> | null,
  key: string,
): {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(body !== null);
  const [tick, setTick] = useState(0);
  const bodyRef = useRef(body);
  bodyRef.current = body;
  useEffect(() => {
    const current = bodyRef.current;
    if (!current) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    ipamCall<T>(current)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((failure: unknown) => {
        if (active)
          setError(
            errorText(failure, "Die Daten konnten nicht geladen werden."),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [key, tick]);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { data, error, loading, reload };
}

/** Utilization bar with percent label; colour by warning threshold. */
export function Meter({
  label,
  percent,
  showText = true,
  warningPercent = 85,
}: {
  label?: string;
  percent: number | null | undefined;
  showText?: boolean;
  warningPercent?: number;
}) {
  const tone = percentTone(percent, warningPercent);
  const value = Math.min(100, Math.max(0, percent ?? 0));
  return (
    <span className={`ipam-meter ipam-meter--${tone}`}>
      <span
        aria-label={`${label ? `${label}: ` : ""}Auslastung ${percentText(percent)}`}
        className="ipam-meter__track"
        role="img"
      >
        <span
          className="ipam-meter__fill"
          style={{ width: `${value > 0 ? Math.max(value, 2) : 0}%` }}
        />
      </span>
      {showText ? (
        <span className="ipam-meter__text">{percentText(percent)}</span>
      ) : null}
    </span>
  );
}

/** Segmented switch (e.g. «Hierarchie | Nach Standort»). */
export function Segmented<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: T) => void;
  options: readonly { value: T; label: ReactNode }[];
  value: T;
}) {
  return (
    <div aria-label={label} className="ipam-seg" role="group">
      {options.map((option) => (
        <button
          aria-pressed={option.value === value}
          className={option.value === value ? "is-on" : ""}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Sub tabs inside a card (Belegung, Adressen …). */
export function SubTabs<T extends string>({
  label,
  onChange,
  tabs,
  value,
}: {
  label: string;
  onChange: (value: T) => void;
  tabs: readonly { value: T; label: ReactNode }[];
  value: T;
}) {
  return (
    <div aria-label={label} className="ipam-subtabs" role="tablist">
      {tabs.map((tab) => (
        <button
          aria-selected={tab.value === value}
          className={tab.value === value ? "is-on" : ""}
          key={tab.value}
          onClick={() => onChange(tab.value)}
          role="tab"
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "success" | "warning" | "danger" | "neutral" | "info" | "accent";
}) {
  return <span className={`ipam-pill ipam-pill--${tone}`}>{children}</span>;
}

export function Notice({
  error,
  message,
}: {
  error?: string | null;
  message?: string | null;
}) {
  return (
    <>
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="form-message form-message--success" role="status">
          {message}
        </p>
      ) : null}
    </>
  );
}

/** Reverses a change from the undo toast (calls existing actions). */
export type UndoAction = { run: () => Promise<unknown> };

/** Callback after a change: success text and optional undo. */
export type IpamChanged = (message?: string, undo?: UndoAction) => void;

export type IpamToastState = {
  id: number;
  message: string;
  tone: "success" | "error";
  undo?: UndoAction;
};

/**
 * Message at the bottom of the screen after a change, with «Rückgängig»
 * when the change can be reversed. Closes after 8 s (not while focused).
 */
export function Toast({
  onClose,
  onUndo,
  toast,
}: {
  onClose: () => void;
  onUndo: (undo: UndoAction) => void;
  toast: IpamToastState | null;
}) {
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (!toast || hold) return;
    const timer = window.setTimeout(onClose, toast.undo ? 8000 : 5000);
    return () => window.clearTimeout(timer);
  }, [toast, hold, onClose]);
  return (
    <div aria-live="polite" className="ipam-toast-region">
      {toast ? (
        <div
          className={`ipam-toast ipam-toast--${toast.tone}`}
          key={toast.id}
          onBlur={() => setHold(false)}
          onFocus={() => setHold(true)}
          onMouseEnter={() => setHold(true)}
          onMouseLeave={() => setHold(false)}
          role={toast.tone === "error" ? "alert" : "status"}
        >
          <span>{toast.message}</span>
          {toast.undo ? (
            <button
              className="ipam-toast__undo"
              onClick={() => onUndo(toast.undo!)}
              type="button"
            >
              Rückgängig
            </button>
          ) : null}
          <button
            aria-label="Meldung schliessen"
            className="ipam-toast__close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Debounced copy of a value (live search, planner preview). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setCurrent(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return current;
}
