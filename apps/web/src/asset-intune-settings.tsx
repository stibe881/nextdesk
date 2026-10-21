import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  AlertTriangle,
  CloudCog,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";

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

type ManualSyncConfiguration = {
  enabled: boolean;
  sso_binding_available: boolean;
  manual_sync_enabled: boolean;
  configuration_generation: number;
  manual_sync_generation: number;
  last_manual_sync_at: string | null;
  last_manual_sync_status: string;
  last_manual_sync_result_code: string | null;
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

type ManualProviderRun = {
  id: string;
  mode: "dry_run" | "synchronize";
  status: "succeeded" | "failed" | "blocked" | "running";
  result_code: string;
  started_at: string;
  finished_at: string | null;
  provider_contacted: boolean;
  devices_seen: number;
  assets_created: number;
  assets_updated: number;
  assets_skipped: number;
  ambiguous_devices: number;
  retry_of_run_id: string | null;
  root_run_id: string | null;
  attempt_no: number;
};

type PendingApply = {
  mode: "synchronize";
  retryOfRunId: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableText(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isConfiguration(value: unknown): value is IntuneConfiguration {
  if (!isRecord(value)) return false;
  return (
    typeof value.enabled === "boolean" &&
    typeof value.sso_binding_available === "boolean" &&
    typeof value.sync_enabled === "boolean" &&
    typeof value.last_status === "string" &&
    isNullableText(value.last_preflight_result_code) &&
    typeof value.configuration_generation === "number"
  );
}

function isManualConfiguration(
  value: unknown,
): value is ManualSyncConfiguration {
  if (!isRecord(value)) return false;
  return (
    typeof value.enabled === "boolean" &&
    typeof value.sso_binding_available === "boolean" &&
    typeof value.manual_sync_enabled === "boolean" &&
    typeof value.configuration_generation === "number" &&
    typeof value.manual_sync_generation === "number" &&
    typeof value.last_manual_sync_status === "string" &&
    isNullableText(value.last_manual_sync_at) &&
    isNullableText(value.last_manual_sync_result_code)
  );
}

function parseLocalPreflightRun(value: unknown): LocalPreflightRun | null {
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

function parseManualProviderRun(value: unknown): ManualProviderRun | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    (value.mode !== "dry_run" && value.mode !== "synchronize") ||
    !["succeeded", "failed", "blocked", "running"].includes(
      String(value.status),
    ) ||
    typeof value.result_code !== "string" ||
    typeof value.started_at !== "string" ||
    !isNullableText(value.finished_at) ||
    typeof value.provider_contacted !== "boolean" ||
    typeof value.devices_seen !== "number" ||
    typeof value.assets_created !== "number" ||
    typeof value.assets_updated !== "number" ||
    typeof value.assets_skipped !== "number" ||
    typeof value.ambiguous_devices !== "number" ||
    typeof value.attempt_no !== "number" ||
    !isNullableText(value.retry_of_run_id) ||
    !isNullableText(value.root_run_id)
  ) {
    return null;
  }
  return {
    id: value.id,
    mode: value.mode,
    status: value.status as ManualProviderRun["status"],
    result_code: value.result_code,
    started_at: value.started_at,
    finished_at: value.finished_at,
    provider_contacted: value.provider_contacted,
    devices_seen: value.devices_seen,
    assets_created: value.assets_created,
    assets_updated: value.assets_updated,
    assets_skipped: value.assets_skipped,
    ambiguous_devices: value.ambiguous_devices,
    retry_of_run_id: value.retry_of_run_id,
    root_run_id: value.root_run_id,
    attempt_no: value.attempt_no,
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
    case "manual_sync_ready":
      return "Manueller Abgleich ist freigegeben";
    case "manual_sync_not_enabled":
      return "Der manuelle Abgleich ist für diesen Mandanten nicht freigegeben";
    case "connection_disabled":
      return "Die lokale Intune-Konfiguration ist deaktiviert";
    case "sso_binding_required":
      return "Eine aktive tenant-spezifische Azure-SSO-Bindung fehlt";
    case "configuration_rebinding_required":
      return "Die gespeicherte Konfiguration muss erneut mit der aktuellen SSO-Bindung gespeichert werden";
    case "provider_not_configured":
      return "Die serverseitige Microsoft-Graph-Anbindung ist noch nicht konfiguriert";
    case "provider_rate_limited":
      return "Microsoft Intune begrenzt den Abgleich derzeit";
    case "provider_unavailable":
      return "Microsoft Intune ist derzeit nicht verfügbar";
    case "provider_payload_invalid":
      return "Die Intune-Antwort konnte nicht sicher verarbeitet werden";
    case "run_invalidated":
      return "Der Lauf wurde durch eine Konfigurations- oder Rechteänderung verworfen";
    case "run_expired":
      return "Der Lauf hat seine zulässige Dauer überschritten";
    case "provider_dry_run_succeeded":
      return "Datensparsame Vorschau abgeschlossen";
    case "provider_sync_succeeded":
      return "Manueller Abgleich abgeschlossen";
    default:
      return "Intune-Lauf abgeschlossen";
  }
}

function responseData(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("Die Serverantwort ist unvollständig.");
  }
  return value.data;
}

function retryable(run: ManualProviderRun): boolean {
  return (
    run.status === "failed" &&
    (run.result_code === "provider_unavailable" ||
      run.result_code === "provider_rate_limited")
  );
}

export function AssetIntuneSettings({ tenantId }: { tenantId: string }) {
  const [configuration, setConfiguration] =
    useState<IntuneConfiguration | null>(null);
  const [manualConfiguration, setManualConfiguration] =
    useState<ManualSyncConfiguration | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [manualEnabled, setManualEnabled] = useState(false);
  const [runs, setRuns] = useState<LocalPreflightRun[]>([]);
  const [manualRuns, setManualRuns] = useState<ManualProviderRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingManual, setSavingManual] = useState(false);
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const [pendingProviderRun, setPendingProviderRun] = useState<string | null>(
    null,
  );
  const [pendingApply, setPendingApply] = useState<PendingApply | null>(null);
  const [message, setMessage] = useState("");
  const requestVersion = useRef(0);
  const unconfirmedPreflightRequestIds = useRef(new Map<string, string>());
  const providerRequestIds = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    if (!supabase) return;
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setLoading(true);
    setMessage("");
    try {
      const [
        configurationResult,
        runsResult,
        manualConfigurationResult,
        manualRunsResult,
      ] = await Promise.all([
        supabase.functions.invoke<unknown>("asset-registry", {
          body: { type: "getIntuneConfiguration", tenantId },
        }),
        supabase.functions.invoke<unknown>("asset-registry", {
          body: { type: "listIntuneRuns", tenantId },
        }),
        supabase.functions.invoke<unknown>("asset-registry", {
          body: { type: "getIntuneManualSyncConfiguration", tenantId },
        }),
        supabase.functions.invoke<unknown>("asset-registry", {
          body: { type: "listIntuneManualSyncRuns", tenantId },
        }),
      ]);
      if (configurationResult.error) throw configurationResult.error;
      if (runsResult.error) throw runsResult.error;
      if (manualConfigurationResult.error)
        throw manualConfigurationResult.error;
      if (manualRunsResult.error) throw manualRunsResult.error;
      const nextConfiguration = responseData(
        configurationResult.data,
      ).configuration;
      const nextRuns = responseData(runsResult.data).runs;
      const nextManualConfiguration = responseData(
        manualConfigurationResult.data,
      ).configuration;
      const nextManualRuns = responseData(manualRunsResult.data).runs;
      if (
        !isConfiguration(nextConfiguration) ||
        !isManualConfiguration(nextManualConfiguration) ||
        !Array.isArray(nextRuns) ||
        !Array.isArray(nextManualRuns)
      ) {
        throw new Error("Die Intune-Konfiguration ist unvollständig.");
      }
      const parsedRuns = nextRuns.map(parseLocalPreflightRun);
      const parsedManualRuns = nextManualRuns.map(parseManualProviderRun);
      if (
        parsedRuns.some((run) => run === null) ||
        parsedManualRuns.some((run) => run === null)
      ) {
        throw new Error("Die Intune-Laufhistorie ist unvollständig.");
      }
      if (requestVersion.current !== version) return;
      setConfiguration(nextConfiguration);
      setManualConfiguration(nextManualConfiguration);
      setEnabled(nextConfiguration.enabled);
      setManualEnabled(nextManualConfiguration.manual_sync_enabled);
      setRuns(parsedRuns as LocalPreflightRun[]);
      setManualRuns(parsedManualRuns as ManualProviderRun[]);
    } catch (error) {
      if (requestVersion.current !== version) return;
      setConfiguration(null);
      setManualConfiguration(null);
      setRuns([]);
      setManualRuns([]);
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
          ? "Die lokale Intune-Konfiguration wurde gespeichert. Microsoft Graph bleibt bis zur separaten manuellen Freigabe deaktiviert."
          : "Die lokale Intune-Konfiguration wurde deaktiviert.",
      );
      void load();
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

  async function saveManualSync(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setMessage("Die Verbindung zu nextDesk ist nicht konfiguriert.");
      return;
    }
    if (
      manualEnabled &&
      (!configuration?.enabled || !manualConfiguration?.sso_binding_available)
    ) {
      setMessage(
        "Speichern Sie zuerst die lokale Intune-Konfiguration mit einer aktiven tenant-spezifischen Azure-SSO-Bindung.",
      );
      return;
    }
    setSavingManual(true);
    setMessage("");
    try {
      const { data, error } = await supabase.functions.invoke<unknown>(
        "asset-registry",
        {
          body: {
            type: "updateIntuneManualSyncConfiguration",
            tenantId,
            enabled: manualEnabled,
          },
        },
      );
      if (error) throw error;
      const nextConfiguration = responseData(data).configuration;
      if (!isManualConfiguration(nextConfiguration)) {
        throw new Error("Die manuelle Intune-Konfiguration ist unvollständig.");
      }
      setManualConfiguration(nextConfiguration);
      setManualEnabled(nextConfiguration.manual_sync_enabled);
      setMessage(
        nextConfiguration.manual_sync_enabled
          ? "Der manuelle Microsoft-Graph-Abgleich ist freigegeben. Er startet nie selbstständig und benötigt für jeden Lauf eine bewusste Aktion."
          : "Der manuelle Microsoft-Graph-Abgleich wurde deaktiviert.",
      );
      void load();
    } catch (error) {
      setMessage(
        await functionErrorMessage(
          error,
          "Die Freigabe für den manuellen Intune-Abgleich konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setSavingManual(false);
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
      const run = parseLocalPreflightRun(responseData(data).run);
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

  async function runProvider(
    mode: "dry_run" | "synchronize",
    retryOfRunId: string | null = null,
  ) {
    if (!supabase) {
      setMessage("Die Verbindung zu nextDesk ist nicht konfiguriert.");
      return;
    }
    const requestKey = `${mode}:${retryOfRunId ?? "new"}`;
    const requestId =
      providerRequestIds.current.get(requestKey) ?? crypto.randomUUID();
    providerRequestIds.current.set(requestKey, requestId);
    setPendingProviderRun(requestKey);
    setPendingApply(null);
    setMessage("");
    try {
      const { data, error } = await supabase.functions.invoke<unknown>(
        "intune-asset-sync",
        {
          body: {
            type: "runManualIntuneSync",
            tenantId,
            mode,
            clientRequestId: requestId,
            retryOfRunId,
            confirmApply: mode === "synchronize",
          },
        },
      );
      if (error) throw error;
      const run = parseManualProviderRun(responseData(data).run);
      if (!run) throw new Error("Der Intune-Lauf ist unvollständig.");
      setManualRuns((current) => [
        run,
        ...current.filter((item) => item.id !== run.id),
      ]);
      providerRequestIds.current.delete(requestKey);
      setMessage(resultLabel(run.result_code));
      void load();
    } catch (error) {
      providerRequestIds.current.delete(requestKey);
      setMessage(
        await functionErrorMessage(
          error,
          "Der manuelle Intune-Abgleich konnte nicht abgeschlossen werden.",
        ),
      );
      void load();
    } finally {
      setPendingProviderRun(null);
    }
  }

  const controlsDisabled =
    loading ||
    saving ||
    savingManual ||
    pendingRunId !== null ||
    pendingProviderRun !== null;
  const canRunPreflight =
    configuration?.enabled === true &&
    configuration.sso_binding_available === true &&
    !controlsDisabled;
  const canRunProvider =
    configuration?.enabled === true &&
    manualConfiguration?.sso_binding_available === true &&
    manualConfiguration.manual_sync_enabled === true &&
    !controlsDisabled;

  return (
    <section
      className="asset-intune-settings panel"
      aria-busy={controlsDisabled}
      aria-labelledby="asset-intune-heading"
    >
      <div className="panel-heading asset-intune-settings__heading">
        <div>
          <span className="eyebrow">ASSET-INTEGRATION</span>
          <h2 id="asset-intune-heading">Microsoft Intune</h2>
          <p>
            Lokale Konfigurationsprüfung, bewusst manuelle Microsoft-Graph-Läufe
            und datensparsame Run-Historie für diesen Mandanten.
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
              bindet die Integration ausschliesslich an die bestehende
              tenant-spezifische Azure-SSO-Konfiguration. Der Preflight
              kontaktiert weder Microsoft noch Graph und ändert keine Geräte
              oder Assets.
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
                disabled={!canRunPreflight}
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
            className="asset-intune-settings__history"
            aria-labelledby="asset-intune-manual-heading"
          >
            <div className="panel-heading">
              <div>
                <p className="eyebrow">MANUELLER MICROSOFT-GRAPH-ABGLEICH</p>
                <h3 id="asset-intune-manual-heading">
                  Intune-Assets bewusst abgleichen
                </h3>
                <p>
                  Jeder Lauf wird einzeln ausgelöst. nextDesk liest nur
                  technische Inventardaten und führt nie Microsoft-Schreib-,
                  Lösch- oder Hintergrundoperationen aus.
                </p>
              </div>
            </div>
            <form
              className="asset-intune-settings__form"
              onSubmit={saveManualSync}
            >
              <label className="asset-intune-settings__check">
                <input
                  checked={manualEnabled}
                  disabled={savingManual || !configuration?.enabled}
                  onChange={(event) => setManualEnabled(event.target.checked)}
                  type="checkbox"
                />
                Manuellen Microsoft-Graph-Abgleich für diesen Mandanten
                freigeben
              </label>
              <p className="asset-intune-settings__help">
                Voraussetzung sind die gespeicherte Azure-SSO-Bindung, eine
                separate mehrmandantenfähige Microsoft-Graph-Anwendung mit
                <code>DeviceManagementManagedDevices.Read.All</code> und deren
                Admin-Consent. Client-ID und Secret verbleiben ausschliesslich
                serverseitig. Diese Freigabe startet keine automatische
                Synchronisation.
              </p>
              <div className="asset-intune-settings__status" role="status">
                <ShieldCheck aria-hidden="true" size={17} />
                <span>
                  Letzter manueller Lauf:{" "}
                  {dateLabel(manualConfiguration?.last_manual_sync_at ?? null)}
                  {manualConfiguration?.last_manual_sync_result_code
                    ? ` · ${resultLabel(manualConfiguration.last_manual_sync_result_code)}`
                    : ""}
                </span>
              </div>
              <div className="asset-intune-settings__actions">
                <button
                  disabled={savingManual || !configuration?.enabled}
                  type="submit"
                >
                  {savingManual
                    ? "Freigabe wird gespeichert …"
                    : "Manuelle Freigabe speichern"}
                </button>
                <button
                  className="secondary-button"
                  disabled={!canRunProvider}
                  onClick={() => void runProvider("dry_run")}
                  type="button"
                >
                  <PlayCircle aria-hidden="true" size={16} />
                  {pendingProviderRun === "dry_run:new"
                    ? "Vorschau läuft …"
                    : "Datensparsame Vorschau durchführen"}
                </button>
                <button
                  disabled={!canRunProvider}
                  onClick={() =>
                    setPendingApply({ mode: "synchronize", retryOfRunId: null })
                  }
                  type="button"
                >
                  <CloudCog aria-hidden="true" size={16} /> Intune-Assets
                  abgleichen
                </button>
              </div>
            </form>

            {pendingApply ? (
              <div
                aria-describedby="asset-intune-confirmation-text"
                aria-labelledby="asset-intune-confirmation-title"
                className="asset-intune-settings__status"
                role="dialog"
              >
                <AlertTriangle aria-hidden="true" size={18} />
                <div>
                  <strong id="asset-intune-confirmation-title">
                    Übernahme ausdrücklich bestätigen
                  </strong>
                  <p id="asset-intune-confirmation-text">
                    nextDesk liest für diesen einzelnen Lauf nur Geräte-ID,
                    Gerätename, Seriennummer, Hersteller, Modell,
                    Betriebssystem, Compliance-, Verschlüsselungs- und
                    Zeitstatus. Eindeutig verknüpfte Assets werden technisch
                    aktualisiert; bisher nicht verknüpfte Geräte können als neue
                    Assets angelegt werden. Mehrdeutige Zuordnungen,
                    Seriennummernkollisionen und fehlende Intune-Geräte ändern
                    keine bestehenden Assets.
                  </p>
                  <div className="asset-intune-settings__actions">
                    <button
                      onClick={() =>
                        void runProvider(
                          pendingApply.mode,
                          pendingApply.retryOfRunId,
                        )
                      }
                      type="button"
                    >
                      Jetzt einmalig abgleichen
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => setPendingApply(null)}
                      type="button"
                    >
                      Abbrechen
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {manualRuns.length === 0 ? (
              <p className="empty-state">
                Noch keine Microsoft-Graph-Vorschau oder Synchronisation
                ausgeführt.
              </p>
            ) : (
              <ul aria-label="Manuelle Intune-Abgleichshistorie">
                {manualRuns.map((run) => (
                  <li key={run.id}>
                    <article>
                      <div>
                        <strong>{resultLabel(run.result_code)}</strong>
                        <p>
                          {dateLabel(run.started_at)} · Versuch {run.attempt_no}{" "}
                          ·{" "}
                          {run.mode === "dry_run"
                            ? "Vorschau"
                            : "Synchronisation"}
                        </p>
                        <p>
                          Providerkontakt:{" "}
                          {run.provider_contacted ? "ja" : "nein"} · Geräte:{" "}
                          {run.devices_seen} ·{" "}
                          {run.mode === "dry_run" ? "potenziell neu" : "neu"}:{" "}
                          {run.assets_created} ·{" "}
                          {run.mode === "dry_run"
                            ? "potenziell aktualisiert"
                            : "aktualisiert"}
                          : {run.assets_updated} · übersprungen:{" "}
                          {run.assets_skipped} · mehrdeutig:{" "}
                          {run.ambiguous_devices}
                        </p>
                      </div>
                      {retryable(run) ? (
                        <button
                          className="secondary-button"
                          disabled={controlsDisabled}
                          onClick={() => {
                            if (run.mode === "synchronize") {
                              setPendingApply({
                                mode: "synchronize",
                                retryOfRunId: run.id,
                              });
                            } else {
                              void runProvider("dry_run", run.id);
                            }
                          }}
                          type="button"
                        >
                          <RotateCcw aria-hidden="true" size={15} />
                          {pendingProviderRun === `${run.mode}:${run.id}`
                            ? "Wird wiederholt …"
                            : "Bewusst wiederholen"}
                        </button>
                      ) : null}
                    </article>
                  </li>
                ))}
              </ul>
            )}
          </section>

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
