import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Globe, RefreshCw, X } from "lucide-react";

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
  /** Services of the status page published automatically. */
  serviceIds: string[];
};

export type StatusPageServiceOption = { id: string; name: string };

export function parseExternalServices(
  value: unknown,
): StatusPageServiceOption[] {
  const data =
    value && typeof value === "object" && "data" in value
      ? (value as { data?: { services?: unknown } }).data
      : null;
  const rows = Array.isArray(data?.services) ? data.services : [];
  return rows.flatMap((row: unknown) => {
    if (!row || typeof row !== "object") return [];
    const entry = row as Record<string, unknown>;
    return typeof entry.id === "string" && typeof entry.name === "string"
      ? [{ id: entry.id, name: entry.name }]
      : [];
  });
}

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
        serviceIds: Array.isArray(entry.serviceIds)
          ? entry.serviceIds.filter(
              (id): id is string => typeof id === "string",
            )
          : [],
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
  return {
    sources: parseExternalSources(data),
    services: parseExternalServices(data),
  };
}

/** Services of the status page for one source: chips plus a search. */
function SourceServicePicker({
  disabled,
  label,
  onChange,
  options,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (ids: string[]) => void;
  options: StatusPageServiceOption[];
  value: string[];
}) {
  const [query, setQuery] = useState("");
  const names = new Map(options.map((option) => [option.id, option.name]));
  const words = query.toLocaleLowerCase("de-CH").split(/\s+/).filter(Boolean);
  const matches = words.length
    ? options
        .filter((option) => !value.includes(option.id))
        .filter((option) =>
          words.every((word) =>
            option.name.toLocaleLowerCase("de-CH").includes(word),
          ),
        )
        .slice(0, 8)
    : [];
  return (
    <div className="external-status__services">
      <small>
        Automatisch auf der Statusseite melden für:
        {value.length ? null : " (keine Dienste – keine öffentliche Meldung)"}
      </small>
      {value.length ? (
        <ul aria-label={`Dienste für ${label}`}>
          {value.map((id) => (
            <li key={id}>
              {names.get(id) ?? "Gelöschter Dienst"}
              <button
                aria-label={`${names.get(id) ?? "Dienst"} entfernen`}
                disabled={disabled}
                onClick={() => onChange(value.filter((entry) => entry !== id))}
                type="button"
              >
                <X aria-hidden="true" size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        aria-label={`Dienst für ${label} hinzufügen`}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (matches[0]) {
              onChange([...value, matches[0].id]);
              setQuery("");
            }
          }
        }}
        placeholder="Dienst suchen, z. B. Teams …"
        type="search"
        value={query}
      />
      {matches.length ? (
        <ul className="external-status__matches">
          {matches.map((option) => (
            <li key={option.id}>
              <button
                disabled={disabled}
                onClick={() => {
                  onChange([...value, option.id]);
                  setQuery("");
                }}
                type="button"
              >
                {option.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
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
  const [serviceOptions, setServiceOptions] = useState<
    StatusPageServiceOption[]
  >([]);
  const [sourceServices, setSourceServices] = useState<
    Record<string, string[]>
  >({});
  const [busy, setBusy] = useState<"save" | "check" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const apply = useCallback(
    (next: {
      sources: ExternalStatusSource[];
      services: StatusPageServiceOption[];
    }) => {
      setSources(next.sources);
      setServiceOptions(next.services);
      setSelected(
        Object.fromEntries(
          next.sources.map((source) => [source.key, source.enabled]),
        ),
      );
      setSourceServices(
        Object.fromEntries(
          next.sources.map((source) => [source.key, source.serviceIds]),
        ),
      );
    },
    [],
  );

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
      apply(
        await invoke({
          type: "save",
          tenantId,
          enabled: selected,
          services: sourceServices,
        }),
      );
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
            sie sich automatisch. Sind einer Quelle Dienste zugeordnet,
            erscheint die Störung sofort als öffentliche Meldung im Banner und
            auf der Statusseite (die Dienste werden als gestört markiert);
            Updates des Anbieters ergänzen sie, und mit der Behebung wird sie
            geschlossen.
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
                {selected[source.key] ? (
                  <SourceServicePicker
                    disabled={busy !== null}
                    label={source.label}
                    onChange={(ids) =>
                      setSourceServices({
                        ...sourceServices,
                        [source.key]: ids,
                      })
                    }
                    options={serviceOptions}
                    value={sourceServices[source.key] ?? []}
                  />
                ) : null}
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
