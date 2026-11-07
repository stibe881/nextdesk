import { useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  LoaderCircle,
  MonitorSmartphone,
  X,
} from "lucide-react";
import {
  type IntuneAction,
  type IntuneDevice,
  type IntuneDeviceList,
  intuneActionLabel,
  intuneConfirmationText,
  intuneErrorMessage,
  intuneSuccessMessage,
  needsConfirmation,
  parseIntuneDeviceList,
} from "./lib/intune-actions";
import { supabase } from "./lib/supabase";
import "./intune-actions.css";

/*
 * Intune-Aktionen: remote actions (sync, restart, lock, passcode reset,
 * LAPS rotation, Defender quick scan) on Intune managed devices, from the
 * ticket detail and the asset list. Actions that change the device need a
 * confirmation; every action is logged on the server (and in the ticket
 * history when started from a ticket).
 */

type Row = Record<string, unknown>;

async function invokeIntuneActions(body: Row): Promise<unknown> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("intune-actions", {
    body,
  });
  if (error) {
    const context = (error as { context?: unknown }).context;
    let payload: unknown = null;
    if (context instanceof Response) {
      payload = await context
        .clone()
        .json()
        .catch(() => null);
    }
    throw new Error(intuneErrorMessage(payload));
  }
  return (data as Row | null)?.data ?? null;
}

type Toast = { kind: "success" | "error"; text: string };

export function IntuneActionsMenu({
  tenantId,
  ticketId,
  device,
  disabled = false,
  onCompleted,
}: {
  tenantId: string;
  ticketId: string | null;
  /** Nothing is rendered without a device (asset not Intune managed). */
  device: IntuneDevice | undefined;
  disabled?: boolean;
  /** Called after an action ran (e.g. to reload the ticket history). */
  onCompleted?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<IntuneAction | null>(null);
  const [confirming, setConfirming] = useState<IntuneAction | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const menuId = useId();
  const dialogTitleId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
        return;
      }
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  useEffect(() => {
    if (!confirming) return;
    confirmButtonRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirming(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function execute(action: IntuneAction, confirmed: boolean) {
    if (!device) return;
    setConfirming(null);
    setOpen(false);
    setPending(action);
    try {
      await invokeIntuneActions({
        type: "runAction",
        tenantId,
        assetId: device.assetId,
        ticketId,
        action,
        confirmed,
      });
      setToast({
        kind: "success",
        text: intuneSuccessMessage(action, device.name),
      });
    } catch (error) {
      setToast({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Die Intune-Aktion konnte nicht ausgeführt werden.",
      });
    } finally {
      setPending(null);
      onCompleted?.();
    }
  }

  function choose(action: IntuneAction) {
    if (!device) return;
    if (needsConfirmation(device, action)) {
      setOpen(false);
      setConfirming(action);
      return;
    }
    void execute(action, false);
  }

  if (!device || device.actions.length === 0) return null;

  return (
    <div className="intune-actions" ref={containerRef}>
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Intune-Aktionen für ${device.name}`}
        className="intune-actions__trigger"
        disabled={disabled || pending !== null}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {pending ? (
          <LoaderCircle
            aria-hidden="true"
            className="ticket-detail-spinner"
            size={15}
          />
        ) : (
          <MonitorSmartphone aria-hidden="true" size={15} strokeWidth={1.8} />
        )}
        {pending ? `${intuneActionLabel(pending)} …` : "Intune-Aktionen"}
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      {open ? (
        <ul className="intune-actions__menu" id={menuId} role="menu">
          {device.actions.map((action) => (
            <li key={action} role="none">
              <button
                onClick={() => choose(action)}
                role="menuitem"
                type="button"
              >
                {intuneActionLabel(action)}
                {needsConfirmation(device, action) ? " …" : ""}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {confirming ? (
        <div className="intune-actions__backdrop">
          <div
            aria-labelledby={dialogTitleId}
            aria-modal="true"
            className="intune-actions__dialog"
            role="alertdialog"
          >
            <AlertTriangle aria-hidden="true" size={20} />
            <div>
              <strong id={dialogTitleId}>
                {intuneActionLabel(confirming)}?
              </strong>
              <p>{intuneConfirmationText(confirming, device.name)}</p>
              <p className="intune-actions__hint">
                Die Aktion wird über Microsoft Intune ausgeführt und
                protokolliert.
              </p>
              <div className="intune-actions__dialog-actions">
                <button
                  className="danger-action"
                  onClick={() => void execute(confirming, true)}
                  ref={confirmButtonRef}
                  type="button"
                >
                  {intuneActionLabel(confirming)}
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setConfirming(null)}
                  type="button"
                >
                  Abbrechen
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {toast ? (
        <aside
          aria-live="polite"
          className={`intune-actions__toast intune-actions__toast--${toast.kind}`}
          role={toast.kind === "error" ? "alert" : "status"}
        >
          {toast.kind === "success" ? (
            <CheckCircle2 aria-hidden="true" size={20} strokeWidth={1.8} />
          ) : (
            <AlertTriangle aria-hidden="true" size={20} strokeWidth={1.8} />
          )}
          <span>{toast.text}</span>
          <button
            aria-label="Hinweis schliessen"
            className="ticket-toast-dismiss"
            onClick={() => setToast(null)}
            type="button"
          >
            <X aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
        </aside>
      ) : null}
    </div>
  );
}

/** Intune managed devices of a ticket with their actions (ticket detail). */
export function TicketIntuneActions({
  tenantId,
  ticketId,
  refreshKey,
  onCompleted,
}: {
  tenantId: string;
  ticketId: string;
  refreshKey: string;
  onCompleted?: (() => void) | undefined;
}) {
  const [list, setList] = useState<IntuneDeviceList | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    const requestId = ++sequence.current;
    setList(null);
    void (async () => {
      try {
        const next = parseIntuneDeviceList(
          await invokeIntuneActions({
            type: "listTicketDevices",
            tenantId,
            ticketId,
          }),
        );
        if (requestId === sequence.current) setList(next);
      } catch {
        // No permission, module off or older deployment: hide the section.
        if (requestId === sequence.current) setList(null);
      }
    })();
    return () => {
      sequence.current += 1;
    };
  }, [tenantId, ticketId, refreshKey]);

  const devices = list?.devices.filter((device) => device.actions.length > 0);
  if (!list || !devices || devices.length === 0) return null;

  return (
    <div>
      <dt>Intune-Aktionen</dt>
      <dd>
        {!list.connectionReady ? (
          <p className="data-caption">
            Die Intune-Anbindung ist für diesen Mandanten nicht aktiv. Aktionen
            sind erst nach der Einrichtung möglich.
          </p>
        ) : null}
        <ul
          aria-label="Intune-verwaltete Geräte"
          className="intune-actions__devices"
        >
          {devices.map((device) => (
            <li key={device.assetId}>
              <span>
                <strong>{device.name}</strong>
                {device.operatingSystem ? (
                  <small>{device.operatingSystem}</small>
                ) : null}
              </span>
              <IntuneActionsMenu
                device={device}
                disabled={!list.connectionReady}
                onCompleted={onCompleted}
                tenantId={tenantId}
                ticketId={ticketId}
              />
            </li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

/**
 * Intune actions per asset for a list of assets (asset list). Returns an
 * empty map without permission or when no asset is Intune managed.
 */
export function useIntuneAssetDevices(
  tenantId: string,
  assetIds: string[],
): { devices: Map<string, IntuneDevice>; connectionReady: boolean } {
  const [state, setState] = useState<{
    devices: Map<string, IntuneDevice>;
    connectionReady: boolean;
  }>({ devices: new Map(), connectionReady: false });
  const key = assetIds.slice(0, 100).join(",");

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) {
      setState({ devices: new Map(), connectionReady: false });
      return;
    }
    void (async () => {
      try {
        const list = parseIntuneDeviceList(
          await invokeIntuneActions({
            type: "listAssetActions",
            tenantId,
            assetIds: ids,
          }),
        );
        if (cancelled) return;
        setState({
          devices: new Map(
            (list?.devices ?? []).map((device) => [device.assetId, device]),
          ),
          connectionReady: list?.connectionReady ?? false,
        });
      } catch {
        if (!cancelled) {
          setState({ devices: new Map(), connectionReady: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, key]);

  return state;
}
