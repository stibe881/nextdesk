import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { CloudCog, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";

import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";

type IntuneConfiguration = {
  enabled: boolean;
  sso_binding_available: boolean;
  sync_enabled: boolean;
  last_success_at: string | null;
  last_attempt_at: string | null;
  last_status: string;
  last_preflight_at: string | null;
  last_preflight_result_code: string | null;
  configuration_generation: number;
  updated_at: string | null;
};

type LocalPreflightRun = {
  id: string;
  trigger_kind: "manual_preflight" | "manual_preflight_retry";
  execution_scope: "local_preflight";
  status: "succeeded" | "blocked";
  result_code: string;
  started_at: string;
  finished_at: string;
  retry_of_run_id: string | null;
  root_run_id: string;
  attempt_no: number;
  provider_contacted: false;
  devices_seen: number;
  assets_created: number;
  assets_updated: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isConfiguration(value: unknown): value is IntuneConfiguration {
  if (!isRecord(value)) return false;
  return (
    typeof value.enabled === "boolean" &&
    typeof value.sso_binding_available === "boolean" &&
    typeof value.sync_enabled === "boolean" &&
    typeof value.last_status === "string" &&
    (typeof value.last_preflight_result_code === "string" ||
      value.last_preflight_result_code === null) &&
    typeof value.configuration_generation === "number"
  );
}

function parseRun(value: unknown): LocalPreflightRun | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    (value.trigger_kind !== "manual_preflight" &&
      value.trigger_kind !== "manual_preflight_retry") ||
    value.execution_scope !== "local_preflight" ||
    (value.status !== "succeeded" && value.status !== "blocked") ||
    typeof value.result_code !== "string" ||
    typeof value.started_at !== "string" ||
    typeof value.finished_at !== "string" ||
    typeof value.root_run_id !== "string" ||
    typeof value.attempt_no !== "number" ||
    value.provider_contacted !== false ||
    typeof value.devices_seen !== "number" ||
    typeof value.assets_created !== "number" ||
    typeof value.assets_updated !== "number" ||
    (typeof value.retry_of_run_id !== "string" &&
      value.retry_of_run_id !== null)
  ) {
    return null;
  }
  return {
    id: value.id,
    trigger_kind: value.trigger_kind,
    execution_scope: value.execution_scope,
    status: value.status,
    result_code: value.result_code,
    started_at: value.started_at,
    finished_at: value.finished_at,
    retry_of_run_id: value.retry_of_run_id,
    root_run_id: value.root_run_id,
    attempt_no: value.attempt_no,
    provider_contacted: false,
    devices_seen: value.devices_seen,
    assets_created: value.assets_created,
    assets_updated: value.assets_updated,
  };
}

function dateLabel(value: string | null): string {
  if (!value) return "Noch nie";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unbekannt";
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function resultLabel(resultCode: string): string {
  switch (resultCode) {
    case "preflight_ready":
      return "Lokale Konfiguration ist bereit";
    case "connection_disabled":
      return "Die lokale Intune-Konfiguration ist deaktiviert";
    case "sso_binding_required":
      return "Eine aktive tenant-spezifische Azure-SSO-Bindung fehlt";
    case "configuration_rebinding_required":
      return "Die gespeicherte Konfiguration muss erneut mit der aktuellen SSO-Bindung gespeichert werden";
    default:
      return "Lokale Prüfung abgeschlossen";
  }
}

function responseData(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("Die Serverantwort ist unvollständig.");
  }
  return value.data;
}

export function AssetIntuneSettings({ tenantId }: { tenantId: string }) {
  const [configuration, setConfiguration] =
    useState<IntuneConfiguration | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [runs, setRuns] = useState<LocalPreflightRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const requestVersion = useRef(0);
  const unconfirmedPreflightRequestIds = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    if (!supabase) return;
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setLoading(true);
    setMessage("");
    try {
      const [configurationResult, runsResult] = await Promise.all([
        supabase.functions.invoke<unknown>("asset-registry", {
          body: { type: "getIntuneConfiguration", tenantId },
        }),
        supabase.functions.invoke<unknown>("asset-registry", {
          body: { type: "listIntuneRuns", tenantId },
        }),
      ]);
      if (configurationResult.error) throw configurationResult.error;
      if (runsResult.error) throw runsResult.error;
      const nextConfiguration = responseData(
        configurationResult.data,
      ).configuration;
      const nextRuns = responseData(runsResult.data).runs;
      if (!isConfiguration(nextConfiguration) || !Array.isArray(nextRuns)) {
        throw new Error("Die Intune-Konfiguration ist unvollständig.");
      }
      const parsedRuns = nextRuns.map(parseRun);
      if (parsedRuns.some((run) => run === null)) {
        throw new Error("Die lokale Prüfhistorie ist unvollständig.");
      }
      if (requestVersion.current !== version) return;
      setConfiguration(nextConfiguration);
      setEnabled(nextConfiguration.enabled);
      setRuns(parsedRuns as LocalPreflightRun[]);
    } catch (error) {
      if (requestVersion.current !== version) return;
      setConfiguration(null);
      setRuns([]);
      setMessage(
        await functionErrorMessage(
          error,
          "Die Intune-Konfiguration konnte nicht geladen werden.",
        ),
      );
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setMessage("Die Verbindung zu nextDesk ist nicht konfiguriert.");
      return;
    }
    if (enabled && configuration && !configuration.sso_binding_available) {
      setMessage(
        "Für die lokale Intune-Konfiguration ist zuerst eine aktive tenant-spezifische Azure-SSO-Bindung erforderlich.",
      );
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const { data, error } = await supabase.functions.invoke<unknown>(
        "asset-registry",
        { body: { type: "updateIntuneConfiguration", tenantId, enabled } },
      );
      if (error) throw error;
      const nextConfiguration = responseData(data).configuration;
      if (!isConfiguration(nextConfiguration)) {
        throw new Error("Die Intune-Konfiguration ist unvollständig.");
      }
      setConfiguration(nextConfiguration);
      setEnabled(nextConfiguration.enabled);
      setMessage(
        nextConfiguration.enabled
          ? "Die lokale Intune-Konfiguration wurde gespeichert. Eine Providersynchronisation bleibt deaktiviert."
          : "Die lokale Intune-Konfiguration wurde deaktiviert.",
      );
    } catch (error) {
      setMessage(
        await functionErrorMessage(
          error,
          "Die Intune-Konfiguration konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function runLocalPreflight(retryOfRunId?: string) {
    if (!supabase) {
      setMessage("Die Verbindung zu nextDesk ist nicht konfiguriert.");
      return;
    }
    const requestKey = retryOfRunId ?? "new";
    const requestId =
      unconfirmedPreflightRequestIds.current.get(requestKey) ??
      crypto.randomUUID();
    unconfirmedPreflightRequestIds.current.set(requestKey, requestId);
    setPendingRunId(requestKey);
    setMessage("");
    try {
      const { data, error } = await supabase.functions.invoke<unknown>(
        "asset-registry",
        {
          body: retryOfRunId
            ? {
                type: "retryIntuneLocalPreflight",
                tenantId,
                clientRequestId: requestId,
                retryOfRunId,
              }
            : {
                type: "startIntuneLocalPreflight",
                tenantId,
                clientRequestId: requestId,
              },
        },
      );
      if (error) throw error;
      const run = parseRun(responseData(data).run);
      if (!run) throw new Error("Der lokale Prüflauf ist unvollständig.");
      setRuns((current) => [
        run,
        ...current.filter((item) => item.id !== run.id),
      ]);
      unconfirmedPreflightRequestIds.current.delete(requestKey);
      setMessage(resultLabel(run.result_code));
      void load();
    } catch (error) {
      setMessage(
        await functionErrorMessage(
          error,
          "Der lokale Intune-Prüflauf konnte nicht abgeschlossen werden.",
        ),
      );
    } finally {
      setPendingRunId(null);
    }
  }

  const controlsDisabled = loading || saving || pendingRunId !== null;
  const canRun =
    configuration?.enabled === true &&
    configuration.sso_binding_available === true &&
    !controlsDisabled;

  return (
    <section
      className="asset-intune-settings panel"
      aria-busy={loading || saving || pendingRunId !== null}
      aria-labelledby="asset-intune-heading"
    >
      <div className="panel-heading asset-intune-settings__heading">
        <div>
          <span className="eyebrow">ASSET-INTEGRATION</span>
          <h2 id="asset-intune-heading">Microsoft Intune</h2>
          <p>
            Lokale Konfigurationsprüfung und Run-Historie für diesen Mandanten.
            Der Preflight kontaktiert weder Microsoft noch Graph und ändert
            keine Geräte oder Assets.
          </p>
        </div>
        <CloudCog aria-hidden="true" size={25} />
      </div>
      {loading ? <p>Konfiguration wird geladen …</p> : null}
      {!loading ? (
        <>
          <form className="asset-intune-settings__form" onSubmit={save}>
            <div className="asset-intune-settings__status" role="status">
              <ShieldCheck aria-hidden="true" size={17} />
              <span>
                {configuration?.sso_binding_available
                  ? "Aktive tenant-spezifische Azure-SSO-Bindung erkannt."
                  : "Für die lokale Intune-Konfiguration fehlt eine aktive tenant-spezifische Azure-SSO-Bindung."}
              </span>
            </div>
            <label className="asset-intune-settings__check">
              <input
                checked={enabled}
                disabled={saving}
                onChange={(event) => setEnabled(event.target.checked)}
                type="checkbox"
              />
              Lokale Intune-Konfiguration für diesen Mandanten vorbereiten
            </label>
            <p className="asset-intune-settings__help">
              Eine Entra-Mandanten-ID wird nicht im Browser eingegeben. nextDesk
              bindet die spätere Integration ausschliesslich an die bestehende
              tenant-spezifische Azure-SSO-Konfiguration. Eine automatische oder
              manuelle Providersynchronisation wird hier nicht aktiviert.
            </p>
            <div className="asset-intune-settings__status" role="status">
              <ShieldCheck aria-hidden="true" size={17} />
              <span>
                Letzte lokale Prüfung:{" "}
                {dateLabel(configuration?.last_preflight_at ?? null)}
                {configuration?.last_preflight_result_code
                  ? ` · ${resultLabel(configuration.last_preflight_result_code)}`
                  : ""}
              </span>
            </div>
            <div className="asset-intune-settings__actions">
              <button disabled={saving} type="submit">
                {saving ? "Wird gespeichert …" : "Konfiguration speichern"}
              </button>
              <button
                className="secondary-button"
                disabled={!canRun}
                onClick={() => void runLocalPreflight()}
                type="button"
              >
                <ShieldCheck aria-hidden="true" size={16} />
                {pendingRunId === "new"
                  ? "Prüfung läuft …"
                  : "Lokalen Preflight ausführen"}
              </button>
              <button
                className="secondary-button"
                disabled={controlsDisabled}
                onClick={() => void load()}
                type="button"
              >
                <RefreshCw aria-hidden="true" size={16} /> Aktualisieren
              </button>
            </div>
          </form>

          <section
            aria-labelledby="asset-intune-runs-heading"
            className="asset-intune-settings__history"
          >
            <div className="panel-heading">
              <div>
                <p className="eyebrow">KONTROLLIERTE PRÜFUNGEN</p>
                <h3 id="asset-intune-runs-heading">
                  Lokale Preflight-Historie
                </h3>
                <p>
                  Alle Einträge sind providerfrei. Geräte, Assets und Microsoft
                  Graph wurden nicht abgefragt oder verändert.
                </p>
              </div>
            </div>
            {runs.length === 0 ? (
              <p className="empty-state">
                Noch keine lokale Prüfung ausgeführt.
              </p>
            ) : (
              <ul aria-label="Lokale Intune-Preflight-Historie">
                {runs.map((run) => (
                  <li key={run.id}>
                    <article>
                      <div>
                        <strong>{resultLabel(run.result_code)}</strong>
                        <p>
                          {dateLabel(run.started_at)} · Versuch {run.attempt_no}{" "}
                          ·{" "}
                          {run.status === "succeeded" ? "bereit" : "blockiert"}
                        </p>
                        <p>
                          Providerkontakt: nein · Geräte: 0 · Assets geändert: 0
                        </p>
                      </div>
                      <button
                        className="secondary-button"
                        disabled={controlsDisabled}
                        onClick={() => void runLocalPreflight(run.id)}
                        type="button"
                      >
                        <RotateCcw aria-hidden="true" size={15} />
                        {pendingRunId === run.id
                          ? "Wird wiederholt …"
                          : "Wiederholen"}
                      </button>
                    </article>
                  </li>
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
