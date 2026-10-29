import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
type MaintenanceState = "scheduled" | "active" | "completed" | "cancelled";
type StatusMaintenance = {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  state: MaintenanceState;
  publicEnabled: boolean;
  serviceIds: string[];
  updatedAt: string;
};
type PublicMaintenance = {
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  state: Extract<MaintenanceState, "scheduled" | "active">;
  serviceNames: string[];
};
type MaintenanceDraft = {
  id: string | null;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  state: MaintenanceState;
  publicEnabled: boolean;
  serviceIds: string[];
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
  maintenances: StatusMaintenance[];
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
  | { type: "rotateStatusPageId"; tenantId: string }
  | {
      type: "manageMaintenance";
      operation: "create";
      tenantId: string;
      title: string;
      description: string | null;
      startsAt: string;
      endsAt: string;
      state: MaintenanceState;
      publicEnabled: boolean;
      serviceIds: string[];
    }
  | {
      type: "manageMaintenance";
      operation: "update";
      tenantId: string;
      maintenanceId: string;
      title: string;
      description: string | null;
      startsAt: string;
      endsAt: string;
      state: MaintenanceState;
      publicEnabled: boolean;
      serviceIds: string[];
    };
type PublicService = {
  displayStatus: ServiceStatus;
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
  maintenances: PublicMaintenance[];
  title: string;
};

export type ServiceStatusProps = {
  tenantId: string;
  createMaintenanceRequestId?: number | undefined;
  onCreateMaintenanceRequestConsumed?:
    ((requestId: number) => void) | undefined;
};
export type PublicServiceStatusPageProps = { publicId: string };

const MAX_SERVICES = 500;
const MAX_EVENTS = 15_000;
const MAX_MAINTENANCES = 500;
const MAX_PUBLIC_MAINTENANCES = 100;
const MAX_MAINTENANCE_SERVICES = 100;
const MAX_MAINTENANCE_TIMER_DELAY = 2_000_000_000;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i;
const ACCENT_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const HTML_ATTRIBUTE_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

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

const MAINTENANCE_STATE_LABELS: Record<MaintenanceState, string> = {
  scheduled: "Geplant",
  active: "Aktiv",
  completed: "Abgeschlossen",
  cancelled: "Abgesagt",
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

function normalizeUuid(value: unknown): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
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

function isMaintenanceState(value: unknown): value is MaintenanceState {
  return (
    value === "scheduled" ||
    value === "active" ||
    value === "completed" ||
    value === "cancelled"
  );
}

function isPublicMaintenanceState(
  value: unknown,
): value is PublicMaintenance["state"] {
  return value === "scheduled" || value === "active";
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

function isDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    isWellFormedText(value) &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    !Number.isNaN(new Date(value).getTime())
  );
}

function parseStringArray(value: unknown, maxLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxLength) return null;
  if (!value.every((item) => typeof item === "string")) return null;
  return value;
}

function parseServiceIdArray(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_MAINTENANCE_SERVICES
  ) {
    return null;
  }
  const ids = value.map(normalizeUuid);
  if (ids.some((id) => id === null)) return null;
  const normalizedIds = ids as string[];
  return new Set(normalizedIds).size === normalizedIds.length
    ? normalizedIds
    : null;
}

function isAccentColor(value: unknown): value is string {
  return typeof value === "string" && ACCENT_COLOR_PATTERN.test(value);
}

export function escapeHtmlAttribute(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => HTML_ATTRIBUTE_ESCAPES[character] ?? character,
  );
}

function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      value === url.toString()
    );
  } catch {
    return false;
  }
}

function parseService(value: unknown): StatusService | null {
  const id = isRecord(value) ? normalizeUuid(value.id) : null;
  if (
    !isRecord(value) ||
    id === null ||
    !isString(value.name, 1, 240) ||
    !isStatus(value.status) ||
    typeof value.statusPublic !== "boolean" ||
    !isDateTime(value.updatedAt)
  ) {
    return null;
  }
  return {
    id,
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
  const serviceId = isRecord(value) ? normalizeUuid(value.serviceId) : null;
  if (
    !isRecord(value) ||
    serviceId === null ||
    !serviceIds.has(serviceId) ||
    !isStatus(value.status) ||
    !isDateTime(value.changedAt)
  ) {
    return null;
  }
  return {
    serviceId,
    status: value.status,
    changedAt: value.changedAt,
  };
}

function parseMaintenance(
  value: unknown,
  serviceIds: ReadonlySet<string>,
): StatusMaintenance | null {
  const id = isRecord(value) ? normalizeUuid(value.id) : null;
  if (
    !isRecord(value) ||
    id === null ||
    !isString(value.title, 2, 180) ||
    !(value.description === null || isString(value.description, 0, 2_000)) ||
    !isDateTime(value.startsAt) ||
    !isDateTime(value.endsAt) ||
    new Date(value.startsAt).getTime() >= new Date(value.endsAt).getTime() ||
    !isMaintenanceState(value.state) ||
    typeof value.publicEnabled !== "boolean" ||
    !isDateTime(value.updatedAt)
  ) {
    return null;
  }
  const parsedServiceIds = parseServiceIdArray(value.serviceIds);
  if (
    parsedServiceIds === null ||
    !parsedServiceIds.every((serviceId) => serviceIds.has(serviceId))
  ) {
    return null;
  }
  return {
    id,
    title: value.title.trim(),
    description: value.description === null ? null : value.description.trim(),
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    state: value.state,
    publicEnabled: value.publicEnabled,
    serviceIds: parsedServiceIds,
    updatedAt: value.updatedAt,
  };
}

export function parseStatusOverview(value: unknown): StatusOverview {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("Die Serverantwort hat ein unerwartetes Format.");
  }
  const data = value.data;
  if (
    !isRecord(data.page) ||
    !Array.isArray(data.services) ||
    !Array.isArray(data.events) ||
    !Array.isArray(data.maintenances)
  ) {
    throw new Error("Die Statusdaten sind unvollständig.");
  }
  if (
    data.services.length > MAX_SERVICES ||
    data.events.length > MAX_EVENTS ||
    data.maintenances.length > MAX_MAINTENANCES
  ) {
    throw new Error("Die Statusdaten überschreiten die zulässige Grösse.");
  }
  const page = data.page;
  const publicId = page.publicId === null ? null : normalizeUuid(page.publicId);
  if (
    typeof page.publicEnabled !== "boolean" ||
    !(page.publicId === null || publicId !== null) ||
    !isString(page.title, 2, 120) ||
    !(page.updatedAt === null || isDateTime(page.updatedAt)) ||
    typeof data.canManagePublication !== "boolean"
  ) {
    throw new Error("Die Statusseite enthält ungültige Werte.");
  }
  const services = data.services.map(parseService);
  if (services.some((service) => service === null)) {
    throw new Error("Die Serviceliste enthält ungültige Werte.");
  }
  const parsedServices = services.filter(
    (service): service is StatusService => service !== null,
  );
  const serviceIds = new Set(parsedServices.map((service) => service.id));
  if (serviceIds.size !== parsedServices.length) {
    throw new Error("Die Serviceliste enthält ungültige Werte.");
  }
  const events = data.events.map((event) => parseEvent(event, serviceIds));
  if (events.some((event) => event === null)) {
    throw new Error("Der Statusverlauf enthält ungültige Werte.");
  }
  const parsedEvents = events.filter(
    (event): event is StatusEvent => event !== null,
  );
  const maintenances = data.maintenances.map((maintenance) =>
    parseMaintenance(maintenance, serviceIds),
  );
  if (maintenances.some((maintenance) => maintenance === null)) {
    throw new Error("Die Wartungsliste enthält ungültige Werte.");
  }
  const parsedMaintenances = maintenances.filter(
    (maintenance): maintenance is StatusMaintenance => maintenance !== null,
  );
  if (
    new Set(parsedMaintenances.map((maintenance) => maintenance.id)).size !==
    parsedMaintenances.length
  ) {
    throw new Error("Die Wartungsliste enthält ungültige Werte.");
  }
  return {
    canManagePublication: data.canManagePublication,
    events: parsedEvents,
    maintenances: parsedMaintenances,
    page: {
      publicEnabled: page.publicEnabled,
      publicId,
      title: page.title.trim(),
      updatedAt: page.updatedAt,
    },
    services: parsedServices,
  };
}

function parsePublicService(value: unknown): PublicService | null {
  if (
    !isRecord(value) ||
    !isString(value.name, 1, 240) ||
    !isStatus(value.status) ||
    !isStatus(value.displayStatus) ||
    !isDateTime(value.updatedAt) ||
    !Array.isArray(value.history)
  ) {
    return null;
  }
  const history = value.history.map((item) => {
    if (
      !isRecord(item) ||
      !isStatus(item.status) ||
      !isDateTime(item.changedAt)
    ) {
      return null;
    }
    return { changedAt: item.changedAt, status: item.status };
  });
  if (history.some((item) => item === null)) return null;
  return {
    displayStatus: value.displayStatus,
    history: history as Array<{ changedAt: string; status: ServiceStatus }>,
    name: value.name.trim(),
    status: value.status,
    updatedAt: value.updatedAt,
  };
}

function parsePublicMaintenance(value: unknown): PublicMaintenance | null {
  if (
    !isRecord(value) ||
    !isString(value.title, 2, 180) ||
    !(value.description === null || isString(value.description, 0, 2_000)) ||
    !isDateTime(value.startsAt) ||
    !isDateTime(value.endsAt) ||
    new Date(value.startsAt).getTime() >= new Date(value.endsAt).getTime() ||
    !isPublicMaintenanceState(value.state)
  ) {
    return null;
  }
  const serviceNames = parseStringArray(
    value.serviceNames,
    MAX_MAINTENANCE_SERVICES,
  );
  if (
    serviceNames === null ||
    serviceNames.length < 1 ||
    !serviceNames.every((name) => isString(name, 1, 240))
  ) {
    return null;
  }
  return {
    title: value.title.trim(),
    description: value.description === null ? null : value.description.trim(),
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    state: value.state,
    serviceNames: serviceNames.map((name) => name.trim()),
  };
}

export function parsePublicServiceStatus(value: unknown): PublicStatusPayload {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("Die Statusseite ist nicht verfügbar.");
  }
  const data = value.data;
  if (
    !isString(data.title, 2, 120) ||
    !isStatus(data.overallStatus) ||
    !Array.isArray(data.services) ||
    !Array.isArray(data.maintenances) ||
    !(data.accentColor === null || isAccentColor(data.accentColor)) ||
    !(data.logoUrl === null || isSafeHttpsUrl(data.logoUrl)) ||
    !isDateTime(data.generatedAt)
  ) {
    throw new Error("Die Statusseite ist nicht verfügbar.");
  }
  if (
    data.services.length > MAX_SERVICES ||
    data.maintenances.length > MAX_PUBLIC_MAINTENANCES
  ) {
    throw new Error("Die Statusseite ist nicht verfügbar.");
  }
  const services = data.services.map(parsePublicService);
  if (services.some((service) => service === null)) {
    throw new Error("Die Statusseite ist nicht verfügbar.");
  }
  const maintenances = data.maintenances.map(parsePublicMaintenance);
  if (maintenances.some((maintenance) => maintenance === null)) {
    throw new Error("Die Statusseite ist nicht verfügbar.");
  }
  return {
    accentColor: data.accentColor,
    generatedAt: data.generatedAt,
    logoUrl: data.logoUrl,
    overallStatus: data.overallStatus,
    services: services.filter(
      (service): service is PublicService => service !== null,
    ),
    maintenances: maintenances.filter(
      (maintenance): maintenance is PublicMaintenance => maintenance !== null,
    ),
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

export function isCurrentMaintenance(
  maintenance: Pick<StatusMaintenance, "startsAt" | "endsAt" | "state">,
  now: number,
): boolean {
  return (
    (maintenance.state === "scheduled" || maintenance.state === "active") &&
    Date.parse(maintenance.startsAt) <= now &&
    Date.parse(maintenance.endsAt) > now
  );
}

function activeMaintenanceServiceIds(
  maintenances: readonly StatusMaintenance[],
  now: number,
): ReadonlySet<string> {
  const serviceIds = new Set<string>();
  for (const maintenance of maintenances) {
    if (!isCurrentMaintenance(maintenance, now)) continue;
    for (const serviceId of maintenance.serviceIds) serviceIds.add(serviceId);
  }
  return serviceIds;
}

export function displayOverallStatus(
  services: readonly Pick<PublicService, "displayStatus" | "status">[],
): ServiceStatus {
  const storedStatus = overallStatus(services);
  // An explicitly recorded incident remains authoritative over a planned
  // maintenance window; the affected service still displays the maintenance
  // state, but an independent degradation or outage is never hidden globally.
  if (statusSeverity(storedStatus) >= statusSeverity("degraded")) {
    return storedStatus;
  }
  return services.reduce<ServiceStatus>(
    (current, service) =>
      statusSeverity(service.displayStatus) > statusSeverity(current)
        ? service.displayStatus
        : current,
    "operational",
  );
}

export function nextMaintenanceTransition(
  maintenances: readonly Pick<
    StatusMaintenance,
    "startsAt" | "endsAt" | "state"
  >[],
  now: number,
): number | null {
  const transitions = maintenances
    .filter(
      (maintenance) =>
        maintenance.state === "scheduled" || maintenance.state === "active",
    )
    .flatMap((maintenance) => [
      Date.parse(maintenance.startsAt),
      Date.parse(maintenance.endsAt),
    ])
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > now);
  return transitions.length > 0 ? Math.min(...transitions) : null;
}

export function maintenanceRefreshDelay(
  nextTransition: number | null,
  now: number,
): number | null {
  if (nextTransition === null) return null;
  return Math.min(
    MAX_MAINTENANCE_TIMER_DELAY,
    Math.max(1, nextTransition - now),
  );
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unbekannt"
    : new Intl.DateTimeFormat("de-CH", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Zurich",
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

export function sharePointIframeEmbedCode(
  pageUrl: string,
  title: string,
): string {
  return `<iframe src="${escapeHtmlAttribute(pageUrl)}" title="Systemstatus: ${escapeHtmlAttribute(title)}" loading="lazy" width="100%" height="720" style="border: 0;"></iframe>`;
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
  const currentStatus = payload.overallStatus;
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
                <StatusPill status={service.displayStatus} />
              </div>
              <AvailabilityLine service={service} />
            </article>
          ))}
        </section>
      )}
    </>
  );
}

function MaintenanceStatePill({ state }: { state: MaintenanceState }) {
  return (
    <span
      className={`service-status__maintenance-state service-status__maintenance-state--${state}`}
    >
      {MAINTENANCE_STATE_LABELS[state]}
    </span>
  );
}

function MaintenancePeriod({
  startsAt,
  endsAt,
}: Pick<StatusMaintenance, "startsAt" | "endsAt">) {
  return (
    <p className="service-status__maintenance-period">
      <time dateTime={startsAt}>{dateLabel(startsAt)}</time>
      <span aria-hidden="true"> bis </span>
      <time dateTime={endsAt}>{dateLabel(endsAt)}</time>
    </p>
  );
}

function sortMaintenances(
  maintenances: readonly StatusMaintenance[],
): StatusMaintenance[] {
  return [...maintenances].sort(
    (left, right) =>
      new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
  );
}

function MaintenanceList({
  maintenances,
  services,
  canManagePublication,
  onEdit,
}: {
  maintenances: readonly StatusMaintenance[];
  services: readonly StatusService[];
  canManagePublication: boolean;
  onEdit: (maintenance: StatusMaintenance) => void;
}) {
  const serviceNames = new Map(
    services.map((service) => [service.id, service.name]),
  );
  const groups = [
    {
      id: "active",
      title: "Aktive Wartungen",
      maintenances: sortMaintenances(
        maintenances.filter((maintenance) => maintenance.state === "active"),
      ),
    },
    {
      id: "scheduled",
      title: "Geplante Wartungen",
      maintenances: sortMaintenances(
        maintenances.filter((maintenance) => maintenance.state === "scheduled"),
      ),
    },
    {
      id: "past",
      title: "Vergangene und abgeschlossene Wartungen",
      maintenances: sortMaintenances(
        maintenances.filter(
          (maintenance) =>
            maintenance.state === "completed" ||
            maintenance.state === "cancelled",
        ),
      ),
    },
  ];

  return (
    <section
      className="service-status__maintenances"
      aria-labelledby="service-status-maintenance-title"
    >
      <header className="service-status__maintenance-heading">
        <div>
          <p className="eyebrow">Serviceplanung</p>
          <h3 id="service-status-maintenance-title">Wartungen</h3>
          <p>
            Erfassen Sie geplante Arbeiten transparent. Zustandswechsel und
            Veröffentlichungen erfolgen nur nach Ihrer expliziten Eingabe.
          </p>
        </div>
      </header>
      {maintenances.length === 0 ? (
        <p className="service-status__empty">
          Es sind noch keine Wartungen erfasst.
        </p>
      ) : (
        <div className="service-status__maintenance-groups">
          {groups.map((group) =>
            group.maintenances.length > 0 ? (
              <section
                aria-labelledby={`service-status-maintenance-${group.id}`}
                className="service-status__maintenance-group"
                key={group.id}
              >
                <h4 id={`service-status-maintenance-${group.id}`}>
                  {group.title}
                </h4>
                <div className="service-status__maintenance-list">
                  {group.maintenances.map((maintenance) => {
                    const affectedServices = maintenance.serviceIds.map(
                      (serviceId) =>
                        serviceNames.get(serviceId) ?? "Unbekannter Service",
                    );
                    return (
                      <article key={maintenance.id}>
                        <div className="service-status__maintenance-card-heading">
                          <div>
                            <h5>{maintenance.title}</h5>
                            <MaintenancePeriod
                              endsAt={maintenance.endsAt}
                              startsAt={maintenance.startsAt}
                            />
                          </div>
                          <MaintenanceStatePill state={maintenance.state} />
                        </div>
                        {maintenance.description ? (
                          <p className="service-status__maintenance-description">
                            {maintenance.description}
                          </p>
                        ) : null}
                        <dl className="service-status__maintenance-details">
                          <div>
                            <dt>Betroffene Services</dt>
                            <dd>
                              {affectedServices.length > 0
                                ? affectedServices.join(", ")
                                : "Keine Services zugeordnet"}
                            </dd>
                          </div>
                          <div>
                            <dt>Veröffentlichung</dt>
                            <dd>
                              {maintenance.publicEnabled
                                ? "Öffentlich veröffentlicht"
                                : "Nur intern"}
                            </dd>
                          </div>
                        </dl>
                        <p className="service-status__maintenance-actions">
                          <button
                            disabled={
                              maintenance.publicEnabled && !canManagePublication
                            }
                            onClick={() => onEdit(maintenance)}
                            type="button"
                          >
                            Wartung bearbeiten
                          </button>
                        </p>
                        {maintenance.publicEnabled && !canManagePublication ? (
                          <p className="service-status__maintenance-access-note">
                            Für Änderungen an einer öffentlichen Wartung ist die
                            Berechtigung für Mandanteneinstellungen
                            erforderlich.
                          </p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null,
          )}
        </div>
      )}
    </section>
  );
}

function PublicMaintenanceList({
  maintenances,
}: {
  maintenances: readonly PublicMaintenance[];
}) {
  if (maintenances.length === 0) return null;
  return (
    <section
      aria-labelledby="public-service-status-maintenance-title"
      className="public-service-status__maintenances"
    >
      <header>
        <p className="eyebrow">Vorausschau</p>
        <h2 id="public-service-status-maintenance-title">Geplante Wartungen</h2>
      </header>
      <div className="public-service-status__maintenance-list">
        {maintenances.map((maintenance, index) => (
          <article
            key={`${maintenance.title}-${maintenance.startsAt}-${maintenance.endsAt}-${index}`}
          >
            <div className="public-service-status__maintenance-heading">
              <h3>{maintenance.title}</h3>
              <MaintenanceStatePill state={maintenance.state} />
            </div>
            <MaintenancePeriod
              endsAt={maintenance.endsAt}
              startsAt={maintenance.startsAt}
            />
            {maintenance.description ? <p>{maintenance.description}</p> : null}
            {maintenance.serviceNames.length > 0 ? (
              <p className="public-service-status__maintenance-services">
                Betroffene Services: {maintenance.serviceNames.join(", ")}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function toDateTimeLocal(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localDateTimeToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function MaintenanceEditorDialog({
  draft,
  services,
  canManagePublication,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  draft: MaintenanceDraft;
  services: readonly StatusService[];
  canManagePublication: boolean;
  saving: boolean;
  onChange: (next: MaintenanceDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const titleRef = useRef<HTMLInputElement>(null);
  const selectedServiceIds = new Set(draft.serviceIds);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);

  return (
    <div
      aria-labelledby="service-status-maintenance-dialog-title"
      aria-modal="true"
      className="service-status__maintenance-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !saving) onClose();
      }}
      role="dialog"
    >
      <section className="service-status__maintenance-dialog">
        <header>
          <div>
            <p className="eyebrow">Serviceplanung</p>
            <h3 id="service-status-maintenance-dialog-title">
              {draft.id ? "Wartung bearbeiten" : "Wartung erfassen"}
            </h3>
          </div>
          <button disabled={saving} onClick={onClose} type="button">
            Schliessen
          </button>
        </header>
        <form onSubmit={onSubmit}>
          <label>
            Titel
            <input
              disabled={saving}
              maxLength={180}
              onChange={(event) =>
                onChange({ ...draft, title: event.target.value })
              }
              ref={titleRef}
              required
              value={draft.title}
            />
          </label>
          <label>
            Beschreibung <span className="sr-only">(optional)</span>
            <textarea
              disabled={saving}
              maxLength={2_000}
              onChange={(event) =>
                onChange({ ...draft, description: event.target.value })
              }
              rows={4}
              value={draft.description}
            />
          </label>
          <div className="service-status__maintenance-date-fields">
            <label>
              Beginn
              <input
                disabled={saving}
                onChange={(event) =>
                  onChange({ ...draft, startsAt: event.target.value })
                }
                required
                type="datetime-local"
                value={draft.startsAt}
              />
            </label>
            <label>
              Ende
              <input
                disabled={saving}
                onChange={(event) =>
                  onChange({ ...draft, endsAt: event.target.value })
                }
                required
                type="datetime-local"
                value={draft.endsAt}
              />
            </label>
          </div>
          <label>
            Zustand
            <select
              disabled={saving}
              onChange={(event) => {
                if (isMaintenanceState(event.target.value)) {
                  onChange({ ...draft, state: event.target.value });
                }
              }}
              value={draft.state}
            >
              {(
                Object.keys(MAINTENANCE_STATE_LABELS) as MaintenanceState[]
              ).map((state) => (
                <option key={state} value={state}>
                  {MAINTENANCE_STATE_LABELS[state]}
                </option>
              ))}
            </select>
            <small className="service-status__maintenance-field-note">
              Der Zustand wird nicht automatisch geändert.
            </small>
          </label>
          <fieldset className="service-status__maintenance-services">
            <legend>Betroffene Services</legend>
            <p id="service-status-maintenance-services-help">
              Wählen Sie ausschliesslich Services aus, die in dieser Übersicht
              bereits serverautorisiert geladen wurden.
            </p>
            <div>
              {services.map((service) => {
                const selected = selectedServiceIds.has(service.id);
                const unavailableForPublic =
                  draft.publicEnabled && !service.statusPublic;
                return (
                  <label
                    className={
                      unavailableForPublic
                        ? "service-status__maintenance-service-option service-status__maintenance-service-option--disabled"
                        : "service-status__maintenance-service-option"
                    }
                    key={service.id}
                  >
                    <input
                      aria-describedby="service-status-maintenance-services-help"
                      checked={selected}
                      disabled={saving || (unavailableForPublic && !selected)}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          serviceIds: event.target.checked
                            ? [...draft.serviceIds, service.id]
                            : draft.serviceIds.filter(
                                (id) => id !== service.id,
                              ),
                        })
                      }
                      type="checkbox"
                    />
                    <span>
                      <strong>{service.name}</strong>
                      <small>
                        {service.statusPublic
                          ? "Für die öffentliche Statusseite freigegeben"
                          : "Nur intern"}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <label className="service-status__publish-toggle">
            <input
              checked={draft.publicEnabled}
              disabled={saving || !canManagePublication}
              onChange={(event) =>
                onChange({
                  ...draft,
                  publicEnabled: event.target.checked,
                  serviceIds: event.target.checked
                    ? draft.serviceIds.filter((serviceId) =>
                        services.some(
                          (service) =>
                            service.id === serviceId && service.statusPublic,
                        ),
                      )
                    : draft.serviceIds,
                })
              }
              type="checkbox"
            />
            <span>
              <strong>Öffentlich veröffentlichen</strong>
              <small>
                {canManagePublication
                  ? "Öffentliche Wartungen dürfen nur bereits veröffentlichte Services betreffen. Die Auswahl wird beim Aktivieren geprüft."
                  : "Ohne Berechtigung zur Veröffentlichung bleibt diese Wartung intern."}
              </small>
            </span>
          </label>
          <p className="service-status__maintenance-form-actions">
            <button disabled={saving} type="submit" className="primary-button">
              {saving
                ? "Wird gespeichert …"
                : draft.id
                  ? "Wartung speichern"
                  : "Wartung erfassen"}
            </button>
            <button disabled={saving} onClick={onClose} type="button">
              Abbrechen
            </button>
          </p>
        </form>
      </section>
    </div>
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
  return parseStatusOverview(data);
}

function internalToPublicPayload(
  overview: StatusOverview,
  now = Date.now(),
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
  const maintenanceServiceIds = activeMaintenanceServiceIds(
    overview.maintenances,
    now,
  );
  const services = overview.services
    .filter((service) => service.statusPublic)
    .map((service) => ({
      displayStatus: maintenanceServiceIds.has(service.id)
        ? "maintenance"
        : service.status,
      history: eventsByService.get(service.id) ?? [],
      name: service.name,
      status: service.status,
      updatedAt: service.updatedAt,
    }));
  const publicServiceNames = new Map(
    overview.services
      .filter((service) => service.statusPublic)
      .map((service) => [service.id, service.name]),
  );
  const maintenances: PublicMaintenance[] = overview.maintenances
    .filter(
      (
        maintenance,
      ): maintenance is StatusMaintenance & {
        state: PublicMaintenance["state"];
      } =>
        maintenance.publicEnabled &&
        (maintenance.state === "scheduled" || maintenance.state === "active"),
    )
    .map((maintenance) => ({
      title: maintenance.title,
      description: maintenance.description,
      startsAt: maintenance.startsAt,
      endsAt: maintenance.endsAt,
      state: maintenance.state,
      serviceNames: maintenance.serviceIds.flatMap(
        (serviceId) => publicServiceNames.get(serviceId) ?? [],
      ),
    }));
  return {
    accentColor: null,
    generatedAt: new Date().toISOString(),
    logoUrl: null,
    overallStatus: displayOverallStatus(services),
    services,
    maintenances,
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

export function ServiceStatus({
  tenantId,
  createMaintenanceRequestId,
  onCreateMaintenanceRequestConsumed,
}: ServiceStatusProps) {
  const [overview, setOverview] = useState<StatusOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [maintenanceSaving, setMaintenanceSaving] = useState(false);
  const [maintenanceDraft, setMaintenanceDraft] =
    useState<MaintenanceDraft | null>(null);
  const [title, setTitle] = useState("Systemstatus");
  const [publicEnabled, setPublicEnabled] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [statusClock, setStatusClock] = useState(() => Date.now());
  const lastMaintenanceCreateRequestId = useRef<number | undefined>(undefined);

  function applyOverview(next: StatusOverview) {
    setOverview(next);
    setTitle(next.page.title);
    setPublicEnabled(next.page.publicEnabled);
    setStatusClock(Date.now());
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await requestStatus({ type: "getStatusOverview", tenantId });
      applyOverview(next);
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

  useEffect(() => {
    if (!overview) return;
    const nextTransition = nextMaintenanceTransition(
      overview.maintenances,
      statusClock,
    );
    const delay = maintenanceRefreshDelay(nextTransition, Date.now());
    if (delay === null) return;
    const timer = window.setTimeout(() => setStatusClock(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [overview, statusClock]);

  const publicPayload = useMemo(
    () => (overview ? internalToPublicPayload(overview, statusClock) : null),
    [overview, statusClock],
  );
  const pageUrl = overview?.page.publicId
    ? publicPageUrl(overview.page.publicId)
    : null;
  const currentBadgeUrl = overview?.page.publicId
    ? badgeUrl(overview.page.publicId)
    : null;
  const embedCode =
    pageUrl && currentBadgeUrl
      ? `<a href="${pageUrl}"><img src="${currentBadgeUrl}" alt="Systemstatus von ${escapeHtmlAttribute(overview?.page.title ?? "nextDesk")}"></a>`
      : null;
  const iframeEmbedCode = pageUrl
    ? sharePointIframeEmbedCode(pageUrl, overview?.page.title ?? "nextDesk")
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
      applyOverview(next);
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
      applyOverview(next);
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

  function openMaintenanceEditor(maintenance?: StatusMaintenance) {
    if (!overview) return;
    if (maintenance?.publicEnabled && !overview.canManagePublication) {
      setError(
        "Für Änderungen an einer öffentlichen Wartung fehlt die Berechtigung.",
      );
      return;
    }
    setError("");
    setNotice("");
    if (maintenance) {
      setMaintenanceDraft({
        id: maintenance.id,
        title: maintenance.title,
        description: maintenance.description ?? "",
        startsAt: toDateTimeLocal(maintenance.startsAt),
        endsAt: toDateTimeLocal(maintenance.endsAt),
        state: maintenance.state,
        publicEnabled: maintenance.publicEnabled,
        serviceIds: maintenance.serviceIds,
      });
      return;
    }
    const startsAt = new Date();
    startsAt.setMinutes(0, 0, 0);
    startsAt.setHours(startsAt.getHours() + 1);
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
    setMaintenanceDraft({
      id: null,
      title: "",
      description: "",
      startsAt: toDateTimeLocal(startsAt),
      endsAt: toDateTimeLocal(endsAt),
      state: "scheduled",
      publicEnabled: false,
      serviceIds: [],
    });
  }

  useEffect(() => {
    if (
      createMaintenanceRequestId === undefined ||
      lastMaintenanceCreateRequestId.current === createMaintenanceRequestId ||
      !overview
    ) {
      return;
    }
    lastMaintenanceCreateRequestId.current = createMaintenanceRequestId;
    openMaintenanceEditor();
    onCreateMaintenanceRequestConsumed?.(createMaintenanceRequestId);
  }, [
    createMaintenanceRequestId,
    onCreateMaintenanceRequestConsumed,
    overview,
  ]);

  async function saveMaintenance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!overview || !maintenanceDraft) return;

    const title = maintenanceDraft.title.trim();
    const description = maintenanceDraft.description.trim();
    const startsAt = localDateTimeToIso(maintenanceDraft.startsAt);
    const endsAt = localDateTimeToIso(maintenanceDraft.endsAt);
    const knownServiceIds = new Set(
      overview.services.map((service) => service.id),
    );
    const selectedServices = new Set(maintenanceDraft.serviceIds);

    if (!isString(title, 2, 180)) {
      setError("Der Wartungstitel muss zwischen 2 und 180 Zeichen enthalten.");
      return;
    }
    if (!isString(description, 0, 2_000)) {
      setError("Die Beschreibung darf höchstens 2000 Zeichen enthalten.");
      return;
    }
    if (
      startsAt === null ||
      endsAt === null ||
      new Date(startsAt).getTime() >= new Date(endsAt).getTime()
    ) {
      setError("Das Ende der Wartung muss nach ihrem Beginn liegen.");
      return;
    }
    if (
      maintenanceDraft.serviceIds.length < 1 ||
      selectedServices.size !== maintenanceDraft.serviceIds.length ||
      !maintenanceDraft.serviceIds.every((serviceId) =>
        knownServiceIds.has(serviceId),
      )
    ) {
      setError(
        maintenanceDraft.serviceIds.length < 1
          ? "Wählen Sie mindestens einen betroffenen Service aus."
          : "Die ausgewählten Services sind nicht mehr verfügbar.",
      );
      return;
    }
    if (maintenanceDraft.publicEnabled && !overview.canManagePublication) {
      setError("Für die öffentliche Veröffentlichung fehlt die Berechtigung.");
      return;
    }
    if (
      maintenanceDraft.publicEnabled &&
      maintenanceDraft.serviceIds.some(
        (serviceId) =>
          !overview.services.find((service) => service.id === serviceId)
            ?.statusPublic,
      )
    ) {
      setError(
        "Öffentliche Wartungen dürfen nur veröffentlichte Services betreffen.",
      );
      return;
    }

    setMaintenanceSaving(true);
    setError("");
    setNotice("");
    try {
      const action: StatusAction = maintenanceDraft.id
        ? {
            type: "manageMaintenance",
            operation: "update",
            tenantId,
            maintenanceId: maintenanceDraft.id,
            title,
            description: description || null,
            startsAt,
            endsAt,
            state: maintenanceDraft.state,
            publicEnabled: maintenanceDraft.publicEnabled,
            serviceIds: maintenanceDraft.serviceIds,
          }
        : {
            type: "manageMaintenance",
            operation: "create",
            tenantId,
            title,
            description: description || null,
            startsAt,
            endsAt,
            state: maintenanceDraft.state,
            publicEnabled: maintenanceDraft.publicEnabled,
            serviceIds: maintenanceDraft.serviceIds,
          };
      const next = await requestStatus(action);
      applyOverview(next);
      setMaintenanceDraft(null);
      setNotice(
        action.operation === "create"
          ? "Die Wartung wurde erfasst."
          : "Die Wartung wurde gespeichert.",
      );
    } catch (nextError) {
      setError(
        await errorMessage(
          nextError,
          "Die Wartung konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setMaintenanceSaving(false);
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
          disabled={loading || saving || maintenanceSaving}
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
          <MaintenanceList
            canManagePublication={overview.canManagePublication}
            maintenances={overview.maintenances}
            onEdit={openMaintenanceEditor}
            services={overview.services}
          />
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
            embedCode &&
            iframeEmbedCode ? (
              <div className="service-status__sharepoint">
                <h4>In SharePoint einfügen</h4>
                <p>
                  Für den Bild-Webpart verwenden Sie die Bildadresse und
                  verlinken das Badge mit der Statusseite. Für das
                  Einbetten-Webpart steht der iFrame-Code bereit. nextDesk
                  verändert keine SharePoint-Seite automatisch.
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
                  SharePoint-iFrame-Einbettung
                  <span className="service-status__copy-row">
                    <textarea readOnly rows={3} value={iframeEmbedCode} />
                    <button
                      onClick={() =>
                        void copy(iframeEmbedCode, "Der SharePoint-iFrame-Code")
                      }
                      type="button"
                      aria-label="SharePoint-iFrame-Code kopieren"
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
          {maintenanceDraft ? (
            <MaintenanceEditorDialog
              canManagePublication={overview.canManagePublication}
              draft={maintenanceDraft}
              onChange={setMaintenanceDraft}
              onClose={() => {
                if (!maintenanceSaving) setMaintenanceDraft(null);
              }}
              onSubmit={(event) => void saveMaintenance(event)}
              saving={maintenanceSaving}
              services={overview.services}
            />
          ) : null}
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
  const publicLoadAbortController = useRef<AbortController | null>(null);
  const publicLoadRequestId = useRef(0);

  const load = useCallback(async () => {
    publicLoadAbortController.current?.abort();
    const abortController = new AbortController();
    publicLoadAbortController.current = abortController;
    const requestId = publicLoadRequestId.current + 1;
    publicLoadRequestId.current = requestId;
    setLoading(true);
    setError("");
    try {
      const base = import.meta.env.VITE_SUPABASE_URL;
      if (!base) throw new Error("missing_configuration");
      const url = new URL("/functions/v1/service-status-public", base);
      url.searchParams.set("id", publicId);
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: abortController.signal,
      });
      if (!response.ok) throw new Error("status_page_unavailable");
      const next = parsePublicServiceStatus(await response.json());
      if (
        !abortController.signal.aborted &&
        publicLoadRequestId.current === requestId
      ) {
        setPayload(next);
      }
    } catch {
      if (
        !abortController.signal.aborted &&
        publicLoadRequestId.current === requestId
      ) {
        setError("Diese Statusseite ist nicht verfügbar.");
      }
    } finally {
      if (publicLoadRequestId.current === requestId) setLoading(false);
    }
  }, [publicId]);

  useEffect(() => {
    void load();
    return () => {
      publicLoadRequestId.current += 1;
      publicLoadAbortController.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    if (!payload) return;
    const nextTransition = nextMaintenanceTransition(
      payload.maintenances,
      Date.now(),
    );
    const delay = maintenanceRefreshDelay(nextTransition, Date.now());
    if (delay === null) return;
    const timer = window.setTimeout(() => void load(), delay);
    return () => window.clearTimeout(timer);
  }, [load, payload]);

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
            <PublicMaintenanceList maintenances={payload.maintenances} />
            <p className="public-service-status__footer">
              Bereitgestellt mit nextDesk
            </p>
          </>
        ) : null}
      </section>
    </main>
  );
}
