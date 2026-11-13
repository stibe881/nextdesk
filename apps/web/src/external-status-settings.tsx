import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Globe, RefreshCw } from "lucide-react";

import { tn } from "./lib/formality";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";

/** Status feed of a provider as returned by the edge function external-status. */
export type ExternalStatusSource = {
  key: string;
  label: string;
  description: string;
  statusUrl: string;
  requiresEntra: boolean;
  enabled: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  activeIncidents: number;
};

export function parseExternalSources(value: unknown): ExternalStatusSource[] {
  const data =
    value && typeof value === "object" && "data" in value
      ? (value as { data?: { sources?: unknown } }).data
      : null;
  const rows = Array.isArray(data?.sources) ? data.sources : [];
  return rows.flatMap((row: unknown) => {
    if (!row || typeof row !== "object") return [];
    const entry = row as Record<string, unknown>;
    if (typeof entry.key !== "string" || typeof entry.label !== "string") {
      return [];
    }
    const text = (field: unknown) =>
      typeof field === "string" && field ? field : null;
    return [
      {
        key: entry.key,
        label: entry.label,
        description: text(entry.description) ?? "",
        statusUrl: text(entry.statusUrl) ?? "",
        requiresEntra: entry.requiresEntra === true,
        enabled: entry.enabled === true,
        lastCheckedAt: text(entry.lastCheckedAt),
        lastError: text(entry.lastError),
        activeIncidents:
          typeof entry.activeIncidents === "number" ? entry.activeIncidents : 0,
      },
    ];
  });
}

async function invoke(body: Record<string, unknown>) {
  if (!supabase) {
    throw new Error("Die Verbindung zu nextDesk ist nicht konfiguriert.");
  }
  const { data, error } = await supabase.functions.invoke<unknown>(
    "external-status",
    { body },
  );
  if (error) {
    throw new Error(
      await functionErrorMessage(
        error,
        "Die externen Statusquellen sind gerade nicht verfügbar.",
      ),
    );
  }
  return parseExternalSources(data);
}

function dateTime(value: string | null): string {
  if (!value) return "noch nie";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "unbekannt"
    : date.toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * «Externe Statusquellen»: official status feeds of cloud services and
 * providers. A reported issue appears under «Störungen» as «extern» and
 * alarms the incident team once; it closes when the provider resolves it.
 */
export function ExternalStatusSettings({ tenantId }: { tenantId: string }) {
  const [sources, setSources] = useState<ExternalStatusSource[] | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<"save" | "check" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const apply = useCallback((next: ExternalStatusSource[]) => {
    setSources(next);
    setSelected(
      Object.fromEntries(next.map((source) => [source.key, source.enabled])),
    );
  }, []);

  useEffect(() => {
    let active = true;
    void invoke({ type: "get", tenantId })
      .then((next) => {
        if (active) apply(next);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [apply, tenantId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("save");
    setMessage("");
    setError("");
    try {
      apply(await invoke({ type: "save", tenantId, enabled: selected }));
      // Check right away so the status is visible without waiting 5 minutes.
      apply(await invoke({ type: "checkNow", tenantId }));
      setMessage("Die externen Statusquellen wurden gespeichert und geprüft.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function checkNow() {
    setBusy("check");
    setMessage("");
    setError("");
    try {
      apply(await invoke({ type: "checkNow", tenantId }));
      setMessage("Die Statusquellen wurden geprüft.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-busy={busy !== null}
      aria-labelledby="external-status-heading"
      className="asset-intune-settings monitoring-settings panel"
    >
      <div className="panel-heading asset-intune-settings__heading">
        <div>
          <span className="eyebrow">MONITORING</span>
          <h2 id="external-status-heading">Externe Statusquellen</h2>
          <p>
            nextDesk liest alle 5 Minuten die offiziellen Statusmeldungen der
            gewählten Anbieter. Meldet ein Anbieter eine Störung, erscheint sie
            unter «Störungen» als «Extern» und das Team für die Alarmierung
            (siehe PRTG oben) wird benachrichtigt, ebenso bei jedem Update des
            Anbieters. Meldet der Anbieter die Störung als behoben, schliesst
            sie sich automatisch.
          </p>
        </div>
        <Globe aria-hidden="true" size={25} />
      </div>

      {!sources && !error ? <p>Statusquellen werden geladen …</p> : null}
      {sources ? (
        <form className="asset-intune-settings__form" onSubmit={save}>
          <ul
            aria-label="Externe Statusquellen"
            className="external-status__list"
          >
            {sources.map((source) => (
              <li key={source.key}>
                <label className="asset-intune-settings__check">
                  <input
                    checked={selected[source.key] === true}
                    disabled={busy !== null}
                    onChange={(event) =>
                      setSelected({
                        ...selected,
                        [source.key]: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  <span>
                    <strong>{source.label}</strong>
                    {source.enabled && source.activeIncidents ? (
                      <span className="monitoring-chip monitoring-chip--danger">
                        {source.activeIncidents === 1
                          ? "1 Störung"
                          : `${source.activeIncidents} Störungen`}
                      </span>
                    ) : null}
                    <small>
                      {source.description}{" "}
                      <a
                        href={source.statusUrl}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        Statusseite
                      </a>
                    </small>
                    {source.enabled ? (
                      <small>
                        Zuletzt geprüft: {dateTime(source.lastCheckedAt)}
                      </small>
                    ) : null}
                    {source.enabled && source.lastError ? (
                      <small className="monitoring-settings__error">
                        {source.lastError}
                      </small>
                    ) : null}
                    {source.requiresEntra ? (
                      <small>
                        Benötigt in der Entra-App die Anwendungsberechtigung{" "}
                        <code>ServiceHealth.Read.All</code> mit
                        Administratorzustimmung.
                      </small>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="asset-intune-settings__help">
            {tn(
              "WWZ und Swisscom bieten keine maschinenlesbare Statusquelle. Für diese überwachst du deinen Anschluss am besten mit einem Ping- oder HTTP-Sensor in PRTG.",
              "WWZ und Swisscom bieten keine maschinenlesbare Statusquelle. Für diese überwachen Sie Ihren Anschluss am besten mit einem Ping- oder HTTP-Sensor in PRTG.",
            )}
          </p>
          {error ? (
            <p className="monitoring-settings__error" role="alert">
              {error}
            </p>
          ) : null}
          {message ? <p role="status">{message}</p> : null}
          <div className="asset-intune-settings__actions">
            <button
              className="primary-button"
              disabled={busy !== null}
              type="submit"
            >
              {busy === "save" ? "Wird gespeichert …" : "Speichern"}
            </button>
            <button
              className="secondary-button"
              disabled={busy !== null}
              onClick={() => void checkNow()}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={15} />
              {busy === "check" ? "Wird geprüft …" : "Jetzt prüfen"}
            </button>
          </div>
        </form>
      ) : null}
      {!sources && error ? (
        <p className="monitoring-settings__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
