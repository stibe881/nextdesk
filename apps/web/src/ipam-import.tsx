import { tn } from "./lib/formality";
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  FileSpreadsheet,
  Info,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";

import {
  IMPORT_KINDS,
  SOURCE_LABELS,
  TABLE_FIELDS,
  TARGET_LABELS,
  batchCounts,
  chunkRows,
  defaultTableSelection,
  detectSource,
  guessTableMapping,
  parseWorkbook,
  tableFromRows,
  wireRow,
  type ImportBatch,
  type ImportIssue,
  type ImportKind,
  type ImportSource,
  type TableSelection,
  type TableTarget,
  type Workbook,
} from "./lib/ipam-import";
import { readWorkbookFile } from "./lib/ipam-import-xlsx";
import { supabase } from "./lib/supabase";
import "./ipam-import.css";

type Step = "source" | "file" | "preview" | "options" | "run" | "done";
type RowState = "new" | "changed" | "unchanged" | "skipped" | "error";
type RowResult = {
  key: string;
  state: RowState;
  changes?: string[];
  message?: string;
};
type Counts = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: number;
};
type ImportContext = {
  vrfs: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  canManageAssets: boolean;
};
type Options = {
  vrfId: string;
  departmentId: string;
  mode: "update" | "skip";
  importDevices: boolean;
  createLocations: boolean;
};

const CHUNK = 400;
const PAGE = 100;

const KIND_LABELS: Record<ImportKind, string> = {
  sites: "Standorte",
  vlans: "VLANs",
  prefixes: "Subnetze",
  addresses: "IP-Adressen",
  devices: "Geräte",
};

const STATE_LABELS: Record<RowState, string> = {
  new: "Neu",
  changed: "Geändert",
  unchanged: "Unverändert",
  skipped: "Übersprungen",
  error: "Fehler",
};

const sourceHints = (): Record<ImportSource, string> => ({
  sonnenberg:
    "Excel-Liste mit Blatt «Overview» (Lokation, Security Zone, IP Prefix, PL, Default GW, VLAN …) und je einem Blatt pro Subnetz.",
  switch_list:
    "Excel-Liste mit Standort, IP Adresse, Bezeichnung und Switch-Modell. Legt Adressen und Switches an.",
  aruba_ap:
    "Excel-Liste mit Gebäude, Standort, AP-Nummer, MAC-Adresse und Seriennummer. Legt Access Points an.",
  generic:
    tn(
      "Beliebige CSV- oder Excel-Tabelle. Du ordnest die Spalten selbst zu.",
      "Beliebige CSV- oder Excel-Tabelle. Sie ordnen die Spalten selbst zu.",
    ),
  phpipam: "CSV-Export der Subnetze oder Adressen aus phpIPAM.",
  netbox: "CSV-Export aus NetBox (Prefixes, IP Addresses oder VLANs).",
});

const SOURCES: (ImportSource | "auto")[] = [
  "auto",
  "sonnenberg",
  "switch_list",
  "aruba_ap",
  "generic",
  "phpipam",
  "netbox",
];

const isTableSource = (source: ImportSource) =>
  source === "generic" || source === "phpipam" || source === "netbox";

async function callImport<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Die Verbindung ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("ipam-import", {
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
    throw new Error("Die Anfrage konnte nicht ausgeführt werden.");
  }
  return (data as { data: T }).data;
}

function rowsOf(batch: ImportBatch, kind: ImportKind): { key: string }[] {
  return batch[kind];
}

type Column = {
  label: string;
  value: (row: Record<string, unknown>) => string;
};
const show = (value: unknown) =>
  value === null || value === undefined || value === "" ? "–" : String(value);
const COLUMNS: Record<ImportKind, Column[]> = {
  sites: [
    { label: "Name", value: (row) => show(row.name) },
    { label: "Beschreibung", value: (row) => show(row.description) },
  ],
  vlans: [
    { label: "Standort", value: (row) => show(row.site) },
    { label: "VLAN", value: (row) => show(row.number) },
    { label: "Name", value: (row) => show(row.name) },
  ],
  prefixes: [
    { label: "Subnetz", value: (row) => show(row.prefix) },
    { label: "Status", value: (row) => show(row.status) },
    { label: "Standort", value: (row) => show(row.site) },
    { label: "VLAN", value: (row) => show(row.vlanNumber) },
    { label: "Gateway", value: (row) => show(row.gateway) },
    {
      label: "DHCP",
      value: (row) =>
        row.dhcpStart
          ? `${String(row.dhcpStart)} – ${String(row.dhcpEnd)}`
          : "–",
    },
    { label: "Beschreibung", value: (row) => show(row.description) },
    {
      label: "Tags",
      value: (row) =>
        Array.isArray(row.tags) && row.tags.length ? row.tags.join(", ") : "–",
    },
  ],
  addresses: [
    { label: "Adresse", value: (row) => show(row.address) },
    { label: "Status", value: (row) => show(row.status) },
    { label: "Hostname", value: (row) => show(row.hostname) },
    { label: "MAC", value: (row) => show(row.macAddress) },
    { label: "Typ", value: (row) => show(row.deviceType) },
    { label: "Beschreibung", value: (row) => show(row.description) },
  ],
  devices: [
    { label: "Name", value: (row) => show(row.name) },
    { label: "Kategorie", value: (row) => show(row.category) },
    { label: "Seriennummer", value: (row) => show(row.serialNumber) },
    { label: "MAC", value: (row) => show(row.macAddress) },
    { label: "IP", value: (row) => show(row.ipAddress) },
    { label: "Standort", value: (row) => show(row.location) },
    { label: "Uplink", value: (row) => show(row.uplink) },
  ],
};

function IssueIcon({ severity }: { severity: ImportIssue["severity"] }) {
  if (severity === "info") return <Info aria-hidden size={15} />;
  return <TriangleAlert aria-hidden size={15} />;
}

/**
 * Import wizard for the IP address management: source → file → preview →
 * options → import → result. Parsing happens in the browser; the rows go to
 * the edge function «ipam-import» in chunks.
 */
export function IpamImportWizard({
  tenantId,
  canManage,
  onChanged,
}: {
  tenantId: string;
  canManage: boolean;
  onChanged?: () => void;
}) {
  const [step, setStep] = useState<Step>("source");
  const [choice, setChoice] = useState<ImportSource | "auto">("auto");
  const [source, setSource] = useState<ImportSource>("generic");
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [fileName, setFileName] = useState("");
  const [selection, setSelection] = useState<TableSelection | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<ImportKind>("prefixes");
  const [limit, setLimit] = useState(PAGE);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [context, setContext] = useState<ImportContext | null>(null);
  const [options, setOptions] = useState<Options>({
    vrfId: "",
    departmentId: "",
    mode: "update",
    importDevices: true,
    createLocations: false,
  });
  const [compare, setCompare] = useState<
    Partial<Record<ImportKind, Map<string, RowResult>>>
  >({});
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [outcome, setOutcome] = useState<Partial<Record<ImportKind, Counts>>>(
    {},
  );
  const [failures, setFailures] = useState<
    (RowResult & { kind: ImportKind })[]
  >([]);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    callImport<ImportContext>({ action: "context", tenantId })
      .then((data) => {
        if (cancelled) return;
        setContext(data);
        setOptions((current) => ({
          ...current,
          departmentId:
            data.departments.length === 1
              ? (data.departments[0]?.id ?? "")
              : current.departmentId,
          importDevices: data.canManageAssets,
        }));
      })
      .catch((nextError: unknown) => {
        if (!cancelled)
          setError(
            nextError instanceof Error ? nextError.message : String(nextError),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [canManage, tenantId]);

  const batch = useMemo(() => {
    if (!workbook) return null;
    try {
      return parseWorkbook(source, workbook, selection ?? undefined);
    } catch (parseError) {
      console.error("ipam_import_parse_failed", parseError);
      return null;
    }
  }, [source, workbook, selection]);

  const counts = batch ? batchCounts(batch) : null;
  const issuesByKey = useMemo(() => {
    const map = new Map<string, ImportIssue[]>();
    for (const issue of batch?.issues ?? []) {
      if (!issue.key) continue;
      map.set(issue.key, [...(map.get(issue.key) ?? []), issue]);
    }
    return map;
  }, [batch]);

  const included = (target: ImportKind) =>
    batch
      ? rowsOf(batch, target).filter((row) => !excluded.has(row.key)).length
      : 0;
  const deviceAllowed = Boolean(
    context?.canManageAssets && options.importDevices,
  );
  const kindsToSend = IMPORT_KINDS.filter(
    (target) => (target !== "devices" || deviceAllowed) && included(target) > 0,
  );

  function reset() {
    setStep("source");
    setWorkbook(null);
    setFileName("");
    setSelection(null);
    setExcluded(new Set());
    setCompare({});
    setOutcome({});
    setFailures([]);
    setError("");
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      const next = await readWorkbookFile(file);
      if (!Object.values(next).some((rows) => rows.length > 0)) {
        throw new Error("Die Datei enthält keine Daten.");
      }
      const detected = choice === "auto" ? detectSource(next) : choice;
      setSource(detected);
      setWorkbook(next);
      setFileName(file.name);
      setExcluded(new Set());
      setCompare({});
      if (isTableSource(detected)) {
        const fallback = defaultTableSelection(next);
        setSelection(
          fallback
            ? {
                sheet: fallback.sheet,
                target: fallback.target,
                mapping: fallback.mapping,
              }
            : null,
        );
      } else {
        setSelection(null);
      }
    } catch (readError) {
      setWorkbook(null);
      setError(
        readError instanceof Error
          ? readError.message
          : "Die Datei konnte nicht gelesen werden.",
      );
    } finally {
      setBusy(false);
    }
  }

  function toggle(key: string) {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function excludeWithWarnings() {
    setExcluded((current) => {
      const next = new Set(current);
      for (const [key, issues] of issuesByKey) {
        if (issues.some((issue) => issue.severity === "warning")) next.add(key);
      }
      return next;
    });
  }

  function requestOptions() {
    return {
      vrfId: options.vrfId || null,
      departmentId: options.departmentId || null,
      mode: options.mode,
      createLocations: options.createLocations,
    };
  }

  async function runChunks(
    action: "preview" | "apply",
    onResult: (
      target: ImportKind,
      data: { counts: Counts; results: RowResult[] },
    ) => void,
  ) {
    if (!batch) return;
    const plan = kindsToSend.map((target) => ({
      target,
      chunks: chunkRows(
        rowsOf(batch, target) as { key: string; origin: null }[],
        excluded,
        CHUNK,
      ),
    }));
    const total = plan.reduce(
      (sum, entry) =>
        sum + entry.chunks.reduce((rows, chunk) => rows + chunk.length, 0),
      0,
    );
    let done = 0;
    setProgress({ done, total, label: "" });
    for (const { target, chunks } of plan) {
      for (const chunk of chunks) {
        setProgress({ done, total, label: KIND_LABELS[target] });
        const data = await callImport<{ counts: Counts; results: RowResult[] }>(
          {
            action,
            tenantId,
            kind: target,
            source: batch.source,
            options: requestOptions(),
            rows: chunk.map((row) => wireRow(row)),
          },
        );
        onResult(target, data);
        done += chunk.length;
        setProgress({ done, total, label: KIND_LABELS[target] });
      }
    }
  }

  async function runCompare() {
    setBusy(true);
    setError("");
    const next: Partial<Record<ImportKind, Map<string, RowResult>>> = {};
    try {
      await runChunks("preview", (target, data) => {
        const map = next[target] ?? new Map<string, RowResult>();
        for (const result of data.results) map.set(result.key, result);
        next[target] = map;
      });
      setCompare(next);
    } catch (compareError) {
      setError(
        compareError instanceof Error
          ? compareError.message
          : String(compareError),
      );
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    setStep("run");
    setError("");
    const totals: Partial<Record<ImportKind, Counts>> = {};
    const rowFailures: (RowResult & { kind: ImportKind })[] = [];
    try {
      await runChunks("apply", (target, data) => {
        const current = totals[target] ?? {
          created: 0,
          updated: 0,
          unchanged: 0,
          skipped: 0,
          errors: 0,
        };
        totals[target] = {
          created: current.created + data.counts.created,
          updated: current.updated + data.counts.updated,
          unchanged: current.unchanged + data.counts.unchanged,
          skipped: current.skipped + data.counts.skipped,
          errors: current.errors + data.counts.errors,
        };
        for (const result of data.results) {
          if (result.state === "error")
            rowFailures.push({ ...result, kind: target });
        }
      });
    } catch (importError) {
      setError(
        `Der Import wurde unterbrochen: ${importError instanceof Error ? importError.message : String(importError)} Bereits übernommene Einträge bleiben erhalten; ein erneuter Import ergänzt den Rest.`,
      );
    }
    setOutcome(totals);
    setFailures(rowFailures);
    setStep("done");
    onChanged?.();
  }

  if (!canManage) {
    return (
      <section className="ipam-import">
        <p className="ipam-import__notice">
          <Info aria-hidden size={16} />{" "}
          {tn(
            "Für den Import benötigst du die Berechtigung, IP-Adressen zu verwalten.",
            "Für den Import benötigen Sie die Berechtigung, IP-Adressen zu verwalten.",
          )}
        </p>
      </section>
    );
  }

  const table =
    workbook && selection
      ? tableFromRows(workbook[selection.sheet] ?? [])
      : null;
  const visibleRows = batch
    ? (
        rowsOf(batch, kind) as unknown as (Record<string, unknown> & {
          key: string;
        })[]
      ).filter((row) => !onlyIssues || issuesByKey.has(row.key))
    : [];
  const generalIssues = batch?.issues.filter((issue) => !issue.key) ?? [];
  const steps: [Step, string][] = [
    ["source", "Quelle"],
    ["file", "Datei"],
    ["preview", "Vorschau"],
    ["options", "Optionen"],
    ["done", "Ergebnis"],
  ];
  const stepIndex = steps.findIndex(
    ([id]) => id === (step === "run" ? "done" : step),
  );

  return (
    <section className="ipam-import" aria-labelledby="ipam-import-title">
      <header className="ipam-import__head">
        <div>
          <h2 id="ipam-import-title">Daten importieren</h2>
          <p>
            {tn(
              "Übernimm bestehende IP-Listen, Switch- und Access-Point-Listen oder Exporte aus phpIPAM und NetBox. Bestehende Einträge werden erkannt und nicht doppelt angelegt.",
              "Übernehmen Sie bestehende IP-Listen, Switch- und Access-Point-Listen oder Exporte aus phpIPAM und NetBox. Bestehende Einträge werden erkannt und nicht doppelt angelegt.",
            )}
          </p>
        </div>
        <ol className="ipam-import__steps" aria-label="Schritte">
          {steps.map(([id, label], index) => (
            <li
              key={id}
              className={
                index === stepIndex
                  ? "is-current"
                  : index < stepIndex
                    ? "is-done"
                    : undefined
              }
              aria-current={index === stepIndex ? "step" : undefined}
            >
              <span>{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      </header>

      {error ? (
        <p className="ipam-import__error" role="alert">
          <TriangleAlert aria-hidden size={16} /> {error}
        </p>
      ) : null}

      {step === "source" ? (
        <div className="ipam-import__panel">
          <h3>
{tn("Welche Daten möchtest du importieren?","Welche Daten möchten Sie importieren?")}
</h3>
          <div
            className="ipam-import__sources"
            role="radiogroup"
            aria-label="Quelle"
          >
            {SOURCES.map((entry) => (
              <label
                key={entry}
                className={choice === entry ? "is-selected" : undefined}
              >
                <input
                  type="radio"
                  name="ipam-import-source"
                  checked={choice === entry}
                  onChange={() => setChoice(entry)}
                />
                <strong>
                  {entry === "auto"
                    ? "Automatisch erkennen"
                    : SOURCE_LABELS[entry]}
                </strong>
                <small>
                  {entry === "auto"
                    ? tn(
                        "Das Format wird anhand der Spalten und Blätter erkannt. Du kannst es danach ändern.",
                        "Das Format wird anhand der Spalten und Blätter erkannt. Sie können es danach ändern.",
                      )
                    : sourceHints()[entry]}
                </small>
              </label>
            ))}
          </div>
          <footer className="ipam-import__actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => setStep("file")}
            >
              Weiter <ArrowRight aria-hidden size={16} />
            </button>
          </footer>
        </div>
      ) : null}

      {step === "file" ? (
        <div className="ipam-import__panel">
          <h3>Datei hochladen</h3>
          <p className="ipam-import__muted">
            {tn(
              "Excel (.xlsx) oder CSV, höchstens 10 MB. Die Datei wird in deinem Browser gelesen; übertragen werden nur die erkannten Einträge. Blätter mit Zugangsdaten (z. B. WLAN-Schlüssel) werden nie übernommen.",
              "Excel (.xlsx) oder CSV, höchstens 10 MB. Die Datei wird in Ihrem Browser gelesen; übertragen werden nur die erkannten Einträge. Blätter mit Zugangsdaten (z. B. WLAN-Schlüssel) werden nie übernommen.",
            )}
          </p>
          <label className="ipam-import__drop">
            <Upload aria-hidden size={20} />
            <span>{fileName || "Datei auswählen"}</span>
            <input
              type="file"
              accept=".xlsx,.xlsm,.csv,.txt,text/csv"
              onChange={(event) => void readFile(event)}
            />
          </label>
          {busy ? (
            <p className="ipam-import__muted">
              <LoaderCircle
                aria-hidden
                size={16}
                className="ipam-import__spin"
              />{" "}
              Datei wird gelesen …
            </p>
          ) : null}
          {workbook ? (
            <div className="ipam-import__detected">
              <label>
                Erkanntes Format
                <select
                  value={source}
                  onChange={(event) => {
                    const next = event.target.value as ImportSource;
                    setSource(next);
                    setExcluded(new Set());
                    if (isTableSource(next) && !selection) {
                      const fallback = defaultTableSelection(workbook);
                      setSelection(
                        fallback
                          ? {
                              sheet: fallback.sheet,
                              target: fallback.target,
                              mapping: fallback.mapping,
                            }
                          : null,
                      );
                    }
                  }}
                >
                  {(Object.keys(SOURCE_LABELS) as ImportSource[]).map(
                    (entry) => (
                      <option key={entry} value={entry}>
                        {SOURCE_LABELS[entry]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <small>
                <FileSpreadsheet aria-hidden size={14} />{" "}
                {Object.keys(workbook).length} Blätter gelesen
              </small>
            </div>
          ) : null}
          {workbook && isTableSource(source) && selection ? (
            <div className="ipam-import__mapping">
              <div className="ipam-import__mapping-head">
                <label>
                  Blatt
                  <select
                    value={selection.sheet}
                    onChange={(event) => {
                      const sheet = event.target.value;
                      const next = tableFromRows(workbook[sheet] ?? []);
                      setSelection({
                        sheet,
                        target: selection.target,
                        mapping: next
                          ? guessTableMapping(next.headers, selection.target)
                          : {},
                      });
                    }}
                  >
                    {Object.keys(workbook).map((sheet) => (
                      <option key={sheet} value={sheet}>
                        {sheet}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Inhalt
                  <select
                    value={selection.target}
                    onChange={(event) => {
                      const target = event.target.value as TableTarget;
                      setSelection({
                        ...selection,
                        target,
                        mapping: table
                          ? guessTableMapping(table.headers, target)
                          : {},
                      });
                    }}
                  >
                    {(Object.keys(TARGET_LABELS) as TableTarget[]).map(
                      (target) => (
                        <option key={target} value={target}>
                          {TARGET_LABELS[target]}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </div>
              <h4>Spalten zuordnen</h4>
              <div className="ipam-import__fields">
                {TABLE_FIELDS[selection.target].map((field) => (
                  <label key={field.key}>
                    {field.label}
                    {field.required ? " *" : ""}
                    <select
                      value={selection.mapping[field.key] ?? ""}
                      onChange={(event) =>
                        setSelection({
                          ...selection,
                          mapping: {
                            ...selection.mapping,
                            [field.key]:
                              event.target.value === ""
                                ? null
                                : Number(event.target.value),
                          },
                        })
                      }
                    >
                      <option value="">– nicht importieren –</option>
                      {(table?.headers ?? []).map((header, index) => (
                        <option key={`${header}-${index}`} value={index}>
                          {header || `Spalte ${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          <footer className="ipam-import__actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setStep("source")}
            >
              <ArrowLeft aria-hidden size={16} /> Zurück
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!batch || busy}
              onClick={() => {
                const first = IMPORT_KINDS.find(
                  (target) => batch && rowsOf(batch, target).length > 0,
                );
                setKind(first ?? "prefixes");
                setLimit(PAGE);
                setStep("preview");
              }}
            >
              Vorschau <ArrowRight aria-hidden size={16} />
            </button>
          </footer>
        </div>
      ) : null}

      {step === "preview" && batch && counts ? (
        <div className="ipam-import__panel">
          <h3>Vorschau</h3>
          <div className="ipam-import__tiles">
            {IMPORT_KINDS.map((target) => (
              <button
                key={target}
                type="button"
                className={kind === target ? "is-active" : undefined}
                onClick={() => {
                  setKind(target);
                  setLimit(PAGE);
                }}
              >
                <strong>{included(target)}</strong>
                <span>{KIND_LABELS[target]}</span>
                {included(target) !== counts[target] ? (
                  <small>von {counts[target]}</small>
                ) : null}
              </button>
            ))}
            <div className="ipam-import__tile-issues">
              <strong>{counts.errors}</strong>
              <span>ausgelassen</span>
              <small>{counts.warnings} Warnungen</small>
            </div>
          </div>
          {batch.skippedSheets.length ? (
            <details className="ipam-import__details">
              <summary>
                {batch.skippedSheets.length} Blätter übersprungen
              </summary>
              <ul>
                {batch.skippedSheets.map((entry) => (
                  <li key={entry.sheet}>
                    <strong>{entry.sheet}</strong>: {entry.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {generalIssues.length ? (
            <details
              className="ipam-import__details"
              open={generalIssues.some((issue) => issue.severity === "error")}
            >
              <summary>
                {generalIssues.length} Hinweise und ausgelassene Zeilen
              </summary>
              <ul className="ipam-import__issues">
                {generalIssues.map((issue, index) => (
                  <li key={index} className={`is-${issue.severity}`}>
                    <IssueIcon severity={issue.severity} />
                    <span>
                      {issue.origin ? (
                        <em>
                          {issue.origin.sheet}
                          {issue.origin.row
                            ? `, Zeile ${issue.origin.row}`
                            : ""}
                          :{" "}
                        </em>
                      ) : null}
                      {issue.message}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="ipam-import__toolbar">
            <label className="ipam-import__check">
              <input
                type="checkbox"
                checked={onlyIssues}
                onChange={(event) => setOnlyIssues(event.target.checked)}
              />
              Nur Zeilen mit Hinweisen
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={excludeWithWarnings}
            >
              Zeilen mit Warnungen ausschliessen
            </button>
            {excluded.size ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setExcluded(new Set())}
              >
                Alle wieder einschliessen ({excluded.size})
              </button>
            ) : null}
          </div>
          {visibleRows.length ? (
            <div className="ipam-import__table-wrap">
              <table className="ipam-import__table">
                <thead>
                  <tr>
                    <th scope="col">Import</th>
                    {COLUMNS[kind].map((column) => (
                      <th key={column.label} scope="col">
                        {column.label}
                      </th>
                    ))}
                    <th scope="col">Hinweise</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.slice(0, limit).map((row) => {
                    const issues = issuesByKey.get(row.key) ?? [];
                    return (
                      <tr
                        key={row.key}
                        className={
                          excluded.has(row.key) ? "is-excluded" : undefined
                        }
                      >
                        <td>
                          <input
                            type="checkbox"
                            aria-label="Zeile importieren"
                            checked={!excluded.has(row.key)}
                            onChange={() => toggle(row.key)}
                          />
                        </td>
                        {COLUMNS[kind].map((column) => (
                          <td key={column.label}>{column.value(row)}</td>
                        ))}
                        <td>
                          {issues.map((issue, index) => (
                            <span
                              key={index}
                              className={`ipam-import__badge is-${issue.severity}`}
                              title={issue.message}
                            >
                              <IssueIcon severity={issue.severity} />{" "}
                              {issue.message}
                            </span>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ipam-import__muted">Keine Einträge dieser Art.</p>
          )}
          {visibleRows.length > limit ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => setLimit(limit + PAGE * 2)}
            >
              Weitere anzeigen ({visibleRows.length - limit})
            </button>
          ) : null}
          <footer className="ipam-import__actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setStep("file")}
            >
              <ArrowLeft aria-hidden size={16} /> Zurück
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={IMPORT_KINDS.every((target) => included(target) === 0)}
              onClick={() => setStep("options")}
            >
              Weiter <ArrowRight aria-hidden size={16} />
            </button>
          </footer>
        </div>
      ) : null}

      {step === "options" && batch ? (
        <div className="ipam-import__panel">
          <h3>Optionen</h3>
          <div className="ipam-import__options">
            <label>
              Ziel-VRF
              <select
                value={options.vrfId}
                onChange={(event) =>
                  setOptions({ ...options, vrfId: event.target.value })
                }
              >
                <option value="">Globale Routing-Tabelle</option>
                {(context?.vrfs ?? []).map((vrf) => (
                  <option key={vrf.id} value={vrf.id}>
                    {vrf.name}
                  </option>
                ))}
              </select>
              <small>Gilt für Einträge ohne eigenes VRF in der Datei.</small>
            </label>
            {(context?.departments.length ?? 0) > 0 ? (
              <label>
                Abteilung
                <select
                  value={options.departmentId}
                  onChange={(event) =>
                    setOptions({ ...options, departmentId: event.target.value })
                  }
                >
                  {(context?.departments.length ?? 0) > 1 ? (
                    <option value="">Bitte wählen</option>
                  ) : null}
                  {(context?.departments ?? []).map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
                <small>
                  Neue Standorte, VLANs und Subnetze gehören zu dieser
                  Abteilung.
                </small>
              </label>
            ) : null}
            <fieldset>
              <legend>Bestehende Einträge</legend>
              <label className="ipam-import__check">
                <input
                  type="radio"
                  name="ipam-import-mode"
                  checked={options.mode === "update"}
                  onChange={() => setOptions({ ...options, mode: "update" })}
                />
                aktualisieren (leere Felder der Datei überschreiben nichts)
              </label>
              <label className="ipam-import__check">
                <input
                  type="radio"
                  name="ipam-import-mode"
                  checked={options.mode === "skip"}
                  onChange={() => setOptions({ ...options, mode: "skip" })}
                />
                überspringen
              </label>
            </fieldset>
            {batch.devices.length ? (
              <fieldset>
                <legend>Geräte</legend>
                <label className="ipam-import__check">
                  <input
                    type="checkbox"
                    checked={deviceAllowed}
                    disabled={!context?.canManageAssets}
                    onChange={(event) =>
                      setOptions({
                        ...options,
                        importDevices: event.target.checked,
                      })
                    }
                  />
                  {batch.devices.length} Geräte in der Infrastruktur anlegen
                </label>
                {!context?.canManageAssets ? (
                  <small>
                    {tn(
                      "Dafür benötigst du die Berechtigung zur Asset-Verwaltung.",
                      "Dafür benötigen Sie die Berechtigung zur Asset-Verwaltung.",
                    )}
                  </small>
                ) : null}
                <label className="ipam-import__check">
                  <input
                    type="checkbox"
                    checked={options.createLocations}
                    disabled={!deviceAllowed}
                    onChange={(event) =>
                      setOptions({
                        ...options,
                        createLocations: event.target.checked,
                      })
                    }
                  />
                  Fehlende Asset-Standorte anlegen
                </label>
              </fieldset>
            ) : null}
          </div>
          <div className="ipam-import__compare">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void runCompare()}
            >
              {busy ? (
                <LoaderCircle
                  aria-hidden
                  size={16}
                  className="ipam-import__spin"
                />
              ) : (
                <RefreshCw aria-hidden size={16} />
              )}{" "}
              Mit bestehenden Daten abgleichen
            </button>
            {busy && progress.total ? (
              <small>
                {progress.label} … {progress.done} / {progress.total}
              </small>
            ) : null}
            {Object.keys(compare).length ? (
              <table className="ipam-import__summary">
                <thead>
                  <tr>
                    <th scope="col">Art</th>
                    {(
                      [
                        "new",
                        "changed",
                        "unchanged",
                        "skipped",
                        "error",
                      ] as RowState[]
                    ).map((state) => (
                      <th key={state} scope="col">
                        {STATE_LABELS[state]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {kindsToSend.map((target) => {
                    const results = [...(compare[target]?.values() ?? [])];
                    return (
                      <tr key={target}>
                        <th scope="row">{KIND_LABELS[target]}</th>
                        {(
                          [
                            "new",
                            "changed",
                            "unchanged",
                            "skipped",
                            "error",
                          ] as RowState[]
                        ).map((state) => (
                          <td key={state}>
                            {
                              results.filter((result) => result.state === state)
                                .length
                            }
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
            {Object.entries(compare).flatMap(([target, map]) =>
              [...(map?.values() ?? [])]
                .filter((result) => result.state === "error")
                .slice(0, 20)
                .map((result) => (
                  <p
                    key={`${target}-${result.key}`}
                    className="ipam-import__row-error"
                  >
                    <TriangleAlert aria-hidden size={14} />{" "}
                    {KIND_LABELS[target as ImportKind]}{" "}
                    {result.key.split(":").slice(1).join(":")}: {result.message}
                  </p>
                )),
            )}
          </div>
          <footer className="ipam-import__actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setStep("preview")}
            >
              <ArrowLeft aria-hidden size={16} /> Zurück
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={
                busy ||
                kindsToSend.length === 0 ||
                ((context?.departments.length ?? 0) > 1 &&
                  !options.departmentId)
              }
              onClick={() => void runImport()}
            >
              Import starten
            </button>
          </footer>
        </div>
      ) : null}

      {step === "run" ? (
        <div className="ipam-import__panel" aria-live="polite">
          <h3>Import läuft …</h3>
          <progress max={progress.total || 1} value={progress.done} />
          <p className="ipam-import__muted">
            {progress.label ? `${progress.label}: ` : ""}
            {progress.done} von {progress.total} Einträgen
          </p>
        </div>
      ) : null}

      {step === "done" ? (
        <div className="ipam-import__panel">
          <h3>
            <CircleCheck aria-hidden size={18} /> Import abgeschlossen
          </h3>
          <table className="ipam-import__summary">
            <thead>
              <tr>
                <th scope="col">Art</th>
                <th scope="col">Neu</th>
                <th scope="col">Aktualisiert</th>
                <th scope="col">Unverändert</th>
                <th scope="col">Übersprungen</th>
                <th scope="col">Fehler</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(outcome) as ImportKind[]).map((target) => {
                const entry = outcome[target]!;
                return (
                  <tr key={target}>
                    <th scope="row">{KIND_LABELS[target]}</th>
                    <td>{entry.created}</td>
                    <td>{entry.updated}</td>
                    <td>{entry.unchanged}</td>
                    <td>{entry.skipped}</td>
                    <td>{entry.errors}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {failures.length ? (
            <details className="ipam-import__details" open>
              <summary>{failures.length} Zeilen mit Fehlern</summary>
              <ul className="ipam-import__issues">
                {failures.slice(0, 200).map((failure) => (
                  <li
                    key={`${failure.kind}-${failure.key}`}
                    className="is-error"
                  >
                    <TriangleAlert aria-hidden size={14} />
                    <span>
                      <em>
                        {KIND_LABELS[failure.kind]}{" "}
                        {failure.key.split(":").slice(1).join(":")}:{" "}
                      </em>
                      {failure.message}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <footer className="ipam-import__actions">
            <button type="button" className="primary-button" onClick={reset}>
              Weitere Datei importieren
            </button>
          </footer>
        </div>
      ) : null}
    </section>
  );
}
