import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase } from "./lib/supabase";
import { useVisibleInterval } from "./lib/use-visible-interval";
import "./service-status-incidents.css";

/** Zustände einer öffentlichen Störungsmeldung. */
export type IncidentState =
  "investigating" | "identified" | "monitoring" | "resolved";

export const INCIDENT_STATE_LABELS: Record<IncidentState, string> = {
  investigating: "Wird untersucht",
  identified: "Ursache erkannt",
  monitoring: "Wird beobachtet",
  resolved: "Behoben",
};

const INCIDENT_STATES = Object.keys(INCIDENT_STATE_LABELS) as IncidentState[];

export type IncidentMessageUpdate = {
  id: string;
  state: IncidentState;
  title: string;
  body: string;
  createdAt: string;
};

export type IncidentMessage = {
  id: string;
  state: IncidentState;
  title: string;
  body: string;
  publicEnabled: boolean;
  monitoringIncidentId: string | null;
  serviceIds: string[];
  startsAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  updates: IncidentMessageUpdate[];
};

/** Öffentliche Sicht (Statusseite) ohne interne Kennungen. */
export type PublicIncident = {
  title: string;
  body: string;
  state: IncidentState;
  startsAt: string;
  resolvedAt: string | null;
  updatedAt: string;
  serviceNames: string[];
  updates: Array<{ state: IncidentState; body: string; createdAt: string }>;
};

type ServiceOption = { id: string; name: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isState(value: unknown): value is IncidentState {
  return (
    typeof value === "string" &&
    (INCIDENT_STATES as readonly string[]).includes(value)
  );
}

function isText(value: unknown, max = 10_000): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** Verfügbarkeit im Format von de-CH, z. B. «99.8 %». */
export function formatAvailability(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "–";
  }
  const digits = value >= 99.95 && value < 100 ? 2 : 1;
  return `${new Intl.NumberFormat("de-CH", {
    maximumFractionDigits: digits,
    minimumFractionDigits: value === 100 ? 0 : 1,
  }).format(value)} %`;
}

function parseUpdate(value: unknown): IncidentMessageUpdate | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !isState(value.state) ||
    !isText(value.title, 240) ||
    !isText(value.body) ||
    !isDate(value.createdAt)
  ) {
    return null;
  }
  return {
    id: value.id,
    state: value.state,
    title: value.title,
    body: value.body,
    createdAt: value.createdAt,
  };
}

export function parseIncidentMessage(value: unknown): IncidentMessage | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id) ||
    !isState(value.state) ||
    !isText(value.title, 240) ||
    !isText(value.body) ||
    !isDate(value.createdAt) ||
    !isDate(value.updatedAt)
  ) {
    return null;
  }
  const updates = Array.isArray(value.updates)
    ? value.updates
        .map(parseUpdate)
        .filter((update): update is IncidentMessageUpdate => update !== null)
    : [];
  return {
    id: value.id,
    state: value.state,
    title: value.title,
    body: value.body,
    publicEnabled: value.publicEnabled === true,
    monitoringIncidentId:
      typeof value.monitoringIncidentId === "string"
        ? value.monitoringIncidentId
        : null,
    serviceIds: Array.isArray(value.serviceIds)
      ? value.serviceIds.filter(
          (id): id is string => typeof id === "string" && UUID_PATTERN.test(id),
        )
      : [],
    startsAt: isDate(value.startsAt) ? value.startsAt : value.createdAt,
    resolvedAt: isDate(value.resolvedAt) ? value.resolvedAt : null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    updates,
  };
}

/** Liste der Meldungen; ungültige Einträge werden ausgelassen. */
export function parseIncidentMessages(value: unknown): IncidentMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 200)
    .map(parseIncidentMessage)
    .filter((message): message is IncidentMessage => message !== null);
}

export function parsePublicIncidents(value: unknown): PublicIncident[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((item) => {
    if (
      !isRecord(item) ||
      !isText(item.title, 240) ||
      !isText(item.body) ||
      !isState(item.state) ||
      !isDate(item.startsAt) ||
      !isDate(item.updatedAt)
    ) {
      return [];
    }
    const updates = Array.isArray(item.updates)
      ? item.updates.flatMap((update) =>
          isRecord(update) &&
          isState(update.state) &&
          isText(update.body) &&
          isDate(update.createdAt)
            ? [
                {
                  state: update.state,
                  body: update.body,
                  createdAt: update.createdAt,
                },
              ]
            : [],
        )
      : [];
    return [
      {
        title: item.title,
        body: item.body,
        state: item.state,
        startsAt: item.startsAt,
        resolvedAt: isDate(item.resolvedAt) ? item.resolvedAt : null,
        updatedAt: item.updatedAt,
        serviceNames: Array.isArray(item.serviceNames)
          ? item.serviceNames.filter((name): name is string =>
              isText(name, 240),
            )
          : [],
        updates,
      },
    ];
  });
}

/** Meldungen der Verwaltung in die öffentliche Darstellung überführen. */
export function incidentMessagesToPublic(
  messages: readonly IncidentMessage[],
  serviceNames: ReadonlyMap<string, string>,
  onlyPublic: boolean,
): PublicIncident[] {
  return messages
    .filter((message) => !onlyPublic || message.publicEnabled)
    .map((message) => ({
      title: message.title,
      body: message.body,
      state: message.state,
      startsAt: message.startsAt,
      resolvedAt: message.resolvedAt,
      updatedAt: message.updatedAt,
      serviceNames: message.serviceIds.flatMap(
        (id) => serviceNames.get(id) ?? [],
      ),
      updates: message.updates.map((update) => ({
        state: update.state,
        body: update.body,
        createdAt: update.createdAt,
      })),
    }));
}

function dateTimeLabel(value: string): string {
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function IncidentStatePill({ state }: { state: IncidentState }) {
  return (
    <span className={`status-incident__state status-incident__state--${state}`}>
      {INCIDENT_STATE_LABELS[state]}
    </span>
  );
}

function IncidentTimeline({ updates }: { updates: PublicIncident["updates"] }) {
  if (updates.length <= 1) return null;
  return (
    <ol className="status-incident__timeline" aria-label="Verlauf der Meldung">
      {updates.map((update, index) => (
        <li key={`${update.createdAt}-${index}`}>
          <span>
            <IncidentStatePill state={update.state} />{" "}
            <time dateTime={update.createdAt}>
              {dateTimeLabel(update.createdAt)}
            </time>
          </span>
          <p>{update.body}</p>
        </li>
      ))}
    </ol>
  );
}

/** Aktuelle und in den letzten 14 Tagen gelöste Störungsmeldungen. */
export function PublicIncidentList({
  incidents,
}: {
  incidents: readonly PublicIncident[];
}) {
  if (incidents.length === 0) return null;
  const current = incidents.filter((incident) => incident.state !== "resolved");
  const past = incidents.filter((incident) => incident.state === "resolved");
  const group = (
    title: string,
    items: readonly PublicIncident[],
    id: string,
  ) =>
    items.length === 0 ? null : (
      <section aria-labelledby={id} className="status-incident__group">
        <h2 id={id}>{title}</h2>
        {items.map((incident, index) => (
          <article
            className={`status-incident status-incident--${incident.state}`}
            key={`${incident.title}-${incident.startsAt}-${index}`}
          >
            <div className="status-incident__heading">
              <h3>{incident.title}</h3>
              <IncidentStatePill state={incident.state} />
            </div>
            <p className="status-incident__meta">
              Seit {dateTimeLabel(incident.startsAt)}
              {incident.resolvedAt
                ? ` · behoben ${dateTimeLabel(incident.resolvedAt)}`
                : ` · aktualisiert ${dateTimeLabel(incident.updatedAt)}`}
            </p>
            <p>{incident.body}</p>
            {incident.serviceNames.length > 0 ? (
              <p className="status-incident__services">
                Betroffene Dienste: {incident.serviceNames.join(", ")}
              </p>
            ) : null}
            <IncidentTimeline updates={incident.updates} />
          </article>
        ))}
      </section>
    );
  return (
    <div className="status-incident__list">
      {group("Aktuelle Störungen", current, "status-incidents-current")}
      {group("Störungen der letzten 14 Tage", past, "status-incidents-past")}
    </div>
  );
}

type IncidentDraft = {
  id: string | null;
  title: string;
  body: string;
  state: IncidentState;
  publicEnabled: boolean;
  serviceIds: string[];
};

const EMPTY_DRAFT: IncidentDraft = {
  id: null,
  title: "",
  body: "",
  state: "investigating",
  publicEnabled: true,
  serviceIds: [],
};

async function invokeStatus<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) {
    throw new Error("Die Verbindung zu Supabase ist nicht konfiguriert.");
  }
  const { data, error } = await supabase.functions.invoke<unknown>(
    "service-status",
    { body },
  );
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = (await context.json().catch(() => null)) as unknown;
      if (
        isRecord(payload) &&
        isRecord(payload.error) &&
        typeof payload.error.message === "string"
      ) {
        throw new Error(payload.error.message);
      }
    }
    throw new Error("Die Störungsmeldung konnte nicht verarbeitet werden.");
  }
  if (!isRecord(data) || !isRecord(data.data)) {
    throw new Error("Die Serverantwort hat ein unerwartetes Format.");
  }
  return data.data as T;
}

/**
 * Verwaltung der öffentlichen Störungsmeldungen in der Statusseiten-
 * Verwaltung: neue Meldung, Updates mit Zustand und Verlauf.
 */
export function IncidentMessagesPanel({
  services,
  tenantId,
  onChanged,
}: {
  services: readonly ServiceOption[];
  tenantId: string;
  onChanged?: () => void;
}) {
  const [messages, setMessages] = useState<IncidentMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<IncidentDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const serviceNames = new Map(
    services.map((service) => [service.id, service.name]),
  );

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await invokeStatus<{ messages: unknown }>({
          type: "listIncidentMessages",
          tenantId,
        });
        setMessages(parseIncidentMessages(data.messages));
        if (!silent) setError("");
      } catch (nextError) {
        if (!silent) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Die Störungsmeldungen konnten nicht geladen werden.",
          );
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [tenantId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useVisibleInterval(() => void load(true), 60_000, !loading && !saving);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await invokeStatus(
        draft.id
          ? {
              type: "updateIncidentMessage",
              tenantId,
              messageId: draft.id,
              state: draft.state,
              title: draft.title.trim(),
              body: draft.body.trim(),
              serviceIds: draft.serviceIds,
              publicEnabled: draft.publicEnabled,
            }
          : {
              type: "publishIncidentMessage",
              tenantId,
              monitoringIncidentId: null,
              serviceIds: draft.serviceIds,
              state: draft.state,
              title: draft.title.trim(),
              body: draft.body.trim(),
              publicEnabled: draft.publicEnabled,
            },
      );
      setNotice(
        draft.id
          ? "Das Update wurde gespeichert."
          : "Die Störungsmeldung wurde erfasst.",
      );
      setDraft(null);
      await load(true);
      onChanged?.();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Störungsmeldung konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  const visible = messages.filter(
    (message) => showResolved || message.state !== "resolved",
  );

  return (
    <section
      aria-labelledby="status-incident-admin-title"
      className="status-incident-admin panel"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Kommunikation</p>
          <h3 id="status-incident-admin-title">Störungsmeldungen</h3>
          <p>
            Öffentliche Meldungen erscheinen auf der Statusseite, im Portal-
            Banner und beim Erfassen eines Tickets. Bestätigte Abonnentinnen und
            Abonnenten erhalten jedes Update per E-Mail.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={saving}
          onClick={() => setDraft({ ...EMPTY_DRAFT })}
          type="button"
        >
          Neue Meldung
        </button>
      </div>
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="form-message form-message--success" role="status">
          {notice}
        </p>
      ) : null}
      {draft ? (
        <form className="status-incident-admin__form" onSubmit={save}>
          <h4>
            {draft.id ? "Update veröffentlichen" : "Neue Störungsmeldung"}
          </h4>
          <label>
            Titel
            <input
              disabled={saving}
              maxLength={240}
              minLength={3}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
              required
              value={draft.title}
            />
          </label>
          <label>
            Zustand
            <select
              disabled={saving}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  state: event.target.value as IncidentState,
                })
              }
              value={draft.state}
            >
              {INCIDENT_STATES.map((state) => (
                <option key={state} value={state}>
                  {INCIDENT_STATE_LABELS[state]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {draft.id ? "Text des Updates" : "Text"}
            <textarea
              disabled={saving}
              maxLength={10_000}
              minLength={3}
              onChange={(event) =>
                setDraft({ ...draft, body: event.target.value })
              }
              required
              rows={4}
              value={draft.body}
            />
          </label>
          <fieldset disabled={saving}>
            <legend>Betroffene Dienste</legend>
            <div className="status-incident-admin__services">
              {services.map((service) => (
                <label key={service.id}>
                  <input
                    checked={draft.serviceIds.includes(service.id)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        serviceIds: event.target.checked
                          ? [...draft.serviceIds, service.id]
                          : draft.serviceIds.filter((id) => id !== service.id),
                      })
                    }
                    type="checkbox"
                  />
                  {service.name}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="status-incident-admin__toggle">
            <input
              checked={draft.publicEnabled}
              disabled={saving}
              onChange={(event) =>
                setDraft({ ...draft, publicEnabled: event.target.checked })
              }
              type="checkbox"
            />
            Auf der öffentlichen Statusseite zeigen und Abonnenten informieren
          </label>
          <p className="status-incident-admin__actions">
            <button className="primary-button" disabled={saving} type="submit">
              {saving ? "Wird gespeichert …" : "Speichern"}
            </button>
            <button
              disabled={saving}
              onClick={() => setDraft(null)}
              type="button"
            >
              Abbrechen
            </button>
          </p>
        </form>
      ) : null}
      {loading ? (
        <p className="empty-state">Meldungen werden geladen …</p>
      ) : null}
      {!loading && visible.length === 0 ? (
        <p className="service-status__empty">
          {messages.length === 0
            ? "Es sind keine Störungsmeldungen erfasst."
            : "Keine offenen Störungsmeldungen."}
        </p>
      ) : null}
      <ul className="status-incident-admin__list">
        {visible.map((message) => (
          <li key={message.id}>
            <div className="status-incident__heading">
              <strong>{message.title}</strong>
              <IncidentStatePill state={message.state} />
            </div>
            <p className="status-incident__meta">
              {message.publicEnabled ? "Öffentlich" : "Nur intern"} · seit{" "}
              {dateTimeLabel(message.startsAt)}
              {message.monitoringIncidentId ? " · aus Monitoring-Störung" : ""}
              {message.serviceIds.length > 0
                ? ` · ${message.serviceIds
                    .map((id) => serviceNames.get(id) ?? "Unbekannter Dienst")
                    .join(", ")}`
                : ""}
            </p>
            <p>{message.body}</p>
            <IncidentTimeline updates={message.updates} />
            <button
              disabled={saving}
              onClick={() =>
                setDraft({
                  id: message.id,
                  title: message.title,
                  body: "",
                  state: message.state,
                  publicEnabled: message.publicEnabled,
                  serviceIds: message.serviceIds,
                })
              }
              type="button"
            >
              Update erfassen
            </button>
          </li>
        ))}
      </ul>
      {messages.some((message) => message.state === "resolved") ? (
        <button
          className="text-button"
          onClick={() => setShowResolved((current) => !current)}
          type="button"
        >
          {showResolved ? "Behobene ausblenden" : "Behobene anzeigen"}
        </button>
      ) : null}
    </section>
  );
}
