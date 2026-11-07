import { Archive, Pencil, Plus, Save, TextQuote, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import {
  filterSnippets,
  insertSnippetAt,
  MAX_SNIPPET_BODY_LENGTH,
  MAX_SNIPPET_NAME_LENGTH,
  normalizeSnippetShortcut,
  parseSnippetResponse,
  resolveSnippetPlaceholders,
  SNIPPET_PLACEHOLDERS,
  snippetTriggerAt,
  unknownSnippetPlaceholders,
  type ReplySnippet,
  type SnippetContext,
} from "./lib/reply-snippets";
import { supabase } from "./lib/supabase";
import "./reply-snippets.css";

/**
 * «Antwort-Bausteine» in the web app:
 *   - useReplySnippetAssist: «/» in the reply field opens a filterable
 *     picker; the chosen snippet is inserted with resolved placeholders.
 *   - ReplySnippetManager: create, edit and archive personal snippets and,
 *     with «Vorlagen verwalten», the shared snippets of the tenant.
 */

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Die Verbindung ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("reply-snippets", {
    body,
  });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = (await context.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (payload?.error?.message) throw new Error(payload.error.message);
    }
    throw new Error("Die Antwort-Bausteine sind gerade nicht verfügbar.");
  }
  return data as T;
}

const EMPTY_CONTEXT: SnippetContext = {
  requesterName: null,
  ticketNumber: null,
  subject: null,
  device: null,
  agentName: null,
  departmentName: null,
};

type Department = { id: string; name: string };

function parseDepartments(value: unknown): Department[] {
  const data =
    typeof value === "object" && value !== null
      ? (value as { data?: { departments?: unknown } }).data
      : null;
  return Array.isArray(data?.departments)
    ? data.departments.flatMap((entry: unknown) => {
        const record = entry as { id?: unknown; name?: unknown } | null;
        return typeof record?.id === "string" && typeof record.name === "string"
          ? [{ id: record.id, name: record.name }]
          : [];
      })
    : [];
}

/**
 * «/» picker for a reply textarea. Returns the props for the textarea, the
 * picker (shown under the field) and a «Bausteine» button.
 */
export function useReplySnippetAssist({
  enabled,
  tenantId,
  ticketId,
  departmentId,
  text,
  onTextChange,
  textareaRef,
}: {
  enabled: boolean;
  tenantId: string;
  ticketId: string;
  departmentId: string | null;
  text: string;
  onTextChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [snippets, setSnippets] = useState<ReplySnippet[]>([]);
  const [context, setContext] = useState<SnippetContext>(EMPTY_CONTEXT);
  const [revision, setRevision] = useState(0);
  const [caret, setCaret] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseQuery, setBrowseQuery] = useState("");

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void call<unknown>({ type: "listForTicket", tenantId, ticketId })
      .then((value) => {
        if (!active) return;
        const parsed = parseSnippetResponse(value);
        setSnippets(parsed?.snippets ?? []);
        setContext(parsed?.context ?? EMPTY_CONTEXT);
      })
      .catch(() => {
        // Without snippets the reply field works as before.
        if (active) setSnippets([]);
      });
    return () => {
      active = false;
    };
  }, [enabled, tenantId, ticketId, revision]);

  const trigger = enabled ? snippetTriggerAt(text, caret) : null;
  const triggerOpen =
    trigger !== null && trigger.start !== dismissedAt && snippets.length > 0;
  const matches = useMemo(
    () =>
      triggerOpen && trigger
        ? filterSnippets(snippets, trigger.query, departmentId)
        : [],
    [departmentId, snippets, trigger?.query, triggerOpen],
  );
  const pickerOpen = triggerOpen && matches.length > 0;
  const browseMatches = useMemo(
    () =>
      browseOpen ? filterSnippets(snippets, browseQuery, departmentId, 20) : [],
    [browseOpen, browseQuery, departmentId, snippets],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [trigger?.query, pickerOpen]);

  const focusAt = useCallback(
    (position: number) => {
      requestAnimationFrame(() => {
        const element = textareaRef.current;
        if (!element) return;
        element.focus();
        element.setSelectionRange(position, position);
        setCaret(position);
      });
    },
    [textareaRef],
  );

  function insert(snippet: ReplySnippet) {
    const resolved = resolveSnippetPlaceholders(snippet.body, context);
    if (trigger && pickerOpen) {
      const next = insertSnippetAt(text, trigger, caret, resolved);
      onTextChange(next.text);
      focusAt(next.caret);
      return;
    }
    // From the «Bausteine» list: insert at the caret.
    const position = Math.min(caret, text.length);
    const before = text.slice(0, position);
    const separator = before && !/\s$/.test(before) ? " " : "";
    const next = `${before}${separator}${resolved}${text.slice(position)}`;
    onTextChange(next);
    setBrowseOpen(false);
    focusAt(position + separator.length + resolved.length);
  }

  function updateCaret(element: HTMLTextAreaElement) {
    setCaret(element.selectionStart ?? element.value.length);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!pickerOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      const snippet = matches[activeIndex];
      if (!snippet) return;
      event.preventDefault();
      insert(snippet);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDismissedAt(trigger?.start ?? null);
    }
  }

  const listId = `reply-snippet-picker-${ticketId}`;
  const textareaProps = {
    "aria-autocomplete": "list" as const,
    "aria-controls": pickerOpen ? listId : undefined,
    "aria-expanded": pickerOpen,
    "aria-activedescendant": pickerOpen
      ? `${listId}-${matches[activeIndex]?.id ?? ""}`
      : undefined,
    onClick: (event: { currentTarget: HTMLTextAreaElement }) =>
      updateCaret(event.currentTarget),
    onInput: (event: { currentTarget: HTMLTextAreaElement }) =>
      updateCaret(event.currentTarget),
    onKeyDown,
    onKeyUp: (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        !["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(event.key) ||
        !pickerOpen
      )
        updateCaret(event.currentTarget);
    },
    onSelect: (event: { currentTarget: HTMLTextAreaElement }) =>
      updateCaret(event.currentTarget),
  };

  const picker: ReactNode = pickerOpen ? (
    <ul
      aria-label="Antwort-Bausteine"
      className="reply-snippet-picker"
      id={listId}
      role="listbox"
    >
      {matches.map((snippet, index) => (
        <li
          aria-selected={index === activeIndex}
          className={
            index === activeIndex
              ? "reply-snippet-picker__item reply-snippet-picker__item--active"
              : "reply-snippet-picker__item"
          }
          id={`${listId}-${snippet.id}`}
          key={snippet.id}
          onMouseDown={(event) => {
            // Keep the focus (and the caret) in the textarea.
            event.preventDefault();
            insert(snippet);
          }}
          onMouseEnter={() => setActiveIndex(index)}
          role="option"
        >
          <span className="reply-snippet-picker__name">
            {snippet.name}
            {snippet.shortcut ? <code>/{snippet.shortcut}</code> : null}
            <small>{snippet.personal ? "Persönlich" : "Gemeinsam"}</small>
          </span>
          <span className="reply-snippet-picker__preview">
            {resolveSnippetPlaceholders(snippet.body, context).slice(0, 140)}
          </span>
        </li>
      ))}
    </ul>
  ) : null;

  const browser: ReactNode = enabled ? (
    <div className="reply-snippet-browser">
      <button
        aria-expanded={browseOpen}
        className="text-button"
        onClick={() => {
          setBrowseOpen((open) => !open);
          setBrowseQuery("");
        }}
        type="button"
      >
        <TextQuote aria-hidden="true" size={15} />
        Bausteine
      </button>
      <span className="data-caption">
        Tipp: Tippen Sie «/» im Textfeld, um einen Baustein einzufügen.
      </span>
      {browseOpen ? (
        <div className="reply-snippet-browser__panel">
          <input
            aria-label="Bausteine durchsuchen"
            autoFocus
            onChange={(event) => setBrowseQuery(event.target.value)}
            onKeyDown={(event) => {
              // The list sits inside the reply form: Enter picks, never sends.
              if (event.key !== "Enter") return;
              event.preventDefault();
              const first = browseMatches[0];
              if (first) insert(first);
            }}
            placeholder="Baustein suchen …"
            type="search"
            value={browseQuery}
          />
          {browseMatches.length === 0 ? (
            <p className="data-caption">
              Keine passenden Bausteine. Bausteine erfassen Sie in den
              persönlichen Einstellungen.
            </p>
          ) : (
            <ul>
              {browseMatches.map((snippet) => (
                <li key={snippet.id}>
                  <button onClick={() => insert(snippet)} type="button">
                    <strong>{snippet.name}</strong>
                    {snippet.shortcut ? <code>/{snippet.shortcut}</code> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            className="text-button"
            onClick={() => setRevision((value) => value + 1)}
            type="button"
          >
            Liste aktualisieren
          </button>
        </div>
      ) : null}
    </div>
  ) : null;

  return { textareaProps, picker, browser };
}

type Draft = {
  id: string | null;
  name: string;
  shortcut: string;
  body: string;
  departmentId: string;
  shared: boolean;
};

const EMPTY_DRAFT: Draft = {
  id: null,
  name: "",
  shortcut: "",
  body: "",
  departmentId: "",
  shared: false,
};

/** Management of personal and (with permission) shared snippets. */
export function ReplySnippetManager({ tenantId }: { tenantId: string }) {
  const [snippets, setSnippets] = useState<ReplySnippet[] | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [canManageShared, setCanManageShared] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const value = await call<unknown>({ type: "list", tenantId });
      const parsed = parseSnippetResponse(value);
      if (!parsed)
        throw new Error("Die Bausteine konnten nicht geladen werden.");
      setSnippets(parsed.snippets);
      setCanManageShared(parsed.canManageShared);
      setDepartments(parseDepartments(value));
      setError("");
    } catch (loadError) {
      setSnippets([]);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Die Bausteine konnten nicht geladen werden.",
      );
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const shortcutInvalid =
    draft !== null &&
    draft.shortcut.trim() !== "" &&
    normalizeSnippetShortcut(draft.shortcut) === null;
  const unknownPlaceholders = draft
    ? unknownSnippetPlaceholders(draft.body)
    : [];

  async function save() {
    if (!draft || busy) return;
    if (!draft.name.trim() || !draft.body.trim() || shortcutInvalid) {
      setError("Bitte geben Sie Name und Text an und prüfen Sie das Kürzel.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await call({
        type: "save",
        tenantId,
        id: draft.id,
        name: draft.name,
        shortcut: normalizeSnippetShortcut(draft.shortcut),
        body: draft.body,
        departmentId: draft.departmentId || null,
        shared: draft.shared,
      });
      setDraft(null);
      setMessage("Der Baustein wurde gespeichert.");
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Der Baustein konnte nicht gespeichert werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function archive(snippet: ReplySnippet) {
    if (busy) return;
    if (!window.confirm(`Baustein «${snippet.name}» entfernen?`)) return;
    setBusy(true);
    try {
      await call({ type: "archive", tenantId, id: snippet.id });
      setMessage("Der Baustein wurde entfernt.");
      await load();
    } catch (archiveError) {
      setError(
        archiveError instanceof Error
          ? archiveError.message
          : "Der Baustein konnte nicht entfernt werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  function insertPlaceholder(key: string) {
    if (!draft) return;
    const element = bodyRef.current;
    const token = `{${key}}`;
    const start = element?.selectionStart ?? draft.body.length;
    const end = element?.selectionEnd ?? start;
    const body = `${draft.body.slice(0, start)}${token}${draft.body.slice(end)}`;
    setDraft({ ...draft, body });
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <section
      aria-labelledby="reply-snippet-manager-heading"
      className="reply-snippet-manager"
    >
      <div className="reply-snippet-manager__heading">
        <div>
          <p className="eyebrow">ANTWORT-BAUSTEINE</p>
          <h3 id="reply-snippet-manager-heading">Bausteine mit Variablen</h3>
          <p className="data-caption">
            Tippen Sie im Antwortfeld eines Tickets «/» und wählen Sie einen
            Baustein. Variablen wie {"{Vorname}"} oder {"{Ticketnummer}"} werden
            dabei automatisch ersetzt.
          </p>
        </div>
        {draft ? null : (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              setDraft(EMPTY_DRAFT);
              setMessage("");
            }}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
            Neuer Baustein
          </button>
        )}
      </div>

      {draft ? (
        <div className="reply-snippet-manager__form">
          <label>
            Name
            <input
              maxLength={MAX_SNIPPET_NAME_LENGTH}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              value={draft.name}
            />
          </label>
          <label>
            Kürzel (optional)
            <input
              aria-invalid={shortcutInvalid}
              maxLength={41}
              onChange={(event) =>
                setDraft({ ...draft, shortcut: event.target.value })
              }
              placeholder="z. B. gruss"
              value={draft.shortcut}
            />
            {shortcutInvalid ? (
              <small className="error">
                Nur Kleinbuchstaben, Ziffern, «-» und «_», höchstens 40 Zeichen.
              </small>
            ) : null}
          </label>
          <label className="reply-snippet-manager__body">
            Text
            <textarea
              maxLength={MAX_SNIPPET_BODY_LENGTH}
              onChange={(event) =>
                setDraft({ ...draft, body: event.target.value })
              }
              ref={bodyRef}
              rows={6}
              value={draft.body}
            />
          </label>
          <div
            aria-label="Variable einfügen"
            className="reply-snippet-manager__placeholders"
            role="group"
          >
            {SNIPPET_PLACEHOLDERS.map((placeholder) => (
              <button
                key={placeholder.key}
                onClick={() => insertPlaceholder(placeholder.key)}
                title={placeholder.label}
                type="button"
              >
                {`{${placeholder.key}}`}
              </button>
            ))}
          </div>
          {unknownPlaceholders.length > 0 ? (
            <p className="data-caption" role="status">
              Unbekannte Variablen bleiben unverändert stehen:{" "}
              {unknownPlaceholders.map((key) => `{${key}}`).join(", ")}
            </p>
          ) : null}
          <label>
            Abteilung
            <select
              onChange={(event) =>
                setDraft({ ...draft, departmentId: event.target.value })
              }
              value={draft.departmentId}
            >
              <option value="">Alle Abteilungen</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label className="reply-snippet-manager__shared">
            <input
              checked={draft.shared}
              disabled={!canManageShared}
              onChange={(event) =>
                setDraft({ ...draft, shared: event.target.checked })
              }
              type="checkbox"
            />
            Für alle im Mandanten freigeben
            {canManageShared ? null : (
              <small>(benötigt die Berechtigung «Vorlagen verwalten»)</small>
            )}
          </label>
          <div className="reply-snippet-manager__actions">
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void save()}
              type="button"
            >
              <Save aria-hidden="true" size={16} />
              Speichern
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setDraft(null)}
              type="button"
            >
              <X aria-hidden="true" size={16} />
              Abbrechen
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="data-caption" role="status">
          {message}
        </p>
      ) : null}

      {snippets === null ? (
        <p className="data-caption">Bausteine werden geladen …</p>
      ) : snippets.length === 0 ? (
        <p className="data-caption">Noch keine Bausteine erfasst.</p>
      ) : (
        <ul className="reply-snippet-manager__list">
          {snippets.map((snippet) => (
            <li key={snippet.id}>
              <div>
                <strong>{snippet.name}</strong>
                {snippet.shortcut ? <code>/{snippet.shortcut}</code> : null}
                <small>
                  {snippet.personal ? "Persönlich" : "Gemeinsam"}
                  {snippet.departmentName ? ` · ${snippet.departmentName}` : ""}
                </small>
                <p>{snippet.body.slice(0, 200)}</p>
              </div>
              {snippet.canEdit ? (
                <div className="reply-snippet-manager__item-actions">
                  <button
                    aria-label={`${snippet.name} bearbeiten`}
                    className="icon-button"
                    disabled={busy}
                    onClick={() => {
                      setMessage("");
                      setDraft({
                        id: snippet.id,
                        name: snippet.name,
                        shortcut: snippet.shortcut ?? "",
                        body: snippet.body,
                        departmentId: snippet.departmentId ?? "",
                        shared: !snippet.personal,
                      });
                    }}
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={16} />
                  </button>
                  <button
                    aria-label={`${snippet.name} entfernen`}
                    className="icon-button"
                    disabled={busy}
                    onClick={() => void archive(snippet)}
                    type="button"
                  >
                    <Archive aria-hidden="true" size={16} />
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
