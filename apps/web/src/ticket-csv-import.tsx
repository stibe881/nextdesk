import { useEffect, useState } from "react";
import { FileUp, LoaderCircle } from "lucide-react";
import { supabase } from "./lib/supabase";

type Department = { id: string; name: string };
type ImportRow = {
  subject: string;
  description: string;
  priority: string;
  requesterName: string;
  requesterEmail: string;
};
type Preview = {
  accepted: number;
  rejected: number;
  issues: Array<{ row: number; errors: string[] }>;
};

function rowsFromCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') quoted = !quoted;
    else if (!quoted && (char === ";" || char === ",")) {
      row.push(cell.trim());
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
function normalizedHeader(value: string) {
  return value.toLocaleLowerCase("de-CH").replace(/[^a-zäöü]/g, "");
}
function parseCsv(text: string): ImportRow[] {
  const csv = rowsFromCsv(text);
  if (csv.length < 2) return [];
  const headers = csv[0]!.map(normalizedHeader);
  const at = (...names: string[]) =>
    headers.findIndex((header) => names.includes(header));
  const subject = at("betreff", "subject");
  const description = at("beschreibung", "description");
  const priority = at("priorität", "prioritaet", "priority");
  const requesterName = at("anfragendeperson", "anfragender", "requestername");
  const requesterEmail = at("email", "emailadresse", "requesteremail");
  if ([subject, description, requesterName].some((index) => index < 0))
    throw new Error(
      "Die CSV benötigt mindestens die Spalten Betreff, Beschreibung und Anfragende Person.",
    );
  return csv
    .slice(1)
    .filter((row) => row.some(Boolean))
    .map((row) => ({
      subject: row[subject] ?? "",
      description: row[description] ?? "",
      priority: priority >= 0 ? (row[priority] ?? "normal") : "normal",
      requesterName: row[requesterName] ?? "",
      requesterEmail: requesterEmail >= 0 ? (row[requesterEmail] ?? "") : "",
    }));
}
function downloadTemplate() {
  const content =
    "Betreff;Beschreibung;Priorität;Anfragende Person;E-Mail\r\nVPN-Zugang;Bitte Zugang zum VPN prüfen.;Normal;Max Muster;max.muster@example.ch\r\n";
  const url = URL.createObjectURL(
    new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "nextdesk-ticket-import-vorlage.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function TicketCsvImport({
  tenantId,
  onImported,
}: {
  tenantId: string;
  onImported: () => void;
}) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!supabase) return;
    void supabase
      .from("departments")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("name")
      .then(({ data, error }) => {
        if (error) {
          setMessage("Die Abteilungen konnten nicht geladen werden.");
          return;
        }
        const next = (data ?? []).filter(
          (item): item is Department =>
            typeof item.id === "string" && typeof item.name === "string",
        );
        setDepartments(next);
        setDepartmentId((current) => current || next[0]?.id || "");
      });
  }, [tenantId]);
  async function invoke(type: "preview" | "import") {
    if (!supabase || !departmentId || !rows.length) return;
    setPending(true);
    setMessage("");
    try {
      const { data, error } = await supabase.functions.invoke(
        "ticket-csv-import",
        { body: { type, tenantId, departmentId, rows } },
      );
      if (error) throw error;
      const body = data?.data;
      if (type === "preview") {
        if (
          !body ||
          typeof body.accepted !== "number" ||
          typeof body.rejected !== "number" ||
          !Array.isArray(body.issues)
        )
          throw new Error("Die Importvorschau ist unvollständig.");
        setPreview({
          accepted: body.accepted,
          rejected: body.rejected,
          issues: body.issues,
        });
      } else {
        const count = Array.isArray(body?.created) ? body.created.length : 0;
        setMessage(`${count} Tickets wurden importiert.`);
        setRows([]);
        setPreview(null);
        onImported();
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Der Import konnte nicht verarbeitet werden.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <details className="ticket-csv-import">
      <summary>
        <FileUp aria-hidden="true" size={16} /> Tickets importieren
      </summary>
      <div className="ticket-csv-import__content">
        <p>
          Importiere maximal 100 Tickets pro Datei. Zuerst wird immer eine
          Vorschau ohne Datenänderung erstellt.
        </p>
        <button
          className="text-button"
          onClick={downloadTemplate}
          type="button"
        >
          CSV-Vorlage herunterladen
        </button>
        <label>
          CSV-Datei
          <input
            accept=".csv,text/csv"
            disabled={pending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then((text) => {
                try {
                  const next = parseCsv(text);
                  if (!next.length)
                    throw new Error("Die Datei enthält keine Ticketzeilen.");
                  if (next.length > 100)
                    throw new Error(
                      "Eine Datei darf höchstens 100 Tickets enthalten.",
                    );
                  setRows(next);
                  setPreview(null);
                  setMessage(`${next.length} Ticketzeilen wurden eingelesen.`);
                } catch (error) {
                  setRows([]);
                  setPreview(null);
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : "Die CSV-Datei konnte nicht gelesen werden.",
                  );
                }
              });
            }}
            type="file"
          />
        </label>
        <label>
          Zielabteilung
          <select
            disabled={pending || !departments.length}
            onChange={(event) => {
              setDepartmentId(event.target.value);
              setPreview(null);
            }}
            value={departmentId}
          >
            <option value="">Abteilung auswählen</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <div className="ticket-csv-import__actions">
          <button
            className="secondary-button"
            disabled={pending || !rows.length || !departmentId}
            onClick={() => void invoke("preview")}
            type="button"
          >
            {pending ? (
              <LoaderCircle
                aria-hidden="true"
                className="ticket-detail-spinner"
                size={16}
              />
            ) : null}{" "}
            Import prüfen
          </button>
          {preview && preview.accepted > 0 && preview.rejected === 0 && (
            <button
              disabled={pending}
              onClick={() => void invoke("import")}
              type="button"
            >
              {pending
                ? "Import wird ausgeführt …"
                : `${preview.accepted} Tickets verbindlich importieren`}
            </button>
          )}
        </div>
        {preview && (
          <div className="ticket-csv-import__preview">
            <strong>
              {preview.accepted} gültig, {preview.rejected} mit Fehlern
            </strong>
            {preview.issues.length > 0 && (
              <ul>
                {preview.issues.map((issue) => (
                  <li key={issue.row}>
                    Zeile {issue.row}: {issue.errors.join(", ")}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {message && (
          <p aria-live="polite" className="data-caption">
            {message}
          </p>
        )}
      </div>
    </details>
  );
}
