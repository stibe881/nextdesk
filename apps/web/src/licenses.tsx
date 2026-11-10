import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  Bell,
  CalendarClock,
  FileText,
  Paperclip,
  PiggyBank,
  Plus,
  RefreshCw,
  Users,
  X,
} from "lucide-react";
import {
  FormCard,
  FormDialog,
  FormField,
  FormGrid,
  FormSummary,
} from "./form-kit";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import {
  RecordAttachments,
  uploadRecordAttachment,
} from "./record-attachments";
import {
  departmentLabel,
  initialDepartmentId,
  parseDepartmentOptions,
  type DepartmentOption,
} from "./lib/contract-departments";
import { COST_PERIOD_LABEL, formatMoney } from "./lib/license-reclaim";
import { LicenseReclaimPanel, LicenseSeatsDialog } from "./license-reclaim";

type LicenseStatus = "draft" | "active" | "terminated" | "archived";
type LicenseType = string;
type License = {
  id: string;
  title: string;
  vendorName: string;
  referenceNumber: string | null;
  licenseType: LicenseType;
  quantity: number | null;
  status: LicenseStatus;
  startsOn: string | null;
  endsOn: string | null;
  noticePeriodDays: number | null;
  reminderDaysBefore: number | null;
  reminderSentFor: string | null;
  departmentId: string | null;
  responsibleUserId: string | null;
  notes: string | null;
  /** Kosten eines Platzes pro Periode (für die Rückgewinnung). */
  seatCostAmount?: number | null;
  seatCostCurrency?: "CHF" | "EUR" | "USD";
  seatCostPeriod?: "monthly" | "quarterly" | "yearly" | "one_time" | null;
  /** Microsoft-365-SKU (optional, für das Entfernen in Entra). */
  m365SkuId?: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type Person = { id: string; displayName: string };
type Form = {
  id: string | null;
  title: string;
  vendorName: string;
  referenceNumber: string;
  licenseType: LicenseType;
  quantity: string;
  status: Exclude<LicenseStatus, "archived">;
  startsOn: string;
  endsOn: string;
  noticePeriodDays: string;
  reminderDaysBefore: string;
  departmentId: string;
  responsibleUserId: string;
  notes: string;
  seatCostAmount: string;
  seatCostCurrency: "CHF" | "EUR" | "USD";
  seatCostPeriod: "" | "monthly" | "quarterly" | "yearly" | "one_time";
  m365SkuId: string;
};
const EMPTY: Form = {
  id: null,
  title: "",
  vendorName: "",
  referenceNumber: "",
  licenseType: "subscription",
  quantity: "",
  status: "draft",
  startsOn: "",
  endsOn: "",
  noticePeriodDays: "",
  reminderDaysBefore: "",
  departmentId: "",
  responsibleUserId: "",
  notes: "",
  seatCostAmount: "",
  seatCostCurrency: "CHF",
  seatCostPeriod: "",
  m365SkuId: "",
};
const statusLabel: Record<LicenseStatus, string> = {
  draft: "Entwurf",
  active: "Aktiv",
  terminated: "Beendet",
  archived: "Archiviert",
};
const typeLabel: Record<string, string> = {
  subscription: "Abonnement",
  perpetual: "Unbefristet (Kauf)",
  volume: "Volumenlizenz",
  open_source: "Open Source",
  other: "Weitere",
};
const typeText = (type: string) =>
  Object.hasOwn(typeLabel, type) ? (typeLabel[type] ?? type) : type;
const NEW_TYPE = "__new__";
const REMINDER_OPTIONS = [7, 14, 30, 60, 90, 180];
const today = () => new Date().toISOString().slice(0, 10);
const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("de-CH", { dateStyle: "medium" }).format(
        new Date(`${value}T12:00:00`),
      )
    : "Ohne Ablaufdatum";
function deadline(
  contract: License,
): { label: string; tone: "neutral" | "warning" | "danger" } | null {
  if (!contract.endsOn) return null;
  const end = new Date(`${contract.endsOn}T12:00:00`);
  const notice =
    contract.noticePeriodDays === null
      ? null
      : new Date(end.getTime() - contract.noticePeriodDays * 86_400_000);
  const now = new Date(`${today()}T12:00:00`);
  const days = Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
  const noticeDays = notice
    ? Math.ceil((notice.getTime() - now.getTime()) / 86_400_000)
    : null;
  if (days < 0) return { label: "Laufzeit abgelaufen", tone: "danger" };
  if (noticeDays !== null && noticeDays <= 0)
    return { label: "Kündigung fällig", tone: "danger" };
  if (noticeDays !== null && noticeDays <= 30)
    return { label: `Kündigung in ${noticeDays} Tagen`, tone: "warning" };
  if (days <= 30)
    return { label: `Läuft in ${days} Tagen ab`, tone: "warning" };
  return {
    label: `Läuft am ${formatDate(contract.endsOn)} ab`,
    tone: "neutral",
  };
}
function formFor(contract: License): Form {
  return {
    id: contract.id,
    title: contract.title,
    vendorName: contract.vendorName,
    referenceNumber: contract.referenceNumber ?? "",
    licenseType: contract.licenseType,
    quantity: contract.quantity === null ? "" : String(contract.quantity),
    status: contract.status === "archived" ? "terminated" : contract.status,
    startsOn: contract.startsOn ?? "",
    endsOn: contract.endsOn ?? "",
    noticePeriodDays:
      contract.noticePeriodDays === null
        ? ""
        : String(contract.noticePeriodDays),
    reminderDaysBefore:
      contract.reminderDaysBefore === null
        ? ""
        : String(contract.reminderDaysBefore),
    departmentId: contract.departmentId ?? "",
    responsibleUserId: contract.responsibleUserId ?? "",
    notes: contract.notes ?? "",
    seatCostAmount:
      contract.seatCostAmount === null || contract.seatCostAmount === undefined
        ? ""
        : String(contract.seatCostAmount),
    seatCostCurrency: contract.seatCostCurrency ?? "CHF",
    seatCostPeriod: contract.seatCostPeriod ?? "",
    m365SkuId: contract.m365SkuId ?? "",
  };
}
function responseData(value: unknown): Record<string, unknown> | null {
  return value &&
    typeof value === "object" &&
    "data" in value &&
    value.data &&
    typeof value.data === "object"
    ? (value.data as Record<string, unknown>)
    : null;
}
function parseLicenses(value: unknown): License[] | null {
  const data = responseData(value);
  return data && Array.isArray(data.licenses)
    ? (data.licenses as License[])
    : null;
}
function parsePeople(value: unknown): Person[] | null {
  const data = responseData(value);
  return data && Array.isArray(data.people) ? (data.people as Person[]) : null;
}

export function Licenses({
  createRequestId,
  onCreateRequestConsumed,
  tenantId,
}: {
  createRequestId?: number | undefined;
  onCreateRequestConsumed?: (requestId: number) => void;
  tenantId: string;
}) {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | LicenseStatus>("all");
  const [type, setType] = useState<"all" | LicenseType>("all");
  const [due, setDue] = useState<"all" | "due" | "30" | "no-end">("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [pending, setPending] = useState(false);
  const [addingType, setAddingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [documentsFor, setDocumentsFor] = useState<License | null>(null);
  const [seatsFor, setSeatsFor] = useState<License | null>(null);
  const [reclaimOpen, setReclaimOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const load = async () => {
    if (!supabase) return;
    setLoading(true);
    setError("");
    try {
      const [licensesResult, peopleResult] = await Promise.all([
        supabase.functions.invoke("licenses", {
          body: { type: "list", tenantId, includeArchived },
        }),
        supabase.functions.invoke("licenses", {
          body: { type: "listPeople", tenantId },
        }),
      ]);
      if (licensesResult.error || peopleResult.error)
        throw new Error("load_failed");
      const nextLicenses = parseLicenses(licensesResult.data);
      const nextPeople = parsePeople(peopleResult.data);
      if (!nextLicenses || !nextPeople) throw new Error("invalid_response");
      setLicenses(nextLicenses);
      setDepartments(parseDepartmentOptions(responseData(licensesResult.data)));
      setPeople(
        nextPeople.sort((a, b) =>
          a.displayName.localeCompare(b.displayName, "de-CH"),
        ),
      );
    } catch {
      setError(
        "Lizenzen konnten nicht geladen werden. Prüfen Sie Ihre Berechtigung oder versuchen Sie es später erneut.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [tenantId, includeArchived]);
  useEffect(() => {
    if (!editorOpen) return;
    const handle = window.setTimeout(() => nameRef.current?.focus(), 0);
    return () => window.clearTimeout(handle);
  }, [editorOpen]);
  const filtered = useMemo(
    () =>
      licenses.filter((contract) => {
        const haystack =
          `${contract.title} ${contract.vendorName} ${contract.referenceNumber ?? ""}`.toLocaleLowerCase(
            "de-CH",
          );
        if (
          query.trim() &&
          !haystack.includes(query.trim().toLocaleLowerCase("de-CH"))
        )
          return false;
        if (status !== "all" && contract.status !== status) return false;
        if (type !== "all" && contract.licenseType !== type) return false;
        const date = deadline(contract);
        if (due === "no-end" && contract.endsOn) return false;
        if (
          due === "due" &&
          !(
            date?.label === "Kündigung fällig" ||
            date?.label === "Laufzeit abgelaufen"
          )
        )
          return false;
        if (
          due === "30" &&
          !(date?.tone === "warning" || date?.tone === "danger")
        )
          return false;
        return true;
      }),
    [licenses, due, query, status, type],
  );
  // Names already used on saved records are offered while typing.
  const partyNames = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const item of licenses) {
      const name = item.vendorName.trim();
      const key = name.toLocaleLowerCase("de-CH");
      if (name && !byKey.has(key)) byKey.set(key, name);
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b, "de-CH"));
  }, [licenses]);
  // Built-in types first, then every custom type already in use.
  const typeOptions = useMemo(() => {
    const custom = new Map<string, string>();
    for (const item of licenses) {
      const name = item.licenseType;
      if (
        !Object.hasOwn(typeLabel, name) &&
        !custom.has(name.toLocaleLowerCase("de-CH"))
      ) {
        custom.set(name.toLocaleLowerCase("de-CH"), name);
      }
    }
    return [
      ...Object.keys(typeLabel),
      ...[...custom.values()].sort((a, b) => a.localeCompare(b, "de-CH")),
    ];
  }, [licenses]);
  const applyNewType = () => {
    const name = newTypeName.trim().replace(/\s+/g, " ");
    if (name.length < 2) return;
    // An existing type (any letter case) is reused instead of duplicated.
    const existing = typeOptions.find(
      (key) =>
        typeText(key).toLocaleLowerCase("de-CH") ===
        name.toLocaleLowerCase("de-CH"),
    );
    setForm({ ...form, licenseType: existing ?? name });
    setAddingType(false);
    setNewTypeName("");
  };
  const close = () => {
    if (pending) return;
    setEditorOpen(false);
    setAddingType(false);
    setNewTypeName("");
    setQueuedFiles([]);
    setForm(EMPTY);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };
  const open = (contract?: License) => {
    setNotice("");
    setError("");
    const initial = contract ? formFor(contract) : EMPTY;
    setForm({
      ...initial,
      departmentId: initialDepartmentId(initial.departmentId, departments),
    });
    setEditorOpen(true);
  };
  // "+" menu: open the editor once the data has loaded.
  const handledCreateRequest = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (
      createRequestId === undefined ||
      loading ||
      handledCreateRequest.current === createRequestId
    ) {
      return;
    }
    handledCreateRequest.current = createRequestId;
    open();
    onCreateRequestConsumed?.(createRequestId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequestId, loading]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setPending(true);
    setError("");
    try {
      const noticeDays =
        form.noticePeriodDays.trim() === ""
          ? null
          : Number(form.noticePeriodDays);
      const quantity =
        form.quantity.trim() === "" ? null : Number(form.quantity);
      if (
        quantity !== null &&
        (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000)
      )
        throw new Error("invalid_quantity");
      if (
        noticeDays !== null &&
        (!Number.isInteger(noticeDays) || noticeDays < 0 || noticeDays > 3650)
      )
        throw new Error("invalid_notice");
      const seatCostAmount =
        form.seatCostAmount.trim() === ""
          ? null
          : Number(form.seatCostAmount.replace(",", "."));
      if (
        seatCostAmount !== null &&
        (!Number.isFinite(seatCostAmount) || seatCostAmount < 0)
      )
        throw new Error("invalid_cost");
      if (seatCostAmount !== null && !form.seatCostPeriod)
        throw new Error("cost_period_missing");
      if (
        form.m365SkuId.trim() &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          form.m365SkuId.trim(),
        )
      )
        throw new Error("invalid_sku");
      const values = {
        title: form.title,
        vendorName: form.vendorName,
        referenceNumber: form.referenceNumber || null,
        licenseType: form.licenseType,
        quantity,
        status: form.status,
        startsOn: form.startsOn || null,
        endsOn: form.endsOn || null,
        noticePeriodDays: noticeDays,
        reminderDaysBefore:
          form.reminderDaysBefore === ""
            ? null
            : Number(form.reminderDaysBefore),
        departmentId: form.departmentId || null,
        responsibleUserId: form.responsibleUserId || null,
        notes: form.notes || null,
        seatCostAmount,
        seatCostCurrency: form.seatCostCurrency,
        seatCostPeriod: seatCostAmount === null ? null : form.seatCostPeriod,
        m365SkuId: form.m365SkuId.trim() || null,
      };
      if (values.startsOn && values.endsOn && values.endsOn < values.startsOn)
        throw new Error("invalid_dates");
      const result = await supabase.functions.invoke("licenses", {
        body: form.id
          ? { type: "update", tenantId, licenseId: form.id, values }
          : { type: "create", tenantId, values },
      });
      if (result.error) {
        // Show the server's readable reason instead of a generic message.
        let detail = "";
        try {
          const context = (result.error as { context?: Response }).context;
          const payload = context ? await context.json() : null;
          if (typeof payload?.error?.message === "string") {
            detail = payload.error.message;
          }
        } catch {
          // keep the generic message
        }
        throw new Error(detail ? `server:${detail}` : "save_failed");
      }
      const data = responseData(result.data);
      const saved = data?.license as License | undefined;
      if (!saved?.id) throw new Error("invalid_response");
      setLicenses((current) =>
        [...current.filter((item) => item.id !== saved.id), saved].sort(
          (a, b) => a.title.localeCompare(b.title, "de-CH"),
        ),
      );
      setNotice(
        form.id
          ? "Die Lizenz wurde aktualisiert."
          : "Die Lizenz wurde erfasst.",
      );
      if (queuedFiles.length > 0) {
        let failed = 0;
        for (const file of queuedFiles) {
          try {
            await uploadRecordAttachment(tenantId, "license", saved.id, file);
          } catch {
            failed += 1;
          }
        }
        if (failed > 0) {
          setError(
            `Gespeichert, aber ${failed} Anhang/Anhänge konnten nicht hochgeladen werden. Öffnen Sie «Dokumente», um es erneut zu versuchen.`,
          );
        }
      }
      close();
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message === "invalid_dates"
          ? "Das Ablaufdatum muss am oder nach dem Startdatum liegen."
          : reason instanceof Error && reason.message === "invalid_quantity"
            ? "Die Anzahl muss eine ganze Zahl zwischen 1 und 1 000 000 sein."
            : reason instanceof Error && reason.message === "invalid_notice"
              ? "Die Kündigungsfrist muss zwischen 0 und 3650 Tagen liegen."
              : reason instanceof Error && reason.message === "invalid_cost"
                ? "Die Kosten pro Platz müssen eine positive Zahl sein."
                : reason instanceof Error &&
                    reason.message === "cost_period_missing"
                  ? "Bitte angeben, für welchen Zeitraum die Kosten pro Platz gelten."
                  : reason instanceof Error && reason.message === "invalid_sku"
                    ? "Die Microsoft-365-SKU-ID muss eine GUID sein."
                    : reason instanceof Error &&
                        reason.message.startsWith("server:")
                      ? reason.message.slice(7)
                      : "Die Lizenz konnte nicht gespeichert werden.",
      );
    } finally {
      setPending(false);
    }
  };
  const archive = async (contract: License) => {
    if (
      !supabase ||
      !window.confirm(
        `«${contract.title}» archivieren? Archivierte Lizenzen bleiben nachvollziehbar, können aber nicht mehr geändert werden.`,
      )
    )
      return;
    setPending(true);
    setError("");
    try {
      const result = await supabase.functions.invoke("licenses", {
        body: { type: "archive", tenantId, licenseId: contract.id },
      });
      if (result.error) throw new Error("archive_failed");
      const data = responseData(result.data);
      const saved = data?.license as License | undefined;
      if (!saved?.id) throw new Error("invalid_response");
      setLicenses((current) =>
        includeArchived
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : current.filter((item) => item.id !== saved.id),
      );
      setNotice("Die Lizenz wurde archiviert.");
    } catch {
      setError("Die Lizenz konnte nicht archiviert werden.");
    } finally {
      setPending(false);
    }
  };
  if (!isSupabaseConfigured)
    return (
      <section className="licenses">
        <p className="empty-state">
          Die Lizenzverwaltung benötigt eine sichere Serververbindung.
        </p>
      </section>
    );
  return (
    <section className="licenses" aria-label="Lizenzen">
      <header className="page-heading">
        <div>
          <p>
            Laufzeiten, Verlängerungen und Verantwortlichkeiten Ihrer Lizenzen
            an einem Ort.
          </p>
        </div>
        <div className="contracts__actions">
          <button
            aria-pressed={reclaimOpen}
            className="secondary-button"
            onClick={() => setReclaimOpen((current) => !current)}
            type="button"
          >
            <PiggyBank size={16} /> Rückgewinnung
          </button>
          <button
            className="primary-button"
            onClick={(event) => {
              triggerRef.current = event.currentTarget;
              open();
            }}
            type="button"
          >
            <Plus size={16} /> Lizenz erfassen
          </button>
        </div>
      </header>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-success" role="status">
          {notice}
        </p>
      )}
      {reclaimOpen ? <LicenseReclaimPanel tenantId={tenantId} /> : null}
      <fieldset className="contracts__filters">
        <label>
          Suche
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Produkt, Hersteller oder Nummer"
          />
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="all">Alle</option>
            {(Object.keys(statusLabel) as LicenseStatus[]).map((key) => (
              <option key={key} value={key}>
                {statusLabel[key]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Art
          <select
            value={type}
            onChange={(event) => setType(event.target.value as typeof type)}
          >
            <option value="all">Alle</option>
            {typeOptions.map((key) => (
              <option key={key} value={key}>
                {typeText(key)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fälligkeit
          <select
            value={due}
            onChange={(event) => setDue(event.target.value as typeof due)}
          >
            <option value="all">Alle</option>
            <option value="due">Kündigung / Ablauf fällig</option>
            <option value="30">In den nächsten 30 Tagen</option>
            <option value="no-end">Ohne Ablaufdatum</option>
          </select>
        </label>
        <label className="contracts__archive-toggle">
          <input
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
            type="checkbox"
          />{" "}
          Archivierte einblenden
        </label>
      </fieldset>
      {loading ? (
        <p className="empty-state">Lizenzen werden geladen …</p>
      ) : filtered.length === 0 ? (
        <p className="empty-state">Keine Lizenzen für die aktuelle Auswahl.</p>
      ) : (
        <ul className="contracts__list">
          {filtered.map((contract) => {
            const date = deadline(contract);
            const person = people.find(
              (item) => item.id === contract.responsibleUserId,
            );
            return (
              <li key={contract.id}>
                <article>
                  <div className="contracts__card-title">
                    <FileText size={20} />
                    <div>
                      <h2>{contract.title}</h2>
                      <p>
                        {contract.vendorName}
                        {contract.referenceNumber
                          ? ` · ${contract.referenceNumber}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <div className="contracts__badges">
                    <span
                      className={`status-badge status-badge--${contract.status}`}
                    >
                      {statusLabel[contract.status]}
                    </span>
                    <span className="contracts__type">
                      {typeText(contract.licenseType)}
                    </span>
                  </div>
                  <dl>
                    <div>
                      <dt>Ablauf</dt>
                      <dd>{formatDate(contract.endsOn)}</dd>
                    </div>
                    <div>
                      <dt>Anzahl</dt>
                      <dd>
                        {contract.quantity === null
                          ? "Nicht angegeben"
                          : contract.quantity.toLocaleString("de-CH")}
                      </dd>
                    </div>
                    {departmentLabel(contract.departmentId, departments) ? (
                      <div>
                        <dt>Abteilung</dt>
                        <dd>
                          {departmentLabel(contract.departmentId, departments)}
                        </dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Verantwortlich</dt>
                      <dd>{person?.displayName ?? "Nicht zugeordnet"}</dd>
                    </div>
                    <div>
                      <dt>Kündigungsfrist</dt>
                      <dd>
                        {contract.noticePeriodDays === null
                          ? "Nicht definiert"
                          : `${contract.noticePeriodDays} Tage`}
                      </dd>
                    </div>
                    {contract.seatCostAmount !== null &&
                    contract.seatCostAmount !== undefined ? (
                      <div>
                        <dt>Kosten pro Platz</dt>
                        <dd>
                          {formatMoney(
                            contract.seatCostAmount,
                            contract.seatCostCurrency ?? "CHF",
                          )}{" "}
                          {COST_PERIOD_LABEL[contract.seatCostPeriod ?? ""] ??
                            ""}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  {contract.reminderDaysBefore !== null && (
                    <p className="contracts__deadline contracts__deadline--neutral">
                      <Bell size={16} />{" "}
                      {contract.reminderSentFor !== null &&
                      contract.reminderSentFor === contract.endsOn
                        ? "Erinnerungsticket wurde erstellt"
                        : `Ticket-Erinnerung ${contract.reminderDaysBefore} Tage vor Ablauf`}
                    </p>
                  )}
                  {date && (
                    <p
                      className={`contracts__deadline contracts__deadline--${date.tone}`}
                    >
                      <CalendarClock size={16} /> {date.label}
                    </p>
                  )}
                  <div className="contracts__card-actions">
                    <button
                      className="secondary-button"
                      onClick={() => setDocumentsFor(contract)}
                      type="button"
                    >
                      <Paperclip size={16} /> Dokumente
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => setSeatsFor(contract)}
                      type="button"
                    >
                      <Users size={16} /> Plätze
                    </button>
                    <button
                      className="secondary-button"
                      disabled={pending || contract.status === "archived"}
                      onClick={(event) => {
                        triggerRef.current = event.currentTarget;
                        open(contract);
                      }}
                      type="button"
                    >
                      Bearbeiten
                    </button>
                    <button
                      className="danger-button"
                      disabled={pending || contract.status === "archived"}
                      onClick={() => void archive(contract)}
                      type="button"
                    >
                      <Archive size={16} /> Archivieren
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
      {editorOpen &&
        createPortal(
          <FormDialog
            eyebrow={form.id ? "Lizenz bearbeiten" : "Neue Lizenz"}
            onClose={close}
            onSubmit={save}
            side={
              <FormSummary
                eyebrow="Lizenz"
                rows={[
                  ["Anbieter", form.vendorName.trim()],
                  ["Anzahl", form.quantity.trim()],
                  [
                    "Status",
                    form.status === "draft"
                      ? "Entwurf"
                      : form.status === "active"
                        ? "Aktiv"
                        : "Beendet",
                  ],
                  ["Läuft bis", form.endsOn ? formatDate(form.endsOn) : ""],
                  [
                    "Kosten gesamt",
                    form.seatCostAmount.trim() !== "" &&
                    form.quantity.trim() !== ""
                      ? `${form.seatCostCurrency} ${(
                          Number(form.seatCostAmount) * Number(form.quantity)
                        ).toLocaleString("de-CH", {
                          maximumFractionDigits: 2,
                        })}${
                          form.seatCostPeriod
                            ? ` ${
                                {
                                  monthly: "pro Monat",
                                  quarterly: "pro Quartal",
                                  yearly: "pro Jahr",
                                  one_time: "einmalig",
                                }[form.seatCostPeriod]
                              }`
                            : ""
                        }`
                      : "",
                  ],
                ]}
                title={form.title.trim()}
              />
            }
            submitting={pending}
            title={form.id ? "Lizenz aktualisieren" : "Lizenz erfassen"}
          >
            <FormCard title="Lizenz">
              <FormGrid cols={2}>
                <FormField label="Produkt / Bezeichnung" required>
                  <input
                    ref={nameRef}
                    required
                    minLength={3}
                    maxLength={240}
                    value={form.title}
                    onChange={(event) =>
                      setForm({ ...form, title: event.target.value })
                    }
                  />
                </FormField>
                <FormField label="Hersteller / Anbieter" required>
                  <input
                    required
                    minLength={2}
                    maxLength={160}
                    autoComplete="off"
                    list="license-vendors"
                    value={form.vendorName}
                    onChange={(event) =>
                      setForm({ ...form, vendorName: event.target.value })
                    }
                  />
                  <datalist id="license-vendors">
                    {partyNames.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </FormField>
                <FormField label="Lizenznummer">
                  <input
                    maxLength={120}
                    value={form.referenceNumber}
                    onChange={(event) =>
                      setForm({ ...form, referenceNumber: event.target.value })
                    }
                  />
                </FormField>
                <FormField label="Art">
                  <select
                    value={addingType ? NEW_TYPE : form.licenseType}
                    onChange={(event) => {
                      if (event.target.value === NEW_TYPE) {
                        setAddingType(true);
                        return;
                      }
                      setAddingType(false);
                      setForm({ ...form, licenseType: event.target.value });
                    }}
                  >
                    {typeOptions.includes(form.licenseType) ? null : (
                      <option value={form.licenseType}>
                        {form.licenseType}
                      </option>
                    )}
                    {typeOptions.map((key) => (
                      <option key={key} value={key}>
                        {typeText(key)}
                      </option>
                    ))}
                    <option value={NEW_TYPE}>+ Neue Art hinzufügen …</option>
                  </select>
                  {addingType ? (
                    <span className="contracts__new-type">
                      <input
                        autoFocus
                        maxLength={60}
                        onChange={(event) => setNewTypeName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            applyNewType();
                          }
                        }}
                        placeholder="Name der neuen Art"
                        value={newTypeName}
                      />
                      <button
                        className="primary-button"
                        disabled={newTypeName.trim().length < 2}
                        onClick={applyNewType}
                        type="button"
                      >
                        Übernehmen
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => setAddingType(false)}
                        type="button"
                      >
                        Abbrechen
                      </button>
                    </span>
                  ) : null}
                </FormField>
                <FormField label="Anzahl Lizenzen">
                  <input
                    min="1"
                    max="1000000"
                    inputMode="numeric"
                    type="number"
                    value={form.quantity}
                    onChange={(event) =>
                      setForm({ ...form, quantity: event.target.value })
                    }
                  />
                </FormField>
                <FormField label="Status">
                  <select
                    value={form.status}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        status: event.target.value as Form["status"],
                      })
                    }
                  >
                    <option value="draft">Entwurf</option>
                    <option value="active">Aktiv</option>
                    <option value="terminated">Beendet</option>
                  </select>
                </FormField>
              </FormGrid>
            </FormCard>
            <FormCard title="Laufzeit">
              <FormGrid cols={3}>
                <FormField label="Startdatum">
                  <input
                    type="date"
                    value={form.startsOn}
                    onChange={(event) =>
                      setForm({ ...form, startsOn: event.target.value })
                    }
                  />
                </FormField>
                <FormField label="Ablaufdatum">
                  <input
                    type="date"
                    value={form.endsOn}
                    onChange={(event) =>
                      setForm({ ...form, endsOn: event.target.value })
                    }
                  />
                </FormField>
                <FormField label="Kündigungsfrist (Tage)">
                  <input
                    min="0"
                    max="3650"
                    inputMode="numeric"
                    type="number"
                    value={form.noticePeriodDays}
                    onChange={(event) =>
                      setForm({ ...form, noticePeriodDays: event.target.value })
                    }
                  />
                </FormField>
              </FormGrid>
              <FormGrid cols={2}>
                <FormField
                  hint="Ein Ticket erinnert die verantwortliche Person rechtzeitig. Nur bei aktiven Einträgen mit Ablaufdatum."
                  label="Erinnerung per Ticket"
                >
                  <select
                    value={form.reminderDaysBefore}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        reminderDaysBefore: event.target.value,
                      })
                    }
                  >
                    <option value="">Keine Erinnerung</option>
                    {form.reminderDaysBefore !== "" &&
                    !REMINDER_OPTIONS.includes(
                      Number(form.reminderDaysBefore),
                    ) ? (
                      <option value={form.reminderDaysBefore}>
                        {form.reminderDaysBefore} Tage vor Ablauf
                      </option>
                    ) : null}
                    {REMINDER_OPTIONS.map((days) => (
                      <option key={days} value={String(days)}>
                        {days} Tage vor Ablauf
                      </option>
                    ))}
                  </select>
                </FormField>
              </FormGrid>
            </FormCard>
            <FormCard title="Kosten">
              <FormGrid cols={3}>
                <FormField
                  hint="Für die geschätzte Einsparung der Rückgewinnung."
                  label="Kosten pro Platz"
                >
                  <input
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    type="number"
                    value={form.seatCostAmount}
                    onChange={(event) =>
                      setForm({ ...form, seatCostAmount: event.target.value })
                    }
                  />
                </FormField>
                <FormField label="Währung">
                  <select
                    value={form.seatCostCurrency}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        seatCostCurrency: event.target
                          .value as Form["seatCostCurrency"],
                      })
                    }
                  >
                    <option value="CHF">CHF</option>
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                  </select>
                </FormField>
                <FormField label="Zeitraum der Kosten">
                  <select
                    value={form.seatCostPeriod}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        seatCostPeriod: event.target
                          .value as Form["seatCostPeriod"],
                      })
                    }
                  >
                    <option value="">Zeitraum wählen</option>
                    <option value="monthly">pro Monat</option>
                    <option value="quarterly">pro Quartal</option>
                    <option value="yearly">pro Jahr</option>
                    <option value="one_time">einmalig</option>
                  </select>
                </FormField>
              </FormGrid>
            </FormCard>
            <FormCard title="Zuständigkeit">
              <FormGrid cols={2}>
                {departments.length > 1 ? (
                  <FormField label="Abteilung" required>
                    <select
                      required
                      value={form.departmentId}
                      onChange={(event) =>
                        setForm({ ...form, departmentId: event.target.value })
                      }
                    >
                      <option disabled value="">
                        Abteilung wählen
                      </option>
                      {departments.map((department) => (
                        <option key={department.id} value={department.id}>
                          {department.name}
                        </option>
                      ))}
                    </select>
                  </FormField>
                ) : null}
                <FormField label="Verantwortliche Person">
                  <select
                    value={form.responsibleUserId}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        responsibleUserId: event.target.value,
                      })
                    }
                  >
                    <option value="">Nicht zugeordnet</option>
                    {people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.displayName}
                      </option>
                    ))}
                  </select>
                </FormField>
              </FormGrid>
            </FormCard>
            <FormCard title="Dokumente">
              <RecordAttachments
                entityId={form.id}
                entityType="license"
                onQueuedChange={setQueuedFiles}
                queued={queuedFiles}
                tenantId={tenantId}
              />
            </FormCard>
            <FormCard collapsed title="Weitere Angaben">
              <FormGrid cols={1}>
                <FormField
                  hint="Nur nötig, wenn beim Zurückgeben auch die Lizenz in Microsoft 365 entfernt werden soll."
                  label="Microsoft-365-SKU-ID"
                >
                  <input
                    maxLength={36}
                    placeholder="z. B. 05e9a617-0261-4cee-bb44-138d3ef5d965"
                    spellCheck={false}
                    value={form.m365SkuId}
                    onChange={(event) =>
                      setForm({ ...form, m365SkuId: event.target.value })
                    }
                  />
                </FormField>
                <FormField label="Notiz">
                  <textarea
                    maxLength={2000}
                    rows={5}
                    value={form.notes}
                    onChange={(event) =>
                      setForm({ ...form, notes: event.target.value })
                    }
                  />
                </FormField>
              </FormGrid>
            </FormCard>
          </FormDialog>,
          document.body,
        )}
      {seatsFor ? (
        <LicenseSeatsDialog
          licenseId={seatsFor.id}
          onClose={() => setSeatsFor(null)}
          readOnly={seatsFor.status === "archived"}
          tenantId={tenantId}
          title={seatsFor.title}
        />
      ) : null}
      {documentsFor &&
        createPortal(
          <div
            className="contracts__dialog-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setDocumentsFor(null);
            }}
          >
            <section
              className="contracts__editor-dialog"
              aria-label="Dokumente"
              aria-modal="true"
              role="dialog"
            >
              <header className="panel-heading">
                <div>
                  <p className="eyebrow">Dokumente</p>
                  <h2>{documentsFor.title}</h2>
                </div>
                <button
                  aria-label="Dialog schliessen"
                  className="icon-button"
                  onClick={() => setDocumentsFor(null)}
                  type="button"
                >
                  <X size={18} />
                </button>
              </header>
              <div className="contracts__notes">
                <RecordAttachments
                  entityId={documentsFor.id}
                  entityType="license"
                  onQueuedChange={() => undefined}
                  queued={[]}
                  readOnly={documentsFor.status === "archived"}
                  tenantId={tenantId}
                />
              </div>
            </section>
          </div>,
          document.body,
        )}
    </section>
  );
}
