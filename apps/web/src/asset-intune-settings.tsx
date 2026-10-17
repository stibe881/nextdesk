import { useEffect, useState, type FormEvent } from "react";
import { CloudCog, RefreshCw, ShieldCheck } from "lucide-react";

import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";

type IntuneConfiguration = {
  enabled: boolean;
  directory_tenant_id: string | null;
  sync_enabled: boolean;
  last_success_at: string | null;
  last_attempt_at: string | null;
  last_status: string;
  last_error_code: string | null;
  updated_at: string;
};

function isConfiguration(value: unknown): value is IntuneConfiguration {
  if (!value || typeof value !== "object") return false;
  const configuration = value as Record<string, unknown>;
  return (
    typeof configuration.enabled === "boolean" &&
    typeof configuration.sync_enabled === "boolean" &&
    (typeof configuration.directory_tenant_id === "string" ||
      configuration.directory_tenant_id === null) &&
    typeof configuration.last_status === "string"
  );
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

export function AssetIntuneSettings({ tenantId }: { tenantId: string }) {
  const [configuration, setConfiguration] =
    useState<IntuneConfiguration | null>(null);
  const [directoryTenantId, setDirectoryTenantId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    if (!supabase) return;
    setLoading(true);
    setMessage("");
    try {
      const { data, error } = await supabase.functions.invoke<unknown>(
        "asset-registry",
        { body: { type: "getIntuneConfiguration", tenantId } },
      );
      if (error) throw error;
      const wrapped = data as { data?: { configuration?: unknown } };
      if (!isConfiguration(wrapped.data?.configuration)) {
        throw new Error("Die Intune-Konfiguration ist unvollständig.");
      }
      setConfiguration(wrapped.data.configuration);
      setDirectoryTenantId(
        wrapped.data.configuration.directory_tenant_id ?? "",
      );
      setEnabled(wrapped.data.configuration.enabled);
      setSyncEnabled(wrapped.data.configuration.sync_enabled);
    } catch (error) {
      setMessage(
        await functionErrorMessage(
          error,
          "Die Intune-Konfiguration konnte nicht geladen werden.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [tenantId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const directory = directoryTenantId.trim();
    if (enabled && !directory) {
      setMessage(
        "Für eine aktivierte Intune-Verbindung ist die Entra-Mandanten-ID erforderlich.",
      );
      return;
    }
    if (!supabase) {
      setMessage("Die Verbindung zu nextDesk ist nicht konfiguriert.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const { data, error } = await supabase.functions.invoke<unknown>(
        "asset-registry",
        {
          body: {
            type: "updateIntuneConfiguration",
            tenantId,
            enabled,
            directoryTenantId: directory || null,
            syncEnabled,
          },
        },
      );
      if (error) throw error;
      const wrapped = data as { data?: { configuration?: unknown } };
      if (!isConfiguration(wrapped.data?.configuration)) {
        throw new Error("Die Intune-Konfiguration ist unvollständig.");
      }
      setConfiguration(wrapped.data.configuration);
      setMessage(
        "Die mandantenspezifische Intune-Konfiguration wurde gespeichert.",
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

  return (
    <section
      className="asset-intune-settings panel"
      aria-labelledby="asset-intune-heading"
    >
      <div className="panel-heading asset-intune-settings__heading">
        <div>
          <span className="eyebrow">ASSET-INTEGRATION</span>
          <h2 id="asset-intune-heading">Microsoft Intune</h2>
          <p>
            Geräte werden ausschließlich im aktuellen Mandanten abgeglichen.
            Zugangsdaten bleiben als Edge-Function-Secrets außerhalb von Browser
            und App.
          </p>
        </div>
        <CloudCog aria-hidden="true" size={25} />
      </div>
      {loading ? <p>Konfiguration wird geladen …</p> : null}
      {!loading ? (
        <form className="asset-intune-settings__form" onSubmit={save}>
          <label>
            Entra-Mandanten-ID
            <input
              autoComplete="off"
              disabled={saving}
              onChange={(event) => setDirectoryTenantId(event.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={directoryTenantId}
            />
          </label>
          <label className="asset-intune-settings__check">
            <input
              checked={enabled}
              disabled={saving}
              onChange={(event) => setEnabled(event.target.checked)}
              type="checkbox"
            />
            Intune-Verbindung für diesen Mandanten vorbereiten
          </label>
          <label className="asset-intune-settings__check">
            <input
              checked={syncEnabled}
              disabled={saving || !enabled}
              onChange={(event) => setSyncEnabled(event.target.checked)}
              type="checkbox"
            />
            Automatischen Geräteabgleich erlauben, sobald die zentrale
            Graph-Freigabe vorliegt
          </label>
          <div className="asset-intune-settings__status" role="status">
            <ShieldCheck aria-hidden="true" size={17} />
            <span>
              Letzter erfolgreicher Abgleich:{" "}
              {dateLabel(configuration?.last_success_at ?? null)} · Status:{" "}
              {configuration?.last_status ?? "nicht konfiguriert"}
            </span>
          </div>
          {message ? (
            <p className="asset-intune-settings__message">{message}</p>
          ) : null}
          <div className="asset-intune-settings__actions">
            <button disabled={saving} type="submit">
              {saving ? "Wird gespeichert …" : "Intune-Konfiguration speichern"}
            </button>
            <button
              disabled={loading || saving}
              onClick={() => void load()}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={16} /> Aktualisieren
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
