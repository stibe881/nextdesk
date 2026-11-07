import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Copy,
  DatabaseBackup,
  History,
  KeyRound,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { functionErrorMessage } from "./lib/function-error";
import {
  backupOverdue,
  backupResultChip,
  intervalLabel,
  parseBackupJobs,
  parseBackupReports,
  parseBackupSettings,
  parseOptions,
  responseData,
  splitPatterns,
  type AssetOption,
  type BackupJob,
  type BackupReport,
  type BackupSettings,
  type Option,
  type PriorityOption,
} from "./lib/monitoring-automation";
import { supabase } from "./lib/supabase";

function invoke(body: Record<string, unknown>) {
  if (!supabase) {
    throw new Error("Die Verbindung zu nextDesk ist nicht konfiguriert.");
  }
  return supabase.functions.invoke<unknown>("backup-monitoring", { body });
}

function dateTime(value: string | null): string {
  if (!value) return "noch nie";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "unbekannt"
    : date.toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "short" });
}

async function copyText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
  await navigator.clipboard.writeText(value);
}

const INTERVALS: { value: string; label: string }[] = [
  { value: "", label: "Nicht überwachen" },
  { value: "12", label: "alle 12 Stunden" },
  { value: "24", label: "täglich" },
  { value: "48", label: "alle 2 Tage" },
  { value: "168", label: "wöchentlich" },
  { value: "720", label: "alle 30 Tage" },
];

const ACTION_LABEL: Record<string, string> = {
  ticket_created: "Ticket erstellt",
  comment_added: "Kommentar ergänzt",
  resolved: "Ticket gelöst",
  recorded: "erfasst",
};

const REASON_LABEL = {
  failed: "fehlgeschlagen",
  warning: "Warnung",
  missing: "Meldung ausgeblieben",
} as const;

export const WEBHOOK_EXAMPLE =
  '{"job": "NAS Sync", "status": "failed", "message": "Volume voll", "id": "lauf-42"}';

function JobRow({
  tenantId,
  job,
  defaultGraceHours,
  departments,
  assets,
  services,
  disabled,
  onSave,
  onDelete,
}: {
  tenantId: string;
  job: BackupJob;
  defaultGraceHours: number;
  departments: Option[];
  assets: AssetOption[];
  services: Option[];
  disabled: boolean;
  onSave: (job: BackupJob) => Promise<void>;
  onDelete: (job: BackupJob) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(job);
  const [reports, setReports] = useState<BackupReport[] | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const chip = backupResultChip(job.lastResult);
  const overdue = backupOverdue(job, defaultGraceHours);

  useEffect(() => setDraft(job), [job]);

  async function toggleHistory() {
    if (reports) {
      setReports(null);
      return;
    }
    setHistoryError("");
    try {
      const { data, error } = await invoke({
        type: "listReports",
        tenantId,
        jobId: job.id,
      });
      if (error) throw error;
      setReports(parseBackupReports(responseData(data).reports));
    } catch (error) {
      setHistoryError(
        await functionErrorMessage(
          error,
          "Der Verlauf konnte nicht geladen werden.",
        ),
      );
    }
  }

  return (
    <li>
      <article>
        <div>
          <strong>{job.name}</strong>{" "}
          <span className={`monitoring-chip monitoring-chip--${chip.tone}`}>
            {chip.label}
          </span>
          {overdue || job.missingAlertedAt ? (
            <span className="monitoring-chip monitoring-chip--danger">
              Meldung ausgeblieben
            </span>
          ) : null}
          {!job.active ? (
            <span className="monitoring-chip monitoring-chip--neutral">
              pausiert
            </span>
          ) : null}
          <p>
            Letzte Meldung: {dateTime(job.lastReportAt)}
            {job.lastSource
              ? ` (${job.lastSource === "email" ? "E-Mail" : "Webhook"})`
              : ""}{" "}
            · letzter Erfolg: {dateTime(job.lastSuccessAt)} · erwartet{" "}
            {intervalLabel(job.expectedIntervalHours)} · {job.reportCount}{" "}
            {job.reportCount === 1 ? "Meldung" : "Meldungen"}
            {job.ticketNumber
              ? ` · Ticket ${job.ticketNumber}${
                  job.ticketReason ? ` (${REASON_LABEL[job.ticketReason]})` : ""
                }`
              : ""}
          </p>
          {job.lastMessage ? <p>{job.lastMessage}</p> : null}
          {editing ? (
            <div className="monitoring-settings__grid">
              <label>
                Erwartetes Intervall
                <select
                  disabled={disabled}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      expectedIntervalHours: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                  value={
                    draft.expectedIntervalHours
                      ? String(draft.expectedIntervalHours)
                      : ""
                  }
                >
                  {INTERVALS.some(
                    (option) =>
                      option.value ===
                      String(draft.expectedIntervalHours ?? ""),
                  ) ? null : (
                    <option value={String(draft.expectedIntervalHours)}>
                      {intervalLabel(draft.expectedIntervalHours)}
                    </option>
                  )}
                  {INTERVALS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Toleranz (Stunden)
                <input
                  disabled={disabled}
                  max={336}
                  min={0}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      graceHours:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                    })
                  }
                  placeholder={String(defaultGraceHours)}
                  type="number"
                  value={draft.graceHours ?? ""}
                />
              </label>
              <label>
                Abteilung
                <select
                  disabled={disabled}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      departmentId: event.target.value || null,
                    })
                  }
                  value={draft.departmentId ?? ""}
                >
                  <option value="">Wie Einstellungen</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Asset
                <select
                  disabled={disabled}
                  onChange={(event) =>
                    setDraft({ ...draft, assetId: event.target.value || null })
                  }
                  value={draft.assetId ?? ""}
                >
                  <option value="">Kein Asset</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Dienst
                <select
                  disabled={disabled}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      serviceId: event.target.value || null,
                    })
                  }
                  value={draft.serviceId ?? ""}
                >
                  <option value="">Kein Dienst</option>
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="asset-intune-settings__check">
                <input
                  checked={draft.active}
                  disabled={disabled}
                  onChange={(event) =>
                    setDraft({ ...draft, active: event.target.checked })
                  }
                  type="checkbox"
                />
                Job überwachen
              </label>
            </div>
          ) : null}
          {historyError ? (
            <p className="monitoring-settings__error">{historyError}</p>
          ) : null}
          {reports ? (
            reports.length === 0 ? (
              <p className="empty-state">Noch keine Meldungen.</p>
            ) : (
              <ol
                aria-label={`Verlauf ${job.name}`}
                className="monitoring-settings__history"
              >
                {reports.map((report) => {
                  const reportChip = backupResultChip(report.result);
                  return (
                    <li key={report.id}>
                      <span
                        className={`monitoring-chip monitoring-chip--${reportChip.tone}`}
                      >
                        {reportChip.label}
                      </span>{" "}
                      {dateTime(report.reportedAt)} ·{" "}
                      {report.source === "email" ? "E-Mail" : "Webhook"}
                      {report.objectCount !== null
                        ? ` · ${report.objectCount} Objekte`
                        : ""}
                      {report.action && ACTION_LABEL[report.action]
                        ? ` · ${ACTION_LABEL[report.action]}`
                        : ""}
                      {report.summary ? <p>{report.summary}</p> : null}
                    </li>
                  );
                })}
              </ol>
            )
          ) : null}
        </div>
        <div className="monitoring-settings__row-actions">
          <button
            className="secondary-button"
            disabled={disabled}
            onClick={() => void toggleHistory()}
            type="button"
          >
            <History aria-hidden="true" size={15} />
            {reports ? "Verlauf ausblenden" : "Verlauf"}
          </button>
          {editing ? (
            <>
              <button
                disabled={disabled}
                onClick={() => {
                  void onSave(draft).then(() => setEditing(false));
                }}
                type="button"
              >
                Speichern
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  setDraft(job);
                  setEditing(false);
                }}
                type="button"
              >
                Abbrechen
              </button>
            </>
          ) : (
            <button
              className="secondary-button"
              disabled={disabled}
              onClick={() => setEditing(true)}
              type="button"
            >
              Bearbeiten
            </button>
          )}
          {confirmDelete ? (
            <button
              disabled={disabled}
              onClick={() => {
                setConfirmDelete(false);
                void onDelete(job);
              }}
              type="button"
            >
              Entfernen bestätigen
            </button>
          ) : (
            <button
              aria-label={`${job.name} entfernen`}
              className="secondary-button"
              disabled={disabled}
              onClick={() => setConfirmDelete(true)}
              type="button"
            >
              <Trash2 aria-hidden="true" size={15} />
            </button>
          )}
        </div>
      </article>
    </li>
  );
}

/**
 * Backup-Überwachung: Job-Berichte per E-Mail (Absender-/Betreffregel) oder
 * Webhook; Fehler und ausbleibende Meldungen werden zu Tickets.
 */
export function BackupMonitoringSettings({ tenantId }: { tenantId: string }) {
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [jobs, setJobs] = useState<BackupJob[]>([]);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [priorities, setPriorities] = useState<PriorityOption[]>([]);
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [services, setServices] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [copied, setCopied] = useState(false);
  const requestVersion = useRef(0);

  const [enabled, setEnabled] = useState(false);
  const [departmentId, setDepartmentId] = useState("");
  const [priorityKey, setPriorityKey] = useState("");
  const [warningAction, setWarningAction] = useState<"ignore" | "ticket">(
    "ignore",
  );
  const [autoResolve, setAutoResolve] = useState(true);
  const [intervalHours, setIntervalHours] = useState("24");
  const [graceHours, setGraceHours] = useState("6");
  const [senders, setSenders] = useState("");
  const [subjects, setSubjects] = useState("");

  const applySettings = useCallback((next: BackupSettings) => {
    setSettings(next);
    setEnabled(next.enabled);
    setDepartmentId(next.departmentId ?? "");
    setPriorityKey(next.priorityKey ?? "");
    setWarningAction(next.warningAction);
    setAutoResolve(next.autoResolve);
    setIntervalHours(String(next.defaultIntervalHours));
    setGraceHours(String(next.defaultGraceHours));
    setSenders(next.senderPatterns.join("\n"));
    setSubjects(next.subjectPatterns.join("\n"));
  }, []);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const { data, error } = await invoke({ type: "get", tenantId });
      if (error) throw error;
      const payload = responseData(data);
      const next = parseBackupSettings(payload.settings);
      if (!next) throw new Error("Die Konfiguration ist unvollständig.");
      if (requestVersion.current !== version) return;
      applySettings(next);
      setJobs(parseBackupJobs(payload.jobs));
      const options = parseOptions(payload);
      setDepartments(options.departments);
      setPriorities(options.priorities);
      setAssets(options.assets);
      setServices(options.services);
    } catch (error) {
      if (requestVersion.current !== version) return;
      setMessage(
        await functionErrorMessage(
          error,
          "Die Backup-Überwachung konnte nicht geladen werden.",
        ),
      );
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, [applySettings, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(
    key: string,
    body: Record<string, unknown>,
    success: string,
    failure: string,
  ): Promise<Record<string, unknown> | null> {
    setBusy(key);
    setMessage("");
    try {
      const { data, error } = await invoke({ tenantId, ...body });
      if (error) throw error;
      const payload = responseData(data);
      if (payload.jobs !== undefined) setJobs(parseBackupJobs(payload.jobs));
      if (success) setMessage(success);
      return payload;
    } catch (error) {
      setMessage(await functionErrorMessage(error, failure));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    const payload = await run(
      "settings",
      {
        type: "saveSettings",
        settings: {
          enabled,
          departmentId: departmentId || null,
          priorityKey: priorityKey || null,
          warningAction,
          autoResolve,
          defaultIntervalHours: Number(intervalHours),
          defaultGraceHours: Number(graceHours),
          senderPatterns: splitPatterns(senders),
          subjectPatterns: splitPatterns(subjects),
        },
      },
      "Die Einstellungen wurden gespeichert.",
      "Die Einstellungen konnten nicht gespeichert werden. Bitte prüfen Sie die Absenderadressen.",
    );
    const next = payload ? parseBackupSettings(payload.settings) : null;
    if (next) applySettings(next);
  }

  async function rotate() {
    setConfirmRotate(false);
    const payload = await run(
      "rotate",
      { type: "rotateToken" },
      "",
      "Der Token konnte nicht erzeugt werden.",
    );
    if (payload && typeof payload.webhookUrl === "string") {
      setNewUrl(payload.webhookUrl);
      setCopied(false);
      const next = parseBackupSettings(payload.settings);
      if (next) setSettings(next);
    }
  }

  const disabled = loading || busy !== null;

  return (
    <section
      aria-busy={disabled}
      aria-labelledby="backup-monitoring-heading"
      className="asset-intune-settings monitoring-settings panel"
    >
      <div className="panel-heading asset-intune-settings__heading">
        <div>
          <span className="eyebrow">MONITORING</span>
          <h2 id="backup-monitoring-heading">Backup-Überwachung</h2>
          <p>
            Berichte von Backup-Jobs (z. B. Veeam) kommen per E-Mail oder
            Webhook. Ein fehlgeschlagener Job erstellt ein Ticket oder ergänzt
            das offene; bleibt eine Meldung länger als erwartet aus, entsteht
            «Backup-Meldung ausgeblieben». Beim nächsten Erfolg wird das Ticket
            kommentiert und gelöst.
          </p>
        </div>
        <DatabaseBackup aria-hidden="true" size={25} />
      </div>

      {loading ? <p>Konfiguration wird geladen …</p> : null}
      {!loading && settings ? (
        <>
          <form className="asset-intune-settings__form" onSubmit={saveSettings}>
            <label className="asset-intune-settings__check">
              <input
                checked={enabled}
                disabled={disabled}
                onChange={(event) => setEnabled(event.target.checked)}
                type="checkbox"
              />
              Backup-Meldungen für diesen Mandanten verarbeiten
            </label>
            <div className="monitoring-settings__grid">
              <label>
                Abteilung für Tickets
                <select
                  disabled={disabled}
                  onChange={(event) => setDepartmentId(event.target.value)}
                  value={departmentId}
                >
                  <option value="">Erste aktive Abteilung</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priorität
                <select
                  disabled={disabled}
                  onChange={(event) => setPriorityKey(event.target.value)}
                  value={priorityKey}
                >
                  <option value="">Standard (Hoch)</option>
                  {priorities.map((priority) => (
                    <option key={priority.key} value={priority.key}>
                      {priority.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Bei «Warning»
                <select
                  disabled={disabled}
                  onChange={(event) =>
                    setWarningAction(event.target.value as "ignore" | "ticket")
                  }
                  value={warningAction}
                >
                  <option value="ignore">Nur erfassen</option>
                  <option value="ticket">Ticket erstellen</option>
                </select>
              </label>
              <label>
                Erwartetes Intervall neuer Jobs (Stunden)
                <input
                  disabled={disabled}
                  max={2160}
                  min={1}
                  onChange={(event) => setIntervalHours(event.target.value)}
                  type="number"
                  value={intervalHours}
                />
              </label>
              <label>
                Toleranz (Stunden)
                <input
                  disabled={disabled}
                  max={336}
                  min={0}
                  onChange={(event) => setGraceHours(event.target.value)}
                  type="number"
                  value={graceHours}
                />
              </label>
            </div>
            <div className="monitoring-settings__grid">
              <label>
                Absender der Backup-Berichte (eine Adresse pro Zeile)
                <textarea
                  disabled={disabled}
                  onChange={(event) => setSenders(event.target.value)}
                  placeholder={"veeam@kunde.ch\n@backup.kunde.ch"}
                  rows={3}
                  value={senders}
                />
              </label>
              <label>
                Betreff enthält (optional, eine Angabe pro Zeile)
                <textarea
                  disabled={disabled}
                  onChange={(event) => setSubjects(event.target.value)}
                  placeholder={"[Success]\n[Warning]\n[Failed]"}
                  rows={3}
                  value={subjects}
                />
              </label>
            </div>
            <label className="asset-intune-settings__check">
              <input
                checked={autoResolve}
                disabled={disabled}
                onChange={(event) => setAutoResolve(event.target.checked)}
                type="checkbox"
              />
              Ticket beim nächsten Erfolg automatisch auf «Gelöst» setzen (nur
              wenn es bereits zugewiesen ist)
            </label>
            <p className="asset-intune-settings__help">
              E-Mails dieser Absender (über das verbundene Exchange-Postfach
              oder den E-Mail-Eingang) werden nicht zu Tickets, sondern hier
              erfasst. Erkannt werden Veeam-Betreffs wie «[Failed]
              Tagessicherung (3 VMs)» sowie Zeilen wie «Job: …» und «Status: …».
              Nicht erkennbare Nachrichten werden wie bisher zu Tickets. Jobs
              werden bei der ersten Meldung automatisch angelegt.
            </p>
            <div className="asset-intune-settings__status" role="status">
              <DatabaseBackup aria-hidden="true" size={17} />
              <span>
                Letzte Meldung: {dateTime(settings.lastReceivedAt)} ·
                Webhook-Token{" "}
                {settings.hasToken
                  ? `erzeugt am ${dateTime(settings.tokenRotatedAt)}`
                  : "noch nicht erzeugt"}
              </span>
            </div>
            <div className="asset-intune-settings__actions">
              <button disabled={disabled} type="submit">
                {busy === "settings"
                  ? "Wird gespeichert …"
                  : "Einstellungen speichern"}
              </button>
              <button
                className="secondary-button"
                disabled={disabled}
                onClick={() =>
                  settings.hasToken ? setConfirmRotate(true) : void rotate()
                }
                type="button"
              >
                <KeyRound aria-hidden="true" size={16} />
                {busy === "rotate"
                  ? "Token wird erzeugt …"
                  : settings.hasToken
                    ? "Neuen Webhook-Token erzeugen"
                    : "Webhook-Token erzeugen"}
              </button>
            </div>
          </form>

          {confirmRotate ? (
            <div
              aria-labelledby="backup-rotate-title"
              className="asset-intune-settings__status"
              role="alertdialog"
            >
              <KeyRound aria-hidden="true" size={18} />
              <div>
                <strong id="backup-rotate-title">Neuen Token erzeugen?</strong>
                <p>
                  Die bisherige Webhook-Adresse funktioniert danach nicht mehr.
                </p>
                <div className="asset-intune-settings__actions">
                  <button onClick={() => void rotate()} type="button">
                    Token erneuern
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => setConfirmRotate(false)}
                    type="button"
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {newUrl ? (
            <div className="monitoring-settings__secret" role="status">
              <strong>Webhook-Adresse (wird nur jetzt angezeigt)</strong>
              <p>
                Senden Sie Berichte per POST an diese Adresse, z. B. als JSON:{" "}
                <code>{WEBHOOK_EXAMPLE}</code>. Erlaubte Status: success,
                warning, failed.
              </p>
              <div className="monitoring-settings__copy">
                <code>{newUrl}</code>
                <button
                  className="secondary-button"
                  onClick={() =>
                    void copyText(newUrl).then(
                      () => setCopied(true),
                      () =>
                        setMessage(
                          "Kopieren war nicht möglich. Bitte markieren Sie den Text.",
                        ),
                    )
                  }
                  type="button"
                >
                  <Copy aria-hidden="true" size={15} />
                  {copied ? "Kopiert" : "Kopieren"}
                </button>
              </div>
            </div>
          ) : null}

          <section
            aria-labelledby="backup-jobs-heading"
            className="asset-intune-settings__history"
          >
            <div className="panel-heading">
              <div>
                <p className="eyebrow">JOBS</p>
                <h3 id="backup-jobs-heading">Backup-Jobs</h3>
              </div>
              <button
                className="secondary-button"
                disabled={disabled}
                onClick={() => void load()}
                type="button"
              >
                <RefreshCw aria-hidden="true" size={15} /> Aktualisieren
              </button>
            </div>
            {jobs.length === 0 ? (
              <p className="empty-state">
                Noch keine Backup-Meldungen empfangen.
              </p>
            ) : (
              <ul aria-label="Backup-Jobs">
                {jobs.map((job) => (
                  <JobRow
                    assets={assets}
                    defaultGraceHours={settings.defaultGraceHours}
                    departments={departments}
                    disabled={disabled}
                    job={job}
                    key={job.id}
                    onDelete={async (target) => {
                      await run(
                        `delete:${target.id}`,
                        { type: "deleteJob", id: target.id },
                        "Der Job wurde entfernt.",
                        "Der Job konnte nicht entfernt werden.",
                      );
                    }}
                    onSave={async (draft) => {
                      await run(
                        `save:${draft.id}`,
                        {
                          type: "saveJob",
                          job: {
                            id: draft.id,
                            expectedIntervalHours: draft.expectedIntervalHours,
                            graceHours: draft.graceHours,
                            departmentId: draft.departmentId,
                            assetId: draft.assetId,
                            serviceId: draft.serviceId,
                            active: draft.active,
                          },
                        },
                        "Der Job wurde gespeichert.",
                        "Der Job konnte nicht gespeichert werden.",
                      );
                    }}
                    services={services}
                    tenantId={tenantId}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
      {message ? (
        <p
          aria-live="polite"
          className="asset-intune-settings__message"
          role="status"
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}
