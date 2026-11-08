import {
  CheckCircle2,
  FileUp,
  LoaderCircle,
  ShieldAlert,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { functionErrorMessage } from "./lib/function-error";
import {
  bytesToBase64,
  MAX_REPORT_PASTE_CHARACTERS,
  parsePhishingConfig,
  parsePhishingSettings,
  parsePhishingSubmit,
  REPORT_FILE_ACCEPT,
  settingsError,
  validateReportFile,
  type PhishingConfig,
  type PhishingSettings,
  type PhishingSettingsOptions,
  type PhishingSubmitResult,
} from "./lib/phishing-report";
import { supabase } from "./lib/supabase";
import "./phishing-report.css";

/**
 * «Phishing melden» (web portal): the person uploads the suspicious e-mail
 * (.eml/.msg) or pastes its headers. The server analyses it without opening
 * links or attachments, creates a security ticket and informs the security
 * team. The person only sees a thank-you and the ticket number.
 */

async function call(body: Record<string, unknown>): Promise<unknown> {
  if (!supabase) throw new Error("Die Verbindung ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke("phishing-reports", {
    body,
  });
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Die Phishing-Meldung ist gerade nicht verfügbar.",
      ),
    );
  }
  return data;
}

export function usePhishingConfig(tenantId: string): PhishingConfig | null {
  const [config, setConfig] = useState<PhishingConfig | null>(null);
  useEffect(() => {
    let active = true;
    setConfig(null);
    void call({ type: "getConfig", tenantId })
      .then((value) => {
        if (active) setConfig(parsePhishingConfig(value));
      })
      .catch(() => {
        if (active) setConfig({ enabled: false, reportAddress: null });
      });
    return () => {
      active = false;
    };
  }, [tenantId]);
  return config;
}

export function PhishingReportButton({
  onOpenTicket,
  tenantId,
}: {
  onOpenTicket?: ((ticketId: string) => void) | undefined;
  tenantId: string;
}) {
  const config = usePhishingConfig(tenantId);
  const [open, setOpen] = useState(false);
  if (!config?.enabled) return null;
  return (
    <>
      <button
        className="secondary-button"
        onClick={() => setOpen(true)}
        type="button"
      >
        <ShieldAlert aria-hidden="true" size={16} strokeWidth={1.9} />
        Phishing melden
      </button>
      {open ? (
        <PhishingReportDialog
          onClose={() => setOpen(false)}
          onOpenTicket={onOpenTicket}
          reportAddress={config.reportAddress}
          tenantId={tenantId}
        />
      ) : null}
    </>
  );
}

function PhishingReportDialog({
  onClose,
  onOpenTicket,
  reportAddress,
  tenantId,
}: {
  onClose: () => void;
  onOpenTicket?: ((ticketId: string) => void) | undefined;
  reportAddress: string | null;
  tenantId: string;
}) {
  const headingId = useId();
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PhishingSubmitResult | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  async function submit() {
    if (busy) return;
    setError("");
    let body: Record<string, unknown>;
    if (mode === "file") {
      if (!file) {
        setError("Bitte wählen Sie die E-Mail-Datei aus.");
        return;
      }
      const invalid = validateReportFile(file.name, file.size);
      if (invalid) {
        setError(invalid);
        return;
      }
      body = {
        type: "submit",
        tenantId,
        channel: "portal",
        fileName: file.name,
        fileBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      };
    } else {
      if (!pasted.trim()) {
        setError("Bitte fügen Sie die Kopfzeilen oder den Quelltext ein.");
        return;
      }
      body = { type: "submit", tenantId, channel: "portal", rawText: pasted };
    }
    setBusy(true);
    try {
      const parsed = parsePhishingSubmit(await call(body));
      if (!parsed) throw new Error("Die Antwort war unvollständig.");
      setResult(parsed);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : String(submitError),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      aria-labelledby={headingId}
      aria-modal="true"
      className="phishing-report-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      role="dialog"
    >
      <section
        className="phishing-report"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
        }}
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="phishing-report__header">
          <div>
            <p className="eyebrow">SICHERHEIT</p>
            <h2 id={headingId}>Phishing melden</h2>
          </div>
          <button
            aria-label="Schliessen"
            className="phishing-report__close"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={17} />
          </button>
        </header>

        {result ? (
          <div className="phishing-report__thanks" role="status">
            <CheckCircle2 aria-hidden="true" size={28} />
            <p>{result.message}</p>
            <p className="phishing-report__hint">
              Ihre Meldung wurde als Ticket {result.ticketNumber} erfasst.
            </p>
            <div className="phishing-report__actions">
              {onOpenTicket ? (
                <button
                  className="secondary-button"
                  onClick={() => {
                    onOpenTicket(result.ticketId);
                    onClose();
                  }}
                  type="button"
                >
                  Ticket öffnen
                </button>
              ) : null}
              <button
                className="primary-button"
                onClick={onClose}
                type="button"
              >
                Schliessen
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <p className="phishing-report__warning">
              Klicken Sie in der verdächtigen E-Mail keine Links an und öffnen
              Sie keine Anhänge. Wir prüfen die Nachricht, ohne Links oder
              Anhänge zu öffnen.
            </p>
            {reportAddress ? (
              <p className="phishing-report__hint">
                Alternativ können Sie die E-Mail als Anlage an{" "}
                <strong>{reportAddress}</strong> weiterleiten. Schreiben Sie
                dabei «Phishing» in den Betreff.
              </p>
            ) : null}
            <div
              aria-label="Art der Meldung"
              className="phishing-report__modes"
              role="radiogroup"
            >
              <label>
                <input
                  checked={mode === "file"}
                  name="phishing-mode"
                  onChange={() => setMode("file")}
                  type="radio"
                />
                Datei hochladen (.eml / .msg)
              </label>
              <label>
                <input
                  checked={mode === "paste"}
                  name="phishing-mode"
                  onChange={() => setMode("paste")}
                  type="radio"
                />
                Kopfzeilen einfügen
              </label>
            </div>
            {mode === "file" ? (
              <label className="phishing-report__file">
                <FileUp aria-hidden="true" size={18} />
                <span>
                  {file
                    ? file.name
                    : "In Outlook: Nachricht speichern unter … (.msg) oder per Drag & Drop als .eml sichern."}
                </span>
                <input
                  accept={REPORT_FILE_ACCEPT}
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  type="file"
                />
              </label>
            ) : (
              <label className="phishing-report__paste">
                Kopfzeilen oder Quelltext
                <textarea
                  maxLength={MAX_REPORT_PASTE_CHARACTERS}
                  onChange={(event) => setPasted(event.target.value)}
                  placeholder="In Outlook: Datei › Eigenschaften › Internetkopfzeilen kopieren und hier einfügen."
                  rows={8}
                  value={pasted}
                />
              </label>
            )}
            {error ? (
              <p className="phishing-report__error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="phishing-report__actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={onClose}
                type="button"
              >
                Abbrechen
              </button>
              <button className="primary-button" disabled={busy} type="submit">
                {busy ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="phishing-report__spin"
                    size={16}
                  />
                ) : (
                  <ShieldAlert aria-hidden="true" size={16} />
                )}
                Melden
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

const PRIORITY_LABELS = {
  low: "Niedrig",
  normal: "Normal",
  high: "Hoch",
  urgent: "Dringend",
} as const;

/** Admin settings (Integrationen › E-Mail). */
export function PhishingReportSettings({ tenantId }: { tenantId: string }) {
  const [settings, setSettings] = useState<PhishingSettings | null>(null);
  const [options, setOptions] = useState<PhishingSettingsOptions | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let active = true;
    void call({ type: "getSettings", tenantId })
      .then((value) => {
        const parsed = parsePhishingSettings(value);
        if (!active) return;
        if (!parsed) {
          setMessage("Die Einstellungen konnten nicht gelesen werden.");
          return;
        }
        setSettings(parsed.settings);
        setOptions(parsed.options);
      })
      .catch(() => {
        // Without «Mandanteneinstellungen verwalten» the card stays hidden.
        if (active) setHidden(true);
      });
    return () => {
      active = false;
    };
  }, [tenantId]);

  if (hidden) return null;

  async function save() {
    if (!settings || busy) return;
    const invalid = settingsError(settings);
    if (invalid) {
      setMessage(invalid);
      return;
    }
    setBusy(true);
    try {
      const parsed = parsePhishingSettings(
        await call({
          type: "saveSettings",
          tenantId,
          ...settings,
          reportAddress: settings.reportAddress?.trim().toLowerCase() || null,
        }),
      );
      if (parsed) {
        setSettings(parsed.settings);
        setOptions(parsed.options);
      }
      setMessage("Gespeichert.");
    } catch (saveError) {
      setMessage(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    } finally {
      setBusy(false);
    }
  }

  const update = (patch: Partial<PhishingSettings>) =>
    setSettings((current) => (current ? { ...current, ...patch } : current));
  const categories =
    options?.categories.filter(
      (category) => category.departmentId === settings?.departmentId,
    ) ?? [];

  return (
    <section className="tenant-automation phishing-report-settings">
      <div className="tenant-automation__heading">
        <div>
          <p className="eyebrow">SICHERHEIT</p>
          <h2>Phishing-Meldungen</h2>
          <p>
            Mitarbeitende melden verdächtige E-Mails mit «Phishing melden» im
            Portal und in der App oder per Weiterleitung an die Meldeadresse
            (die Adresse muss beim verbundenen Exchange-Postfach ankommen, z. B.
            als Alias). Daraus entsteht ein Sicherheitsticket mit automatischer
            Risikoeinschätzung (interne Notiz); Links und Anhänge werden dabei
            nicht geöffnet. Das Sicherheitsteam erhält eine Benachrichtigung.
          </p>
        </div>
      </div>
      {settings && options ? (
        <div className="phishing-report-settings__grid">
          <label className="tenant-automation__switch">
            <input
              checked={settings.enabled}
              disabled={busy}
              onChange={(event) => update({ enabled: event.target.checked })}
              type="checkbox"
            />
            Phishing-Meldungen aktivieren
          </label>
          <label>
            Meldeadresse
            <input
              autoComplete="off"
              maxLength={320}
              onChange={(event) =>
                update({ reportAddress: event.target.value || null })
              }
              placeholder="phishing@firma.ch"
              type="email"
              value={settings.reportAddress ?? ""}
            />
          </label>
          <label>
            Zielabteilung
            <select
              onChange={(event) =>
                update({
                  departmentId: event.target.value || null,
                  categoryId: null,
                })
              }
              value={settings.departmentId ?? ""}
            >
              <option value="">Bitte wählen</option>
              {options.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Kategorie
            <select
              disabled={!settings.departmentId}
              onChange={(event) =>
                update({ categoryId: event.target.value || null })
              }
              value={settings.categoryId ?? ""}
            >
              <option value="">Keine</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priorität
            <select
              onChange={(event) =>
                update({
                  priorityKey: event.target
                    .value as PhishingSettings["priorityKey"],
                })
              }
              value={settings.priorityKey}
            >
              {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sicherheitsteam (Benachrichtigung)
            <select
              onChange={(event) =>
                update({ notifyTeamId: event.target.value || null })
              }
              value={settings.notifyTeamId ?? ""}
            >
              <option value="">Alle mit Zugriff auf die Zielabteilung</option>
              {options.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void save()}
              type="button"
            >
              Speichern
            </button>
          </div>
        </div>
      ) : null}
      {message ? (
        <p className="tenant-automation__message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
