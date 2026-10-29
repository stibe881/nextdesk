import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  CalendarClock,
  FileText,
  Paperclip,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import {
  RecordAttachments,
  uploadRecordAttachment,
} from "./record-attachments";

type ContractStatus = "draft" | "active" | "terminated" | "archived";
type ContractType = "service" | "license" | "maintenance" | "lease" | "other";
type Contract = {
  id: string;
  title: string;
  counterpartyName: string;
  referenceNumber: string | null;
  contractType: ContractType;
  status: ContractStatus;
  startsOn: string | null;
  endsOn: string | null;
  noticePeriodDays: number | null;
  responsibleUserId: string | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type Person = { id: string; displayName: string };
type Form = {
  id: string | null;
  title: string;
  counterpartyName: string;
  referenceNumber: string;
  contractType: ContractType;
  status: Exclude<ContractStatus, "archived">;
  startsOn: string;
  endsOn: string;
  noticePeriodDays: string;
  responsibleUserId: string;
  notes: string;
};
const EMPTY: Form = {
  id: null,
  title: "",
  counterpartyName: "",
  referenceNumber: "",
  contractType: "service",
  status: "draft",
  startsOn: "",
  endsOn: "",
  noticePeriodDays: "",
  responsibleUserId: "",
  notes: "",
};
const statusLabel: Record<ContractStatus, string> = {
  draft: "Entwurf",
  active: "Aktiv",
  terminated: "Beendet",
  archived: "Archiviert",
};
const typeLabel: Record<ContractType, string> = {
  service: "Dienstleistung",
  license: "Lizenz",
  maintenance: "Wartung",
  lease: "Miete / Leasing",
  other: "Weitere",
};
const today = () => new Date().toISOString().slice(0, 10);
const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("de-CH", { dateStyle: "medium" }).format(
        new Date(`${value}T12:00:00`),
      )
    : "Ohne Enddatum";
function deadline(
  contract: Contract,
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
  if (days < 0) return { label: "Enddatum überschritten", tone: "danger" };
  if (noticeDays !== null && noticeDays <= 0)
    return { label: "Kündigung fällig", tone: "danger" };
  if (noticeDays !== null && noticeDays <= 30)
    return { label: `Kündigung in ${noticeDays} Tagen`, tone: "warning" };
  if (days <= 30) return { label: `Endet in ${days} Tagen`, tone: "warning" };
  return { label: `Endet am ${formatDate(contract.endsOn)}`, tone: "neutral" };
}
function formFor(contract: Contract): Form {
  return {
    id: contract.id,
    title: contract.title,
    counterpartyName: contract.counterpartyName,
    referenceNumber: contract.referenceNumber ?? "",
    contractType: contract.contractType,
    status: contract.status === "archived" ? "terminated" : contract.status,
    startsOn: contract.startsOn ?? "",
    endsOn: contract.endsOn ?? "",
    noticePeriodDays:
      contract.noticePeriodDays === null
        ? ""
        : String(contract.noticePeriodDays),
    responsibleUserId: contract.responsibleUserId ?? "",
    notes: contract.notes ?? "",
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
function parseContracts(value: unknown): Contract[] | null {
  const data = responseData(value);
  return data && Array.isArray(data.contracts)
    ? (data.contracts as Contract[])
    : null;
}
function parsePeople(value: unknown): Person[] | null {
  const data = responseData(value);
  return data && Array.isArray(data.people) ? (data.people as Person[]) : null;
}

export function Contracts({ tenantId }: { tenantId: string }) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | ContractStatus>("all");
  const [type, setType] = useState<"all" | ContractType>("all");
  const [due, setDue] = useState<"all" | "due" | "30" | "no-end">("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [pending, setPending] = useState(false);
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [documentsFor, setDocumentsFor] = useState<Contract | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const load = async () => {
    if (!supabase) return;
    setLoading(true);
    setError("");
    try {
      const [contractsResult, peopleResult] = await Promise.all([
        supabase.functions.invoke("contracts", {
          body: { type: "list", tenantId, includeArchived },
        }),
        supabase.functions.invoke("contracts", {
          body: { type: "listPeople", tenantId },
        }),
      ]);
      if (contractsResult.error || peopleResult.error)
        throw new Error("load_failed");
      const nextContracts = parseContracts(contractsResult.data);
      const nextPeople = parsePeople(peopleResult.data);
      if (!nextContracts || !nextPeople) throw new Error("invalid_response");
      setContracts(nextContracts);
      setPeople(
        nextPeople.sort((a, b) =>
          a.displayName.localeCompare(b.displayName, "de-CH"),
        ),
      );
    } catch {
      setError(
        "Verträge konnten nicht geladen werden. Prüfen Sie Ihre Berechtigung oder versuchen Sie es später erneut.",
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
      contracts.filter((contract) => {
        const haystack =
          `${contract.title} ${contract.counterpartyName} ${contract.referenceNumber ?? ""}`.toLocaleLowerCase(
            "de-CH",
          );
        if (
          query.trim() &&
          !haystack.includes(query.trim().toLocaleLowerCase("de-CH"))
        )
          return false;
        if (status !== "all" && contract.status !== status) return false;
        if (type !== "all" && contract.contractType !== type) return false;
        const date = deadline(contract);
        if (due === "no-end" && contract.endsOn) return false;
        if (
          due === "due" &&
          !(
            date?.label === "Kündigung fällig" ||
            date?.label === "Enddatum überschritten"
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
    [contracts, due, query, status, type],
  );
  // Names already used on saved records are offered while typing.
  const partyNames = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const item of contracts) {
      const name = item.counterpartyName.trim();
      const key = name.toLocaleLowerCase("de-CH");
      if (name && !byKey.has(key)) byKey.set(key, name);
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b, "de-CH"));
  }, [contracts]);
  const close = () => {
    if (pending) return;
    setEditorOpen(false);
    setQueuedFiles([]);
    setForm(EMPTY);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };
  const open = (contract?: Contract) => {
    setNotice("");
    setError("");
    setForm(contract ? formFor(contract) : EMPTY);
    setEditorOpen(true);
  };
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
      if (
        noticeDays !== null &&
        (!Number.isInteger(noticeDays) || noticeDays < 0 || noticeDays > 3650)
      )
        throw new Error("invalid_notice");
      const values = {
        title: form.title,
        counterpartyName: form.counterpartyName,
        referenceNumber: form.referenceNumber || null,
        contractType: form.contractType,
        status: form.status,
        startsOn: form.startsOn || null,
        endsOn: form.endsOn || null,
        noticePeriodDays: noticeDays,
        responsibleUserId: form.responsibleUserId || null,
        notes: form.notes || null,
      };
      if (values.startsOn && values.endsOn && values.endsOn < values.startsOn)
        throw new Error("invalid_dates");
      const result = await supabase.functions.invoke("contracts", {
        body: form.id
          ? { type: "update", tenantId, contractId: form.id, values }
          : { type: "create", tenantId, values },
      });
      if (result.error) throw new Error("save_failed");
      const data = responseData(result.data);
      const saved = data?.contract as Contract | undefined;
      if (!saved?.id) throw new Error("invalid_response");
      setContracts((current) =>
        [...current.filter((item) => item.id !== saved.id), saved].sort(
          (a, b) => a.title.localeCompare(b.title, "de-CH"),
        ),
      );
      setNotice(
        form.id
          ? "Der Vertrag wurde aktualisiert."
          : "Der Vertrag wurde erfasst.",
      );
      if (queuedFiles.length > 0) {
        let failed = 0;
        for (const file of queuedFiles) {
          try {
            await uploadRecordAttachment(tenantId, "contract", saved.id, file);
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
          ? "Das Enddatum muss am oder nach dem Startdatum liegen."
          : reason instanceof Error && reason.message === "invalid_notice"
            ? "Die Kündigungsfrist muss zwischen 0 und 3650 Tagen liegen."
            : "Der Vertrag konnte nicht gespeichert werden.",
      );
    } finally {
      setPending(false);
    }
  };
  const archive = async (contract: Contract) => {
    if (
      !supabase ||
      !window.confirm(
        `«${contract.title}» archivieren? Archivierte Verträge bleiben nachvollziehbar, können aber nicht mehr geändert werden.`,
      )
    )
      return;
    setPending(true);
    setError("");
    try {
      const result = await supabase.functions.invoke("contracts", {
        body: { type: "archive", tenantId, contractId: contract.id },
      });
      if (result.error) throw new Error("archive_failed");
      const data = responseData(result.data);
      const saved = data?.contract as Contract | undefined;
      if (!saved?.id) throw new Error("invalid_response");
      setContracts((current) =>
        includeArchived
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : current.filter((item) => item.id !== saved.id),
      );
      setNotice("Der Vertrag wurde archiviert.");
    } catch {
      setError("Der Vertrag konnte nicht archiviert werden.");
    } finally {
      setPending(false);
    }
  };
  if (!isSupabaseConfigured)
    return (
      <section className="contracts">
        <p className="empty-state">
          Die Vertragsverwaltung benötigt eine sichere Serververbindung.
        </p>
      </section>
    );
  return (
    <section className="contracts" aria-labelledby="contracts-heading">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Mandantenverwaltung</p>
          <h1 id="contracts-heading">Verträge</h1>
          <p>
            Fristen, Kündigungszeitpunkte und Verantwortlichkeiten an einem Ort.
          </p>
        </div>
        <div className="contracts__actions">
          <button
            className="secondary-button"
            disabled={loading}
            onClick={() => void load()}
            type="button"
          >
            <RefreshCw size={16} /> Aktualisieren
          </button>
          <button
            className="primary-button"
            onClick={(event) => {
              triggerRef.current = event.currentTarget;
              open();
            }}
            type="button"
          >
            <Plus size={16} /> Vertrag erfassen
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
      <fieldset className="contracts__filters">
        <label>
          Suche
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Bezeichnung, Gegenpartei oder Nummer"
          />
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="all">Alle</option>
            {(Object.keys(statusLabel) as ContractStatus[]).map((key) => (
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
            {(Object.keys(typeLabel) as ContractType[]).map((key) => (
              <option key={key} value={key}>
                {typeLabel[key]}
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
            <option value="due">Kündigung / Ende fällig</option>
            <option value="30">In den nächsten 30 Tagen</option>
            <option value="no-end">Ohne Enddatum</option>
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
        <p className="empty-state">Verträge werden geladen …</p>
      ) : filtered.length === 0 ? (
        <p className="empty-state">Keine Verträge für die aktuelle Auswahl.</p>
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
                        {contract.counterpartyName}
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
                      {typeLabel[contract.contractType]}
                    </span>
                  </div>
                  <dl>
                    <div>
                      <dt>Ende</dt>
                      <dd>{formatDate(contract.endsOn)}</dd>
                    </div>
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
                  </dl>
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
          <div
            className="contracts__dialog-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) close();
            }}
          >
            <section
              className="contracts__editor-dialog"
              aria-labelledby="contract-editor-heading"
              aria-modal="true"
              role="dialog"
            >
              <header className="panel-heading">
                <div>
                  <p className="eyebrow">
                    {form.id ? "Vertrag bearbeiten" : "Neuer Vertrag"}
                  </p>
                  <h2 id="contract-editor-heading">
                    {form.id ? "Vertrag aktualisieren" : "Vertrag erfassen"}
                  </h2>
                </div>
                <button
                  aria-label="Dialog schliessen"
                  className="icon-button"
                  disabled={pending}
                  onClick={close}
                  type="button"
                >
                  <X size={18} />
                </button>
              </header>
              <form onSubmit={save}>
                <label>
                  Bezeichnung
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
                </label>
                <label>
                  Gegenpartei
                  <input
                    required
                    minLength={2}
                    maxLength={160}
                    autoComplete="off"
                    list="contract-counterparties"
                    value={form.counterpartyName}
                    onChange={(event) =>
                      setForm({ ...form, counterpartyName: event.target.value })
                    }
                  />
                  <datalist id="contract-counterparties">
                    {partyNames.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </label>
                <label>
                  Vertragsnummer
                  <input
                    maxLength={120}
                    value={form.referenceNumber}
                    onChange={(event) =>
                      setForm({ ...form, referenceNumber: event.target.value })
                    }
                  />
                </label>
                <label>
                  Art
                  <select
                    value={form.contractType}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        contractType: event.target.value as ContractType,
                      })
                    }
                  >
                    {(Object.keys(typeLabel) as ContractType[]).map((key) => (
                      <option key={key} value={key}>
                        {typeLabel[key]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Status
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
                </label>
                <label>
                  Verantwortliche Person
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
                </label>
                <label>
                  Startdatum
                  <input
                    type="date"
                    value={form.startsOn}
                    onChange={(event) =>
                      setForm({ ...form, startsOn: event.target.value })
                    }
                  />
                </label>
                <label>
                  Enddatum
                  <input
                    type="date"
                    value={form.endsOn}
                    onChange={(event) =>
                      setForm({ ...form, endsOn: event.target.value })
                    }
                  />
                </label>
                <label>
                  Kündigungsfrist (Tage)
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
                </label>
                <label className="contracts__notes">
                  Notiz
                  <textarea
                    maxLength={2000}
                    rows={5}
                    value={form.notes}
                    onChange={(event) =>
                      setForm({ ...form, notes: event.target.value })
                    }
                  />
                </label>
                <div className="contracts__notes">
                  <RecordAttachments
                    entityId={form.id}
                    entityType="contract"
                    onQueuedChange={setQueuedFiles}
                    queued={queuedFiles}
                    tenantId={tenantId}
                  />
                </div>
                <div className="form-actions">
                  <button
                    className="secondary-button"
                    disabled={pending}
                    onClick={close}
                    type="button"
                  >
                    Abbrechen
                  </button>
                  <button
                    className="primary-button"
                    disabled={pending}
                    type="submit"
                  >
                    {pending ? "Wird gespeichert …" : "Speichern"}
                  </button>
                </div>
              </form>
            </section>
          </div>,
          document.body,
        )}
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
                  entityType="contract"
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
