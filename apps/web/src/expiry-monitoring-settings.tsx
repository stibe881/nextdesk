import { tn } from "./lib/formality";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { CalendarClock, Plus, RefreshCw, Trash2 } from "lucide-react";

import { functionErrorMessage } from "./lib/function-error";
import {
  expiryLabel,
  expiryStatusChip,
  parseExpirySettings,
  parseExpiryTargets,
  parseOptions,
  responseData,
  sortTargets,
  targetDisplay,
  type AssetOption,
  type ExpirySettings,
  type ExpiryTarget,
  type Option,
  type PriorityOption,
} from "./lib/monitoring-automation";
import { supabase } from "./lib/supabase";

function invoke(body: Record<string, unknown>) {
  if (!supabase) {
    throw new Error("Die Verbindung zu nextDesk ist nicht konfiguriert.");
  }
  return supabase.functions.invoke<unknown>("expiry-monitoring", { body });
}

function dateTime(value: string | null): string {
  if (!value) return "noch nie";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "unbekannt"
    : date.toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "short" });
}

const METHOD_LABEL = {
  tls: "TLS-Verbindung",
  ct: "Certificate Transparency",
  rdap: "RDAP",
} as const;

type TargetForm = {
  kind: "certificate" | "domain";
  host: string;
  label: string;
  departmentId: string;
  assetId: string;
  serviceId: string;
  warnDays: string;
};

const EMPTY_FORM: TargetForm = {
  kind: "certificate",
  host: "",
  label: "",
  departmentId: "",
  assetId: "",
  serviceId: "",
  warnDays: "",
};

/**
 * Zertifikate und Domains: TLS-Zertifikate (Host:Port) und Domain-
 * Registrierungen werden regelmässig geprüft; vor Ablauf entsteht ein Ticket.
 */
export function ExpiryMonitoringSettings({ tenantId }: { tenantId: string }) {
  const [settings, setSettings] = useState<ExpirySettings | null>(null);
  const [targets, setTargets] = useState<ExpiryTarget[]>([]);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [priorities, setPriorities] = useState<PriorityOption[]>([]);
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [services, setServices] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<TargetForm>(EMPTY_FORM);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const [enabled, setEnabled] = useState(false);
  const [departmentId, setDepartmentId] = useState("");
  const [priorityKey, setPriorityKey] = useState("");
  const [reminderPriorityKey, setReminderPriorityKey] = useState("");
  const [warnDays, setWarnDays] = useState("30");
  const [reminderDays, setReminderDays] = useState("7");
  const [autoResolve, setAutoResolve] = useState(true);

  const applySettings = useCallback((next: ExpirySettings) => {
    setSettings(next);
    setEnabled(next.enabled);
    setDepartmentId(next.departmentId ?? "");
    setPriorityKey(next.priorityKey ?? "");
    setReminderPriorityKey(next.reminderPriorityKey ?? "");
    setWarnDays(String(next.warnDays));
    setReminderDays(String(next.reminderDays));
    setAutoResolve(next.autoResolve);
  }, []);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const { data, error } = await invoke({ type: "get", tenantId });
      if (error) throw error;
      const payload = responseData(data);
      const next = parseExpirySettings(payload.settings);
      if (!next) throw new Error("Die Konfiguration ist unvollständig.");
      if (requestVersion.current !== version) return;
      applySettings(next);
      setTargets(parseExpiryTargets(payload.targets));
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
          "Die Zertifikatsüberwachung konnte nicht geladen werden.",
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
      if (payload.targets !== undefined)
        setTargets(parseExpiryTargets(payload.targets));
      setMessage(success);
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
          reminderPriorityKey: reminderPriorityKey || null,
          warnDays: Number(warnDays),
          reminderDays: Number(reminderDays),
          autoResolve,
        },
      },
      "Die Einstellungen wurden gespeichert.",
      "Die Einstellungen konnten nicht gespeichert werden. Die Erinnerung muss vor der ersten Warnung liegen.",
    );
    const next = payload ? parseExpirySettings(payload.settings) : null;
    if (next) applySettings(next);
  }

  async function addTarget(event: FormEvent) {
    event.preventDefault();
    const payload = await run(
      "add",
      {
        type: "saveTarget",
        target: {
          kind: form.kind,
          host: form.host,
          label: form.label || null,
          departmentId: form.departmentId || null,
          assetId: form.assetId || null,
          serviceId: form.serviceId || null,
          warnDays: form.warnDays ? Number(form.warnDays) : null,
          active: true,
        },
      },
      "Der Eintrag wurde hinzugefügt und wird in Kürze geprüft.",
      tn("Der Eintrag konnte nicht gespeichert werden. Bitte prüfe Hostname bzw. Domain.", "Der Eintrag konnte nicht gespeichert werden. Bitte prüfen Sie Hostname bzw. Domain."),
    );
    if (payload) setForm(EMPTY_FORM);
  }

  const sorted = useMemo(() => sortTargets(targets), [targets]);
  const disabled = loading || busy !== null;

  return (
    <section
      aria-busy={disabled}
      aria-labelledby="expiry-monitoring-heading"
      className="asset-intune-settings monitoring-settings panel"
    >
      <div className="panel-heading asset-intune-settings__heading">
        <div>
          <span className="eyebrow">MONITORING</span>
          <h2 id="expiry-monitoring-heading">Zertifikate und Domains</h2>
          <p>
            nextDesk prüft TLS-Zertifikate und Domain-Registrierungen täglich.
            Vor dem Ablauf entsteht einmal ein Ticket mit Aussteller,
            alternativen Namen und Hinweisen zur Erneuerung; kurz vor Ablauf
            folgt eine Erinnerung mit höherer Priorität. Nach der Erneuerung
            wird das Ticket kommentiert und gelöst.
          </p>
        </div>
        <CalendarClock aria-hidden="true" size={25} />
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
              Tickets für ablaufende Zertifikate und Domains erstellen
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
                Erstes Ticket (Tage vor Ablauf)
                <input
                  disabled={disabled}
                  inputMode="numeric"
                  max={180}
                  min={1}
                  onChange={(event) => setWarnDays(event.target.value)}
                  type="number"
                  value={warnDays}
                />
              </label>
              <label>
                Erinnerung (Tage vor Ablauf)
                <input
                  disabled={disabled}
                  inputMode="numeric"
                  max={90}
                  min={0}
                  onChange={(event) => setReminderDays(event.target.value)}
                  type="number"
                  value={reminderDays}
                />
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
                Priorität bei Erinnerung
                <select
                  disabled={disabled}
                  onChange={(event) =>
                    setReminderPriorityKey(event.target.value)
                  }
                  value={reminderPriorityKey}
                >
                  <option value="">Standard (Dringend)</option>
                  {priorities.map((priority) => (
                    <option key={priority.key} value={priority.key}>
                      {priority.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="asset-intune-settings__check">
              <input
                checked={autoResolve}
                disabled={disabled}
                onChange={(event) => setAutoResolve(event.target.checked)}
                type="checkbox"
              />
              Ticket nach erkannter Erneuerung automatisch auf «Gelöst» setzen
              (nur wenn es bereits zugewiesen ist)
            </label>
            <p className="asset-intune-settings__help">
              Zertifikate werden direkt über eine TLS-Verbindung gelesen; ist
              das nicht möglich, ermittelt nextDesk das zuletzt ausgestellte
              Zertifikat über Certificate Transparency (crt.sh). Domains werden
              über RDAP abgefragt. Einige Endungen (z. B. .ch und .li)
              veröffentlichen kein Ablaufdatum und erscheinen deshalb mit
              «Fehler».
            </p>
            <div className="asset-intune-settings__status" role="status">
              <CalendarClock aria-hidden="true" size={17} />
              <span>Letzter Prüflauf: {dateTime(settings.lastRunAt)}</span>
            </div>
            <div className="asset-intune-settings__actions">
              <button disabled={disabled} type="submit">
                {busy === "settings"
                  ? "Wird gespeichert …"
                  : "Einstellungen speichern"}
              </button>
            </div>
          </form>

          <form
            aria-labelledby="expiry-add-heading"
            className="asset-intune-settings__history monitoring-settings__add"
            onSubmit={addTarget}
          >
            <div className="panel-heading">
              <div>
                <p className="eyebrow">NEUER EINTRAG</p>
                <h3 id="expiry-add-heading">
                  Zertifikat oder Domain hinzufügen
                </h3>
              </div>
            </div>
            <div className="monitoring-settings__grid">
              <label>
                Art
                <select
                  disabled={disabled}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      kind: event.target.value as TargetForm["kind"],
                    })
                  }
                  value={form.kind}
                >
                  <option value="certificate">TLS-Zertifikat</option>
                  <option value="domain">Domain</option>
                </select>
              </label>
              <label>
                {form.kind === "certificate"
                  ? "Host (Host:Port, Standard 443)"
                  : "Domain"}
                <input
                  disabled={disabled}
                  onChange={(event) =>
                    setForm({ ...form, host: event.target.value })
                  }
                  placeholder={
                    form.kind === "certificate"
                      ? "mail.example.ch:443"
                      : "example.ch"
                  }
                  required
                  value={form.host}
                />
              </label>
              <label>
                Bezeichnung (optional)
                <input
                  disabled={disabled}
                  maxLength={200}
                  onChange={(event) =>
                    setForm({ ...form, label: event.target.value })
                  }
                  value={form.label}
                />
              </label>
              <label>
                Asset (optional)
                <select
                  disabled={disabled}
                  onChange={(event) =>
                    setForm({ ...form, assetId: event.target.value })
                  }
                  value={form.assetId}
                >
                  <option value="">Kein Asset</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.hostname
                        ? `${asset.name} (${asset.hostname})`
                        : asset.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Dienst (optional)
                <select
                  disabled={disabled}
                  onChange={(event) =>
                    setForm({ ...form, serviceId: event.target.value })
                  }
                  value={form.serviceId}
                >
                  <option value="">Kein Dienst</option>
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Abteilung (optional)
                <select
                  disabled={disabled}
                  onChange={(event) =>
                    setForm({ ...form, departmentId: event.target.value })
                  }
                  value={form.departmentId}
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
                Erstes Ticket (Tage, optional)
                <input
                  disabled={disabled}
                  inputMode="numeric"
                  max={180}
                  min={1}
                  onChange={(event) =>
                    setForm({ ...form, warnDays: event.target.value })
                  }
                  placeholder={settings ? String(settings.warnDays) : ""}
                  type="number"
                  value={form.warnDays}
                />
              </label>
            </div>
            <div className="asset-intune-settings__actions">
              <button disabled={disabled || !form.host.trim()} type="submit">
                <Plus aria-hidden="true" size={16} />
                {busy === "add" ? "Wird gespeichert …" : "Hinzufügen"}
              </button>
            </div>
          </form>

          <section
            aria-labelledby="expiry-list-heading"
            className="asset-intune-settings__history"
          >
            <div className="panel-heading">
              <div>
                <p className="eyebrow">ÜBERWACHT</p>
                <h3 id="expiry-list-heading">Zertifikate und Domains</h3>
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
            {sorted.length === 0 ? (
              <p className="empty-state">
                Noch keine Zertifikate oder Domains erfasst.
              </p>
            ) : (
              <ul aria-label="Überwachte Zertifikate und Domains">
                {sorted.map((target) => {
                  const chip = expiryStatusChip(target.status);
                  return (
                    <li key={target.id}>
                      <article>
                        <div>
                          <strong>
                            {targetDisplay(target)}
                            {target.label ? ` – ${target.label}` : ""}
                          </strong>{" "}
                          <span
                            className={`monitoring-chip monitoring-chip--${chip.tone}`}
                          >
                            {chip.label}
                          </span>
                          {!target.active ? (
                            <span className="monitoring-chip monitoring-chip--neutral">
                              pausiert
                            </span>
                          ) : null}
                          <p>
                            {target.kind === "certificate"
                              ? "Zertifikat"
                              : "Domain"}{" "}
                            · Ablauf: {expiryLabel(target.expiresAt)} · zuletzt
                            geprüft {dateTime(target.lastCheckedAt)}
                            {target.checkMethod
                              ? ` (${METHOD_LABEL[target.checkMethod]})`
                              : ""}
                            {target.ticketNumber
                              ? ` · Ticket ${target.ticketNumber}`
                              : ""}
                          </p>
                          {target.issuer || target.registrar ? (
                            <p>
                              {target.issuer
                                ? `Aussteller: ${target.issuer}`
                                : ""}
                              {target.registrar
                                ? `Registrar: ${target.registrar}`
                                : ""}
                              {target.san.length > 1
                                ? ` · ${target.san.length} alternative Namen`
                                : ""}
                            </p>
                          ) : null}
                          {target.assetName || target.serviceName ? (
                            <p>
                              {[
                                target.assetName
                                  ? `Asset: ${target.assetName}`
                                  : null,
                                target.serviceName
                                  ? `Dienst: ${target.serviceName}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          ) : null}
                          {target.lastError ? (
                            <p className="monitoring-settings__error">
                              {target.lastError}
                            </p>
                          ) : null}
                        </div>
                        <div className="monitoring-settings__row-actions">
                          <button
                            className="secondary-button"
                            disabled={disabled}
                            onClick={() =>
                              void run(
                                `check:${target.id}`,
                                { type: "checkNow", id: target.id },
                                `${targetDisplay(target)} wurde geprüft.`,
                                "Die Prüfung ist fehlgeschlagen.",
                              )
                            }
                            type="button"
                          >
                            <RefreshCw aria-hidden="true" size={15} />
                            {busy === `check:${target.id}`
                              ? "Prüft …"
                              : "Jetzt prüfen"}
                          </button>
                          {confirmDelete === target.id ? (
                            <>
                              <button
                                disabled={disabled}
                                onClick={() => {
                                  setConfirmDelete(null);
                                  void run(
                                    `delete:${target.id}`,
                                    { type: "deleteTarget", id: target.id },
                                    "Der Eintrag wurde entfernt.",
                                    "Der Eintrag konnte nicht entfernt werden.",
                                  );
                                }}
                                type="button"
                              >
                                Entfernen bestätigen
                              </button>
                              <button
                                className="secondary-button"
                                onClick={() => setConfirmDelete(null)}
                                type="button"
                              >
                                Abbrechen
                              </button>
                            </>
                          ) : (
                            <button
                              aria-label={`${targetDisplay(target)} entfernen`}
                              className="secondary-button"
                              disabled={disabled}
                              onClick={() => setConfirmDelete(target.id)}
                              type="button"
                            >
                              <Trash2 aria-hidden="true" size={15} />
                            </button>
                          )}
                        </div>
                      </article>
                    </li>
                  );
                })}
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
