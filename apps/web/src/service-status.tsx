import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { CircleCheck, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { supabase } from "./lib/supabase";
import {
  buildServiceStatusHistoryDays,
  type ServiceAvailabilityStatus,
} from "./lib/service-status-history";

type ServiceStatus = ServiceAvailabilityStatus;

type StatusService = {
  id: string;
  name: string;
  status: ServiceStatus;
  statusPublic: boolean;
  updatedAt: string;
};
type StatusEvent = {
  serviceId: string;
  status: ServiceStatus;
  changedAt: string;
};
type StatusPage = {
  publicEnabled: boolean;
  publicId: string | null;
  title: string;
  updatedAt: string | null;
};
type StatusOverview = {
  canManagePublication: boolean;
  events: StatusEvent[];
  page: StatusPage;
  services: StatusService[];
};
type StatusAction =
  | { type: "getStatusOverview"; tenantId: string }
  | {
      type: "saveStatusPage";
      tenantId: string;
      title: string;
      publicEnabled: boolean;
    }
  | { type: "rotateStatusPageId"; tenantId: string };
type PublicService = {
  history: Array<{ changedAt: string; status: ServiceStatus }>;
  name: string;
  status: ServiceStatus;
  updatedAt: string;
};
type PublicStatusPayload = {
  accentColor: string | null;
  generatedAt: string;
  logoUrl: string | null;
  overallStatus: ServiceStatus;
  services: PublicService[];
  title: string;
};

export type ServiceStatusProps = { tenantId: string };
export type PublicServiceStatusPageProps = { publicId: string };

const STATUS_LABELS: Record<ServiceStatus, string> = {
  operational: "Betriebsbereit",
  degraded: "Beeinträchtigte Leistung",
  partial_outage: "Teilweiser Ausfall",
  major_outage: "Schwerwiegender Ausfall",
  maintenance: "Wird gewartet",
};

const OVERALL_COPY: Record<ServiceStatus, string> = {
  operational: "Alle veröffentlichten Dienste sind verfügbar.",
  degraded: "Mindestens ein veröffentlichter Dienst ist beeinträchtigt.",
  partial_outage:
    "Bei mindestens einem veröffentlichten Dienst liegt ein teilweiser Ausfall vor.",
  major_outage:
    "Bei mindestens einem veröffentlichten Dienst liegt ein schwerwiegender Ausfall vor.",
  maintenance:
    "Mindestens ein veröffentlichter Dienst wird planmässig gewartet.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isStatus(value: unknown): value is ServiceStatus {
  return (
    value === "operational" ||
    value === "degraded" ||
    value === "partial_outage" ||
    value === "major_outage" ||
    value === "maintenance"
  );
}

function isWellFormedText(value: string): boolean {
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

function isString(value: unknown, min = 1, max = 10_000): value is string {
  return (
    typeof value === "string" &&
    !value.includes("\u0000") &&
    isWellFormedText(value) &&
    [...value.trim()].length >= min &&
    [...value.trim()].length <= max
  );
}

function parseService(value: unknown): StatusService | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isString(value.name, 1, 240) ||
    !isStatus(value.status) ||
    typeof value.statusPublic !== "boolean" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name.trim(),
    status: value.status,
    statusPublic: value.statusPublic,
    updatedAt: value.updatedAt,
  };
}

function parseEvent(
  value: unknown,
  serviceIds: ReadonlySet<string>,
): StatusEvent | null {
  if (
    !isRecord(value) ||
    !isUuid(value.serviceId) ||
    !serviceIds.has(value.serviceId) ||
    !isStatus(value.status) ||
    typeof value.changedAt !== "string"
  ) {
    return null;
  }
  return {
    serviceId: value.serviceId,
    status: value.status,
    changedAt: value.changedAt,
  };
}

function parseOverview(value: unknown): StatusOverview {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("Die Serverantwort hat ein unerwartetes Format.");
  }
  const data = value.data;
  if (
    !isRecord(data.page) ||
    !Array.isArray(data.services) ||
    !Array.isArray(data.events)
  ) {
    throw new Error("Die Statusdaten sind unvollständig.");
  }
  const page = data.page;
  if (
    typeof page.publicEnabled !== "boolean" ||
    !(page.publicId === null || isUuid(page.publicId)) ||
    !isString(page.title, 2, 120) ||
    !(page.updatedAt === null || typeof page.updatedAt === "string") ||
    typeof data.canManagePublication !== "boolean"
  ) {
    throw new Error("Die Statusseite enthält ungültige Werte.");
  }
  const services = data.services.map(parseService);
  if (services.some((service) => service === null)) {
    throw new Error("Die Serviceliste enthält ungültige Werte.");
  }
  const serviceIds = new Set(
    (services as StatusService[]).map((service) => service.id),
  );
  const events = data.events.map((event) => parseEvent(event, serviceIds));
  if (events.some((event) => event === null)) {
    throw new Error("Der Statusverlauf enthält ungültige Werte.");
  }
  return {
    canManagePublication: data.canManagePublication,
    events: events as StatusEvent[],
    page: {
      publicEnabled: page.publicEnabled,
      publicId: page.publicId,
      title: page.title.trim(),
      updatedAt: page.updatedAt,
    },
    services: services as StatusService[],
  };
}

function parsePublicService(value: unknown): PublicService | null {
  if (
    !isRecord(value) ||
    !isString(value.name, 1, 240) ||
    !isStatus(value.status) ||
    typeof value.updatedAt !== "string" ||
    !Array.isArray(value.history)
  ) {
    return null;
  }
  const history = value.history.map((item) => {
    if (
      !isRecord(item) ||
      !isStatus(item.status) ||
      typeof item.changedAt !== "string"
    ) {
      return null;
    }
    return { changedAt: item.changedAt, status: item.status };
  });
  if (history.some((item) => item === null)) return null;
  return {
    history: history as Array<{ changedAt: string; status: ServiceStatus }>,
    name: value.name.trim(),
    status: value.status,
    updatedAt: value.updatedAt,
  };
}

function parsePublicStatus(value: unknown): PublicStatusPayload {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("Die Statusseite ist nicht verfügbar.");
  }
  const data = value.data;
  if (
    !isString(data.title, 2, 120) ||
    !isStatus(data.overallStatus) ||
    !Array.isArray(data.services) ||
    !(data.accentColor === null || typeof data.accentColor === "string") ||
    !(data.logoUrl === null || typeof data.logoUrl === "string") ||
    typeof data.generatedAt !== "string"
  ) {
    throw new Error("Die Statusseite ist nicht verfügbar.");
  }
  const services = data.services.map(parsePublicService);
  if (services.some((service) => service === null)) {
    throw new Error("Die Statusseite ist nicht verfügbar.");
  }
  return {
    accentColor: data.accentColor,
    generatedAt: data.generatedAt,
    logoUrl: data.logoUrl,
    overallStatus: data.overallStatus,
    services: services as PublicService[],
    title: data.title.trim(),
  };
}

function errorStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  const context = error.context;
  if (context instanceof Response) return context.status;
  return typeof error.status === "number" ? error.status : null;
}

async function errorMessage(error: unknown, fallback: string): Promise<string> {
  const status = errorStatus(error);
  const context = isRecord(error) ? error.context : null;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      if (
        isRecord(body) &&
        isRecord(body.error) &&
        isString(body.error.message)
      ) {
        return body.error.message.trim();
      }
    } catch {
      // The endpoint's safe status code below remains sufficient.
    }
  }
  if (status === 403) return "Für diese Statusaktion fehlt die Berechtigung.";
  if (status === 401)
    return "Ihre Anmeldung ist nicht mehr gültig. Bitte melden Sie sich erneut an.";
  return fallback;
}

function statusSeverity(status: ServiceStatus): number {
  return {
    operational: 0,
    maintenance: 1,
    degraded: 2,
    partial_outage: 3,
    major_outage: 4,
  }[status];
}

function overallStatus(
  services: readonly Pick<PublicService, "status">[],
): ServiceStatus {
  return services.reduce<ServiceStatus>(
    (current, service) =>
      statusSeverity(service.status) > statusSeverity(current)
        ? service.status
        : current,
    "operational",
  );
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unbekannt"
    : new Intl.DateTimeFormat("de-CH", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function publicPageUrl(publicId: string): string {
  const url = new URL(import.meta.env.BASE_URL, window.location.origin);
  url.searchParams.set("system-status", publicId);
  return url.toString();
}

function badgeUrl(publicId: string): string | null {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) return null;
  try {
    const url = new URL("/functions/v1/service-status-public", base);
    url.searchParams.set("id", publicId);
    url.searchParams.set("format", "badge");
    return url.toString();
  } catch {
    return null;
  }
}

function StatusPill({ status }: { status: ServiceStatus }) {
  return (
    <span className={`service-status__pill service-status__pill--${status}`}>
      <span aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}

function AvailabilityLine({ service }: { service: PublicService }) {
  const days = useMemo(() => buildServiceStatusHistoryDays(service), [service]);
  const summary = days.reduce<Record<ServiceStatus, number>>(
    (counts, status) => ({ ...counts, [status]: counts[status] + 1 }),
    {
      operational: 0,
      degraded: 0,
      partial_outage: 0,
      major_outage: 0,
      maintenance: 0,
    },
  );
  const summaryText = (Object.keys(summary) as ServiceStatus[])
    .filter((status) => summary[status] > 0)
    .map((status) => `${summary[status]} Tage ${STATUS_LABELS[status]}`)
    .join(", ");
  return (
    <div
      className="service-status__availability"
      aria-label={`Verfügbarkeit der letzten 90 Tage: ${summaryText}`}
    >
      <div aria-hidden="true" className="service-status__availability-bars">
        {days.map((status, index) => (
          <span
            className={`service-status__availability-day service-status__availability-day--${status}`}
            key={index}
          />
        ))}
      </div>
      <span className="service-status__availability-summary">
        {summaryText}
      </span>
    </div>
  );
}

function StatusPresentation({
  payload,
  publicView = false,
}: {
  payload: Pick<PublicStatusPayload, "overallStatus" | "services">;
  publicView?: boolean;
}) {
  const currentStatus = overallStatus(payload.services);
  return (
    <>
      <section
        className={`service-status__hero service-status__hero--${currentStatus}`}
        aria-live="polite"
      >
        <CircleCheck aria-hidden="true" size={25} strokeWidth={2.6} />
        <div>
          <strong>{OVERALL_COPY[currentStatus]}</strong>
          <span>{payload.services.length} veröffentlichte Dienste</span>
        </div>
      </section>
      <div
        className="service-status__legend"
        aria-label="Legende zu den Servicezuständen"
      >
        {(Object.keys(STATUS_LABELS) as ServiceStatus[]).map((status) => (
          <StatusPill key={status} status={status} />
        ))}
      </div>
      {payload.services.length === 0 ? (
        <p className="service-status__empty">
          {publicView
            ? "Für diese Statusseite sind derzeit keine Dienste veröffentlicht."
            : "Noch keine Services wurden für die öffentliche Statusseite freigegeben."}
        </p>
      ) : (
        <section
          className="service-status__service-list"
          aria-label="Veröffentlichte Dienste"
        >
          {payload.services.map((service) => (
            <article key={service.name}>
              <div className="service-status__service-heading">
                <div>
                  <h3>{service.name}</h3>
                  <p>Zuletzt aktualisiert: {dateLabel(service.updatedAt)}</p>
                </div>
                <StatusPill status={service.status} />
              </div>
              <AvailabilityLine service={service} />
            </article>
          ))}
        </section>
      )}
    </>
  );
}

async function requestStatus(action: StatusAction): Promise<StatusOverview> {
  if (!supabase)
    throw new Error("Die Verbindung zu Supabase ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke<unknown>(
    "service-status",
    {
      body: action,
    },
  );
  if (error) throw error;
  return parseOverview(data);
}

function internalToPublicPayload(
  overview: StatusOverview,
): PublicStatusPayload {
  const eventsByService = new Map<
    string,
    Array<{ changedAt: string; status: ServiceStatus }>
  >();
  for (const event of overview.events) {
    const history = eventsByService.get(event.serviceId) ?? [];
    history.push({ changedAt: event.changedAt, status: event.status });
    eventsByService.set(event.serviceId, history);
  }
  const services = overview.services
    .filter((service) => service.statusPublic)
    .map((service) => ({
      history: eventsByService.get(service.id) ?? [],
      name: service.name,
      status: service.status,
      updatedAt: service.updatedAt,
    }));
  return {
    accentColor: null,
    generatedAt: new Date().toISOString(),
    logoUrl: null,
    overallStatus: overallStatus(services),
    services,
    title: overview.page.title,
  };
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function ServiceStatus({ tenantId }: ServiceStatusProps) {
  const [overview, setOverview] = useState<StatusOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("Systemstatus");
  const [publicEnabled, setPublicEnabled] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await requestStatus({ type: "getStatusOverview", tenantId });
      setOverview(next);
      setTitle(next.page.title);
      setPublicEnabled(next.page.publicEnabled);
    } catch (nextError) {
      setOverview(null);
      setError(
        await errorMessage(
          nextError,
          "Die Systemstatusdaten konnten nicht geladen werden.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const publicPayload = useMemo(
    () => (overview ? internalToPublicPayload(overview) : null),
    [overview],
  );
  const pageUrl = overview?.page.publicId
    ? publicPageUrl(overview.page.publicId)
    : null;
  const currentBadgeUrl = overview?.page.publicId
    ? badgeUrl(overview.page.publicId)
    : null;
  const embedCode =
    pageUrl && currentBadgeUrl
      ? `<a href="${pageUrl}"><img src="${currentBadgeUrl}" alt="Systemstatus von ${overview?.page.title ?? "nextDesk"}"></a>`
      : null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!overview?.canManagePublication) return;
    const trimmed = title.trim();
    if (trimmed.length < 2 || trimmed.length > 120) {
      setError(
        "Die öffentliche Überschrift muss zwischen 2 und 120 Zeichen enthalten.",
      );
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const next = await requestStatus({
        type: "saveStatusPage",
        tenantId,
        title: trimmed,
        publicEnabled,
      });
      setOverview(next);
      setTitle(next.page.title);
      setPublicEnabled(next.page.publicEnabled);
      setNotice(
        next.page.publicEnabled
          ? "Die öffentliche Statusseite ist aktiviert."
          : "Die öffentliche Statusseite ist deaktiviert.",
      );
    } catch (nextError) {
      setError(
        await errorMessage(
          nextError,
          "Die Veröffentlichungseinstellungen konnten nicht gespeichert werden.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function rotatePublicId() {
    if (!overview?.canManagePublication) return;
    if (
      !window.confirm(
        "Die bisherige öffentliche Adresse und der bisherige SharePoint-Badge funktionieren danach nicht mehr. Neue Adresse erstellen?",
      )
    ) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const next = await requestStatus({
        type: "rotateStatusPageId",
        tenantId,
      });
      setOverview(next);
      setTitle(next.page.title);
      setPublicEnabled(next.page.publicEnabled);
      setNotice(
        "Eine neue öffentliche Adresse wurde erstellt. Ersetzen Sie die frühere SharePoint-Bildadresse.",
      );
    } catch (nextError) {
      setError(
        await errorMessage(
          nextError,
          "Die öffentliche Adresse konnte nicht ersetzt werden.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await copyText(value);
      setNotice(`${label} wurde kopiert.`);
    } catch {
      setError(`${label} konnte nicht kopiert werden.`);
    }
  }

  return (
    <section className="service-status" aria-labelledby="service-status-title">
      <header className="service-status__header">
        <div>
          <p className="eyebrow">Servicekommunikation</p>
          <h2 id="service-status-title">Systemstatus</h2>
          <p>
            Zeigen Sie den bewusst gesetzten Zustand Ihrer Services und
            veröffentlichen Sie bei Bedarf eine datensparsame Statusseite.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={loading || saving}
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} />
          Aktualisieren
        </button>
      </header>

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
      {loading ? (
        <p className="empty-state">Systemstatus wird geladen …</p>
      ) : null}

      {!loading && overview && publicPayload ? (
        <>
          <StatusPresentation payload={publicPayload} />
          <section
            className="service-status__publication panel"
            aria-labelledby="service-status-publication-title"
          >
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Öffentliche Freigabe</p>
                <h3 id="service-status-publication-title">
                  Statusseite und SharePoint-Badge
                </h3>
              </div>
              <span
                className={
                  overview.page.publicEnabled
                    ? "service-status__publication-state service-status__publication-state--published"
                    : "service-status__publication-state"
                }
              >
                {overview.page.publicEnabled
                  ? "Veröffentlicht"
                  : "Nicht veröffentlicht"}
              </span>
            </div>
            {overview.canManagePublication ? (
              <form onSubmit={(event) => void save(event)}>
                <label>
                  Öffentliche Überschrift
                  <input
                    disabled={saving}
                    maxLength={120}
                    onChange={(event) => setTitle(event.target.value)}
                    value={title}
                  />
                </label>
                <label className="service-status__publish-toggle">
                  <input
                    checked={publicEnabled}
                    disabled={saving}
                    onChange={(event) => setPublicEnabled(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    <strong>Statusseite veröffentlichen</strong>
                    <small>
                      Erst nach dem Speichern ist die Seite für Personen mit der
                      öffentlichen Adresse sichtbar.
                    </small>
                  </span>
                </label>
                <p className="service-status__publication-actions">
                  <button
                    className="primary-button"
                    disabled={saving}
                    type="submit"
                  >
                    {saving
                      ? "Wird gespeichert …"
                      : "Veröffentlichung speichern"}
                  </button>
                  {overview.page.publicId ? (
                    <button
                      disabled={saving}
                      onClick={() => void rotatePublicId()}
                      type="button"
                    >
                      Öffentliche Adresse ersetzen
                    </button>
                  ) : null}
                </p>
              </form>
            ) : (
              <p className="service-status__permission-note">
                Für die Veröffentlichung oder das Ersetzen der Adresse ist die
                Berechtigung für Mandanteneinstellungen erforderlich.
              </p>
            )}
            {overview.page.publicEnabled &&
            pageUrl &&
            currentBadgeUrl &&
            embedCode ? (
              <div className="service-status__sharepoint">
                <h4>In SharePoint einfügen</h4>
                <p>
                  Fügen Sie die Bildadresse im SharePoint-Bild-Webpart ein und
                  verlinken Sie das Bild mit der Statusseite. nextDesk verändert
                  keine SharePoint-Seite automatisch.
                </p>
                <label>
                  Öffentliche Statusseite
                  <span className="service-status__copy-row">
                    <input readOnly value={pageUrl} />
                    <button
                      onClick={() =>
                        void copy(pageUrl, "Die Statusseitenadresse")
                      }
                      type="button"
                      aria-label="Statusseitenadresse kopieren"
                    >
                      <Copy aria-hidden="true" size={16} />
                    </button>
                    <a
                      href={pageUrl}
                      rel="noreferrer"
                      target="_blank"
                      aria-label="Öffentliche Statusseite öffnen"
                    >
                      <ExternalLink aria-hidden="true" size={16} />
                    </a>
                  </span>
                </label>
                <label>
                  SharePoint-Bildadresse (SVG-Badge)
                  <span className="service-status__copy-row">
                    <input readOnly value={currentBadgeUrl} />
                    <button
                      onClick={() =>
                        void copy(currentBadgeUrl, "Die Bildadresse")
                      }
                      type="button"
                      aria-label="SharePoint-Bildadresse kopieren"
                    >
                      <Copy aria-hidden="true" size={16} />
                    </button>
                  </span>
                </label>
                <label>
                  HTML-Fallback
                  <span className="service-status__copy-row">
                    <textarea readOnly rows={3} value={embedCode} />
                    <button
                      onClick={() => void copy(embedCode, "Der HTML-Fallback")}
                      type="button"
                      aria-label="HTML-Fallback kopieren"
                    >
                      <Copy aria-hidden="true" size={16} />
                    </button>
                  </span>
                </label>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </section>
  );
}

export function isPublicServiceStatusRequested(): string | null {
  const value = new URLSearchParams(window.location.search).get(
    "system-status",
  );
  return isUuid(value) ? value.toLowerCase() : null;
}

export function PublicServiceStatusPage({
  publicId,
}: PublicServiceStatusPageProps) {
  const [payload, setPayload] = useState<PublicStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const base = import.meta.env.VITE_SUPABASE_URL;
        if (!base) throw new Error("missing_configuration");
        const url = new URL("/functions/v1/service-status-public", base);
        url.searchParams.set("id", publicId);
        const response = await fetch(url, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("status_page_unavailable");
        const next = parsePublicStatus(await response.json());
        if (!cancelled) setPayload(next);
      } catch {
        if (!cancelled) setError("Diese Statusseite ist nicht verfügbar.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicId]);

  const style: CSSProperties | undefined =
    payload?.accentColor && /^#[0-9a-f]{6}$/i.test(payload.accentColor)
      ? ({ "--service-status-accent": payload.accentColor } as CSSProperties)
      : undefined;

  return (
    <main className="public-service-status" style={style}>
      <header className="public-service-status__masthead">
        <a href={window.location.origin} aria-label="Zu nextDesk">
          {payload?.logoUrl ? (
            <img alt={`${payload.title} Logo`} src={payload.logoUrl} />
          ) : (
            <strong>nextDesk</strong>
          )}
        </a>
        <span>Systemstatus</span>
      </header>
      <section
        className="public-service-status__content"
        aria-labelledby="public-service-status-title"
      >
        {loading ? (
          <p className="public-service-status__message">
            Systemstatus wird geladen …
          </p>
        ) : null}
        {error ? (
          <p
            className="public-service-status__message public-service-status__message--error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {payload ? (
          <>
            <header className="public-service-status__heading">
              <p className="eyebrow">Live-Übersicht</p>
              <h1 id="public-service-status-title">{payload.title}</h1>
              <p>Zuletzt aktualisiert: {dateLabel(payload.generatedAt)}</p>
            </header>
            <StatusPresentation payload={payload} publicView />
            <p className="public-service-status__footer">
              Bereitgestellt mit nextDesk
            </p>
          </>
        ) : null}
      </section>
    </main>
  );
}
