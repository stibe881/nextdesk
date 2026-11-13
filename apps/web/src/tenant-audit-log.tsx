import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Download, ExternalLink, RotateCcw, Search, X } from "lucide-react";

import {
  activeAuditFilterCount,
  auditActionGroups,
  auditExportFileName,
  auditFiltersFromForm,
  csvWithBom,
  EMPTY_AUDIT_FILTER_FORM,
  type AuditFilterForm,
} from "./lib/audit-filter-form";
import {
  AUDIT_EXPORT_MAX_ROWS,
  AUDIT_SEVERITIES,
  auditActionArea,
  auditActionLabel,
  auditAreaLabel,
  auditDiff,
  auditEntityTypeLabel,
  auditSeverityLabel,
  formatAuditValue,
  hasAuditActionLabel,
  redactAuditSecrets,
  type AuditFilters,
} from "./lib/audit-view";
import { tn } from "./lib/formality";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";
import "./tenant-audit-log.css";

const PAGE_SIZE = 100;

type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  severity: string;
  occurredAt: string;
  actorId: string | null;
  actorName: string;
  ticketId: string | null;
  hasChanges: boolean;
};

type AuditEntryDetail = AuditEntry & {
  requestId: string | null;
  metadata: unknown;
  beforeData: unknown;
  afterData: unknown;
};

type AuditActor = { id: string; name: string; email: string | null };
type EntityTypeOption = { value: string; label: string };

type AuditRequestBody =
  | {
      type: "list";
      tenantId: string;
      filters: AuditFilters;
      limit: number;
      cursor?: string;
    }
  | { type: "detail"; tenantId: string; id: string }
  | { type: "actors"; tenantId: string; query?: string }
  | { type: "facets"; tenantId: string }
  | {
      type: "export";
      tenantId: string;
      filters: AuditFilters;
      format: "csv" | "json";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function invokeAudit(body: AuditRequestBody): Promise<unknown> {
  if (!supabase) {
    throw new Error("Die Verbindung zu Supabase ist nicht konfiguriert.");
  }
  const { data, error } = await supabase.functions.invoke("tenant-audit-log", {
    body,
  });
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Das Änderungsprotokoll ist nicht erreichbar.",
      ),
    );
  }
  return data;
}

async function auditData<T>(body: AuditRequestBody): Promise<T> {
  const data = await invokeAudit(body);
  if (!isRecord(data) || !("data" in data)) {
    throw new Error(
      "Das Änderungsprotokoll hat keine verwertbaren Daten geliefert.",
    );
  }
  return data.data as T;
}

const dateTimeFormat = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "medium",
  timeStyle: "medium",
});

function formatTimestamp(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? dateTimeFormat.format(new Date(time))
    : "Unbekannter Zeitpunkt";
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function downloadText(text: string, type: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export type TenantAuditLogProps = {
  tenantId: string;
  onOpenTicket?: (ticketId: string) => void;
};

export function TenantAuditLog({
  tenantId,
  onOpenTicket,
}: TenantAuditLogProps) {
  const [form, setForm] = useState<AuditFilterForm>(EMPTY_AUDIT_FILTER_FORM);
  const filters = useMemo(() => auditFiltersFromForm(form), [form]);
  const [appliedFilters, setAppliedFilters] = useState<AuditFilters>({});
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [entityTypes, setEntityTypes] = useState<EntityTypeOption[]>([]);
  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);
  const [exportMessage, setExportMessage] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const requestRef = useRef(0);
  const actionGroups = useMemo(() => auditActionGroups(), []);

  // Debounce: text inputs should not trigger one request per keystroke.
  useEffect(() => {
    const handle = window.setTimeout(() => setAppliedFilters(filters), 350);
    return () => window.clearTimeout(handle);
  }, [filters]);

  useEffect(() => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    void auditData<{ entries: AuditEntry[]; nextCursor: string | null }>({
      type: "list",
      tenantId,
      filters: appliedFilters,
      limit: PAGE_SIZE,
    })
      .then((result) => {
        if (requestRef.current !== requestId) return;
        setEntries(result.entries);
        setNextCursor(result.nextCursor);
      })
      .catch((nextError: unknown) => {
        if (requestRef.current !== requestId) return;
        setEntries([]);
        setNextCursor(null);
        setError(
          errorText(
            nextError,
            "Das Änderungsprotokoll konnte nicht geladen werden.",
          ),
        );
      })
      .finally(() => {
        if (requestRef.current === requestId) setLoading(false);
      });
  }, [appliedFilters, tenantId]);

  useEffect(() => {
    let active = true;
    void auditData<{ entityTypes: EntityTypeOption[] }>({
      type: "facets",
      tenantId,
    })
      .then((result) => {
        if (active) setEntityTypes(result.entityTypes);
      })
      .catch(() => {
        if (active) setEntityTypes([]);
      });
    return () => {
      active = false;
    };
  }, [tenantId]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    const requestId = requestRef.current;
    setLoadingMore(true);
    try {
      const result = await auditData<{
        entries: AuditEntry[];
        nextCursor: string | null;
      }>({
        type: "list",
        tenantId,
        filters: appliedFilters,
        limit: PAGE_SIZE,
        cursor: nextCursor,
      });
      if (requestRef.current !== requestId) return;
      setEntries((current) => [...current, ...result.entries]);
      setNextCursor(result.nextCursor);
    } catch (nextError) {
      setError(
        errorText(nextError, "Weitere Einträge konnten nicht geladen werden."),
      );
    } finally {
      setLoadingMore(false);
    }
  }, [appliedFilters, nextCursor, tenantId]);

  const runExport = async (format: "csv" | "json") => {
    setExporting(format);
    setExportMessage("");
    try {
      const data = await invokeAudit({
        type: "export",
        tenantId,
        filters,
        format,
      });
      if (format === "csv") {
        if (typeof data !== "string") {
          throw new Error("Der Export hat keine verwertbaren Daten geliefert.");
        }
        downloadText(
          csvWithBom(data),
          "text/csv;charset=utf-8",
          auditExportFileName("csv"),
        );
        setExportMessage("Der CSV-Export wurde erstellt.");
      } else {
        if (!isRecord(data) || !Array.isArray(data.entries)) {
          throw new Error("Der Export hat keine verwertbaren Daten geliefert.");
        }
        downloadText(
          JSON.stringify(data, null, 2),
          "application/json;charset=utf-8",
          auditExportFileName("json"),
        );
        setExportMessage(
          data.truncated === true
            ? `Der JSON-Export wurde auf ${AUDIT_EXPORT_MAX_ROWS.toLocaleString("de-CH")} Einträge gekürzt.`
            : "Der JSON-Export wurde erstellt.",
        );
      }
    } catch (nextError) {
      setExportMessage(
        errorText(nextError, "Der Export konnte nicht erstellt werden."),
      );
    } finally {
      setExporting(null);
    }
  };

  const update = (patch: Partial<AuditFilterForm>) =>
    setForm((current) => ({ ...current, ...patch }));
  const filterCount = activeAuditFilterCount(filters);

  return (
    <section
      className="tenant-admin-settings__section audit-view"
      aria-labelledby="tenant-audit-heading"
    >
      <div className="tenant-admin-settings__section-heading">
        <div>
          <h2 id="tenant-audit-heading">Änderungsprotokoll</h2>
          <p>
            {tn(
              "Wer hat wann was geändert? Filtere nach Person, Aktion, Objekt, Schweregrad und Zeitraum. Vertrauliche Werte werden verborgen.",
              "Wer hat wann was geändert? Filtern Sie nach Person, Aktion, Objekt, Schweregrad und Zeitraum. Vertrauliche Werte werden verborgen.",
            )}
          </p>
        </div>
        <div className="audit-view__export">
          <button
            type="button"
            className="secondary-button"
            disabled={exporting !== null}
            onClick={() => void runExport("csv")}
          >
            <Download aria-hidden="true" size={16} />
            {exporting === "csv" ? "Export läuft …" : "CSV exportieren"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={exporting !== null}
            onClick={() => void runExport("json")}
          >
            <Download aria-hidden="true" size={16} />
            {exporting === "json" ? "Export läuft …" : "JSON exportieren"}
          </button>
        </div>
      </div>
      <p className="tenant-admin-settings__hint">
        Exporte enthalten höchstens{" "}
        {AUDIT_EXPORT_MAX_ROWS.toLocaleString("de-CH")} Einträge des aktuellen
        Filters und werden selbst im Protokoll vermerkt.
      </p>
      {exportMessage ? (
        <p className="tenant-admin-settings__notice" role="status">
          {exportMessage}
        </p>
      ) : null}

      <form
        className="audit-view__filters"
        role="search"
        aria-label="Änderungsprotokoll filtern"
        onSubmit={(event) => {
          event.preventDefault();
          setAppliedFilters(filters);
        }}
      >
        <ActorFilter
          tenantId={tenantId}
          actorId={form.actorId}
          actorLabel={form.actorLabel}
          onChange={(actorId, actorLabel) => update({ actorId, actorLabel })}
        />
        <label>
          <span>Aktion</span>
          <select
            value={form.action}
            onChange={(event) => update({ action: event.target.value })}
          >
            <option value="">Alle Aktionen</option>
            {actionGroups.map((group) => (
              <optgroup key={group.area} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          <span>Objekttyp</span>
          <select
            value={form.entityType}
            onChange={(event) => update({ entityType: event.target.value })}
          >
            <option value="">Alle Objekttypen</option>
            {entityTypes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label === option.value
                  ? option.value
                  : `${option.label} (${option.value})`}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Schweregrad</span>
          <select
            value={form.severity}
            onChange={(event) => update({ severity: event.target.value })}
          >
            <option value="">Alle Schweregrade</option>
            {AUDIT_SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {auditSeverityLabel(severity)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Von</span>
          <input
            type="date"
            value={form.from}
            onChange={(event) => update({ from: event.target.value })}
          />
        </label>
        <label>
          <span>Bis</span>
          <input
            type="date"
            value={form.to}
            onChange={(event) => update({ to: event.target.value })}
          />
        </label>
        <label className="audit-view__free-text">
          <span>Freitext</span>
          <input
            type="search"
            maxLength={200}
            placeholder="Aktion, Objekt oder Details durchsuchen"
            value={form.freeText}
            onChange={(event) => update({ freeText: event.target.value })}
          />
        </label>
        <div className="audit-view__filter-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={filterCount === 0}
            onClick={() => setForm(EMPTY_AUDIT_FILTER_FORM)}
          >
            <RotateCcw aria-hidden="true" size={16} />
            Filter zurücksetzen
          </button>
        </div>
      </form>

      {error ? (
        <p
          className="tenant-admin-settings__notice tenant-admin-settings__notice--error"
          role="status"
        >
          {error}
        </p>
      ) : loading ? (
        <p className="tenant-admin-settings__loading" aria-live="polite">
          Änderungsprotokoll wird geladen …
        </p>
      ) : entries.length === 0 ? (
        <p>
          {filterCount > 0
            ? "Für diese Filter liegen keine Einträge vor."
            : "Für diesen Mandanten liegen noch keine Änderungen vor."}
        </p>
      ) : (
        <div className="audit-view__table-wrap">
          <table className="audit-view__table">
            <thead>
              <tr>
                <th scope="col">Zeitpunkt</th>
                <th scope="col">Aktion</th>
                <th scope="col">Person</th>
                <th scope="col">Objekt</th>
                <th scope="col">Schweregrad</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  tabIndex={0}
                  aria-label={`${auditActionLabel(entry.action)}, Details öffnen`}
                  className={
                    entry.id === selectedId ? "audit-view__row--active" : ""
                  }
                  onClick={() => setSelectedId(entry.id)}
                  onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(entry.id);
                    }
                  }}
                >
                  <td>
                    <time dateTime={entry.occurredAt}>
                      {formatTimestamp(entry.occurredAt)}
                    </time>
                  </td>
                  <td>
                    <span className="audit-view__area">
                      {auditAreaLabel(auditActionArea(entry.action))}
                    </span>
                    <strong>{auditActionLabel(entry.action)}</strong>
                    {hasAuditActionLabel(entry.action) ? (
                      <code>{entry.action}</code>
                    ) : null}
                  </td>
                  <td>{entry.actorName}</td>
                  <td>{auditEntityTypeLabel(entry.entityType)}</td>
                  <td>
                    <span
                      className={`audit-view__severity audit-view__severity--${entry.severity}`}
                    >
                      {auditSeverityLabel(entry.severity)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && !error && nextCursor ? (
        <button
          type="button"
          className="secondary-button audit-view__more"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? "Wird geladen …" : "Weitere Einträge laden"}
        </button>
      ) : null}

      {selectedId ? (
        <AuditDetailDrawer
          tenantId={tenantId}
          entryId={selectedId}
          onClose={() => setSelectedId(null)}
          {...(onOpenTicket ? { onOpenTicket } : {})}
        />
      ) : null}
    </section>
  );
}

function ActorFilter({
  tenantId,
  actorId,
  actorLabel,
  onChange,
}: {
  tenantId: string;
  actorId: string;
  actorLabel: string;
  onChange: (actorId: string, actorLabel: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [actors, setActors] = useState<AuditActor[]>([]);
  const [highlight, setHighlight] = useState(0);
  const listId = "audit-view-actor-options";

  useEffect(() => {
    if (!open) return;
    let active = true;
    const handle = window.setTimeout(() => {
      const trimmed = query.trim();
      void auditData<{ actors: AuditActor[] }>({
        type: "actors",
        tenantId,
        ...(trimmed ? { query: trimmed } : {}),
      })
        .then((result) => {
          if (!active) return;
          setActors(result.actors);
          setHighlight(0);
        })
        .catch(() => {
          if (active) setActors([]);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [open, query, tenantId]);

  const choose = (actor: AuditActor) => {
    onChange(actor.id, actor.name);
    setQuery("");
    setOpen(false);
  };

  if (actorId) {
    return (
      <div className="audit-view__actor">
        <span className="audit-view__label">Person</span>
        <span className="audit-view__chip">
          {actorLabel || "Ausgewählte Person"}
          <button
            type="button"
            aria-label="Personenfilter entfernen"
            onClick={() => onChange("", "")}
          >
            <X aria-hidden="true" size={14} />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="audit-view__actor">
      <label htmlFor="audit-view-actor" className="audit-view__label">
        Person
      </label>
      <div className="audit-view__combobox">
        <Search aria-hidden="true" size={16} />
        <input
          id="audit-view-actor"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && actors.length > 0}
          aria-controls={listId}
          autoComplete="off"
          placeholder="Name oder E-Mail suchen"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlight((value) =>
                Math.min(value + 1, Math.max(actors.length - 1, 0)),
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter" && open && actors[highlight]) {
              event.preventDefault();
              choose(actors[highlight]);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </div>
      {open && actors.length > 0 ? (
        <ul id={listId} role="listbox" className="audit-view__options">
          {actors.map((actor, index) => (
            <li
              key={actor.id}
              role="option"
              aria-selected={index === highlight}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(actor);
              }}
            >
              <strong>{actor.name}</strong>
              {actor.email && actor.email !== actor.name ? (
                <span>{actor.email}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function AuditDetailDrawer({
  tenantId,
  entryId,
  onClose,
  onOpenTicket,
}: {
  tenantId: string;
  entryId: string;
  onClose: () => void;
  onOpenTicket?: (ticketId: string) => void;
}) {
  const [entry, setEntry] = useState<AuditEntryDetail | null>(null);
  const [error, setError] = useState("");
  const [showUnchanged, setShowUnchanged] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let active = true;
    setEntry(null);
    setError("");
    void auditData<{ entry: AuditEntryDetail }>({
      type: "detail",
      tenantId,
      id: entryId,
    })
      .then((result) => {
        if (!active) return;
        // Defence in depth: the server already hides secrets.
        setEntry({
          ...result.entry,
          metadata: redactAuditSecrets(result.entry.metadata),
          beforeData: redactAuditSecrets(result.entry.beforeData),
          afterData: redactAuditSecrets(result.entry.afterData),
        });
      })
      .catch((nextError: unknown) => {
        if (active) {
          setError(
            errorText(nextError, "Der Eintrag konnte nicht geladen werden."),
          );
        }
      });
    return () => {
      active = false;
    };
  }, [entryId, tenantId]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const diff = useMemo(
    () => (entry ? auditDiff(entry.beforeData, entry.afterData) : []),
    [entry],
  );
  const visibleDiff = showUnchanged
    ? diff
    : diff.filter((item) => item.change !== "unchanged");
  const unchangedCount =
    diff.length - diff.filter((item) => item.change !== "unchanged").length;
  const metadataEntries =
    entry && isRecord(entry.metadata) ? Object.entries(entry.metadata) : [];

  return (
    <div
      className="audit-view__drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="audit-view__drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-view-drawer-title"
      >
        <header>
          <div>
            <p className="audit-view__area">
              {entry
                ? auditAreaLabel(auditActionArea(entry.action))
                : "Eintrag"}
            </p>
            <h3 id="audit-view-drawer-title">
              {entry ? auditActionLabel(entry.action) : "Protokolleintrag"}
            </h3>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="audit-view__close"
            aria-label="Details schliessen"
            onClick={onClose}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        {error ? (
          <p
            className="tenant-admin-settings__notice tenant-admin-settings__notice--error"
            role="status"
          >
            {error}
          </p>
        ) : !entry ? (
          <p className="tenant-admin-settings__loading" aria-live="polite">
            Eintrag wird geladen …
          </p>
        ) : (
          <>
            <dl className="audit-view__facts">
              <dt>Zeitpunkt</dt>
              <dd>
                <time dateTime={entry.occurredAt}>
                  {formatTimestamp(entry.occurredAt)}
                </time>
              </dd>
              <dt>Person</dt>
              <dd>{entry.actorName}</dd>
              <dt>Aktion (technisch)</dt>
              <dd>
                <code>{entry.action}</code>
              </dd>
              <dt>Objekt</dt>
              <dd>
                {auditEntityTypeLabel(entry.entityType)}
                {entry.entityId ? (
                  <>
                    {" "}
                    <code>{entry.entityId}</code>
                  </>
                ) : null}
              </dd>
              <dt>Schweregrad</dt>
              <dd>
                <span
                  className={`audit-view__severity audit-view__severity--${entry.severity}`}
                >
                  {auditSeverityLabel(entry.severity)}
                </span>
              </dd>
              {entry.requestId ? (
                <>
                  <dt>Anfrage-ID</dt>
                  <dd>
                    <code>{entry.requestId}</code>
                  </dd>
                </>
              ) : null}
              <dt>Audit-ID</dt>
              <dd>
                <code>{entry.id}</code>
              </dd>
            </dl>

            {entry.ticketId && onOpenTicket ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  const ticketId = entry.ticketId;
                  if (!ticketId) return;
                  onClose();
                  onOpenTicket(ticketId);
                }}
              >
                <ExternalLink aria-hidden="true" size={16} />
                Ticket öffnen
              </button>
            ) : null}

            <section aria-labelledby="audit-view-diff-heading">
              <div className="audit-view__subheading">
                <h4 id="audit-view-diff-heading">Änderungen</h4>
                {unchangedCount > 0 ? (
                  <label className="audit-view__toggle">
                    <input
                      type="checkbox"
                      checked={showUnchanged}
                      onChange={(event) =>
                        setShowUnchanged(event.target.checked)
                      }
                    />
                    Unveränderte Felder anzeigen ({unchangedCount})
                  </label>
                ) : null}
              </div>
              {diff.length === 0 ? (
                <p className="tenant-admin-settings__hint">
                  Für diesen Eintrag wurden keine Vorher/Nachher-Daten
                  gespeichert.
                </p>
              ) : visibleDiff.length === 0 ? (
                <p className="tenant-admin-settings__hint">
                  Keine geänderten Felder.
                </p>
              ) : (
                <table className="audit-view__diff">
                  <thead>
                    <tr>
                      <th scope="col">Feld</th>
                      <th scope="col">Vorher</th>
                      <th scope="col">Nachher</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDiff.map((item) => (
                      <tr
                        key={item.key}
                        className={`audit-view__diff--${item.change}`}
                      >
                        <th scope="row">
                          <code>{item.key}</code>
                          <span className="audit-view__diff-change">
                            {
                              {
                                added: "hinzugefügt",
                                removed: "entfernt",
                                changed: "geändert",
                                unchanged: "unverändert",
                              }[item.change]
                            }
                          </span>
                        </th>
                        <td>{formatAuditValue(item.before)}</td>
                        <td>{formatAuditValue(item.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section aria-labelledby="audit-view-metadata-heading">
              <h4 id="audit-view-metadata-heading">Metadaten</h4>
              {metadataEntries.length === 0 ? (
                <p className="tenant-admin-settings__hint">
                  Keine Metadaten vorhanden.
                </p>
              ) : (
                <dl className="audit-view__facts">
                  {metadataEntries.map(([key, value]) => (
                    <div key={key} className="audit-view__fact">
                      <dt>
                        <code>{key}</code>
                      </dt>
                      <dd>{formatAuditValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
