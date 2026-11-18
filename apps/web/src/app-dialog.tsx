import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import {
  dialogConfirmLabel,
  dialogTone,
  splitDialogMessage,
  type DialogTone,
} from "./lib/dialog-text";

/**
 * Eigene Bestätigungs- und Eingabedialoge im Stil der Seite, statt der
 * Systemfenster von window.confirm und window.prompt.
 *
 *   if (!(await confirmDialog("Ticket löschen?"))) return;
 *   const reason = await promptDialog("Grund für die Ablehnung:");
 */

type ConfirmRequest = {
  kind: "confirm";
  cancelLabel?: string | undefined;
  confirmLabel?: string | undefined;
  message: string;
  resolve: (value: boolean) => void;
  tone?: DialogTone | undefined;
};

type PromptRequest = {
  kind: "prompt";
  confirmLabel?: string | undefined;
  defaultValue: string;
  message: string;
  multiline: boolean;
  resolve: (value: string | null) => void;
};

type DialogRequest = ConfirmRequest | PromptRequest;

let queue: DialogRequest[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function current(): DialogRequest | null {
  return queue[0] ?? null;
}

export function confirmDialog(
  message: string,
  options: {
    cancelLabel?: string;
    confirmLabel?: string;
    tone?: DialogTone;
  } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { kind: "confirm", message, resolve, ...options }];
    emit();
  });
}

/** Liefert den Text oder null bei «Abbrechen». */
export function promptDialog(
  message: string,
  options: {
    confirmLabel?: string;
    defaultValue?: string;
    multiline?: boolean;
  } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    queue = [
      ...queue,
      {
        kind: "prompt",
        message,
        resolve,
        defaultValue: options.defaultValue ?? "",
        multiline: options.multiline ?? true,
        confirmLabel: options.confirmLabel,
      },
    ];
    emit();
  });
}

function settle(request: DialogRequest, accepted: boolean, text = "") {
  queue = queue.filter((entry) => entry !== request);
  if (request.kind === "confirm") request.resolve(accepted);
  else request.resolve(accepted ? text : null);
  emit();
}

/** Einmal in der Wurzel einbinden (main.tsx). */
export function AppDialogHost() {
  const request = useSyncExternalStore(subscribe, current, current);
  if (!request || typeof document === "undefined") return null;
  return createPortal(
    <DialogView
      key={queue.indexOf(request) + request.message}
      request={request}
    />,
    document.body,
  );
}

function DialogView({ request }: { request: DialogRequest }) {
  const { body, title } = splitDialogMessage(request.message);
  const tone: DialogTone =
    request.kind === "confirm"
      ? (request.tone ?? dialogTone(request.message))
      : "default";
  const confirmLabel =
    request.confirmLabel ??
    (request.kind === "confirm" ? dialogConfirmLabel(request.message) : "OK");
  const [text, setText] = useState(
    request.kind === "prompt" ? request.defaultValue : "",
  );
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const previouslyFocused = useRef<Element | null>(null);
  const idBase = useRef(`app-dialog-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    // Bei heiklen Aktionen zuerst «Abbrechen» fokussieren.
    const target =
      request.kind === "prompt"
        ? inputRef.current
        : tone === "danger"
          ? cancelRef.current
          : confirmRef.current;
    target?.focus();
    document.body.classList.add("app-dialog-open");
    return () => {
      document.body.classList.remove("app-dialog-open");
      const previous = previouslyFocused.current;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [request.kind, tone]);

  const accept = () => settle(request, true, text);
  const cancel = () => settle(request, false);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      cancel();
    } else if (event.key === "Tab") {
      // Fokus im Dialog halten.
      const nodes = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>(
          "button:not(:disabled), textarea, input",
        ),
      );
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    } else if (
      event.key === "Enter" &&
      request.kind === "prompt" &&
      (!request.multiline || event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault();
      accept();
    }
  };

  return (
    <div
      className="app-dialog__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) cancel();
      }}
    >
      <div
        aria-describedby={body ? `${idBase.current}-body` : undefined}
        aria-labelledby={`${idBase.current}-title`}
        aria-modal="true"
        className={`app-dialog app-dialog--${tone}`}
        onKeyDown={onKeyDown}
        role={tone === "danger" ? "alertdialog" : "dialog"}
      >
        <h2 className="app-dialog__title" id={`${idBase.current}-title`}>
          {title}
        </h2>
        {body ? (
          <p className="app-dialog__body" id={`${idBase.current}-body`}>
            {body}
          </p>
        ) : null}
        {request.kind === "prompt" ? (
          request.multiline ? (
            <textarea
              aria-labelledby={`${idBase.current}-title`}
              className="app-dialog__input"
              onChange={(event) => setText(event.target.value)}
              ref={inputRef}
              rows={3}
              value={text}
            />
          ) : (
            <input
              aria-labelledby={`${idBase.current}-title`}
              className="app-dialog__input"
              onChange={(event) => setText(event.target.value)}
              ref={inputRef}
              value={text}
            />
          )
        ) : null}
        <div className="app-dialog__actions">
          <button
            className="secondary-button"
            onClick={cancel}
            ref={cancelRef}
            type="button"
          >
            {request.kind === "confirm"
              ? (request.cancelLabel ?? "Abbrechen")
              : "Abbrechen"}
          </button>
          <button
            className={`app-dialog__confirm${tone === "danger" ? " app-dialog__confirm--danger" : ""}`}
            onClick={accept}
            ref={confirmRef}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
