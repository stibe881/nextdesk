import {
  Download,
  Eye,
  FileText,
  History,
  Info,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type JSX,
} from "react";
import {
  functionErrorMessage,
  functionErrorStatus,
} from "./lib/function-error";
import { supabase } from "./lib/supabase";
import "./ops-center.css";

type AuditEntry = {
  action: string;
  actorId: string | null;
  actorName: string;
  entityId: string | null;
  entityType: string;
  id: string;
  occurredAt: string;
  severity: string;
};
type AuditFilters = {
  action: string;
  actorId: string;
  endAt: string;
  entityId: string;
  entityType: string;
  freeText: string;
  startAt: string;
};
type Macro = {
  categoryId: string | null;
  createdAt: string;
  id: string;
  name: string;
  priorityId: string | null;
  responseText: string | null;
  subcategoryId: string | null;
  templateId: string | null;
  updatedAt: string;
};
type MacroForm = {
  categoryId: string;
  id: string | null;
  name: string;
  priorityId: string;
  responseText: string;
  subcategoryId: string;
  templateId: string;
};
type MacroPreview = {
  categoryId: string | null;
  priorityId: string | null;
  responseText: string | null;
  subcategoryId: string | null;
};
type TenantFeature = {
  defaultEnabled: boolean;
  enabled: boolean;
  key: string;
  pilotEndsAt: string | null;
};

type ApiRecord = Record<string, unknown>;

const emptyFilters = (): AuditFilters => ({
  action: "",
  actorId: "",
  endAt: "",
  entityId: "",
  entityType: "",
  freeText: "",
  startAt: "",
});

const emptyMacroForm = (): MacroForm => ({
  categoryId: "",
  id: null,
  name: "",
  priorityId: "",
  responseText: "",
  subcategoryId: "",
  templateId: "",
});

function isRecord(value: unknown): value is ApiRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function nullableUuid(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : isUuid(value)
      ? value
      : null;
}

function parseAuditEntry(value: unknown): AuditEntry | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    typeof value.action !== "string" ||
    typeof value.entityType !== "string" ||
    (value.entityId !== null && !isUuid(value.entityId)) ||
    typeof value.severity !== "string" ||
    typeof value.occurredAt !== "string" ||
    (value.actorId !== null && !isUuid(value.actorId)) ||
    typeof value.actorName !== "string"
  ) {
    return null;
  }
  return {
    action: value.action,
    actorId: value.actorId,
    actorName: value.actorName,
    entityId: value.entityId,
    entityType: value.entityType,
    id: value.id,
    occurredAt: value.occurredAt,
    severity: value.severity,
  };
}

function parseAuditList(value: unknown): {
  entries: AuditEntry[];
  nextCursor: string | null;
} | null {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.entries) ||
    (value.data.nextCursor !== null &&
      typeof value.data.nextCursor !== "string") ||
    typeof value.data.truncated !== "boolean"
  ) {
    return null;
  }
  const entries = value.data.entries.map(parseAuditEntry);
  if (entries.some((entry) => entry === null)) return null;
  return {
    entries: entries as AuditEntry[],
    nextCursor: value.data.nextCursor,
  };
}

function parseMacro(value: unknown): Macro | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    typeof value.name !== "string" ||
    (value.response_text !== null && typeof value.response_text !== "string") ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string" ||
    (value.template_id !== null && !isUuid(value.template_id)) ||
    (value.category_id !== null && !isUuid(value.category_id)) ||
    (value.subcategory_id !== null && !isUuid(value.subcategory_id)) ||
    (value.priority_id !== null && !isUuid(value.priority_id))
  ) {
    return null;
  }
  return {
    categoryId: nullableUuid(value.category_id),
    createdAt: value.created_at,
    id: value.id,
    name: value.name,
    priorityId: nullableUuid(value.priority_id),
    responseText: value.response_text,
    subcategoryId: nullableUuid(value.subcategory_id),
    templateId: nullableUuid(value.template_id),
    updatedAt: value.updated_at,
  };
}

function parseMacroList(value: unknown): Macro[] | null {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.macros)
  ) {
    return null;
  }
  const macros = value.data.macros.map(parseMacro);
  return macros.some((macro) => macro === null) ? null : (macros as Macro[]);
}

function parseSavedMacro(value: unknown): Macro | null {
  return isRecord(value) && isRecord(value.data)
    ? parseMacro(value.data.macro)
    : null;
}

function parseMacroPreview(value: unknown): MacroPreview | null {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !isRecord(value.data.preview)
  ) {
    return null;
  }
  const preview = value.data.preview;
  if (
    (preview.responseText !== null &&
      typeof preview.responseText !== "string") ||
    (preview.categoryId !== null && !isUuid(preview.categoryId)) ||
    (preview.subcategoryId !== null && !isUuid(preview.subcategoryId)) ||
    (preview.priorityId !== null && !isUuid(preview.priorityId)) ||
    value.data.applied !== false
  ) {
    return null;
  }
  return {
    categoryId: preview.categoryId,
    priorityId: preview.priorityId,
    responseText: preview.responseText,
    subcategoryId: preview.subcategoryId,
  };
}

function parseFeatures(value: unknown): TenantFeature[] | null {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.features)
  ) {
    return null;
  }
  const features: TenantFeature[] = [];
  for (const feature of value.data.features) {
    if (
      !isRecord(feature) ||
      typeof feature.key !== "string" ||
      typeof feature.enabled !== "boolean" ||
      typeof feature.defaultEnabled !== "boolean" ||
      (feature.pilotEndsAt !== null && typeof feature.pilotEndsAt !== "string")
    ) {
      return null;
    }
    features.push({
      defaultEnabled: feature.defaultEnabled,
      enabled: feature.enabled,
      key: feature.key,
      pilotEndsAt: feature.pilotEndsAt,
    });
  }
  return features;
}

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function requestFilters(filters: AuditFilters): ApiRecord {
  const startAt = toIso(filters.startAt);
  const endAt = toIso(filters.endAt);
  return {
    ...(startAt ? { startAt } : {}),
    ...(endAt ? { endAt } : {}),
    ...(filters.action.trim() ? { action: filters.action.trim() } : {}),
    ...(filters.actorId.trim() ? { actorId: filters.actorId.trim() } : {}),
    ...(filters.entityType.trim()
      ? { entityType: filters.entityType.trim() }
      : {}),
    ...(filters.entityId.trim() ? { entityId: filters.entityId.trim() } : {}),
    ...(filters.freeText.trim() ? { freeText: filters.freeText.trim() } : {}),
  };
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Zeitpunkt unbekannt"
    : new Intl.DateTimeFormat("de-CH", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function compactId(value: string | null): string {
  return value ? `${value.slice(0, 8)}…${value.slice(-4)}` : "–";
}

function macroFormFrom(macro: Macro): MacroForm {
  return {
    categoryId: macro.categoryId ?? "",
    id: macro.id,
    name: macro.name,
    priorityId: macro.priorityId ?? "",
    responseText: macro.responseText ?? "",
    subcategoryId: macro.subcategoryId ?? "",
    templateId: macro.templateId ?? "",
  };
}

function isQuietlyUnavailable(error: unknown): boolean {
  const status = functionErrorStatus(error);
  return status === 401 || status === 403 || status === 404;
}

function MacroEditor({
  form,
  onCancel,
  onChange,
  onPreview,
  onSave,
  preview,
  saving,
}: {
  form: MacroForm;
  onCancel: () => void;
  onChange: (next: MacroForm) => void;
  onPreview: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  preview: MacroPreview | null;
  saving: boolean;
}) {
  const update = (field: keyof MacroForm, value: string) =>
    onChange({ ...form, [field]: value });

  return (
    <section
      aria-labelledby="ops-center-macro-editor-heading"
      className="ops-center__macro-editor"
    >
      <div className="ops-center__section-heading">
        <div>
          <p className="eyebrow">MAKRO</p>
          <h3 id="ops-center-macro-editor-heading">
            {form.id ? "Makro bearbeiten" : "Neues Makro"}
          </h3>
        </div>
        <button disabled={saving} onClick={onCancel} type="button">
          Abbrechen
        </button>
      </div>
      <form onSubmit={onSave}>
        <label>
          Name
          <input
            autoFocus
            disabled={saving}
            maxLength={160}
            onChange={(event) => update("name", event.target.value)}
            placeholder="Zum Beispiel: VPN-Zugang prüfen"
            required
            value={form.name}
          />
        </label>
        <label className="ops-center__wide-field">
          Antworttext
          <textarea
            disabled={saving}
            maxLength={10_000}
            onChange={(event) => update("responseText", event.target.value)}
            placeholder="Formulieren Sie eine Antwortvorlage. Sie wird erst nach Ihrer Prüfung verwendet."
            rows={5}
            value={form.responseText}
          />
          <span className="data-caption">
            {[...form.responseText].length}/10&apos;000 Zeichen
          </span>
        </label>
        <details className="ops-center__macro-routing">
          <summary>Optionale Zuordnung</summary>
          <p className="data-caption">
            Die Zuordnung wird nur als Makrovorschlag gespeichert und ändert
            kein Ticket automatisch.
          </p>
          <div>
            <label>
              Vorlagen-ID
              <input
                disabled={saving}
                onChange={(event) => update("templateId", event.target.value)}
                placeholder="UUID, optional"
                value={form.templateId}
              />
            </label>
            <label>
              Kategorie-ID
              <input
                disabled={saving}
                onChange={(event) => update("categoryId", event.target.value)}
                placeholder="UUID, optional"
                value={form.categoryId}
              />
            </label>
            <label>
              Unterkategorie-ID
              <input
                disabled={saving}
                onChange={(event) =>
                  update("subcategoryId", event.target.value)
                }
                placeholder="UUID, optional"
                value={form.subcategoryId}
              />
            </label>
            <label>
              Prioritäts-ID
              <input
                disabled={saving}
                onChange={(event) => update("priorityId", event.target.value)}
                placeholder="UUID, optional"
                value={form.priorityId}
              />
            </label>
          </div>
        </details>
        <div className="ops-center__form-actions">
          <button
            className="secondary-button"
            disabled={saving || !form.name.trim()}
            onClick={onPreview}
            type="button"
          >
            <Eye aria-hidden="true" size={16} strokeWidth={1.9} />
            Vorschau
          </button>
          <button
            className="primary-button"
            disabled={saving || !form.name.trim()}
            type="submit"
          >
            {saving ? (
              <LoaderCircle
                aria-hidden="true"
                className="ops-center__spinner"
                size={16}
              />
            ) : (
              <Save aria-hidden="true" size={16} strokeWidth={1.9} />
            )}
            {saving ? "Wird gespeichert …" : "Makro speichern"}
          </button>
        </div>
      </form>
      {preview && (
        <aside aria-live="polite" className="ops-center__macro-preview">
          <div>
            <Eye aria-hidden="true" size={17} strokeWidth={1.9} />
            <strong>Vorschau ohne Anwendung</strong>
          </div>
          <p>{preview.responseText || "Kein Antworttext hinterlegt."}</p>
          <dl>
            <div>
              <dt>Kategorie</dt>
              <dd>{compactId(preview.categoryId)}</dd>
            </div>
            <div>
              <dt>Unterkategorie</dt>
              <dd>{compactId(preview.subcategoryId)}</dd>
            </div>
            <div>
              <dt>Priorität</dt>
              <dd>{compactId(preview.priorityId)}</dd>
            </div>
          </dl>
          <p className="data-caption">
            Die Vorschau hat kein Ticket und keine Zuweisung geändert.
          </p>
        </aside>
      )}
    </section>
  );
}

export function OpsCenterPanel(props: {
  tenantId: string;
  canManage: boolean;
}): JSX.Element {
  const { canManage, tenantId } = props;
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditFilters, setAuditFilters] = useState<AuditFilters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] =
    useState<AuditFilters>(emptyFilters);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditLoadingMore, setAuditLoadingMore] = useState(false);
  const [auditNote, setAuditNote] = useState("");
  const [auditUnavailable, setAuditUnavailable] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [macroEditor, setMacroEditor] = useState<MacroForm | null>(null);
  const [macroLoading, setMacroLoading] = useState(false);
  const [macroNote, setMacroNote] = useState("");
  const [macroPreview, setMacroPreview] = useState<MacroPreview | null>(null);
  const [macroSaving, setMacroSaving] = useState(false);
  const [macrosUnavailable, setMacrosUnavailable] = useState(false);
  const [features, setFeatures] = useState<TenantFeature[]>([]);
  const [featuresLoading, setFeaturesLoading] = useState(false);
  const [featuresUnavailable, setFeaturesUnavailable] = useState(false);

  const loadAudits = useCallback(
    async (filters: AuditFilters, cursor?: string, append = false) => {
      if (!supabase || !canManage) return;
      append ? setAuditLoadingMore(true) : setAuditLoading(true);
      setAuditNote("");
      try {
        const { data, error } = await supabase.functions.invoke(
          "tenant-audit-log",
          {
            body: {
              ...requestFilters(filters),
              ...(cursor ? { cursor } : {}),
              limit: 50,
              tenantId,
              type: "list",
            },
          },
        );
        if (error) throw error;
        const parsed = parseAuditList(data);
        if (!parsed) throw new Error("invalid_audit_log_response");
        setAuditEntries((current) =>
          append ? [...current, ...parsed.entries] : parsed.entries,
        );
        setAuditCursor(parsed.nextCursor);
        setAuditUnavailable(false);
      } catch (error) {
        if (isQuietlyUnavailable(error)) {
          if (!append) setAuditEntries([]);
          setAuditCursor(null);
          setAuditUnavailable(true);
          return;
        }
        if (!append) setAuditEntries([]);
        setAuditCursor(null);
        setAuditNote(
          await functionErrorMessage(
            error,
            "Das Änderungsprotokoll konnte nicht geladen werden.",
          ),
        );
      } finally {
        append ? setAuditLoadingMore(false) : setAuditLoading(false);
      }
    },
    [canManage, tenantId],
  );

  const loadMacros = useCallback(async () => {
    if (!supabase || !canManage) return;
    setMacroLoading(true);
    setMacroNote("");
    try {
      const { data, error } = await supabase.functions.invoke(
        "agent-workbench",
        {
          body: { tenantId, type: "listMacros" },
        },
      );
      if (error) throw error;
      const parsed = parseMacroList(data);
      if (!parsed) throw new Error("invalid_macro_response");
      setMacros(parsed);
      setMacrosUnavailable(false);
    } catch (error) {
      setMacros([]);
      if (isQuietlyUnavailable(error)) {
        setMacrosUnavailable(true);
      } else {
        setMacroNote(
          await functionErrorMessage(
            error,
            "Die Makros konnten nicht geladen werden.",
          ),
        );
      }
    } finally {
      setMacroLoading(false);
    }
  }, [canManage, tenantId]);

  const loadFeatures = useCallback(async () => {
    if (!supabase || !canManage) return;
    setFeaturesLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "tenant-feature-flags",
        { body: { tenantId, type: "list" } },
      );
      if (error) throw error;
      const parsed = parseFeatures(data);
      if (!parsed) throw new Error("invalid_feature_response");
      setFeatures(parsed);
      setFeaturesUnavailable(false);
    } catch {
      setFeatures([]);
      setFeaturesUnavailable(true);
    } finally {
      setFeaturesLoading(false);
    }
  }, [canManage, tenantId]);

  useEffect(() => {
    setAuditEntries([]);
    setAuditCursor(null);
    setAuditNote("");
    setAuditUnavailable(false);
    setAuditFilters(emptyFilters());
    const initialFilters = emptyFilters();
    setAppliedFilters(initialFilters);
    setMacroEditor(null);
    setMacroPreview(null);
    if (!canManage || !supabase) return;
    void loadAudits(initialFilters);
    void loadMacros();
    void loadFeatures();
  }, [canManage, loadAudits, loadFeatures, loadMacros, tenantId]);

  const activeFeatureCount = useMemo(
    () => features.filter((feature) => feature.enabled).length,
    [features],
  );

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedFilters(auditFilters);
    void loadAudits(auditFilters);
  };

  const clearFilters = () => {
    const next = emptyFilters();
    setAuditFilters(next);
    setAppliedFilters(next);
    void loadAudits(next);
  };

  const exportAudit = async () => {
    if (!supabase || exporting) return;
    setExporting(true);
    setAuditNote("");
    try {
      const { data, error, response } = await supabase.functions.invoke<string>(
        "tenant-audit-log",
        {
          body: {
            ...requestFilters(appliedFilters),
            limit: 1_000,
            tenantId,
            type: "exportCsv",
          },
        },
      );
      if (error) throw error;
      if (typeof data !== "string") throw new Error("invalid_audit_export");
      const url = URL.createObjectURL(
        new Blob([data], { type: "text/csv;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `nextdesk-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setAuditNote(
        response?.headers.get("X-NextDesk-Export-Truncated") === "true"
          ? "Die CSV wurde aus Sicherheitsgründen auf 1'000 Einträge begrenzt. Verfeinern Sie die Suche für weitere Einträge."
          : "Die CSV-Datei wurde heruntergeladen. Der Export wurde im Änderungsprotokoll festgehalten.",
      );
    } catch (error) {
      if (isQuietlyUnavailable(error)) {
        setAuditUnavailable(true);
      } else {
        setAuditNote(
          await functionErrorMessage(
            error,
            "Die CSV-Datei konnte nicht erstellt werden.",
          ),
        );
      }
    } finally {
      setExporting(false);
    }
  };

  const saveMacro = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !macroEditor || macroSaving) return;
    const name = macroEditor.name.trim();
    if (!name) return;
    setMacroSaving(true);
    setMacroNote("");
    try {
      const { data, error } = await supabase.functions.invoke(
        "agent-workbench",
        {
          body: {
            ...(macroEditor.id ? { macroId: macroEditor.id } : {}),
            categoryId: macroEditor.categoryId.trim() || null,
            name,
            priorityId: macroEditor.priorityId.trim() || null,
            responseText: macroEditor.responseText.trim() || null,
            subcategoryId: macroEditor.subcategoryId.trim() || null,
            templateId: macroEditor.templateId.trim() || null,
            tenantId,
            type: "saveMacro",
          },
        },
      );
      if (error) throw error;
      const saved = parseSavedMacro(data);
      if (!saved) throw new Error("invalid_saved_macro_response");
      setMacros((current) => {
        const exists = current.some((macro) => macro.id === saved.id);
        const next = exists
          ? current.map((macro) => (macro.id === saved.id ? saved : macro))
          : [...current, saved];
        return next.sort((left, right) =>
          left.name.localeCompare(right.name, "de-CH"),
        );
      });
      setMacroEditor(null);
      setMacroPreview(null);
      setMacroNote("Makro wurde gespeichert. Es wurde kein Ticket verändert.");
    } catch (error) {
      if (isQuietlyUnavailable(error)) {
        setMacrosUnavailable(true);
        setMacroEditor(null);
      } else {
        setMacroNote(
          await functionErrorMessage(
            error,
            "Das Makro konnte nicht gespeichert werden.",
          ),
        );
      }
    } finally {
      setMacroSaving(false);
    }
  };

  const previewMacro = async () => {
    if (!supabase || !macroEditor || macroSaving) return;
    const name = macroEditor.name.trim();
    if (!name) return;
    setMacroSaving(true);
    setMacroNote("");
    try {
      const { data, error } = await supabase.functions.invoke(
        "agent-workbench",
        {
          body: macroEditor.id
            ? { macroId: macroEditor.id, tenantId, type: "previewMacro" }
            : {
                categoryId: macroEditor.categoryId.trim() || null,
                priorityId: macroEditor.priorityId.trim() || null,
                responseText: macroEditor.responseText.trim() || null,
                subcategoryId: macroEditor.subcategoryId.trim() || null,
                tenantId,
                type: "previewMacro",
              },
        },
      );
      if (error) throw error;
      const preview = parseMacroPreview(data);
      if (!preview) throw new Error("invalid_macro_preview_response");
      setMacroPreview(preview);
    } catch (error) {
      if (isQuietlyUnavailable(error)) {
        setMacrosUnavailable(true);
        setMacroEditor(null);
      } else {
        setMacroNote(
          await functionErrorMessage(
            error,
            "Die Makrovorschau konnte nicht geladen werden.",
          ),
        );
      }
    } finally {
      setMacroSaving(false);
    }
  };

  if (!canManage) {
    return (
      <section
        className="ops-center ops-center--unavailable"
        aria-live="polite"
      >
        <Info aria-hidden="true" size={20} strokeWidth={1.9} />
        <div>
          <strong>Ops Center nicht verfügbar</strong>
          <p>
            Für diese Verwaltungsansicht fehlt die erforderliche Berechtigung.
          </p>
        </div>
      </section>
    );
  }

  if (!supabase) {
    return (
      <section
        className="ops-center ops-center--unavailable"
        aria-live="polite"
      >
        <Info aria-hidden="true" size={20} strokeWidth={1.9} />
        <div>
          <strong>Ops Center nicht verfügbar</strong>
          <p>Diese Umgebung ist noch nicht mit nextDesk verbunden.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="ops-center" aria-labelledby="ops-center-heading">
      <header className="ops-center__header">
        <div>
          <p className="eyebrow">MANDANTENBETRIEB</p>
          <h2 id="ops-center-heading">Ops Center</h2>
          <p>
            Prüfen Sie Änderungen, pflegen Sie Antwortmakros und behalten Sie
            Freigaben im Blick.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={auditLoading || macroLoading || featuresLoading}
          onClick={() => {
            void loadAudits(appliedFilters);
            void loadMacros();
            void loadFeatures();
          }}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} strokeWidth={1.9} />
          Aktualisieren
        </button>
      </header>

      <div className="ops-center__layout">
        <section
          className="ops-center__card ops-center__audit"
          aria-labelledby="ops-center-audit-heading"
        >
          <div className="ops-center__section-heading">
            <div>
              <p className="eyebrow">NACHVOLLZIEHBARKEIT</p>
              <h3 id="ops-center-audit-heading">
                <History aria-hidden="true" size={18} strokeWidth={1.9} />
                Änderungsprotokoll
              </h3>
            </div>
            <button
              className="secondary-button"
              disabled={auditUnavailable || exporting || auditLoading}
              onClick={() => void exportAudit()}
              type="button"
            >
              {exporting ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="ops-center__spinner"
                  size={16}
                />
              ) : (
                <Download aria-hidden="true" size={16} strokeWidth={1.9} />
              )}
              CSV herunterladen
            </button>
          </div>

          {auditUnavailable ? (
            <div className="ops-center__quiet-state" role="status">
              <ShieldCheck aria-hidden="true" size={20} strokeWidth={1.9} />
              <div>
                <strong>Änderungsprotokoll nicht verfügbar</strong>
                <p>
                  Das Protokoll ist für diesen Mandanten oder Ihre Berechtigung
                  derzeit nicht verfügbar.
                </p>
              </div>
            </div>
          ) : (
            <>
              <form className="ops-center__filters" onSubmit={submitFilters}>
                <label>
                  Von
                  <input
                    onChange={(event) =>
                      setAuditFilters((current) => ({
                        ...current,
                        startAt: event.target.value,
                      }))
                    }
                    type="datetime-local"
                    value={auditFilters.startAt}
                  />
                </label>
                <label>
                  Bis
                  <input
                    onChange={(event) =>
                      setAuditFilters((current) => ({
                        ...current,
                        endAt: event.target.value,
                      }))
                    }
                    type="datetime-local"
                    value={auditFilters.endAt}
                  />
                </label>
                <label>
                  Aktion
                  <input
                    maxLength={120}
                    onChange={(event) =>
                      setAuditFilters((current) => ({
                        ...current,
                        action: event.target.value,
                      }))
                    }
                    placeholder="Zum Beispiel: ticket.updated"
                    value={auditFilters.action}
                  />
                </label>
                <label>
                  Person (Benutzer-ID)
                  <input
                    maxLength={36}
                    onChange={(event) =>
                      setAuditFilters((current) => ({
                        ...current,
                        actorId: event.target.value,
                      }))
                    }
                    placeholder="UUID"
                    value={auditFilters.actorId}
                  />
                </label>
                <label>
                  Objekttyp
                  <input
                    maxLength={120}
                    onChange={(event) =>
                      setAuditFilters((current) => ({
                        ...current,
                        entityType: event.target.value,
                      }))
                    }
                    placeholder="Zum Beispiel: ticket"
                    value={auditFilters.entityType}
                  />
                </label>
                <label>
                  Objekt-ID
                  <input
                    maxLength={36}
                    onChange={(event) =>
                      setAuditFilters((current) => ({
                        ...current,
                        entityId: event.target.value,
                      }))
                    }
                    placeholder="UUID"
                    value={auditFilters.entityId}
                  />
                </label>
                <label className="ops-center__filter-search">
                  Freitext
                  <input
                    maxLength={120}
                    onChange={(event) =>
                      setAuditFilters((current) => ({
                        ...current,
                        freeText: event.target.value,
                      }))
                    }
                    placeholder="Aktion oder Objekttyp"
                    value={auditFilters.freeText}
                  />
                </label>
                <div className="ops-center__filter-actions">
                  <button
                    className="primary-button"
                    disabled={auditLoading}
                    type="submit"
                  >
                    <Settings2 aria-hidden="true" size={16} strokeWidth={1.9} />
                    Suchen
                  </button>
                  <button
                    disabled={auditLoading}
                    onClick={clearFilters}
                    type="button"
                  >
                    Filter zurücksetzen
                  </button>
                </div>
              </form>

              {auditNote && (
                <p className="ops-center__message" role="status">
                  {auditNote}
                </p>
              )}
              {auditLoading ? (
                <p
                  className="ops-center__loading"
                  aria-busy="true"
                  role="status"
                >
                  <LoaderCircle
                    aria-hidden="true"
                    className="ops-center__spinner"
                    size={18}
                  />
                  Änderungsprotokoll wird geladen …
                </p>
              ) : auditEntries.length === 0 ? (
                <div className="ops-center__empty-state">
                  <FileText aria-hidden="true" size={21} strokeWidth={1.8} />
                  <div>
                    <strong>Keine Einträge gefunden</strong>
                    <p>Passen Sie bei Bedarf Zeitraum oder Filter an.</p>
                  </div>
                </div>
              ) : (
                <div className="ops-center__table-wrap">
                  <table>
                    <caption className="sr-only">
                      Gefilterte Einträge im Änderungsprotokoll
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Zeitpunkt</th>
                        <th scope="col">Aktion</th>
                        <th scope="col">Person</th>
                        <th scope="col">Objekt</th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditEntries.map((entry) => (
                        <tr key={entry.id}>
                          <td data-label="Zeitpunkt">
                            {formatDateTime(entry.occurredAt)}
                          </td>
                          <td data-label="Aktion">
                            <code>{entry.action}</code>
                          </td>
                          <td data-label="Person">
                            <strong>{entry.actorName}</strong>
                            {entry.actorId && (
                              <span className="ops-center__id">
                                {compactId(entry.actorId)}
                              </span>
                            )}
                          </td>
                          <td data-label="Objekt">
                            <strong>{entry.entityType}</strong>
                            <span className="ops-center__id">
                              {compactId(entry.entityId)}
                            </span>
                          </td>
                          <td data-label="Status">
                            <span className="ops-center__severity">
                              {entry.severity}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {auditCursor && !auditLoading && (
                <button
                  className="ops-center__load-more"
                  disabled={auditLoadingMore}
                  onClick={() =>
                    void loadAudits(appliedFilters, auditCursor, true)
                  }
                  type="button"
                >
                  {auditLoadingMore ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="ops-center__spinner"
                      size={16}
                    />
                  ) : null}
                  {auditLoadingMore
                    ? "Weitere Einträge werden geladen …"
                    : "Weitere Einträge laden"}
                </button>
              )}
            </>
          )}
        </section>

        <aside className="ops-center__side-column">
          <section
            className="ops-center__card"
            aria-labelledby="ops-center-macros-heading"
          >
            <div className="ops-center__section-heading">
              <div>
                <p className="eyebrow">ANTWORTVORLAGEN</p>
                <h3 id="ops-center-macros-heading">Makros</h3>
              </div>
              {!macrosUnavailable && !macroEditor && (
                <button
                  className="secondary-button"
                  disabled={macroLoading}
                  onClick={() => {
                    setMacroEditor(emptyMacroForm());
                    setMacroPreview(null);
                    setMacroNote("");
                  }}
                  type="button"
                >
                  <Plus aria-hidden="true" size={16} strokeWidth={1.9} />
                  Makro anlegen
                </button>
              )}
            </div>

            {macroNote && (
              <p className="ops-center__message" role="status">
                {macroNote}
              </p>
            )}
            {macrosUnavailable ? (
              <div className="ops-center__quiet-state" role="status">
                <Info aria-hidden="true" size={20} strokeWidth={1.9} />
                <div>
                  <strong>Makroverwaltung nicht verfügbar</strong>
                  <p>
                    Die Agentenwerkbank ist für diesen Mandanten oder Ihre
                    Berechtigung derzeit nicht verfügbar.
                  </p>
                </div>
              </div>
            ) : macroEditor ? (
              <MacroEditor
                form={macroEditor}
                onCancel={() => {
                  setMacroEditor(null);
                  setMacroPreview(null);
                }}
                onChange={setMacroEditor}
                onPreview={() => void previewMacro()}
                onSave={(event) => void saveMacro(event)}
                preview={macroPreview}
                saving={macroSaving}
              />
            ) : macroLoading ? (
              <p className="ops-center__loading" aria-busy="true" role="status">
                <LoaderCircle
                  aria-hidden="true"
                  className="ops-center__spinner"
                  size={18}
                />
                Makros werden geladen …
              </p>
            ) : macros.length === 0 ? (
              <div className="ops-center__empty-state">
                <FileText aria-hidden="true" size={21} strokeWidth={1.8} />
                <div>
                  <strong>Noch keine Makros</strong>
                  <p>
                    Erstellen Sie eine Antwortvorlage für wiederkehrende
                    Anliegen.
                  </p>
                </div>
              </div>
            ) : (
              <ul className="ops-center__macro-list">
                {macros.map((macro) => (
                  <li key={macro.id}>
                    <div>
                      <strong>{macro.name}</strong>
                      <p>
                        {macro.responseText || "Kein Antworttext hinterlegt."}
                      </p>
                      <span>
                        Zuletzt geändert: {formatDateTime(macro.updatedAt)}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setMacroEditor(macroFormFrom(macro));
                        setMacroPreview(null);
                        setMacroNote("");
                      }}
                      type="button"
                    >
                      Bearbeiten
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            className="ops-center__card"
            aria-labelledby="ops-center-system-heading"
          >
            <div className="ops-center__section-heading">
              <div>
                <p className="eyebrow">READ-ONLY</p>
                <h3 id="ops-center-system-heading">Systemstatus</h3>
              </div>
              {!featuresUnavailable && !featuresLoading && (
                <span className="ops-center__count">
                  {activeFeatureCount} aktiv
                </span>
              )}
            </div>
            {featuresLoading ? (
              <p className="ops-center__loading" aria-busy="true" role="status">
                <LoaderCircle
                  aria-hidden="true"
                  className="ops-center__spinner"
                  size={18}
                />
                Funktionsstatus wird geladen …
              </p>
            ) : featuresUnavailable ? (
              <div className="ops-center__quiet-state" role="status">
                <Info aria-hidden="true" size={20} strokeWidth={1.9} />
                <div>
                  <strong>Systemstatus nicht verfügbar</strong>
                  <p>
                    Der aktuelle Funktionsstatus kann gerade nicht sicher
                    gelesen werden.
                  </p>
                </div>
              </div>
            ) : features.length === 0 ? (
              <div className="ops-center__empty-state">
                <Info aria-hidden="true" size={21} strokeWidth={1.8} />
                <div>
                  <strong>Keine Funktionsdaten vorhanden</strong>
                  <p>
                    Für diesen Mandanten sind noch keine Statusdaten hinterlegt.
                  </p>
                </div>
              </div>
            ) : (
              <ul className="ops-center__feature-list">
                {features.map((feature) => (
                  <li key={feature.key}>
                    <span>
                      <strong>{feature.key}</strong>
                      {feature.pilotEndsAt && (
                        <small>
                          Testlauf bis {formatDateTime(feature.pilotEndsAt)}
                        </small>
                      )}
                    </span>
                    <span
                      className={`ops-center__feature-state${feature.enabled ? " is-active" : ""}`}
                    >
                      {feature.enabled ? "Aktiv" : "Deaktiviert"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="ops-center__integration-note">
              <div>
                <ShieldCheck aria-hidden="true" size={18} strokeWidth={1.9} />
                <strong>Bewusst noch deaktiviert</strong>
              </div>
              <p>
                E-Mail, Push, Webhooks, KI, Intune-Abgleich und
                Entra-Vollabgleich bleiben deaktiviert. Jede dieser
                Integrationen braucht eine ausdrückliche Freigabe.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
