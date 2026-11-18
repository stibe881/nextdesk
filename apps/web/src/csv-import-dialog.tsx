import { tn } from "./lib/formality";
import { useMemo, useState, type ChangeEvent } from "react";
import { FileUp, X } from "lucide-react";
import {
  guessMapping,
  parseCsv,
  prepareRows,
  type CsvTable,
  type ImportField,
  type Mapping,
  type PreparedRow,
} from "./lib/csv-import";
import "./csv-import-dialog.css";

type Result = { line: number; ok: boolean; message?: string };

/**
 * CSV import in three steps: choose a file, map the columns (guessed from the
 * headers), check the preview and import the valid rows one by one.
 */
export function CsvImportDialog({
  title,
  fields,
  templateName,
  onImportRow,
  onClose,
  onFinished,
}: {
  title: string;
  fields: ImportField[];
  templateName: string;
  onImportRow: (values: PreparedRow["values"]) => Promise<void>;
  onClose: () => void;
  onFinished: (imported: number) => void;
}) {
  const [table, setTable] = useState<CsvTable | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<Mapping>({});
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Result[] | null>(null);

  const rows = useMemo(
    () => (table ? prepareRows(table, fields, mapping) : []),
    [fields, mapping, table],
  );
  const valid = rows.filter((row) => row.errors.length === 0);
  const missingRequired = fields.filter(
    (field) => field.required && (mapping[field.key] ?? null) === null,
  );

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setResults(null);
    if (file.size > 2_000_000) {
      setError("Die Datei ist zu gross (höchstens 2 MB).");
      return;
    }
    const buffer = await file.arrayBuffer();
    // Excel often saves CSV as Windows-1252; fall back when UTF-8 fails.
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      text = new TextDecoder("windows-1252").decode(buffer);
    }
    const parsed = parseCsv(text);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setError("Die Datei enthält keine Kopfzeile oder keine Datenzeilen.");
      return;
    }
    if (parsed.rows.length > 1000) {
      setError(
        tn(
          "Bitte importiere höchstens 1000 Zeilen auf einmal.",
          "Bitte importieren Sie höchstens 1000 Zeilen auf einmal.",
        ),
      );
      return;
    }
    setFileName(file.name);
    setTable(parsed);
    setMapping(guessMapping(parsed.headers, fields));
  }

  function downloadTemplate() {
    const header = fields.map((field) => field.label).join(";");
    const blob = new Blob([`﻿${header}\n`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = templateName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function runImport() {
    setRunning(true);
    setProgress(0);
    const next: Result[] = [];
    for (const [index, row] of valid.entries()) {
      try {
        await onImportRow(row.values);
        next.push({ line: row.line, ok: true });
      } catch (nextError) {
        next.push({
          line: row.line,
          ok: false,
          message:
            nextError instanceof Error ? nextError.message : String(nextError),
        });
      }
      setProgress(index + 1);
    }
    setResults(next);
    setRunning(false);
    onFinished(next.filter((result) => result.ok).length);
  }

  return (
    <div className="csv-import__backdrop" role="presentation">
      <section
        aria-label={title}
        aria-modal="true"
        className="csv-import"
        role="dialog"
      >
        <header>
          <h3>
            <FileUp aria-hidden="true" size={18} /> {title}
          </h3>
          <button
            aria-label="Schliessen"
            className="icon-button"
            disabled={running}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        <div className="csv-import__step">
          <p>
            CSV-Datei mit Kopfzeile (Trennzeichen Semikolon, Komma oder Tab).
            Datumswerte wie 31.03.2028, Beträge wie 1'234.50.
          </p>
          <div className="csv-import__file">
            <input accept=".csv,text/csv" onChange={readFile} type="file" />
            <button
              className="text-button"
              onClick={downloadTemplate}
              type="button"
            >
              Vorlage herunterladen
            </button>
          </div>
          {fileName ? (
            <small>
              {fileName}: {table?.rows.length ?? 0} Zeilen
            </small>
          ) : null}
        </div>

        {error ? (
          <p className="form-message form-message--error" role="alert">
            {error}
          </p>
        ) : null}

        {table ? (
          <>
            <div className="csv-import__step">
              <h4>Spalten zuordnen</h4>
              <div className="csv-import__mapping">
                {fields.map((field) => (
                  <label key={field.key}>
                    <span>
                      {field.label}
                      {field.required ? " *" : ""}
                    </span>
                    <select
                      onChange={(event) =>
                        setMapping((current) => ({
                          ...current,
                          [field.key]:
                            event.target.value === ""
                              ? null
                              : Number(event.target.value),
                        }))
                      }
                      value={mapping[field.key] ?? ""}
                    >
                      <option value="">– nicht importieren –</option>
                      {table.headers.map((header, index) => (
                        <option key={`${header}-${index}`} value={index}>
                          {header || `Spalte ${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {missingRequired.length ? (
                <p className="form-message form-message--error">
                  Pflichtfelder ohne Spalte:{" "}
                  {missingRequired.map((field) => field.label).join(", ")}
                </p>
              ) : null}
            </div>

            <div className="csv-import__step">
              <h4>
                Vorschau: {valid.length} von {rows.length} Zeilen gültig
              </h4>
              <div className="csv-import__preview">
                <table>
                  <thead>
                    <tr>
                      <th>Zeile</th>
                      {fields
                        .filter((field) => mapping[field.key] !== null)
                        .map((field) => (
                          <th key={field.key}>{field.label}</th>
                        ))}
                      <th>Prüfung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((row) => (
                      <tr
                        className={row.errors.length ? "is-invalid" : ""}
                        key={row.line}
                      >
                        <td>{row.line}</td>
                        {fields
                          .filter((field) => mapping[field.key] !== null)
                          .map((field) => (
                            <td key={field.key}>
                              {String(row.values[field.key] ?? "")}
                            </td>
                          ))}
                        <td>{row.errors.join(" · ") || "OK"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 50 ? (
                <small>Es werden die ersten 50 Zeilen angezeigt.</small>
              ) : null}
            </div>
          </>
        ) : null}

        {results ? (
          <div className="csv-import__step">
            <h4>
              {results.filter((result) => result.ok).length} importiert,{" "}
              {results.filter((result) => !result.ok).length} fehlgeschlagen
            </h4>
            <ul className="csv-import__results">
              {results
                .filter((result) => !result.ok)
                .map((result) => (
                  <li key={result.line}>
                    Zeile {result.line}: {result.message}
                  </li>
                ))}
            </ul>
          </div>
        ) : null}

        <footer>
          <button
            className="secondary-button"
            disabled={running}
            onClick={onClose}
            type="button"
          >
            {results ? "Schliessen" : "Abbrechen"}
          </button>
          {!results ? (
            <button
              className="primary-button"
              disabled={
                running ||
                !table ||
                valid.length === 0 ||
                missingRequired.length > 0
              }
              onClick={() => void runImport()}
              type="button"
            >
              {running
                ? `Wird importiert … ${progress}/${valid.length}`
                : `${valid.length} Zeilen importieren`}
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
