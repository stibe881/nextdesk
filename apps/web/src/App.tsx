import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  AtSign,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BadgeCheck,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarClock,
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardList,
  CircleCheck,
  CircleEllipsis,
  FileWarning,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Minus,
  MonitorCog,
  Plus,
  Settings,
  SlidersHorizontal,
  Ticket,
  UserRound,
  Boxes,
  X,
  type LucideIcon,
} from "lucide-react";
import { productDefaults } from "@nextdesk/config";
import {
  activityItems,
  dashboardComparisonWindow,
  dashboardTickets,
  dashboardTrendFromComparison,
  previewMetrics,
  serviceHealth,
  type DashboardMetricTrend,
  type DashboardMetricTrends,
  type DashboardMetrics,
  type DashboardTicket,
  type Period,
  type ServiceHealth,
  type TimelineItem,
} from "./dashboard-data";
import {
  loadActiveTenants,
  loadLiveDashboard,
  loadProfileName,
  type LiveDashboardSnapshot,
  type TicketAgentOption,
  type TicketFilterCatalog,
  type TenantOption,
} from "./lib/live-dashboard";
import { acceptTenantInvitations } from "./lib/tenant-invitations";
import { TicketComposer } from "./ticket-composer";
import { TicketCsvExport } from "./ticket-csv-export";
import { TicketCsvImport } from "./ticket-csv-import";
import { TicketDetail } from "./ticket-detail";
import { TenantAdminSettings } from "./tenant-admin-settings";
import { KnowledgeBase } from "./knowledge-base";
import { GlobalSearch, type GlobalSearchResult } from "./global-search";
import { ServiceReporting } from "./service-reporting";
import { ServiceAssets } from "./service-assets";
import { EventSpaces } from "./event-spaces";
import { Onboarding } from "./onboarding";
import { PersonalSettings } from "./personal-settings";
import { ExperienceWorkspace, MyDayCard } from "./experience-workspace";
import {
  activeIncidentNoticesFromResponse,
  AgentMetricsCard,
  AgentWorkbenchPanel,
  IncidentBanner,
  type ActiveIncidentNotice,
  type TeamQueue,
} from "./agent-workbench";
import { RequesterPortalPanel } from "./requester-portal";
import { IntroTip } from "./intro-tips";
import {
  OwnerConsoleScreen,
  resolveOwnerAccess,
  type OwnerAccess,
} from "./platform-owner";
import { functionErrorMessage } from "./lib/function-error";
import {
  bootstrapBrowserAuthSession,
  cleanBrowserAuthCallbackUrl,
  createBrowserAuthSessionGate,
  hasBrowserAuthCallback,
} from "./lib/auth-callback";
import { resolveTenantSsoAccess } from "./lib/tenant-sso-access";
import {
  parseTicketSearch,
  removeTicketSearchClause,
} from "./lib/ticket-search";
import { pageViewOptionsForSection } from "./lib/page-view-options";
import {
  quickCreateActionsForContext,
  quickCreateRequestMatchesTenant,
  type QuickCreateAction,
} from "./lib/quick-create-actions";
import {
  canRequesterOpenSection,
  requesterNavigationSections,
} from "./lib/requester-navigation";
import {
  isWorkplaceAvailable,
  isWorkspaceNavigationReady,
  migrateWorkplaceStartSection,
  requestedWorkplaceViewForFollowUps,
  type WorkplaceRequestedView,
} from "./lib/workplace-navigation";
import { appRedirectUrl, isSupabaseConfigured, supabase } from "./lib/supabase";

type Section =
  | "Übersicht"
  | "Tickets"
  | "Arbeitsplatz"
  | "Erwähnungen"
  | "Mein Portal"
  | "Services"
  | "Assets"
  | "Fälle"
  | "Veranstaltungsräume"
  | "Eintritte"
  | "Wissen"
  | "Berichte"
  | "Einstellungen";
type TicketScope = "all" | "mine" | "unassigned" | "open" | "closed";
type MetricTicketFilter = {
  label: string;
  ticketIds: string[];
};
type TicketListDensity = "compact" | "standard" | "comfortable";
type WorkspaceTheme = "light" | "dark" | "system";
type WorkspacePreferences = {
  density: TicketListDensity;
  highContrast: boolean;
  reduceMotion: boolean;
  startSection: Section;
  startWorkplaceView: WorkplaceRequestedView | null;
  ticketSplitView: boolean;
  theme: WorkspaceTheme;
};
type QuickCreateRequest = {
  action: Exclude<QuickCreateAction, "ticket">;
  id: number;
  tenantId: string;
};

const quickCreateActionPresentation: Record<
  QuickCreateAction,
  { Icon: LucideIcon; label: string }
> = {
  ticket: { Icon: Ticket, label: "Ticket erfassen" },
  problem: { Icon: FileWarning, label: "Fall erfassen" },
  followUp: { Icon: CalendarClock, label: "Wiedervorlage erfassen" },
  knowledge: { Icon: BookOpen, label: "Wissensartikel erfassen" },
};

type DashboardView = {
  activity: readonly TimelineItem[];
  hasMoreTickets: boolean;
  metrics: DashboardMetrics;
  serviceHealth: readonly ServiceHealth[];
  ticketCount: number;
  ticketAgents?: readonly TicketAgentOption[];
  ticketFilterCatalog?: TicketFilterCatalog;
  ticketListNote?: string;
  tickets: readonly DashboardTicket[];
  updatedAt: string;
};

type NotificationTicketReference = {
  id: string;
  ticketNumber: string;
  subject?: string;
};

type NotificationItem = {
  createdAt: string;
  id: string;
  kind: string;
  payload: unknown;
  readAt: string | null;
  ticket: NotificationTicketReference | null;
};

type TicketSortBy = "updated" | "agent" | "status" | "department" | "priority";
type TicketSortDirection = "asc" | "desc";
type SavedTicketViewFilters = {
  agent: string;
  department: string;
  priority: string;
  query: string;
  queue: string;
  sortBy: TicketSortBy;
  sortDirection: TicketSortDirection;
  status: string;
  ticketScope: TicketScope;
};
type TicketListRefinement = Pick<
  SavedTicketViewFilters,
  "agent" | "department" | "priority" | "sortBy" | "sortDirection" | "status"
>;

type SavedTicketView = {
  createdAt: string;
  filters: SavedTicketViewFilters;
  id: string;
  name: string;
  ownerId: string;
  updatedAt: string;
  visibility: "private" | "tenant";
};

type BulkStatusOption = {
  isClosed: boolean;
  key: string;
  label: string;
};

type TenantTicketAccess = {
  canWorkTickets: boolean;
  isTenantAdmin: boolean;
};

type TenantFeatureFlag = {
  defaultEnabled: boolean;
  enabled: boolean;
  key: string;
};

type TenantWorkspaceBranding = {
  accentColor: string | null;
  logoUrl: string | null;
  portalName: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  tenantId: string;
};

const sections: readonly { label: Section; Icon: LucideIcon }[] = [
  { label: "Übersicht", Icon: LayoutDashboard },
  { label: "Tickets", Icon: Ticket },
  { label: "Fälle", Icon: FileWarning },
  { label: "Arbeitsplatz", Icon: BriefcaseBusiness },
  { label: "Services", Icon: MonitorCog },
  { label: "Assets", Icon: Boxes },
  { label: "Veranstaltungsräume", Icon: CalendarDays },
  { label: "Eintritte", Icon: ClipboardList },
  { label: "Wissen", Icon: BookOpen },
  { label: "Mein Portal", Icon: UserRound },
  { label: "Berichte", Icon: ChartNoAxesCombined },
];

const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  density: "standard",
  highContrast: false,
  reduceMotion: false,
  startSection: "Übersicht",
  startWorkplaceView: null,
  ticketSplitView: false,
  theme: "system",
};
const DEFAULT_TICKET_LIST_REFINEMENT: TicketListRefinement = {
  agent: "all",
  department: "all",
  priority: "all",
  sortBy: "updated",
  sortDirection: "desc",
  status: "all",
};

const ignoreUnreadMentions = () => undefined;

const previewView: DashboardView = {
  activity: activityItems,
  hasMoreTickets: false,
  metrics: previewMetrics,
  serviceHealth,
  ticketCount: dashboardTickets.length,
  tickets: dashboardTickets,
  updatedAt: "09:45 · Europe/Zurich",
};

const LOADING_DASHBOARD_METRICS: DashboardMetrics = {
  closed: "—",
  closedDetail: "",
  mine: "—",
  mineDetail: "",
  open: "—",
  openDetail: "",
  unassigned: "—",
  unassignedDetail: "",
};

function statusClass(value: string): string {
  return value.toLocaleLowerCase("de-CH").replaceAll(" ", "-");
}

function displayNameFromEmail(email: string | undefined): string {
  if (!email) return "Support-Team";
  const localPart = (email.split("@")[0] ?? email)
    .replaceAll(/[._-]/g, " ")
    .trim();
  const readableName = localPart
    .split(/\s+/)
    .filter(Boolean)
    .map(
      (part) =>
        `${part.slice(0, 1).toLocaleUpperCase("de-CH")}${part.slice(1)}`,
    )
    .join(" ");
  return readableName || "Support-Team";
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "TH"
  );
}

function metricDisplay(value: string): string {
  return value === "—" ? value : value;
}

function MetricTrend({ trend }: { trend: DashboardMetricTrend | undefined }) {
  if (!trend) return null;
  const Icon =
    trend.direction === "up"
      ? ArrowUp
      : trend.direction === "down"
        ? ArrowDown
        : Minus;
  const text =
    trend.direction === "same"
      ? "wie in der Vorperiode"
      : `${trend.percentage} % ${trend.direction === "up" ? "mehr" : "weniger"} als in der Vorperiode`;

  return (
    <span className="metric-trend">
      <Icon aria-hidden="true" size={14} strokeWidth={2} />
      {text}
    </span>
  );
}

function MetricLoadingState() {
  return (
    <div
      aria-label="Kennzahl wird geladen"
      aria-live="polite"
      className="metric-card__loading"
      role="status"
    >
      <span aria-hidden="true" className="metric-card__loading-value" />
      <span aria-hidden="true" className="metric-card__loading-comparison" />
      <span aria-hidden="true" className="metric-card__loading-detail" />
    </div>
  );
}

function TicketScopeMetricTiles({
  canWorkTickets,
  loading,
  metrics,
  onOpenScope,
  selectedScope,
  trends,
}: {
  canWorkTickets: boolean;
  loading: boolean;
  metrics: DashboardMetrics;
  onOpenScope: (scope: TicketScope) => void;
  selectedScope: TicketScope | null;
  trends: DashboardMetricTrends;
}) {
  const className = (scope: TicketScope, emphasis = false) =>
    `metric-card metric-button${emphasis ? " emphasis" : ""}${
      selectedScope === scope ? " metric-card--active" : ""
    }`;

  return (
    <section
      className="metric-strip ticket-scope-metrics"
      aria-label="Ticket-Schnellfilter"
    >
      <button
        aria-pressed={selectedScope === "mine"}
        className={className("mine", true)}
        disabled={loading}
        onClick={() => onOpenScope("mine")}
        type="button"
      >
        <p>Meine Tickets</p>
        {loading ? (
          <MetricLoadingState />
        ) : (
          <>
            <div>
              <strong>{metricDisplay(metrics.mine)}</strong>
            </div>
            <MetricTrend trend={trends.mine} />
            <small>{metrics.mineDetail}</small>
          </>
        )}
      </button>
      {canWorkTickets && (
        <>
          <button
            aria-pressed={selectedScope === "unassigned"}
            className={className("unassigned")}
            disabled={loading}
            onClick={() => onOpenScope("unassigned")}
            type="button"
          >
            <p>Nicht zugewiesene Tickets</p>
            {loading ? (
              <MetricLoadingState />
            ) : (
              <>
                <div>
                  <strong>{metricDisplay(metrics.unassigned)}</strong>
                </div>
                <MetricTrend trend={trends.unassigned} />
                <small>{metrics.unassignedDetail}</small>
              </>
            )}
          </button>
          <button
            aria-pressed={selectedScope === "open"}
            className={className("open")}
            disabled={loading}
            onClick={() => onOpenScope("open")}
            type="button"
          >
            <p>Offene Tickets</p>
            {loading ? (
              <MetricLoadingState />
            ) : (
              <>
                <div>
                  <strong>{metricDisplay(metrics.open)}</strong>
                </div>
                <MetricTrend trend={trends.open} />
                <small>{metrics.openDetail}</small>
              </>
            )}
          </button>
          <button
            aria-pressed={selectedScope === "closed"}
            className={className("closed")}
            disabled={loading}
            onClick={() => onOpenScope("closed")}
            type="button"
          >
            <p>Gelöste Tickets</p>
            {loading ? (
              <MetricLoadingState />
            ) : (
              <>
                <div>
                  <strong>{metricDisplay(metrics.closed)}</strong>
                </div>
                <MetricTrend trend={trends.closed} />
                <small>{metrics.closedDetail}</small>
              </>
            )}
          </button>
        </>
      )}
    </section>
  );
}

function tenantTicketAccessFromResponse(
  value: unknown,
): TenantTicketAccess | null {
  if (!value || typeof value !== "object" || !("data" in value)) {
    return null;
  }
  const data = value.data;
  if (!data || typeof data !== "object") return null;
  const parsed = data as Record<string, unknown>;
  return typeof parsed.canWorkTickets === "boolean" &&
    typeof parsed.isTenantAdmin === "boolean"
    ? {
        canWorkTickets: parsed.canWorkTickets,
        isTenantAdmin: parsed.isTenantAdmin,
      }
    : null;
}

function tenantFeatureFlagsFromResponse(
  value: unknown,
): Record<string, boolean> | null {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.features)
  ) {
    return null;
  }

  const flags: Record<string, boolean> = {};
  for (const rawFeature of value.data.features) {
    if (!isRecord(rawFeature)) return null;
    const feature = rawFeature as Partial<TenantFeatureFlag>;
    if (
      typeof feature.key !== "string" ||
      typeof feature.enabled !== "boolean" ||
      typeof feature.defaultEnabled !== "boolean"
    ) {
      return null;
    }
    flags[feature.key] = feature.enabled;
  }
  return flags;
}

function displayAuthError(message: string): string {
  if (message.toLocaleLowerCase("en-US").includes("email rate limit")) {
    return "Zu viele Anmelde-E-Mails wurden für dieses Projekt versendet. Bitte warten Sie bis zu einer Stunde und fordern Sie danach nur einen neuen Magic Link an.";
  }
  return message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function departmentQueueKeysFromRows(
  value: unknown,
): Record<string, { key: string; label: string }> | null {
  if (!Array.isArray(value)) return null;
  const queues: Record<string, { key: string; label: string }> = {};
  for (const department of value) {
    if (
      !isRecord(department) ||
      typeof department.id !== "string" ||
      typeof department.key !== "string" ||
      typeof department.name !== "string"
    ) {
      return null;
    }
    queues[department.id] = {
      key: department.key,
      label: department.name,
    };
  }
  return queues;
}

function usableTenantLogoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function usableBrandColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : null;
}

function isTicketScope(value: unknown): value is TicketScope {
  return (
    value === "all" ||
    value === "mine" ||
    value === "unassigned" ||
    value === "open" ||
    value === "closed"
  );
}

function isTicketSortBy(value: unknown): value is TicketSortBy {
  return (
    value === "updated" ||
    value === "agent" ||
    value === "status" ||
    value === "department" ||
    value === "priority"
  );
}

function ticketListRefinementFromValue(
  value: Record<string, unknown>,
): TicketListRefinement | null {
  const textFilter = (key: string) => {
    const raw = value[key];
    if (raw === undefined) return "all";
    if (typeof raw !== "string") return null;
    const normalized = raw.trim();
    return normalized && !/[\u0000-\u001f\u007f-\u009f]/u.test(normalized)
      ? normalized
      : "all";
  };
  const agent = textFilter("agent");
  const status = textFilter("status");
  const department = textFilter("department");
  const priority = textFilter("priority");
  const sortBy = value.sortBy === undefined ? "updated" : value.sortBy;
  const sortDirection =
    value.sortDirection === undefined ? "desc" : value.sortDirection;
  if (
    !agent ||
    !status ||
    !department ||
    !priority ||
    !isTicketSortBy(sortBy) ||
    (sortDirection !== "asc" && sortDirection !== "desc")
  ) {
    return null;
  }
  return { agent, department, priority, sortBy, sortDirection, status };
}

function isSection(value: unknown): value is Section {
  return (
    value === "Erwähnungen" ||
    sections.some((section) => section.label === value)
  );
}

function sectionDisplayLabel(section: Section): string {
  return section === "Wissen" ? "Wissensdatenbank" : section;
}

function sectionFromGlobalSearchResult(result: GlobalSearchResult): Section {
  if (
    result.resultType === "follow_up" ||
    result.section === "Wiedervorlagen"
  ) {
    return "Arbeitsplatz";
  }
  return result.section;
}

function isInputLikeTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    Boolean(
      target.closest(
        "input, textarea, select, [contenteditable='true'], [role='textbox']",
      ),
    )
  );
}

function workspacePreferencesFromValue(
  value: unknown,
): WorkspacePreferences | null {
  if (!isRecord(value)) return null;
  const migratedStart = migrateWorkplaceStartSection(value.startSection);
  if (!isSection(migratedStart.section)) return null;
  if (
    value.density !== "compact" &&
    value.density !== "standard" &&
    value.density !== "comfortable"
  ) {
    return null;
  }
  if (
    typeof value.highContrast !== "boolean" ||
    typeof value.reduceMotion !== "boolean"
  ) {
    return null;
  }
  return {
    density: value.density,
    highContrast: value.highContrast,
    reduceMotion: value.reduceMotion,
    // Frühere persönliche Einstellungen konnten separate, inzwischen im
    // Arbeitsplatz integrierte Arbeitsbereiche direkt öffnen.
    startSection: migratedStart.section,
    startWorkplaceView: migratedStart.requestedView,
    ticketSplitView:
      typeof value.ticketSplitView === "boolean"
        ? value.ticketSplitView
        : DEFAULT_WORKSPACE_PREFERENCES.ticketSplitView,
    theme:
      value.theme === "light" ||
      value.theme === "dark" ||
      value.theme === "system"
        ? value.theme
        : DEFAULT_WORKSPACE_PREFERENCES.theme,
  };
}

function experienceWorkspacePreferencesFromResponse(
  value: unknown,
): Partial<Pick<WorkspacePreferences, "density" | "theme">> | undefined {
  if (!isRecord(value) || !isRecord(value.data)) return undefined;
  const workspacePreferences = value.data.workspacePreferences;
  if (workspacePreferences === null) return {};
  if (
    !isRecord(workspacePreferences) ||
    !isRecord(workspacePreferences.preferences)
  ) {
    return undefined;
  }

  const preferences = workspacePreferences.preferences;
  return {
    ...(preferences.theme === "light" ||
    preferences.theme === "dark" ||
    preferences.theme === "system"
      ? { theme: preferences.theme }
      : {}),
    ...(preferences.density === "compact" ||
    preferences.density === "comfortable"
      ? { density: preferences.density }
      : {}),
  };
}

function workspacePreferenceSyncValue(
  preferences: WorkspacePreferences,
): string {
  return JSON.stringify({
    density: preferences.density === "compact" ? "compact" : "comfortable",
    theme: preferences.theme,
  });
}

function savedTicketViewFromValue(value: unknown): SavedTicketView | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.ownerId !== "string" ||
    typeof value.name !== "string" ||
    (value.visibility !== "private" && value.visibility !== "tenant") ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    !isRecord(value.filters) ||
    typeof value.filters.query !== "string" ||
    typeof value.filters.queue !== "string" ||
    !isTicketScope(value.filters.ticketScope)
  )
    return null;
  const refinement = ticketListRefinementFromValue(value.filters);
  if (!refinement) return null;
  return {
    createdAt: value.createdAt,
    filters: {
      ...refinement,
      query: value.filters.query,
      queue: value.filters.queue,
      ticketScope: value.filters.ticketScope,
    },
    id: value.id,
    name: value.name,
    ownerId: value.ownerId,
    updatedAt: value.updatedAt,
    visibility: value.visibility,
  };
}

function savedTicketViewsFromResponse(value: unknown): {
  canManageTenantViews: boolean;
  savedViews: SavedTicketView[];
} | null {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    typeof value.data.canManageTenantViews !== "boolean" ||
    !Array.isArray(value.data.savedViews)
  )
    return null;
  const savedViews = value.data.savedViews.map(savedTicketViewFromValue);
  return savedViews.every(
    (savedView): savedView is SavedTicketView => savedView !== null,
  )
    ? { canManageTenantViews: value.data.canManageTenantViews, savedViews }
    : null;
}

function savedTicketViewFromSaveResponse(
  value: unknown,
): SavedTicketView | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  return savedTicketViewFromValue(value.data.savedView);
}

function bulkStatusOptionsFromResponse(
  value: unknown,
): BulkStatusOption[] | null {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.statuses)
  ) {
    return null;
  }
  const statuses = value.data.statuses.map((status) => {
    if (
      !isRecord(status) ||
      typeof status.key !== "string" ||
      typeof status.label !== "string" ||
      typeof status.isClosed !== "boolean"
    ) {
      return null;
    }
    return {
      isClosed: status.isClosed,
      key: status.key,
      label: status.label,
    } satisfies BulkStatusOption;
  });
  return statuses.every((status): status is BulkStatusOption => status !== null)
    ? statuses
    : null;
}

function notificationFromValue(value: unknown): NotificationItem | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.kind !== "string" ||
    typeof value.createdAt !== "string" ||
    (value.readAt !== null && typeof value.readAt !== "string")
  ) {
    return null;
  }

  let ticket: NotificationTicketReference | null = null;
  if (value.ticket !== null) {
    if (
      !isRecord(value.ticket) ||
      typeof value.ticket.id !== "string" ||
      typeof value.ticket.ticketNumber !== "string"
    ) {
      return null;
    }
    ticket = {
      id: value.ticket.id,
      ticketNumber: value.ticket.ticketNumber,
      ...(typeof value.ticket.subject === "string"
        ? { subject: value.ticket.subject }
        : {}),
    };
  }

  return {
    createdAt: value.createdAt,
    id: value.id,
    kind: value.kind,
    payload: value.payload,
    readAt: value.readAt,
    ticket,
  };
}

function notificationsFromResponse(value: unknown): NotificationItem[] | null {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.notifications)
  ) {
    return null;
  }

  const notifications = value.data.notifications.map(notificationFromValue);
  return notifications.every(
    (notification): notification is NotificationItem => notification !== null,
  )
    ? notifications
    : null;
}

type NotificationPresentation = {
  description: string;
  Icon: LucideIcon;
  title: string;
};

function notificationTicketNumber(
  notification: NotificationItem,
): string | null {
  if (isRecord(notification.payload)) {
    const value = notification.payload.ticketNumber;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return notification.ticket?.ticketNumber ?? null;
}

function notificationPayloadText(
  notification: NotificationItem,
  key: string,
  maximumLength: number,
): string | null {
  if (!isRecord(notification.payload)) return null;
  const value = notification.payload[key];
  if (
    typeof value !== "string" ||
    value.includes("\u0000") ||
    [...value].length > maximumLength
  ) {
    return null;
  }
  const text = value.trim();
  return text ? text : null;
}

function notificationPayloadDateTime(
  notification: NotificationItem,
  key: string,
): string | null {
  const value = notificationPayloadText(notification, key, 64);
  return value && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

function notificationPresentation(
  notification: NotificationItem,
): NotificationPresentation {
  const ticketNumber = notificationTicketNumber(notification);
  const ticketLabel = ticketNumber ? `Ticket ${ticketNumber}` : "Dieses Ticket";

  switch (notification.kind) {
    case "ticket.assigned":
      return {
        description: `${ticketLabel} wurde dir zugewiesen.`,
        Icon: UserRound,
        title: "Ticket zugewiesen",
      };
    case "ticket.requester_reply":
      return {
        description: `Die anfragende Person hat auf ${ticketLabel} geantwortet.`,
        Icon: MessageSquareText,
        title: "Neue Antwort der anfragenden Person",
      };
    case "ticket.support_reply":
      return {
        description: `Der Support hat auf ${ticketLabel} geantwortet.`,
        Icon: MessageSquareText,
        title: "Antwort vom Support",
      };
    case "ticket.mention":
      return {
        description: `Du wurdest in ${ticketLabel} erwähnt.`,
        Icon: AtSign,
        title: "Du wurdest erwähnt",
      };
    case "ticket.resolved":
      return {
        description: `${ticketLabel} wurde gelöst.`,
        Icon: CircleCheck,
        title: "Ticket gelöst",
      };
    case "ticket.approval.requested":
      return {
        description: `Für ${ticketLabel} wird deine Freigabe benötigt.`,
        Icon: BadgeCheck,
        title: "Freigabe benötigt",
      };
    case "ticket.follow_up_due": {
      const followUpTitle =
        notificationPayloadText(notification, "title", 240) ?? "Wiedervorlage";
      const dueAt = notificationPayloadDateTime(notification, "dueAt");
      return {
        description: dueAt
          ? `${followUpTitle} · Fällig am ${notificationTime(dueAt)}`
          : followUpTitle,
        Icon: CalendarClock,
        title: "Wiedervorlage fällig",
      };
    }
    case "ticket.escalation_opened":
      return {
        description: `${ticketLabel} wurde eskaliert.`,
        Icon: ArrowUp,
        title: "Ticket eskaliert",
      };
    default:
      if (notification.kind.startsWith("ticket.sla.")) {
        return {
          description: `Für ${ticketLabel} ist eine SLA-Frist betroffen.`,
          Icon: Bell,
          title: "SLA-Hinweis",
        };
      }
      return {
        description: ticketNumber
          ? `Neue Benachrichtigung zu ${ticketLabel}.`
          : "Neue Benachrichtigung in deinem Mandanten.",
        Icon: Bell,
        title: "Benachrichtigung",
      };
  }
}

function notificationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Zeitpunkt unbekannt";
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function notificationErrorMessage(
  error: unknown,
  fallback = "Benachrichtigungen können derzeit nicht geladen werden.",
): string {
  const context = isRecord(error) ? error.context : undefined;
  if (isRecord(context) && context.status === 403) {
    return "Benachrichtigungen sind für diesen Mandanten nicht verfügbar.";
  }
  return fallback;
}

function AccessShell({ children }: { children: ReactNode }) {
  return (
    <main className="access-shell">
      <header className="access-header">
        <div className="access-brand">
          <img
            alt="nextDesk"
            className="nextdesk-logo-mark"
            src="/assets/nextdesk-logo-product.png"
          />
          <span>{productDefaults.productName}</span>
        </div>
        <nav aria-label="Zugangsbereiche">
          <span>PLATTFORM</span>
          <a href="https://gross-ict.ch/support">SUPPORT</a>
        </nav>
      </header>
      <div className="access-overlay" aria-hidden="true" />
      <section className="access-stage">
        <div className="access-intro">
          <p className="access-kicker">DIGITALE BETREUUNG · SICHERER ZUGANG</p>
          <h1>
            IHRE IT.
            <br />
            IHR PORTAL.
          </h1>
          <span className="access-rule" aria-hidden="true" />
          <p>Tickets, Services und Kundenportale an einem sicheren Ort.</p>
        </div>
        <section className="access-card">{children}</section>
      </section>
      <footer className="access-footer">
        <span>NEXTDESK · BETRIEBEN VON</span>
        <img alt="Gross ICT" src="/assets/gross-ict-footer-logo.png" />
      </footer>
    </main>
  );
}

function SignInScreen() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "sending" | "sso" | "sent" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  async function requestGrossIctSso() {
    if (!supabase) return;
    setStatus("sso");
    setMessage("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        redirectTo: appRedirectUrl(),
        // Profile claims are the authoritative source for the visible Entra
        // name. E-Mail remains necessary for tenant-domain routing.
        scopes: "openid profile email",
      },
    });
    if (error) {
      setStatus("error");
      setMessage(
        "Gross-ICT-SSO ist noch nicht in Supabase eingerichtet. Hinterlegen Sie zuerst die Entra-App-Registrierung.",
      );
    }
  }

  async function requestMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    setStatus("sending");
    setMessage("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: appRedirectUrl(), shouldCreateUser: false },
    });

    if (error) {
      setStatus("error");
      setMessage(displayAuthError(error.message));
      return;
    }

    setStatus("sent");
    setMessage(
      "Der Anmeldelink wurde versendet. Öffnen Sie ihn in diesem Browser.",
    );
  }

  return (
    <AccessShell>
      <p className="eyebrow">KUNDEN-LOGIN</p>
      <h2>
        Sicher in Ihre
        <br />
        Servicezentrale.
      </h2>
      <p className="access-lead">
        Eigentümer und Kundinnen und Kunden melden sich über ihr jeweiliges
        Unternehmens-SSO an. Ihr Zugang wird danach automatisch dem richtigen
        Mandanten zugeordnet.
      </p>
      <button
        className="gross-sso-button"
        disabled={status === "sending" || status === "sso"}
        onClick={() => void requestGrossIctSso()}
        type="button"
      >
        {status === "sso" ? "SSO wird geöffnet …" : "MIT SSO ANMELDEN"}
        <ArrowRight aria-hidden="true" size={18} strokeWidth={1.8} />
      </button>
      <div className="access-divider">
        <span>ODER MIT E-MAIL</span>
      </div>
      <form className="access-form" onSubmit={requestMagicLink}>
        <label>
          Arbeitsadresse
          <input
            autoComplete="email"
            disabled={
              status === "sending" || status === "sso" || status === "sent"
            }
            inputMode="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@organisation.ch"
            required
            type="email"
            value={email}
          />
        </label>
        <button
          className="email-access-button"
          disabled={
            status === "sending" || status === "sso" || status === "sent"
          }
          type="submit"
        >
          {status === "sending"
            ? "Link wird vorbereitet …"
            : "Anmeldelink senden"}
        </button>
      </form>
      {message && <p className={`access-message ${status}`}>{message}</p>}
    </AccessShell>
  );
}

function LoadingScreen({ message }: { message: string }) {
  return (
    <AccessShell>
      <p className="eyebrow">nextDesk wird vorbereitet</p>
      <h1>{message}</h1>
      <div className="loading-line" aria-hidden="true" />
    </AccessShell>
  );
}

function NoMembershipScreen({ onSignOut }: { onSignOut: () => void }) {
  return (
    <AccessShell>
      <p className="eyebrow">ANMELDUNG BESTÄTIGT</p>
      <h1>Portalzugang wird geprüft.</h1>
      <p>
        Ihre Sitzung ist aktiv, aber es ist noch keine aktive
        Mandantenmitgliedschaft vorhanden. Für das Eigentümerportal benötigen
        Sie die Gross-ICT-SSO-Anmeldung und einen verifizierten MFA-Zugang.
      </p>
      <button className="secondary-button" onClick={onSignOut} type="button">
        Abmelden
      </button>
    </AccessShell>
  );
}

function MembershipErrorScreen({
  message,
  onSignOut,
}: {
  message: string;
  onSignOut: () => void;
}) {
  return (
    <AccessShell>
      <p className="eyebrow">Mandantenkontext nicht geladen</p>
      <h1>Der Zugriff konnte nicht geprüft werden.</h1>
      <p>{message}</p>
      <button className="secondary-button" onClick={onSignOut} type="button">
        Abmelden
      </button>
    </AccessShell>
  );
}

function TicketList({
  loading = false,
  hasActiveFilters = false,
  keyboardActiveTicketId,
  tickets,
  onClearFilters,
  onCreateTicket,
  onOpen,
  onSelectionChange,
  selectedTicketIds,
}: {
  loading?: boolean;
  hasActiveFilters?: boolean;
  keyboardActiveTicketId?: string | null;
  tickets: readonly DashboardTicket[];
  onClearFilters?: () => void;
  onCreateTicket?: () => void;
  onOpen?: (ticketId: string) => void;
  onSelectionChange?: (ticketId: string, selected: boolean) => void;
  selectedTicketIds?: ReadonlySet<string>;
}) {
  if (loading && tickets.length === 0) {
    return (
      <div className="ticket-list-skeleton" aria-busy="true" role="status">
        <span>Tickets werden geladen …</span>
        <i />
        <i />
        <i />
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <div className="empty-state ticket-empty-state">
        <strong>
          {hasActiveFilters
            ? "Keine Tickets entsprechen den aktiven Filtern."
            : onCreateTicket
              ? "Ihre Ticketliste ist bereit."
              : "Aktuell liegen keine Tickets in Ihrer Queue."}
        </strong>
        <span>
          {hasActiveFilters
            ? "Passen Sie Suche oder Queue an oder setzen Sie alle Filter zurück."
            : onCreateTicket
              ? "Erfassen Sie den ersten Vorgang, damit er priorisiert und nachvollziehbar bearbeitet werden kann."
              : "Prüfen Sie später erneut oder wechseln Sie zu einer anderen Queue."}
        </span>
        {hasActiveFilters && onClearFilters ? (
          <button onClick={onClearFilters} type="button">
            Filter zurücksetzen
          </button>
        ) : onCreateTicket ? (
          <button
            className="primary-button"
            onClick={onCreateTicket}
            type="button"
          >
            Ticket erfassen
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="ticket-list">
      {tickets.map((ticket) => {
        const ticketId = ticket.recordId ?? ticket.id;
        const keyboardActive = keyboardActiveTicketId === ticketId;
        const slaLabel =
          ticket.sla.includes("SLA") || ticket.sla === "kein SLA-Ziel"
            ? ticket.sla
            : `SLA ${ticket.sla}`;
        return (
          <article
            aria-label={
              onOpen
                ? `Ticket ${ticket.id}: ${ticket.subject} öffnen`
                : undefined
            }
            aria-current={keyboardActive ? "true" : undefined}
            className={`${onOpen ? "ticket-row ticket-row--actionable" : "ticket-row"}${
              onSelectionChange ? " ticket-row--selectable" : ""
            }${keyboardActive ? " ticket-row--keyboard-active" : ""}`}
            id={onOpen ? `ticket-shortcut-${ticketId}` : undefined}
            key={ticket.id}
            onClick={onOpen ? () => onOpen(ticketId) : undefined}
            onKeyDown={
              onOpen
                ? (event) => {
                    if (event.target instanceof HTMLInputElement) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpen(ticketId);
                    }
                  }
                : undefined
            }
            role={onOpen && !onSelectionChange ? "button" : undefined}
            tabIndex={
              onOpen
                ? onSelectionChange
                  ? keyboardActive
                    ? 0
                    : -1
                  : 0
                : undefined
            }
          >
            {onSelectionChange && (
              <label
                className="ticket-selection"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <input
                  aria-label={`Ticket ${ticket.id} auswählen`}
                  checked={selectedTicketIds?.has(ticketId) ?? false}
                  onChange={(event) =>
                    onSelectionChange(ticketId, event.target.checked)
                  }
                  type="checkbox"
                />
              </label>
            )}
            <div className="ticket-main">
              <div className="ticket-context">
                <span className="ticket-number">{ticket.id}</span>
                <span className="ticket-queue">{ticket.queueLabel}</span>
              </div>
              <h3>{ticket.subject}</h3>
              <p className="ticket-meta">
                {ticket.priority ? <span>{ticket.priority}</span> : null}
                <span>vor {ticket.age}</span>
              </p>
            </div>
            <div className="ticket-state">
              <span
                aria-label={`Status: ${ticket.state}`}
                className={`state-badge ${statusClass(ticket.state)}`}
              >
                <span aria-hidden="true" className="state-badge__indicator" />
                {ticket.state}
              </span>
              <span
                aria-label={`SLA: ${slaLabel}`}
                className={`sla ${ticket.risk}`}
              >
                {slaLabel}
              </span>
            </div>
            {onOpen ? (
              <ArrowRight
                aria-hidden="true"
                className="ticket-row-arrow"
                size={18}
                strokeWidth={1.8}
              />
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function TicketListDetailPreview({
  onOpenFull,
  ticket,
}: {
  onOpenFull: () => void;
  ticket: DashboardTicket | null;
}) {
  if (!ticket) {
    return (
      <aside aria-label="Ticketdetail" className="ticket-list-detail__preview">
        <p className="eyebrow">DETAIL</p>
        <h3>Ticket auswählen</h3>
        <p>
          Wählen Sie ein Ticket aus der Liste, um die Zusammenfassung hier zu
          sehen.
        </p>
      </aside>
    );
  }

  const slaLabel =
    ticket.sla.includes("SLA") || ticket.sla === "kein SLA-Ziel"
      ? ticket.sla
      : `SLA ${ticket.sla}`;
  return (
    <aside
      aria-labelledby="ticket-list-detail-heading"
      className="ticket-list-detail__preview"
    >
      <p className="eyebrow">DETAIL</p>
      <div className="ticket-list-detail__title">
        <span className="ticket-number">{ticket.id}</span>
        <span
          aria-label={`Status: ${ticket.state}`}
          className={`state-badge ${statusClass(ticket.state)}`}
        >
          <span aria-hidden="true" className="state-badge__indicator" />
          {ticket.state}
        </span>
      </div>
      <h3 id="ticket-list-detail-heading">{ticket.subject}</h3>
      <dl>
        <div>
          <dt>Queue</dt>
          <dd>{ticket.queueLabel}</dd>
        </div>
        <div>
          <dt>Priorität</dt>
          <dd>{ticket.priority ?? "Ohne Priorität"}</dd>
        </div>
        <div>
          <dt>SLA</dt>
          <dd className={`sla ${ticket.risk}`}>{slaLabel}</dd>
        </div>
        <div>
          <dt>Erfasst</dt>
          <dd>vor {ticket.age}</dd>
        </div>
      </dl>
      <p className="ticket-list-detail__hint">
        Diese Übersicht ändert nichts am Ticket. Öffnen Sie die vollständige
        Detailansicht für bestätigte Bearbeitungsschritte.
      </p>
      <button className="primary-button" onClick={onOpenFull} type="button">
        Vollständige Details öffnen
      </button>
    </aside>
  );
}

export function App() {
  const [section, setRequestedSection] = useState<Section>("Übersicht");
  const [globalSearchTarget, setGlobalSearchTarget] =
    useState<GlobalSearchResult | null>(null);
  const [workplaceRequestedView, setWorkplaceRequestedView] =
    useState<WorkplaceRequestedView | null>(null);
  const [period, setPeriod] = useState<Period>("Heute");
  const [queue, setQueue] = useState("alle");
  const [ticketScope, setTicketScope] = useState<TicketScope>("all");
  const [ticketListRefinement, setTicketListRefinement] =
    useState<TicketListRefinement>(DEFAULT_TICKET_LIST_REFINEMENT);
  const [metricTicketFilter, setMetricTicketFilter] =
    useState<MetricTicketFilter | null>(null);
  const [query, setQuery] = useState("");
  const [savedTicketViews, setSavedTicketViews] = useState<SavedTicketView[]>(
    [],
  );
  const [canManageTenantViews, setCanManageTenantViews] = useState(false);
  const [savedTicketViewsLoading, setSavedTicketViewsLoading] = useState(false);
  const [session, setSession] = useState<Session | null | undefined>(
    isSupabaseConfigured ? undefined : null,
  );
  const [operatorName, setOperatorName] = useState("Mara Keller");
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [activeTenantId, setActiveTenantId] = useState("");
  const [tenantLoading, setTenantLoading] = useState(false);
  const [tenantLoadError, setTenantLoadError] = useState("");
  const [snapshot, setSnapshot] = useState<LiveDashboardSnapshot | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardRevision, setDashboardRevision] = useState(0);
  const [dashboardTrends, setDashboardTrends] = useState<DashboardMetricTrends>(
    {},
  );
  const [ticketPage, setTicketPage] = useState(0);
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [ticketActionStatus, setTicketActionStatus] = useState("");
  const [experienceNotice, setExperienceNotice] = useState<{
    message: string;
    tone: "error" | "success";
  } | null>(null);
  const [experienceFollowUpsRevision, setExperienceFollowUpsRevision] =
    useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [ownerAccess, setOwnerAccess] = useState<OwnerAccess>("idle");
  const [ownerAccessError, setOwnerAccessError] = useState("");
  const [ownerView, setOwnerView] = useState<"console" | "tenant">("console");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [splitSelectedTicketId, setSplitSelectedTicketId] = useState<
    string | null
  >(null);
  const [ticketComposerOpen, setTicketComposerOpen] = useState(false);
  const [quickCreateMenuOpen, setQuickCreateMenuOpen] = useState(false);
  const [quickCreateRequest, setQuickCreateRequest] =
    useState<QuickCreateRequest | null>(null);
  const [canWorkTickets, setCanWorkTickets] = useState(false);
  const [ticketAccessLoading, setTicketAccessLoading] =
    useState(isSupabaseConfigured);
  const [tenantFeaturesLoading, setTenantFeaturesLoading] =
    useState(isSupabaseConfigured);
  const [isTenantAdmin, setIsTenantAdmin] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const [notificationStatus, setNotificationStatus] = useState("");
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [notificationActionPending, setNotificationActionPending] = useState<
    string | null
  >(null);
  const [keyboardHelpOpen, setKeyboardHelpOpen] = useState(false);
  const [keyboardActiveTicketId, setKeyboardActiveTicketId] = useState<
    string | null
  >(null);
  const [dismissedLiveMessage, setDismissedLiveMessage] = useState<
    string | null
  >(null);
  const [workspacePreferences, setWorkspacePreferences] =
    useState<WorkspacePreferences>(DEFAULT_WORKSPACE_PREFERENCES);
  const [workspacePreferencesHydrated, setWorkspacePreferencesHydrated] =
    useState(false);
  const [workspacePreferencesOpen, setWorkspacePreferencesOpen] =
    useState(false);
  const [workspacePreferencesContext, setWorkspacePreferencesContext] =
    useState<"page" | "personal">("page");
  const [personalSettingsOpen, setPersonalSettingsOpen] = useState(false);
  const [ssoEnforced, setSsoEnforced] = useState(false);
  const [tenantFeatures, setTenantFeatures] = useState<Record<string, boolean>>(
    {},
  );
  const [departmentQueueKeys, setDepartmentQueueKeys] = useState<
    Record<string, { key: string; label: string }>
  >({});
  const [activeIncidentNotices, setActiveIncidentNotices] = useState<
    ActiveIncidentNotice[]
  >([]);
  const [tenantFeatureRevision, setTenantFeatureRevision] = useState(0);
  const [tenantWorkspaceBranding, setTenantWorkspaceBranding] =
    useState<TenantWorkspaceBranding | null>(null);
  const [tenantBrandingRevision, setTenantBrandingRevision] = useState(0);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const notificationPanelRef = useRef<HTMLElement>(null);
  const keyboardHelpCloseRef = useRef<HTMLButtonElement>(null);
  const quickCreateMenuRef = useRef<HTMLElement>(null);
  const quickCreateRequestIdRef = useRef(0);
  const quickCreateTriggerRef = useRef<HTMLButtonElement>(null);
  const personalSettingsTriggerRef = useRef<HTMLButtonElement>(null);
  const workspacePreferencesCloseRef = useRef<HTMLButtonElement>(null);
  const workspacePreferencesTriggerRef = useRef<HTMLButtonElement>(null);
  const workspacePreferencesSyncTenantRef = useRef<string | null>(null);
  const workspacePreferencesLastSavedRef = useRef<string | null>(null);
  const workspaceStartNavigationRef = useRef<string | null>(null);
  const workspacePreferencesStorageKey = `nextdesk:workspace-preferences:v2:${session?.user.id ?? "preview"}`;
  const legacyWorkspacePreferencesStorageKey = `nextdesk:workspace-preferences:${session?.user.id ?? "preview"}`;

  useEffect(() => {
    if (isSupabaseConfigured && session === undefined) return;

    setWorkspacePreferencesHydrated(false);
    workspaceStartNavigationRef.current = null;
    try {
      const storedV2 = window.localStorage.getItem(
        workspacePreferencesStorageKey,
      );
      if (storedV2 !== null) {
        const parsed = workspacePreferencesFromValue(JSON.parse(storedV2));
        setWorkspacePreferences(parsed ?? DEFAULT_WORKSPACE_PREFERENCES);
      } else {
        const legacy = workspacePreferencesFromValue(
          JSON.parse(
            window.localStorage.getItem(legacyWorkspacePreferencesStorageKey) ??
              "null",
          ),
        );
        const migrated = legacy
          ? {
              ...legacy,
              // The former default followed the device. Preserve an explicit
              // dark choice, but migrate the legacy default to nextDesk light.
              theme: legacy.theme === "system" ? "light" : legacy.theme,
            }
          : DEFAULT_WORKSPACE_PREFERENCES;
        window.localStorage.setItem(
          workspacePreferencesStorageKey,
          JSON.stringify(migrated),
        );
        setWorkspacePreferences(migrated);
      }
    } catch {
      setWorkspacePreferences(DEFAULT_WORKSPACE_PREFERENCES);
    } finally {
      setWorkspacePreferencesHydrated(true);
    }
  }, [legacyWorkspacePreferencesStorageKey, workspacePreferencesStorageKey]);

  useEffect(() => {
    if (!workspacePreferencesHydrated) return;
    window.localStorage.setItem(
      workspacePreferencesStorageKey,
      JSON.stringify(workspacePreferences),
    );
  }, [
    workspacePreferences,
    workspacePreferencesHydrated,
    workspacePreferencesStorageKey,
  ]);

  useEffect(() => {
    if (section === "Erwähnungen") setSection("Arbeitsplatz");
  }, [section]);

  useEffect(() => {
    setMetricTicketFilter(null);
  }, [activeTenantId]);

  useEffect(() => {
    if (!supabase) return;

    const auth = supabase.auth;
    let mounted = true;
    const callbackUrl = window.location.href;
    const callbackInProgress = hasBrowserAuthCallback(callbackUrl);
    const callbackSessionGate =
      createBrowserAuthSessionGate(callbackInProgress);
    if (callbackInProgress) setTenantLoading(true);
    const applySession = (nextSession: Session | null) => {
      if (!mounted) return;
      setTenantLoading(Boolean(nextSession));
      setTenants([]);
      setActiveTenantId("");
      setSession(nextSession);
      setSnapshot(null);
      setErrorMessage("");
      setTenantLoadError("");
      setOwnerAccess("idle");
      setOwnerAccessError("");
      setOwnerView("console");
      setCanWorkTickets(false);
      setTicketAccessLoading(Boolean(nextSession));
      setTenantFeaturesLoading(Boolean(nextSession));
      setIsTenantAdmin(false);
      setWorkspacePreferencesOpen(false);
      setWorkspacePreferencesContext("page");
      setPersonalSettingsOpen(false);
      setWorkplaceRequestedView(null);
      setSsoEnforced(false);
      setTenantFeatures({});
      setDepartmentQueueKeys({});
      setActiveIncidentNotices([]);
      setTenantWorkspaceBranding(null);
      setExperienceNotice(null);
      setExperienceFollowUpsRevision(0);
    };
    const { data } = auth.onAuthStateChange((_event, nextSession) => {
      if (!callbackSessionGate.accepts(nextSession)) return;
      applySession(nextSession);
    });
    const rejectCallback = async (error: unknown) => {
      callbackSessionGate.fail();
      await auth.signOut({ scope: "local" }).catch(() => undefined);
      if (!mounted) return;
      applySession(null);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Die Anmeldung konnte nicht abgeschlossen werden.",
      );
    };
    const clearCallbackUrl = () => {
      if (!callbackInProgress) return;
      window.history.replaceState(
        window.history.state,
        "",
        cleanBrowserAuthCallbackUrl(callbackUrl),
      );
    };
    void bootstrapBrowserAuthSession(auth, callbackUrl)
      .then(async ({ cleanUrl, error, session: nextSession }) => {
        if (!mounted) return;
        if (cleanUrl) {
          window.history.replaceState(window.history.state, "", cleanUrl);
        }
        if (error || (callbackInProgress && !nextSession)) {
          await rejectCallback(
            error ??
              new Error("Die Anmeldung konnte nicht abgeschlossen werden."),
          );
          return;
        }
        if (callbackInProgress && nextSession) {
          callbackSessionGate.complete(nextSession);
        }
        applySession(nextSession);
      })
      .catch(async (error: unknown) => {
        clearCallbackUrl();
        await rejectCallback(error);
      });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !session) {
      setTenants([]);
      setActiveTenantId("");
      setTenantLoading(false);
      setTenantLoadError("");
      setSsoEnforced(false);
      return;
    }

    let mounted = true;
    setTenantLoading(true);
    setTenantLoadError("");
    setTenants([]);
    setActiveTenantId("");
    setSnapshot(null);
    void acceptTenantInvitations()
      .catch(() => 0)
      .then(async () => {
        // The SSO guard can create a normal tenant membership for a verified
        // Entra employee. For an enforced tenant the small tenant summary is
        // already verified by that guard, so the initial workspace does not
        // depend on a second nested PostgREST membership query.
        const ssoAccess = await resolveTenantSsoAccess();
        const [activeTenants, profileName] = await Promise.all([
          ssoAccess.scope === "tenant"
            ? Promise.resolve([ssoAccess.tenant])
            : loadActiveTenants(),
          loadProfileName(),
        ]);
        if (
          ssoAccess.scope === "tenant" &&
          activeTenants[0]?.id !== ssoAccess.tenantId
        ) {
          throw new Error(
            "Die Mandantenmitgliedschaft konnte nach der SSO-Anmeldung nicht bestätigt werden.",
          );
        }
        return {
          activeTenants,
          profileName,
          ssoEnforced: ssoAccess.scope === "tenant" && ssoAccess.ssoEnforced,
        };
      })
      .then(({ activeTenants, profileName, ssoEnforced: nextSsoEnforced }) => {
        if (!mounted) return;
        setTenants(activeTenants);
        setSsoEnforced(nextSsoEnforced);
        setOperatorName(
          profileName ?? displayNameFromEmail(session.user.email),
        );
        setTicketAccessLoading(Boolean(activeTenants[0]?.id));
        setTenantFeaturesLoading(Boolean(activeTenants[0]?.id));
        setActiveTenantId((current) => current || activeTenants[0]?.id || "");
      })
      .catch(async (error: unknown) => {
        if (!mounted) return;
        setTenantLoadError(
          await functionErrorMessage(
            error,
            "Ihre Anmeldung konnte keinem berechtigten Mandanten zugeordnet werden. Bitte wenden Sie sich an die Mandantenadministration.",
          ),
        );
      })
      .finally(() => {
        if (mounted) setTenantLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [session]);

  useEffect(() => {
    if (!supabase || !session || tenantLoading) {
      if (!session) {
        setOwnerAccess("idle");
        setOwnerAccessError("");
      }
      return;
    }

    let mounted = true;
    setOwnerAccess("checking");
    setOwnerAccessError("");
    void resolveOwnerAccess().then((result) => {
      if (!mounted) return;
      setOwnerAccess(result.state);
      setOwnerAccessError(result.message ?? "");
    });

    return () => {
      mounted = false;
    };
  }, [session, tenantLoading]);

  const activeTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === activeTenantId) ?? null,
    [activeTenantId, tenants],
  );
  const experienceWorkspaceEnabled =
    isSupabaseConfigured && tenantFeatures["experience.workspace"] === true;
  const requesterPortalEnabled =
    isSupabaseConfigured && tenantFeatures["requester.portal"] === true;
  const agentWorkbenchEnabled =
    isSupabaseConfigured &&
    canWorkTickets &&
    tenantFeatures["agent.workbench"] === true;
  const workspaceNavigationReady = isWorkspaceNavigationReady({
    activeTenantAvailable: activeTenant !== null,
    isSupabaseConfigured,
    sessionResolved: session !== undefined,
    signedIn: Boolean(session),
    tenantFeaturesLoading,
    ticketAccessLoading,
  });

  useEffect(() => {
    if (!workspacePreferencesHydrated || !workspaceNavigationReady) return;
    const navigationKey = `${workspacePreferencesStorageKey}:${activeTenant?.id ?? "preview"}`;
    if (workspaceStartNavigationRef.current === navigationKey) return;

    workspaceStartNavigationRef.current = navigationKey;
    if (workspacePreferences.startWorkplaceView) {
      setWorkplaceRequestedView(workspacePreferences.startWorkplaceView);
    }
    setSection(workspacePreferences.startSection);
  }, [
    activeTenant?.id,
    workspaceNavigationReady,
    workspacePreferences.startSection,
    workspacePreferences.startWorkplaceView,
    workspacePreferencesHydrated,
    workspacePreferencesStorageKey,
  ]);

  useEffect(() => {
    if (!supabase || !session || !activeTenant) {
      setTenantWorkspaceBranding(null);
      return;
    }

    let mounted = true;
    void Promise.all([
      supabase
        .from("tenant_settings")
        .select("portal_name")
        .eq("tenant_id", activeTenant.id)
        .maybeSingle(),
      supabase
        .from("tenant_branding")
        .select("logo_path, primary_color, secondary_color, accent_color")
        .eq("tenant_id", activeTenant.id)
        .maybeSingle(),
    ])
      .then(([settingsResult, brandingResult]) => {
        if (settingsResult.error) throw settingsResult.error;
        if (brandingResult.error) throw brandingResult.error;
        if (!mounted) return;
        const portalName = settingsResult.data?.portal_name?.trim();
        setTenantWorkspaceBranding({
          accentColor: usableBrandColor(brandingResult.data?.accent_color),
          logoUrl: usableTenantLogoUrl(brandingResult.data?.logo_path),
          portalName: portalName || null,
          primaryColor: usableBrandColor(brandingResult.data?.primary_color),
          secondaryColor: usableBrandColor(
            brandingResult.data?.secondary_color,
          ),
          tenantId: activeTenant.id,
        });
      })
      .catch(() => {
        if (!mounted) return;
        setTenantWorkspaceBranding({
          accentColor: null,
          logoUrl: null,
          portalName: null,
          primaryColor: null,
          secondaryColor: null,
          tenantId: activeTenant.id,
        });
      });

    return () => {
      mounted = false;
    };
  }, [activeTenant, session, tenantBrandingRevision]);

  useEffect(() => {
    if (!supabase || !session || !activeTenant || !canWorkTickets) {
      setSavedTicketViews([]);
      setCanManageTenantViews(false);
      setSavedTicketViewsLoading(false);
      return;
    }

    let mounted = true;
    setSavedTicketViewsLoading(true);
    void supabase.functions
      .invoke("ticket-saved-views", {
        body: { type: "listSavedViews", tenantId: activeTenant.id },
      })
      .then(({ data, error }) => {
        if (error) throw error;
        const parsed = savedTicketViewsFromResponse(data);
        if (!parsed) throw new Error("invalid_saved_view_response");
        if (!mounted) return;
        setSavedTicketViews(parsed.savedViews);
        setCanManageTenantViews(parsed.canManageTenantViews);
      })
      .catch(async (error: unknown) => {
        if (!mounted) return;
        setSavedTicketViews([]);
        setCanManageTenantViews(false);
        setErrorMessage(
          await functionErrorMessage(
            error,
            "Gespeicherte Ticketansichten konnten nicht geladen werden. Bitte versuchen Sie es erneut.",
          ),
        );
      })
      .finally(() => {
        if (mounted) setSavedTicketViewsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [activeTenant, canWorkTickets, session]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !session || !activeTenant) {
      setNotifications([]);
      setNotificationsLoading(false);
      setNotificationsError("");
      setNotificationStatus("");
      setNotificationPanelOpen(false);
      return;
    }

    let mounted = true;
    setNotificationsLoading(true);
    setNotificationsError("");
    setNotificationStatus("");
    setNotificationPanelOpen(false);
    void supabase.functions
      .invoke("notification-center", {
        body: {
          type: "list",
          tenantId: activeTenant.id,
          unreadOnly: false,
          limit: 20,
        },
      })
      .then(({ data, error }) => {
        if (error) throw error;
        const nextNotifications = notificationsFromResponse(data);
        if (!nextNotifications)
          throw new Error("invalid_notification_response");
        if (mounted) setNotifications(nextNotifications);
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setNotifications([]);
        setNotificationsError(notificationErrorMessage(error));
      })
      .finally(() => {
        if (mounted) setNotificationsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [activeTenant, session]);

  useEffect(() => {
    if (notificationPanelOpen) notificationPanelRef.current?.focus();
  }, [notificationPanelOpen]);

  useEffect(() => {
    if (!keyboardHelpOpen) return;
    const frame = window.requestAnimationFrame(() =>
      keyboardHelpCloseRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [keyboardHelpOpen]);

  useEffect(() => {
    if (!supabase || !session || !activeTenant) {
      setCanWorkTickets(false);
      setIsTenantAdmin(false);
      setTicketAccessLoading(false);
      return;
    }
    let mounted = true;
    setTicketAccessLoading(true);
    void supabase.functions
      .invoke("tenant-users", {
        body: { type: "getMyTicketAccess", tenantId: activeTenant.id },
      })
      .then(({ data, error }) => {
        if (error) throw error;
        const access = tenantTicketAccessFromResponse(data);
        if (!access) throw new Error("invalid_ticket_access_response");
        if (!mounted) return;
        setCanWorkTickets(access.canWorkTickets);
        setIsTenantAdmin(access.isTenantAdmin);
      })
      .catch(() => {
        if (!mounted) return;
        setCanWorkTickets(false);
        setIsTenantAdmin(false);
      })
      .finally(() => {
        if (mounted) setTicketAccessLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [activeTenant, session]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !session || !activeTenant) {
      setTenantFeatures({});
      setTenantFeaturesLoading(false);
      return;
    }

    let mounted = true;
    setTenantFeaturesLoading(true);
    void supabase.functions
      .invoke("tenant-feature-flags", {
        body: { type: "list", tenantId: activeTenant.id },
      })
      .then(({ data, error }) => {
        if (error) throw error;
        const flags = tenantFeatureFlagsFromResponse(data);
        if (!flags) throw new Error("invalid_tenant_feature_flags_response");
        if (mounted) setTenantFeatures(flags);
      })
      .catch(() => {
        // Optional modules fail closed so they never appear before the current
        // tenant entitlement has been verified by the server.
        if (mounted) setTenantFeatures({});
      })
      .finally(() => {
        if (mounted) setTenantFeaturesLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [activeTenant, session, tenantFeatureRevision]);

  useEffect(() => {
    if (!supabase || !session || !activeTenant) {
      setDepartmentQueueKeys({});
      return;
    }

    let mounted = true;
    void supabase
      .from("departments")
      .select("id, key, name")
      .eq("tenant_id", activeTenant.id)
      .eq("active", true)
      .then(({ data, error }) => {
        if (error) throw error;
        const nextQueues = departmentQueueKeysFromRows(data);
        if (!nextQueues) throw new Error("invalid_departments_response");
        if (mounted) setDepartmentQueueKeys(nextQueues);
      })
      .then(undefined, () => {
        if (mounted) setDepartmentQueueKeys({});
      });

    return () => {
      mounted = false;
    };
  }, [activeTenant, session]);

  useEffect(() => {
    if (!supabase || !session || !activeTenant || !requesterPortalEnabled) {
      setActiveIncidentNotices([]);
      return;
    }

    let mounted = true;
    void supabase.functions
      .invoke("requester-portal", {
        body: { tenantId: activeTenant.id, type: "activeIncidentNotices" },
      })
      .then(({ data, error }) => {
        if (error) throw error;
        const notices = activeIncidentNoticesFromResponse(data);
        if (!notices) throw new Error("invalid_incident_notices_response");
        if (mounted) setActiveIncidentNotices(notices);
      })
      .catch(() => {
        // Feature, membership and network failures are intentionally quiet.
        if (mounted) setActiveIncidentNotices([]);
      });

    return () => {
      mounted = false;
    };
  }, [activeTenant, requesterPortalEnabled, session]);

  useEffect(() => {
    if (
      !supabase ||
      !session ||
      !activeTenant ||
      !experienceWorkspaceEnabled ||
      !workspacePreferencesHydrated
    ) {
      workspacePreferencesSyncTenantRef.current = null;
      workspacePreferencesLastSavedRef.current = null;
      return;
    }

    let mounted = true;
    workspacePreferencesSyncTenantRef.current = null;
    void supabase.functions
      .invoke("experience-hub", {
        body: { tenantId: activeTenant.id, type: "getWorkspacePreferences" },
      })
      .then(({ data, error }) => {
        if (error) throw error;
        const remotePreferences =
          experienceWorkspacePreferencesFromResponse(data);
        if (remotePreferences === undefined) {
          throw new Error("invalid_workspace_preferences_response");
        }
        if (!mounted) return;
        setWorkspacePreferences((current) => {
          // A valid remote choice deliberately wins over the local fallback,
          // including an explicitly saved "system" choice.
          const next = { ...current, ...remotePreferences };
          workspacePreferencesLastSavedRef.current =
            workspacePreferenceSyncValue(next);
          workspacePreferencesSyncTenantRef.current = activeTenant.id;
          return next;
        });
      })
      .catch(() => {
        // The locally stored preference remains the deliberate fallback when
        // Experience Hub is unavailable or the server fails closed.
      });

    return () => {
      mounted = false;
    };
  }, [
    activeTenant,
    experienceWorkspaceEnabled,
    session,
    workspacePreferencesHydrated,
  ]);

  useEffect(() => {
    if (
      !supabase ||
      !session ||
      !activeTenant ||
      !experienceWorkspaceEnabled ||
      !workspacePreferencesHydrated ||
      workspacePreferencesSyncTenantRef.current !== activeTenant.id
    ) {
      return;
    }

    const experienceSupabase = supabase;
    const preferences = {
      density:
        workspacePreferences.density === "compact" ? "compact" : "comfortable",
      theme: workspacePreferences.theme,
    } as const;
    const nextSavedValue = workspacePreferenceSyncValue(workspacePreferences);
    if (workspacePreferencesLastSavedRef.current === nextSavedValue) return;

    const timeout = window.setTimeout(() => {
      void experienceSupabase.functions
        .invoke("experience-hub", {
          body: {
            preferences,
            tenantId: activeTenant.id,
            type: "saveWorkspacePreferences",
          },
        })
        .then(({ error }) => {
          if (!error) workspacePreferencesLastSavedRef.current = nextSavedValue;
        })
        .catch(() => {
          // Saving is best effort. The current local preference remains active.
        });
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [
    activeTenant,
    experienceWorkspaceEnabled,
    session,
    workspacePreferences,
    workspacePreferencesHydrated,
  ]);

  useEffect(() => {
    if (ticketAccessLoading || tenantFeaturesLoading) return;
    if (canWorkTickets) return;
    setTicketScope("mine");
    setSelectedTicketIds(new Set());
    setTicketActionStatus("");
    if (!canRequesterOpenSection(section, requesterPortalEnabled)) {
      setSection("Übersicht");
    }
  }, [
    canWorkTickets,
    requesterPortalEnabled,
    section,
    tenantFeaturesLoading,
    ticketAccessLoading,
  ]);

  useEffect(() => {
    setTicketPage(0);
  }, [
    activeTenant?.id,
    canWorkTickets,
    dashboardRevision,
    metricTicketFilter,
    period,
    query,
    queue,
    ticketListRefinement,
    ticketScope,
  ]);

  useEffect(() => {
    setSelectedTicketIds(new Set());
    setTicketActionStatus("");
    setSplitSelectedTicketId(null);
  }, [activeTenant?.id]);

  useEffect(() => {
    setSelectedTicketIds(new Set());
    setTicketActionStatus("");
  }, [ticketListRefinement]);

  useEffect(() => {
    if (!session || !activeTenant) return;

    let mounted = true;
    setDashboardLoading(true);
    if (ticketPage === 0) setSnapshot(null);
    setErrorMessage("");
    void loadLiveDashboard(
      activeTenant,
      period,
      ticketPage,
      ticketListRefinement,
      {
        metricTicketIds: metricTicketFilter?.ticketIds ?? null,
        query,
        queue,
        scope: canWorkTickets ? ticketScope : "mine",
      },
    )
      .then((nextSnapshot) => {
        if (!mounted) return;
        setSnapshot((current) => {
          if (
            ticketPage === 0 ||
            !current ||
            current.tenantId !== nextSnapshot.tenantId ||
            current.period !== nextSnapshot.period
          ) {
            return nextSnapshot;
          }

          const loadedTicketIds = new Set(
            current.tickets.map((ticket) => ticket.recordId ?? ticket.id),
          );
          const tickets = [
            ...current.tickets,
            ...nextSnapshot.tickets.filter(
              (ticket) => !loadedTicketIds.has(ticket.recordId ?? ticket.id),
            ),
          ];
          const mergedSnapshot = {
            ...nextSnapshot,
            tickets,
          };
          if (tickets.length < nextSnapshot.ticketCount) {
            return {
              ...mergedSnapshot,
              ticketListNote: `Die Liste zeigt ${tickets.length} von ${nextSnapshot.ticketCount} passenden Tickets.`,
            };
          }
          const { ticketListNote: _ticketListNote, ...completeSnapshot } =
            mergedSnapshot;
          return completeSnapshot;
        });
      })
      .catch(async (error: unknown) => {
        if (!mounted) return;
        setErrorMessage(
          await functionErrorMessage(
            error,
            "Die Ticketübersicht konnte nicht geladen werden. Bitte versuchen Sie es erneut.",
          ),
        );
      })
      .finally(() => {
        if (mounted) setDashboardLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [
    activeTenant,
    dashboardRevision,
    canWorkTickets,
    metricTicketFilter,
    period,
    query,
    queue,
    session,
    ticketListRefinement,
    ticketPage,
    ticketScope,
  ]);

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  function closeNotificationPanel() {
    setNotificationPanelOpen(false);
    notificationButtonRef.current?.focus();
  }

  function toggleNotificationPanel() {
    if (notificationPanelOpen) {
      closeNotificationPanel();
      return;
    }
    setNotificationPanelOpen(true);
  }

  function setSection(nextSection: Section) {
    if (
      !canWorkTickets &&
      !canRequesterOpenSection(nextSection, requesterPortalEnabled)
    ) {
      setGlobalSearchTarget(null);
      setRequestedSection("Übersicht");
      return;
    }
    setRequestedSection(nextSection);
  }

  async function handleNotificationClick(notification: NotificationItem) {
    if (!supabase) return;

    const ticketId = notification.ticket?.id;
    setNotificationActionPending(notification.id);
    setNotificationsError("");
    setNotificationStatus("");
    try {
      const { error } = await supabase.functions.invoke("notification-center", {
        body: { type: "markRead", notificationId: notification.id },
      });
      if (error) throw error;
      const readAt = new Date().toISOString();
      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id ? { ...item, readAt } : item,
        ),
      );
    } catch (error) {
      setNotificationsError(
        notificationErrorMessage(
          error,
          "Die Benachrichtigung konnte nicht als gelesen markiert werden.",
        ),
      );
    } finally {
      setNotificationActionPending(null);
    }

    if (ticketId) {
      setSection("Tickets");
      setSelectedTicketId(ticketId);
      setNotificationPanelOpen(false);
    }
  }

  async function markAllNotificationsAsRead() {
    if (!supabase || !activeTenant) return;

    setNotificationActionPending("all");
    setNotificationsError("");
    setNotificationStatus("");
    try {
      const { error } = await supabase.functions.invoke("notification-center", {
        body: { type: "markAllRead", tenantId: activeTenant.id },
      });
      if (error) throw error;
      const readAt = new Date().toISOString();
      setNotifications((current) =>
        current.map((notification) =>
          notification.readAt ? notification : { ...notification, readAt },
        ),
      );
      setNotificationStatus(
        "Alle Benachrichtigungen wurden als gelesen markiert.",
      );
    } catch (error) {
      setNotificationsError(
        notificationErrorMessage(
          error,
          "Benachrichtigungen konnten nicht als gelesen markiert werden.",
        ),
      );
    } finally {
      setNotificationActionPending(null);
    }
  }

  const currentSnapshot =
    snapshot?.tenantId === activeTenantId && snapshot.period === period
      ? snapshot
      : null;
  const dashboardMetricsLoading =
    isSupabaseConfigured &&
    Boolean(session && activeTenant) &&
    currentSnapshot === null;

  useEffect(() => {
    if (!supabase || !session || !activeTenant || !currentSnapshot) {
      setDashboardTrends({});
      return;
    }

    let mounted = true;
    const dashboardSupabase = supabase;
    const tenantId = activeTenant.id;
    const userId = session.user.id;
    const { currentStart, previousStart } = dashboardComparisonWindow(period);

    void (async () => {
      const { data: statuses, error: statusesError } = await dashboardSupabase
        .from("ticket_statuses")
        .select("id, is_closed")
        .eq("tenant_id", tenantId);
      if (statusesError) throw statusesError;
      const closedStatusIds = (statuses ?? [])
        .filter((status) => status.is_closed)
        .map((status) => status.id);
      const previousTicketCount = (
        scope: "all" | "closed" | "mine" | "unassigned",
      ) => {
        let query = dashboardSupabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .gte("created_at", previousStart)
          .lt("created_at", currentStart);
        if (scope === "closed") {
          return closedStatusIds.length > 0
            ? query.in("status_id", closedStatusIds)
            : Promise.resolve({ count: 0, error: null });
        }
        if (scope === "mine") {
          return query.or(
            `assigned_agent_id.eq.${userId},requester_id.eq.${userId}`,
          );
        }
        if (scope === "unassigned") return query.is("assigned_agent_id", null);
        return query;
      };

      const [all, closed, mine, unassigned] = await Promise.all([
        previousTicketCount("all"),
        previousTicketCount("closed"),
        previousTicketCount("mine"),
        previousTicketCount("unassigned"),
      ]);
      if (all.error || closed.error || mine.error || unassigned.error) {
        throw new Error("previous_dashboard_metrics_unavailable");
      }

      const toCount = (value: string): number | null => {
        const count = Number(value);
        return Number.isInteger(count) && count >= 0 ? count : null;
      };
      const previousValues = {
        closed: closed.count ?? 0,
        mine: mine.count ?? 0,
        open: Math.max(0, (all.count ?? 0) - (closed.count ?? 0)),
        unassigned: unassigned.count ?? 0,
      };
      const currentValues = {
        closed: toCount(currentSnapshot.metrics.closed),
        mine: toCount(currentSnapshot.metrics.mine),
        open: toCount(currentSnapshot.metrics.open),
        unassigned: toCount(currentSnapshot.metrics.unassigned),
      };
      const nextTrends: DashboardMetricTrends = {};
      for (const key of ["closed", "mine", "open", "unassigned"] as const) {
        const current = currentValues[key];
        if (current === null) continue;
        const trend = dashboardTrendFromComparison(
          current,
          previousValues[key],
        );
        if (trend) nextTrends[key] = trend;
      }
      if (mounted) setDashboardTrends(nextTrends);
    })().catch(() => {
      // Historical comparison data is optional and remains invisible when
      // RLS, membership or the network cannot provide it safely.
      if (mounted) setDashboardTrends({});
    });

    return () => {
      mounted = false;
    };
  }, [activeTenant, currentSnapshot, period, session]);

  const view: DashboardView = isSupabaseConfigured
    ? (currentSnapshot ?? {
        activity: [],
        hasMoreTickets: false,
        metrics: LOADING_DASHBOARD_METRICS,
        serviceHealth: [],
        ticketCount: 0,
        tickets: [],
        updatedAt: "wird geladen",
      })
    : previewView;
  const queueOptions = useMemo<readonly [string, string][]>(() => {
    const configuredQueues = view.ticketFilterCatalog?.departments ?? [];
    if (configuredQueues.length > 0) {
      return configuredQueues.map((department): [string, string] => [
        department.key,
        department.label,
      ]);
    }
    return Array.from(
      new Map(
        view.tickets.map((ticket) => [ticket.queue, ticket.queueLabel]),
      ).entries(),
    ) as [string, string][];
  }, [view.ticketFilterCatalog?.departments, view.tickets]);
  const ticketFilterOptions = useMemo(() => {
    const collator = new Intl.Collator("de-CH", { sensitivity: "base" });
    const statuses =
      view.ticketFilterCatalog?.statuses ??
      Array.from(new Set(view.tickets.map((ticket) => ticket.state)))
        .filter(Boolean)
        .sort(collator.compare);
    const priorities =
      view.ticketFilterCatalog?.priorities ??
      Array.from(
        new Set(
          view.tickets.map((ticket) => ticket.priority ?? "Ohne Priorität"),
        ),
      )
        .filter(Boolean)
        .sort(collator.compare);
    const departments =
      view.ticketFilterCatalog?.departments ??
      queueOptions
        .map(([key, label]) => ({ key, label }))
        .sort((left, right) => collator.compare(left.label, right.label));
    const agentsById = new Map(
      (view.ticketAgents ?? []).map((agent) => [agent.id, agent]),
    );
    for (const ticket of view.tickets) {
      if (!ticket.assignedAgentId || !ticket.assignedAgentName) continue;
      agentsById.set(ticket.assignedAgentId, {
        displayName: ticket.assignedAgentName,
        id: ticket.assignedAgentId,
      });
    }
    const agents = [...agentsById.values()].sort(
      (left, right) =>
        collator.compare(left.displayName, right.displayName) ||
        left.id.localeCompare(right.id),
    );
    return { agents, departments, priorities, statuses };
  }, [queueOptions, view.ticketAgents, view.ticketFilterCatalog, view.tickets]);
  const parsedTicketSearch = useMemo(() => parseTicketSearch(query), [query]);
  const effectiveTicketScope = canWorkTickets ? ticketScope : "mine";
  const metricTicketIds = useMemo(
    () => (metricTicketFilter ? new Set(metricTicketFilter.ticketIds) : null),
    [metricTicketFilter],
  );
  const missingMetricTickets = useMemo(() => {
    if (!metricTicketIds) return false;
    const loadedMetricTicketCount = view.tickets.filter((ticket) =>
      metricTicketIds.has(ticket.recordId ?? ticket.id),
    ).length;
    return loadedMetricTicketCount < metricTicketIds.size;
  }, [metricTicketIds, view.tickets]);
  const filteredTickets = useMemo(() => {
    // Die Datenbank wendet sämtliche Filter und die globale Sortierung vor der
    // Pagination an. Eine lokale Filter- oder Sortierlogik würde diese Ordnung
    // bei weiteren Seiten wieder verfälschen.
    return view.tickets;
  }, [view.tickets]);
  const splitSelectedTicket = useMemo(
    () =>
      filteredTickets.find(
        (ticket) => (ticket.recordId ?? ticket.id) === splitSelectedTicketId,
      ) ?? null,
    [filteredTickets, splitSelectedTicketId],
  );

  useEffect(() => {
    if (!workspacePreferences.ticketSplitView) {
      setSplitSelectedTicketId(null);
      return;
    }
    if (splitSelectedTicket) return;
    const firstTicket = filteredTickets[0];
    setSplitSelectedTicketId(
      firstTicket ? (firstTicket.recordId ?? firstTicket.id) : null,
    );
  }, [
    filteredTickets,
    splitSelectedTicket,
    workspacePreferences.ticketSplitView,
  ]);

  const greetingName = operatorName.split(" ")[0] || operatorName;
  const queueCount = (queueKey: string) =>
    view.tickets.filter((ticket) => ticket.queue === queueKey).length;
  const openTicketScope = (scope: TicketScope) => {
    setMetricTicketFilter(null);
    setTicketListRefinement(DEFAULT_TICKET_LIST_REFINEMENT);
    setTicketScope(canWorkTickets ? scope : "mine");
    setQueue("alle");
    setSection("Tickets");
  };
  const openTicketFromList = (ticketId: string) => {
    if (workspacePreferences.ticketSplitView && canWorkTickets) {
      setSplitSelectedTicketId(ticketId);
      return;
    }
    setSelectedTicketId(ticketId);
  };
  const openTeamQueue = (teamQueue: TeamQueue) => {
    const department = departmentQueueKeys[teamQueue.departmentId];
    if (!department) {
      setErrorMessage(
        "Die Abteilungszuordnung für diese Warteschlange ist derzeit nicht verfügbar.",
      );
      return;
    }
    setMetricTicketFilter(null);
    setQuery("");
    setTicketListRefinement(DEFAULT_TICKET_LIST_REFINEMENT);
    setQueue(department.key);
    setTicketScope("open");
    setSection("Tickets");
    setSplitSelectedTicketId(null);
  };
  const updateTicketSelection = (ticketId: string, selected: boolean) => {
    setTicketActionStatus("");
    if (
      selected &&
      !selectedTicketIds.has(ticketId) &&
      selectedTicketIds.size >= 50
    ) {
      setTicketActionStatus(
        "Für eine Mehrfachaktion können höchstens 50 Tickets ausgewählt werden.",
      );
      return;
    }
    setSelectedTicketIds((current) => {
      const next = new Set(current);
      if (selected) next.add(ticketId);
      else next.delete(ticketId);
      return next;
    });
  };
  const clearTicketSelection = () => setSelectedTicketIds(new Set());
  const clearTicketFilters = () => {
    clearTicketSelection();
    setMetricTicketFilter(null);
    setQuery("");
    setTicketListRefinement(DEFAULT_TICKET_LIST_REFINEMENT);
    setQueue("alle");
    setTicketScope(canWorkTickets ? "all" : "mine");
  };
  const updateTicketSearchQuery = (nextQuery: string) => {
    if (!nextQuery.trim()) setMetricTicketFilter(null);
    setQuery(nextQuery);
  };
  const openMetricTickets = (filter: MetricTicketFilter) => {
    clearTicketSelection();
    setQuery("");
    setTicketListRefinement(DEFAULT_TICKET_LIST_REFINEMENT);
    setQueue("alle");
    setTicketScope(canWorkTickets ? "all" : "mine");
    setMetricTicketFilter(filter);
    setSection("Tickets");
    setSplitSelectedTicketId(null);
  };
  const ticketScopeLabel: Record<TicketScope, string> = {
    all: "Alle sichtbaren Tickets",
    closed: "Gelöste Tickets",
    mine: "Meine Tickets",
    open: "Offene Tickets",
    unassigned: "Nicht zugewiesene Tickets",
  };
  const hasTicketListRefinement =
    query.trim().length > 0 ||
    ticketListRefinement.agent !== "all" ||
    ticketListRefinement.status !== "all" ||
    ticketListRefinement.department !== "all" ||
    ticketListRefinement.priority !== "all" ||
    ticketListRefinement.sortBy !== "updated" ||
    ticketListRefinement.sortDirection !== "desc";
  const isFeatureEnabled = (featureKey: string) =>
    !isSupabaseConfigured || tenantFeatures[featureKey] === true;
  const quickCreateActions = quickCreateActionsForContext({
    assetManagementEnabled: isFeatureEnabled("assets.management"),
    canWorkTickets,
    experienceWorkspaceEnabled,
    hasActiveTenant: activeTenant !== null,
    knowledgeBaseEnabled: isFeatureEnabled("knowledge.base"),
  });
  const activeQuickCreateRequest =
    quickCreateRequest &&
    quickCreateRequestMatchesTenant(
      quickCreateRequest.tenantId,
      activeTenant?.id ?? null,
    )
      ? quickCreateRequest
      : null;
  const pageViewOptions = pageViewOptionsForSection(
    section,
    isSupabaseConfigured && canWorkTickets,
  );
  const hasPageViewOptions = pageViewOptions.length > 0;
  const isPersonalAppearanceDialog = workspacePreferencesContext === "personal";
  const featureSections = sections.filter((item) => {
    if (item.label === "Arbeitsplatz") {
      return isWorkplaceAvailable(
        agentWorkbenchEnabled,
        experienceWorkspaceEnabled,
      );
    }
    if (item.label === "Mein Portal") return requesterPortalEnabled;
    if (
      item.label === "Services" ||
      item.label === "Assets" ||
      item.label === "Fälle"
    ) {
      return isFeatureEnabled("assets.management");
    }
    if (item.label === "Wissen") return isFeatureEnabled("knowledge.base");
    if (item.label === "Berichte") return isFeatureEnabled("reporting.service");
    return true;
  });
  const workSections = canWorkTickets
    ? featureSections
    : requesterNavigationSections(featureSections);

  useEffect(() => {
    if (ticketAccessLoading || tenantFeaturesLoading) return;
    const sectionFeature: Partial<Record<Section, string>> = {
      Fälle: "assets.management",
      Assets: "assets.management",
      Berichte: "reporting.service",
      Services: "assets.management",
      "Mein Portal": "requester.portal",
      Wissen: "knowledge.base",
    };
    const featureKey = sectionFeature[section];
    const workplaceUnavailable =
      section === "Arbeitsplatz" &&
      !isWorkplaceAvailable(agentWorkbenchEnabled, experienceWorkspaceEnabled);
    if (
      (workplaceUnavailable || featureKey) &&
      isSupabaseConfigured &&
      (workplaceUnavailable || tenantFeatures[featureKey!] !== true)
    ) {
      setSection("Übersicht");
    }
  }, [
    agentWorkbenchEnabled,
    experienceWorkspaceEnabled,
    section,
    tenantFeatures,
    tenantFeaturesLoading,
    ticketAccessLoading,
  ]);

  useEffect(() => {
    if (isSupabaseConfigured && tenantFeatures["ticketing.detail"] !== true) {
      setSelectedTicketId(null);
    }
  }, [tenantFeatures]);

  useEffect(() => {
    if (
      workspacePreferencesOpen &&
      !isPersonalAppearanceDialog &&
      !hasPageViewOptions
    ) {
      setWorkspacePreferencesOpen(false);
    }
  }, [
    hasPageViewOptions,
    isPersonalAppearanceDialog,
    workspacePreferencesOpen,
  ]);

  useEffect(() => {
    if (!workspacePreferencesOpen) return;
    const frame = window.requestAnimationFrame(() =>
      workspacePreferencesCloseRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [workspacePreferencesOpen]);

  useEffect(() => {
    if (!quickCreateMenuOpen) return;
    const frame = window.requestAnimationFrame(() =>
      quickCreateMenuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
        ?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [quickCreateMenuOpen]);

  useEffect(() => {
    if (!quickCreateMenuOpen) return;
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        quickCreateMenuRef.current?.contains(target) ||
        quickCreateTriggerRef.current?.contains(target)
      ) {
        return;
      }
      setQuickCreateMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeFromOutside);
    return () => document.removeEventListener("pointerdown", closeFromOutside);
  }, [quickCreateMenuOpen]);

  const keyboardNavigableTickets =
    (section === "Tickets" || section === "Übersicht") &&
    isSupabaseConfigured &&
    isFeatureEnabled("ticketing.detail")
      ? filteredTickets
      : [];
  const activeKeyboardTicketIndex = keyboardNavigableTickets.findIndex(
    (ticket) => (ticket.recordId ?? ticket.id) === keyboardActiveTicketId,
  );

  useEffect(() => {
    if (
      keyboardActiveTicketId &&
      !keyboardNavigableTickets.some(
        (ticket) => (ticket.recordId ?? ticket.id) === keyboardActiveTicketId,
      )
    ) {
      setKeyboardActiveTicketId(null);
    }
  }, [keyboardActiveTicketId, keyboardNavigableTickets]);

  useEffect(() => {
    if (!keyboardActiveTicketId) return;
    const frame = window.requestAnimationFrame(() =>
      document
        .getElementById(`ticket-shortcut-${keyboardActiveTicketId}`)
        ?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [keyboardActiveTicketId, section]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isInputLikeTarget(event.target)) return;

      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key === "?" &&
        !workspacePreferencesOpen &&
        !quickCreateMenuOpen &&
        !ticketComposerOpen &&
        !selectedTicketId &&
        !notificationPanelOpen
      ) {
        event.preventDefault();
        setKeyboardHelpOpen(true);
        return;
      }

      if (
        workspacePreferencesOpen ||
        quickCreateMenuOpen ||
        keyboardHelpOpen ||
        ticketComposerOpen ||
        selectedTicketId ||
        notificationPanelOpen ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        keyboardNavigableTickets.length === 0
      ) {
        return;
      }

      const key = event.key.toLocaleLowerCase("de-CH");
      if (key === "j" || key === "k") {
        event.preventDefault();
        const direction = key === "j" ? 1 : -1;
        const startIndex =
          activeKeyboardTicketIndex === -1
            ? direction === 1
              ? 0
              : keyboardNavigableTickets.length - 1
            : (activeKeyboardTicketIndex +
                direction +
                keyboardNavigableTickets.length) %
              keyboardNavigableTickets.length;
        const ticket = keyboardNavigableTickets[startIndex];
        if (!ticket) return;
        setKeyboardActiveTicketId(ticket.recordId ?? ticket.id);
        return;
      }

      if (event.key === "Enter" && activeKeyboardTicketIndex !== -1) {
        event.preventDefault();
        const ticket = keyboardNavigableTickets[activeKeyboardTicketIndex];
        if (!ticket) return;
        setSelectedTicketId(ticket.recordId ?? ticket.id);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeKeyboardTicketIndex,
    keyboardHelpOpen,
    keyboardNavigableTickets,
    notificationPanelOpen,
    quickCreateMenuOpen,
    selectedTicketId,
    ticketComposerOpen,
    workspacePreferencesOpen,
  ]);

  function updateWorkspacePreferences(updates: Partial<WorkspacePreferences>) {
    setWorkspacePreferences((current) => ({
      ...current,
      ...updates,
      ...(updates.startSection !== undefined
        ? { startWorkplaceView: null }
        : {}),
    }));
  }

  function closeQuickCreateMenu(returnFocus = true) {
    setQuickCreateMenuOpen(false);
    if (returnFocus) {
      window.requestAnimationFrame(() =>
        quickCreateTriggerRef.current?.focus(),
      );
    }
  }

  function activateTenant(nextTenantId: string) {
    if (nextTenantId === activeTenantId) return;
    setCanWorkTickets(false);
    setTicketAccessLoading(true);
    setIsTenantAdmin(false);
    setTenantFeatures({});
    setTenantFeaturesLoading(true);
    setWorkplaceRequestedView(null);
    setQuickCreateMenuOpen(false);
    setQuickCreateRequest(null);
    setTicketComposerOpen(false);
    setActiveTenantId(nextTenantId);
  }

  function consumeQuickCreateRequest(requestId: number) {
    setQuickCreateRequest((current) =>
      current?.id === requestId ? null : current,
    );
  }

  function moveFocusFromQuickCreateMenu(direction: -1 | 1) {
    const focusableElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !quickCreateMenuRef.current?.contains(element));
    const triggerIndex = focusableElements.indexOf(
      quickCreateTriggerRef.current as HTMLButtonElement,
    );
    const target = focusableElements[triggerIndex + direction];
    closeQuickCreateMenu(false);
    window.requestAnimationFrame(() =>
      (target ?? quickCreateTriggerRef.current)?.focus(),
    );
  }

  function startQuickCreate(action: QuickCreateAction) {
    setPersonalSettingsOpen(false);
    closeQuickCreateMenu(false);
    if (action === "ticket") {
      setQuickCreateRequest(null);
      setSection("Tickets");
      setTicketComposerOpen(true);
      return;
    }

    const requestTenantId = activeTenant?.id;
    if (!requestTenantId) return;

    const request: QuickCreateRequest = {
      action,
      id: ++quickCreateRequestIdRef.current,
      tenantId: requestTenantId,
    };
    setQuickCreateRequest(request);
    setSection(
      action === "problem"
        ? "Fälle"
        : action === "followUp"
          ? "Arbeitsplatz"
          : "Wissen",
    );
  }

  function handleQuickCreateMenuKeyDown(
    event: ReactKeyboardEvent<HTMLElement>,
  ) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeQuickCreateMenu();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      moveFocusFromQuickCreateMenu(event.shiftKey ? -1 : 1);
      return;
    }

    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ),
    );
    const currentIndex = items.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    if (items.length === 0) return;
    const lastIndex = items.length - 1;
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown")
      nextIndex = (currentIndex + 1) % items.length;
    if (event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + items.length) % items.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = lastIndex;
    if (nextIndex === currentIndex || nextIndex < 0) return;
    event.preventDefault();
    items[nextIndex]?.focus();
  }

  function closeWorkspacePreferences() {
    setWorkspacePreferencesOpen(false);
    const focusTarget = isPersonalAppearanceDialog
      ? personalSettingsTriggerRef.current
      : workspacePreferencesTriggerRef.current;
    window.requestAnimationFrame(() => focusTarget?.focus());
  }

  function handleWorkspacePreferencesKeyDown(
    event: ReactKeyboardEvent<HTMLElement>,
  ) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeWorkspacePreferences();
      return;
    }
    if (event.key !== "Tab") return;

    const focusableElements = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const firstFocusableElement = focusableElements[0];
    const lastFocusableElement =
      focusableElements[focusableElements.length - 1];
    if (!firstFocusableElement || !lastFocusableElement) return;

    if (event.shiftKey && document.activeElement === firstFocusableElement) {
      event.preventDefault();
      lastFocusableElement.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === lastFocusableElement) {
      event.preventDefault();
      firstFocusableElement.focus();
    }
  }

  const workspaceLiveMessage = errorMessage
    ? {
        id: `error:${errorMessage}`,
        message: errorMessage,
        title: "Datenzugriff prüfen",
        tone: "error" as const,
      }
    : notificationsError
      ? {
          id: `notification-error:${notificationsError}`,
          message: notificationsError,
          title: "Benachrichtigungen prüfen",
          tone: "error" as const,
        }
      : ticketActionStatus
        ? {
            id: `ticket-status:${ticketActionStatus}`,
            message: ticketActionStatus,
            title: "Ticketstatus aktualisiert",
            tone: "success" as const,
          }
        : notificationStatus
          ? {
              id: `notification-status:${notificationStatus}`,
              message: notificationStatus,
              title: "Benachrichtigungen aktualisiert",
              tone: "success" as const,
            }
          : experienceNotice
            ? {
                id: `experience:${experienceNotice.tone}:${experienceNotice.message}`,
                message: experienceNotice.message,
                title: "Wiedervorlagen",
                tone: experienceNotice.tone,
              }
            : null;

  const workspaceLiveMessageId = workspaceLiveMessage?.id ?? null;

  useEffect(() => {
    if (!workspaceLiveMessageId) {
      setDismissedLiveMessage(null);
      return;
    }

    setDismissedLiveMessage(null);
    const timeout = window.setTimeout(() => {
      setDismissedLiveMessage(workspaceLiveMessageId);
    }, 5_000);

    return () => window.clearTimeout(timeout);
  }, [workspaceLiveMessageId]);

  const workspaceClassName = [
    "app-shell",
    `app-shell--theme-${workspacePreferences.theme}`,
    `app-shell--density-${workspacePreferences.density}`,
    workspacePreferences.highContrast ? "app-shell--high-contrast" : "",
    workspacePreferences.reduceMotion ? "app-shell--reduced-motion" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const activeWorkspaceBranding =
    tenantWorkspaceBranding?.tenantId === activeTenant?.id
      ? tenantWorkspaceBranding
      : null;
  const workspaceBrandName = activeWorkspaceBranding
    ? activeWorkspaceBranding.portalName
    : productDefaults.productName;
  const workspaceBrandLogoAlt = workspaceBrandName
    ? `${workspaceBrandName} Logo`
    : "Portal-Logo";
  const workspaceBrandLogo =
    activeWorkspaceBranding?.logoUrl ?? "/assets/nextdesk-logo-product.png";
  const workspaceBrandStyle = {
    "--brand-accent": activeWorkspaceBranding?.accentColor ?? "#075985",
    "--brand-primary": activeWorkspaceBranding?.primaryColor ?? "#4338CA",
    "--brand-primary-hover":
      activeWorkspaceBranding?.secondaryColor ?? "#3730A3",
  } as CSSProperties;

  const visibleSections = isTenantAdmin
    ? [...workSections, { label: "Einstellungen" as const, Icon: Settings }]
    : workSections;
  const primaryNavigationSections = visibleSections.filter(
    (item) => item.label !== "Mein Portal",
  );
  const portalNavigationItem = visibleSections.find(
    (item) => item.label === "Mein Portal",
  );
  const unreadNotificationCount = useMemo(
    () =>
      notifications.filter((notification) => notification.readAt === null)
        .length,
    [notifications],
  );

  if (isSupabaseConfigured && session === undefined) {
    return <LoadingScreen message="Sichere Sitzung wird geprüft." />;
  }
  if (isSupabaseConfigured && session === null) {
    return <SignInScreen />;
  }
  if (isSupabaseConfigured && tenantLoading) {
    return <LoadingScreen message="Mandantenkontext wird geladen." />;
  }
  if (
    isSupabaseConfigured &&
    session &&
    ownerAccess === "ready" &&
    ownerView === "console"
  ) {
    return (
      <AccessShell>
        <OwnerConsoleScreen
          onOpenTenant={(tenantId) => {
            setMetricTicketFilter(null);
            activateTenant(tenantId);
            setOwnerView("tenant");
          }}
          onSignOut={() => void signOut()}
        />
      </AccessShell>
    );
  }
  if (
    isSupabaseConfigured &&
    session &&
    ownerAccess === "error" &&
    tenants.length === 0
  ) {
    return (
      <MembershipErrorScreen
        message={ownerAccessError}
        onSignOut={() => void signOut()}
      />
    );
  }
  if (isSupabaseConfigured && session && tenantLoadError) {
    return (
      <MembershipErrorScreen
        message={tenantLoadError}
        onSignOut={() => void signOut()}
      />
    );
  }
  if (
    isSupabaseConfigured &&
    session &&
    tenants.length === 0 &&
    ownerAccess !== "checking"
  ) {
    return <NoMembershipScreen onSignOut={() => void signOut()} />;
  }

  return (
    <div className={workspaceClassName} style={workspaceBrandStyle}>
      <aside className="command-rail" aria-label="Hauptnavigation">
        <div
          className={
            activeWorkspaceBranding?.logoUrl
              ? "brand-lockup brand-lockup--tenant"
              : "brand-lockup"
          }
        >
          <img
            alt={workspaceBrandLogoAlt}
            className={
              activeWorkspaceBranding?.logoUrl
                ? "brand-logo-mark brand-logo-mark--tenant"
                : "brand-logo-mark"
            }
            src={workspaceBrandLogo}
          />
          {workspaceBrandName ? <span>{workspaceBrandName}</span> : null}
        </div>
        <div className="navigation-cluster">
          <p className="navigation-label">ARBEITSBEREICH</p>
          <nav className="nav-list">
            {primaryNavigationSections.map((item) => (
              <button
                className={
                  section === item.label ? "nav-item active" : "nav-item"
                }
                key={item.label}
                onClick={() => {
                  setPersonalSettingsOpen(false);
                  setSection(item.label);
                }}
                type="button"
              >
                <item.Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                {sectionDisplayLabel(item.label)}
              </button>
            ))}
          </nav>
        </div>
        <div className="rail-footer">
          {portalNavigationItem && (
            <nav
              aria-label="Persönlicher Bereich"
              className="rail-footer__navigation"
            >
              <button
                className={
                  section === portalNavigationItem.label
                    ? "nav-item rail-footer__portal active"
                    : "nav-item rail-footer__portal"
                }
                onClick={() => {
                  setPersonalSettingsOpen(false);
                  setSection(portalNavigationItem.label);
                }}
                type="button"
              >
                <portalNavigationItem.Icon
                  aria-hidden="true"
                  size={18}
                  strokeWidth={1.8}
                />
                {sectionDisplayLabel(portalNavigationItem.label)}
              </button>
            </nav>
          )}
          <div className="rail-footer__account">
            <button
              aria-label="Persönliche Einstellungen öffnen"
              className="operator-profile-trigger"
              disabled={!session}
              onClick={() => setPersonalSettingsOpen(true)}
              ref={personalSettingsTriggerRef}
              type="button"
            >
              <span className="operator-avatar">{initials(operatorName)}</span>
              <span className="operator-profile-copy">
                <strong>{operatorName}</strong>
                <small>
                  {isSupabaseConfigured ? "Angemeldet" : "Service Operations"}
                </small>
              </span>
            </button>
            {isSupabaseConfigured ? (
              <button
                className="more-button"
                onClick={() => void signOut()}
                aria-label="Abmelden"
                type="button"
              >
                <LogOut aria-hidden="true" size={17} strokeWidth={1.8} />
              </button>
            ) : (
              <button
                className="more-button"
                aria-label="Profiloptionen"
                type="button"
              >
                <CircleEllipsis
                  aria-hidden="true"
                  size={19}
                  strokeWidth={1.8}
                />
              </button>
            )}
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">
              Operations /{" "}
              <span>{personalSettingsOpen ? "Mein Konto" : section}</span>
            </p>
            <h1>
              {personalSettingsOpen
                ? "Persönliche Einstellungen"
                : section === "Übersicht"
                  ? `Guten Morgen, ${greetingName}.`
                  : section}
            </h1>
          </div>
          <div className="topbar-actions">
            {ownerAccess === "ready" && ownerView === "tenant" && (
              <button
                className="platform-return"
                onClick={() => setOwnerView("console")}
                type="button"
              >
                <ArrowLeft aria-hidden="true" size={15} strokeWidth={1.8} />
                Plattform
              </button>
            )}
            {activeTenant &&
              ownerAccess === "ready" &&
              ownerView === "tenant" && (
                <label className="tenant-selector">
                  <span>Mandant</span>
                  <select
                    onChange={(event) => {
                      setMetricTicketFilter(null);
                      activateTenant(event.target.value);
                    }}
                    value={activeTenantId}
                  >
                    {tenants.map((tenant) => (
                      <option key={tenant.id} value={tenant.id}>
                        {tenant.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            {quickCreateActions.length > 0 && (
              <div className="quick-create-anchor">
                <button
                  aria-controls="quick-create-menu"
                  aria-expanded={quickCreateMenuOpen}
                  aria-haspopup="menu"
                  aria-label="Neue Erfassung öffnen"
                  className="quick-create-trigger"
                  onClick={() => setQuickCreateMenuOpen((current) => !current)}
                  ref={quickCreateTriggerRef}
                  title="Erfassen"
                  type="button"
                >
                  <Plus aria-hidden="true" size={20} strokeWidth={2.2} />
                </button>
                {quickCreateMenuOpen && (
                  <section
                    aria-label="Neue Erfassung"
                    className="quick-create-menu"
                    id="quick-create-menu"
                    onKeyDown={handleQuickCreateMenuKeyDown}
                    ref={quickCreateMenuRef}
                    role="menu"
                  >
                    <p className="quick-create-menu__heading">Erfassen</p>
                    {quickCreateActions.map((action) => {
                      const { Icon, label } =
                        quickCreateActionPresentation[action];
                      return (
                        <button
                          key={action}
                          onClick={() => startQuickCreate(action)}
                          role="menuitem"
                          type="button"
                        >
                          <Icon
                            aria-hidden="true"
                            size={18}
                            strokeWidth={1.8}
                          />
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </section>
                )}
              </div>
            )}
            {hasPageViewOptions && !personalSettingsOpen && (
              <button
                aria-controls="workspace-preferences"
                aria-expanded={workspacePreferencesOpen}
                aria-label={`Ansichtsoptionen für ${sectionDisplayLabel(section)} öffnen`}
                className="workspace-preferences-trigger"
                onClick={() => {
                  setWorkspacePreferencesContext("page");
                  setWorkspacePreferencesOpen(true);
                }}
                ref={workspacePreferencesTriggerRef}
                type="button"
              >
                <SlidersHorizontal
                  aria-hidden="true"
                  size={17}
                  strokeWidth={1.9}
                />
                <span>Ansicht</span>
              </button>
            )}
            {activeTenant && (
              <GlobalSearch
                disabled={!isSupabaseConfigured}
                onSelect={(result) => {
                  if (
                    !canWorkTickets &&
                    !canRequesterOpenSection(
                      sectionFromGlobalSearchResult(result),
                      requesterPortalEnabled,
                    )
                  ) {
                    return;
                  }
                  setGlobalSearchTarget(result);
                  if (result.resultType === "ticket" && result.ticketId) {
                    setSection("Tickets");
                    setSelectedTicketId(result.ticketId);
                    return;
                  }
                  setSection(sectionFromGlobalSearchResult(result));
                }}
                scope={canWorkTickets ? "all" : "tickets-only"}
                tenantId={activeTenant.id}
              />
            )}
            <div className="notification-center-anchor">
              <button
                aria-controls="notification-center-panel"
                aria-expanded={notificationPanelOpen}
                aria-label={`Benachrichtigungen, ${unreadNotificationCount} ungelesen`}
                className="notification-button"
                disabled={!isSupabaseConfigured || !activeTenant}
                onClick={toggleNotificationPanel}
                ref={notificationButtonRef}
                type="button"
              >
                <Bell aria-hidden="true" size={17} strokeWidth={1.8} />
                <b aria-hidden="true">{unreadNotificationCount}</b>
              </button>
              {notificationPanelOpen && (
                <section
                  aria-labelledby="notification-center-heading"
                  className="notification-center-panel"
                  id="notification-center-panel"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") closeNotificationPanel();
                  }}
                  ref={notificationPanelRef}
                  role="dialog"
                  tabIndex={-1}
                >
                  <div className="notification-center-panel__header">
                    <div>
                      <p className="eyebrow">Benachrichtigungen</p>
                      <h2 id="notification-center-heading">
                        Aktueller Mandant
                      </h2>
                    </div>
                    <button
                      className="notification-center-panel__close"
                      onClick={closeNotificationPanel}
                      type="button"
                    >
                      Schließen
                    </button>
                  </div>
                  {!notificationsLoading && unreadNotificationCount > 0 && (
                    <button
                      className="notification-center-panel__mark-all"
                      disabled={notificationActionPending !== null}
                      onClick={() => void markAllNotificationsAsRead()}
                      type="button"
                    >
                      {notificationActionPending === "all"
                        ? "Wird markiert …"
                        : "Alle als gelesen markieren"}
                    </button>
                  )}
                  {notificationsLoading ? (
                    <p aria-live="polite" className="empty-state">
                      Benachrichtigungen werden geladen …
                    </p>
                  ) : notificationsError ? (
                    <p aria-live="polite" className="empty-state" role="status">
                      {notificationsError}
                    </p>
                  ) : notifications.length === 0 ? (
                    <p className="empty-state">
                      Keine Benachrichtigungen vorhanden.
                    </p>
                  ) : (
                    <ul
                      aria-label="Benachrichtigungen"
                      className="notification-center-panel__list"
                    >
                      {notifications.map((notification) => {
                        const presentation =
                          notificationPresentation(notification);
                        const time = notificationTime(notification.createdAt);
                        const { Icon, description, title } = presentation;
                        return (
                          <li key={notification.id}>
                            <button
                              aria-label={`${title}. ${description}. ${time}${
                                notification.readAt ? "" : ". Ungelesen"
                              }`}
                              className={
                                notification.readAt
                                  ? "notification-center-panel__item"
                                  : "notification-center-panel__item notification-center-panel__item--unread"
                              }
                              disabled={notificationActionPending !== null}
                              onClick={() =>
                                void handleNotificationClick(notification)
                              }
                              type="button"
                            >
                              <span className="notification-center-panel__item-heading">
                                <Icon
                                  aria-hidden="true"
                                  size={18}
                                  strokeWidth={1.9}
                                />
                                <strong>{title}</strong>
                              </span>
                              <small>{description}</small>
                              {notification.ticket?.subject?.trim() ? (
                                <small className="notification-center-panel__subject">
                                  {notification.ticket.subject.trim()}
                                </small>
                              ) : null}
                              <small className="notification-center-panel__time">
                                {time}
                              </small>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {(notificationStatus ||
                    (notificationActionPending !== null &&
                      notificationActionPending !== "all")) && (
                    <p aria-live="polite" className="empty-state" role="status">
                      {notificationStatus ||
                        "Benachrichtigung wird aktualisiert …"}
                    </p>
                  )}
                </section>
              )}
            </div>
          </div>
        </header>

        {!isSupabaseConfigured && (
          <section className="preview-notice" aria-label="Vorschaumodus">
            <span className="notice-beacon" aria-hidden="true" />
            <div>
              <strong>Lokale Vorschau</strong>
              <span>
                Supabase ist noch nicht verbunden. Die angezeigten operativen
                Werte sind statische Preview-Daten.
              </span>
            </div>
            <span className="notice-code">PHASE 3</span>
          </section>
        )}
        {activeTenant && requesterPortalEnabled && (
          <IncidentBanner notices={activeIncidentNotices} />
        )}
        {personalSettingsOpen && session ? (
          <PersonalSettings
            onBack={() => setPersonalSettingsOpen(false)}
            onOpenAppearance={() => {
              setPersonalSettingsOpen(false);
              setWorkspacePreferencesContext("personal");
              setWorkspacePreferencesOpen(true);
            }}
            onSignOut={() => void signOut()}
            ssoEnforced={ssoEnforced}
            user={session.user}
            {...(activeTenant ? { tenantId: activeTenant.id } : {})}
          />
        ) : section === "Einstellungen" && activeTenant && isTenantAdmin ? (
          <>
            <TenantAdminSettings
              onBrandingUpdated={() =>
                setTenantBrandingRevision((revision) => revision + 1)
              }
              onFeaturesUpdated={() =>
                setTenantFeatureRevision((revision) => revision + 1)
              }
              onClose={() => setSection("Übersicht")}
              tenantId={activeTenant.id}
            />
          </>
        ) : section === "Wissen" &&
          activeTenant &&
          isFeatureEnabled("knowledge.base") ? (
          <KnowledgeBase
            createArticleRequestId={
              activeQuickCreateRequest?.action === "knowledge"
                ? activeQuickCreateRequest.id
                : undefined
            }
            focusArticleId={
              globalSearchTarget?.resultType === "knowledge"
                ? globalSearchTarget.entityId
                : undefined
            }
            onCreateArticleRequestConsumed={consumeQuickCreateRequest}
            tenantId={activeTenant.id}
          />
        ) : section === "Assets" &&
          activeTenant &&
          isFeatureEnabled("assets.management") ? (
          <ServiceAssets fixedTab="assets" tenantId={activeTenant.id} />
        ) : section === "Veranstaltungsräume" && activeTenant ? (
          <EventSpaces
            focusRequestId={
              globalSearchTarget?.resultType === "event_space"
                ? globalSearchTarget.entityId
                : undefined
            }
            tenantId={activeTenant.id}
          />
        ) : section === "Eintritte" && activeTenant ? (
          <Onboarding
            focusEntryId={
              globalSearchTarget?.resultType === "onboarding"
                ? globalSearchTarget.entityId
                : undefined
            }
            tenantId={activeTenant.id}
          />
        ) : section === "Services" &&
          activeTenant &&
          isFeatureEnabled("assets.management") ? (
          <ServiceAssets fixedTab="services" tenantId={activeTenant.id} />
        ) : section === "Fälle" &&
          activeTenant &&
          isFeatureEnabled("assets.management") ? (
          <ServiceAssets
            createProblemRequestId={
              activeQuickCreateRequest?.action === "problem"
                ? activeQuickCreateRequest.id
                : undefined
            }
            fixedTab="problems"
            onCreateProblemRequestConsumed={consumeQuickCreateRequest}
            tenantId={activeTenant.id}
          />
        ) : section === "Berichte" &&
          activeTenant &&
          isFeatureEnabled("reporting.service") ? (
          <ServiceReporting tenantId={activeTenant.id} />
        ) : section === "Arbeitsplatz" &&
          activeTenant &&
          session &&
          isWorkplaceAvailable(
            agentWorkbenchEnabled,
            experienceWorkspaceEnabled,
          ) ? (
          <>
            <IntroTip
              tenantId={activeTenant.id}
              tip="arbeitsplatz"
              userId={session.user.id}
            />
            <AgentWorkbenchPanel
              canManageIncidents={isTenantAdmin}
              followUpsEnabled={experienceWorkspaceEnabled}
              followUpsPanel={
                experienceWorkspaceEnabled ? (
                  <ExperienceWorkspace
                    createFollowUpRequestId={
                      activeQuickCreateRequest?.action === "followUp"
                        ? activeQuickCreateRequest.id
                        : undefined
                    }
                    focusFollowUpId={
                      globalSearchTarget?.resultType === "follow_up"
                        ? globalSearchTarget.entityId
                        : undefined
                    }
                    onCreateFollowUpRequestConsumed={consumeQuickCreateRequest}
                    onChanged={() =>
                      setExperienceFollowUpsRevision((revision) => revision + 1)
                    }
                    onNotice={(message, tone) =>
                      setExperienceNotice({ message, tone })
                    }
                    onOpenTicket={(ticketId) => {
                      setSection("Tickets");
                      setSelectedTicketId(ticketId);
                    }}
                    tenantId={activeTenant.id}
                    tickets={view.tickets}
                  />
                ) : undefined
              }
              onOpenQueue={openTeamQueue}
              onOpenTicket={(ticketId) => {
                setSection("Tickets");
                setSelectedTicketId(ticketId);
              }}
              onUnreadMentionsChange={ignoreUnreadMentions}
              requestedView={requestedWorkplaceViewForFollowUps(
                experienceWorkspaceEnabled,
                workplaceRequestedView === "followUps" ||
                  activeQuickCreateRequest?.action === "followUp" ||
                  globalSearchTarget?.resultType === "follow_up",
              )}
              showAgentWorkbench={agentWorkbenchEnabled}
              tenantId={activeTenant.id}
            />
          </>
        ) : section === "Mein Portal" &&
          activeTenant &&
          session &&
          requesterPortalEnabled ? (
          <>
            <IntroTip
              tenantId={activeTenant.id}
              tip="mein-portal"
              userId={session.user.id}
            />
            <RequesterPortalPanel tenantId={activeTenant.id} />
          </>
        ) : section === "Tickets" ? (
          <>
            <section className="ticket-panel panel ticket-module">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Autorisierte Vorgänge</p>
                  <h2>
                    {metricTicketFilter?.label ??
                      ticketScopeLabel[effectiveTicketScope]}
                  </h2>
                </div>
                <div className="ticket-list-heading-actions">
                  <span className="data-caption">
                    {view.hasMoreTickets
                      ? `${filteredTickets.length} geladen`
                      : `${filteredTickets.length} Treffer`}
                  </span>
                  {isSupabaseConfigured && canWorkTickets && (
                    <button
                      aria-pressed={workspacePreferences.ticketSplitView}
                      className="text-button ticket-split-toggle"
                      onClick={() =>
                        updateWorkspacePreferences({
                          ticketSplitView:
                            !workspacePreferences.ticketSplitView,
                        })
                      }
                      type="button"
                    >
                      {workspacePreferences.ticketSplitView
                        ? "Listenansicht"
                        : "Listen-Detail-Ansicht"}
                    </button>
                  )}
                  {activeTenant && canWorkTickets && (
                    <TicketCsvExport tenantId={activeTenant.id} />
                  )}
                  {activeTenant && canWorkTickets && (
                    <TicketCsvImport
                      onImported={() => {
                        clearTicketSelection();
                        setTicketPage(0);
                        setDashboardRevision((revision) => revision + 1);
                      }}
                      tenantId={activeTenant.id}
                    />
                  )}
                  {canWorkTickets && ticketScope !== "all" && (
                    <button
                      className="text-button"
                      onClick={() => {
                        clearTicketFilters();
                        setSection("Übersicht");
                      }}
                      type="button"
                    >
                      <ArrowLeft
                        aria-hidden="true"
                        size={16}
                        strokeWidth={1.8}
                      />
                      Zur Übersicht
                    </button>
                  )}
                </div>
              </div>
              <TicketScopeMetricTiles
                canWorkTickets={canWorkTickets}
                loading={dashboardMetricsLoading}
                metrics={view.metrics}
                onOpenScope={openTicketScope}
                selectedScope={metricTicketFilter ? null : effectiveTicketScope}
                trends={dashboardTrends}
              />
              {activeTenant && isSupabaseConfigured && canWorkTickets && (
                <TicketListFilters
                  agents={ticketFilterOptions.agents}
                  departments={ticketFilterOptions.departments}
                  filters={ticketListRefinement}
                  hasActiveFilters={hasTicketListRefinement}
                  onChange={setTicketListRefinement}
                  onClear={clearTicketFilters}
                  onQueryChange={updateTicketSearchQuery}
                  priorities={ticketFilterOptions.priorities}
                  query={query}
                  statuses={ticketFilterOptions.statuses}
                />
              )}
              {activeTenant && isSupabaseConfigured && canWorkTickets && (
                <SavedTicketViews
                  canManageTenantViews={canManageTenantViews}
                  currentUserId={session?.user.id}
                  filters={{
                    ...ticketListRefinement,
                    query,
                    queue,
                    ticketScope,
                  }}
                  loading={savedTicketViewsLoading}
                  onApply={(filters) => {
                    clearTicketSelection();
                    setMetricTicketFilter(null);
                    setQuery(filters.query);
                    setQueue(filters.queue);
                    setTicketScope(filters.ticketScope);
                    setTicketListRefinement({
                      agent: filters.agent,
                      department: filters.department,
                      priority: filters.priority,
                      sortBy: filters.sortBy,
                      sortDirection: filters.sortDirection,
                      status: filters.status,
                    });
                  }}
                  onSavedViewsChange={setSavedTicketViews}
                  savedViews={savedTicketViews}
                  tenantId={activeTenant.id}
                />
              )}
              {activeTenant && isSupabaseConfigured && canWorkTickets && (
                <BulkTicketStatusActions
                  onApplied={(updated, statusLabel) => {
                    clearTicketSelection();
                    setTicketPage(0);
                    setDashboardRevision((current) => current + 1);
                    setTicketActionStatus(
                      `${updated} Tickets wurden auf „${statusLabel}“ gesetzt.`,
                    );
                  }}
                  onDeleted={(deleted, cleanupPending) => {
                    clearTicketSelection();
                    setTicketPage(0);
                    setDashboardRevision((current) => current + 1);
                    setTicketActionStatus(
                      cleanupPending > 0
                        ? `${deleted} Tickets wurden gelöscht. Die Bereinigung von ${cleanupPending} Dateianhängen ist protokolliert.`
                        : `${deleted} Tickets wurden endgültig gelöscht.`,
                    );
                  }}
                  onClearSelection={clearTicketSelection}
                  selectedTicketIds={selectedTicketIds}
                  tenantId={activeTenant.id}
                />
              )}
              <QueueTabs
                queue={queue}
                queueCount={queueCount}
                queueOptions={queueOptions}
                setQueue={setQueue}
              />
              {metricTicketFilter && (
                <div className="ticket-search-summary ticket-metrics-filter">
                  <div>
                    <strong>Kennzahlenfilter aktiv</strong>
                    <span>{metricTicketFilter.label}</span>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setMetricTicketFilter(null)}
                    type="button"
                  >
                    Filter zurücksetzen
                  </button>
                </div>
              )}
              {(parsedTicketSearch.chips.length > 0 || query.trim()) && (
                <div className="ticket-search-summary">
                  <div>
                    <strong>Aktive Suche</strong>
                    <span>
                      Nutzen Sie z. B. <code>status:offen</code>,{" "}
                      <code>prio:hoch</code>, <code>queue:ict</code>,{" "}
                      <code>sla:kritisch</code> oder <code>agent:mir</code>.
                    </span>
                  </div>
                  <div
                    className="ticket-search-chips"
                    aria-label="Aktive Suchfilter"
                  >
                    {parsedTicketSearch.chips.map((chip) => (
                      <button
                        aria-label={`${chip.label} entfernen`}
                        className="ticket-search-chip"
                        key={chip.raw}
                        onClick={() =>
                          updateTicketSearchQuery(
                            removeTicketSearchClause(query, chip.raw),
                          )
                        }
                        type="button"
                      >
                        {chip.label}
                        <X aria-hidden="true" size={14} strokeWidth={2} />
                      </button>
                    ))}
                    <button
                      className="text-button"
                      onClick={clearTicketFilters}
                      type="button"
                    >
                      Suche zurücksetzen
                    </button>
                  </div>
                </div>
              )}
              {view.ticketListNote && (
                <p className="list-note">{view.ticketListNote}</p>
              )}
              {missingMetricTickets && (
                <p className="list-note" role="status">
                  Einige Tickets sind in der aktuellen Liste nicht geladen.
                </p>
              )}
              <div
                className={
                  workspacePreferences.ticketSplitView &&
                  isSupabaseConfigured &&
                  canWorkTickets
                    ? "ticket-list-detail ticket-list-detail--enabled"
                    : "ticket-list-detail"
                }
              >
                <div className="ticket-list-detail__list">
                  <TicketList
                    {...(isSupabaseConfigured && canWorkTickets
                      ? {
                          onOpen: openTicketFromList,
                          onSelectionChange: updateTicketSelection,
                          selectedTicketIds,
                        }
                      : {})}
                    {...(query.trim() ||
                    queue !== "alle" ||
                    (canWorkTickets && ticketScope !== "all") ||
                    metricTicketFilter ||
                    hasTicketListRefinement
                      ? { onClearFilters: clearTicketFilters }
                      : {})}
                    hasActiveFilters={Boolean(
                      query.trim() ||
                      queue !== "alle" ||
                      (canWorkTickets && ticketScope !== "all") ||
                      metricTicketFilter ||
                      hasTicketListRefinement,
                    )}
                    keyboardActiveTicketId={keyboardActiveTicketId}
                    loading={dashboardLoading && snapshot === null}
                    {...(activeTenant
                      ? { onCreateTicket: () => setTicketComposerOpen(true) }
                      : {})}
                    tickets={filteredTickets}
                  />
                </div>
                {workspacePreferences.ticketSplitView &&
                  isSupabaseConfigured &&
                  canWorkTickets && (
                    <TicketListDetailPreview
                      onOpenFull={() =>
                        splitSelectedTicket &&
                        setSelectedTicketId(
                          splitSelectedTicket.recordId ??
                            splitSelectedTicket.id,
                        )
                      }
                      ticket={splitSelectedTicket}
                    />
                  )}
              </div>
              {isSupabaseConfigured && view.hasMoreTickets && (
                <div className="ticket-load-more">
                  <button
                    className="secondary-button"
                    disabled={dashboardLoading}
                    onClick={() => setTicketPage((current) => current + 1)}
                    type="button"
                  >
                    {dashboardLoading
                      ? "Weitere Tickets werden geladen …"
                      : "Weitere Tickets laden"}
                  </button>
                </div>
              )}
            </section>
          </>
        ) : section !== "Übersicht" ? (
          <section className="module-stub">
            <p className="eyebrow">{section}</p>
            <h2>Dieser Bereich wird als nächstes angebunden.</h2>
            <p>
              Der Mandanten- und Anmeldekontext ist bereits aktiv. Die jeweilige
              Datenansicht folgt mit den zugehörigen RLS-Policies und
              auditierbaren Mutationen.
            </p>
            <button
              className="primary-button"
              onClick={() => setSection("Übersicht")}
              type="button"
            >
              Zur Übersicht
            </button>
          </section>
        ) : (
          <>
            <section
              className="signal-row signal-row--period"
              aria-label="Zeitraum"
            >
              <div className="segmented" aria-label="Zeitraum">
                {(["Heute", "7 Tage", "30 Tage"] as const).map((option) => (
                  <button
                    className={period === option ? "selected" : ""}
                    key={option}
                    onClick={() => setPeriod(option)}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
            </section>

            <TicketScopeMetricTiles
              canWorkTickets={canWorkTickets}
              loading={dashboardMetricsLoading}
              metrics={view.metrics}
              onOpenScope={openTicketScope}
              selectedScope={null}
              trends={dashboardTrends}
            />

            <section className="content-grid">
              <article className="ticket-panel panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Aktive Arbeit</p>
                    <h2>Priorisierte Tickets</h2>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setSection("Tickets")}
                    type="button"
                  >
                    Alle Tickets
                    <ArrowRight
                      aria-hidden="true"
                      size={16}
                      strokeWidth={1.8}
                    />
                  </button>
                </div>
                <QueueTabs
                  queue={queue}
                  queueCount={queueCount}
                  queueOptions={queueOptions}
                  setQueue={setQueue}
                />
                {view.ticketListNote && (
                  <p className="list-note">{view.ticketListNote}</p>
                )}
                <TicketList
                  {...(isSupabaseConfigured
                    ? { onOpen: setSelectedTicketId }
                    : {})}
                  keyboardActiveTicketId={keyboardActiveTicketId}
                  {...(activeTenant
                    ? { onCreateTicket: () => setTicketComposerOpen(true) }
                    : {})}
                  tickets={filteredTickets}
                />
              </article>

              <aside className="side-stack">
                {activeTenant && agentWorkbenchEnabled && (
                  <AgentMetricsCard
                    onOpenTickets={openMetricTickets}
                    tenantId={activeTenant.id}
                  />
                )}
                {activeTenant &&
                  canWorkTickets &&
                  experienceWorkspaceEnabled && (
                    <MyDayCard
                      onOpenFollowUps={() => {
                        setWorkplaceRequestedView("followUps");
                        setSection("Arbeitsplatz");
                      }}
                      onOpenTicket={(ticketId) => {
                        setSection("Tickets");
                        setSelectedTicketId(ticketId);
                      }}
                      refreshKey={experienceFollowUpsRevision}
                      tenantId={activeTenant.id}
                      tickets={view.tickets}
                    />
                  )}
                <article className="panel activity-panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">Ereignisse</p>
                      <h2>Gerade passiert</h2>
                    </div>
                  </div>
                  {view.activity.length === 0 ? (
                    <p className="empty-state">
                      Keine autorisierten Ereignisse im gewählten Zeitraum.
                    </p>
                  ) : (
                    <ol>
                      {view.activity.map((item) => (
                        <li key={`${item.time}-${item.text}`}>
                          <time>{item.time}</time>
                          <span
                            className={
                              item.tone === "critical"
                                ? "activity-marker critical"
                                : "activity-marker"
                            }
                          />
                          <p>{item.text}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </article>
              </aside>
            </section>
          </>
        )}
      </main>
      {workspaceLiveMessage &&
        dismissedLiveMessage !== workspaceLiveMessage.id && (
          <section
            aria-atomic="true"
            aria-live={
              workspaceLiveMessage.tone === "error" ? "assertive" : "polite"
            }
            className={`workspace-live-message workspace-live-message--${workspaceLiveMessage.tone}`}
            role={workspaceLiveMessage.tone === "error" ? "alert" : "status"}
          >
            <div>
              <strong>{workspaceLiveMessage.title}</strong>
              <span>{workspaceLiveMessage.message}</span>
            </div>
            <button
              aria-label="Meldung ausblenden"
              className="workspace-live-message__dismiss"
              onClick={() => setDismissedLiveMessage(workspaceLiveMessage.id)}
              type="button"
            >
              <X aria-hidden="true" size={17} strokeWidth={1.8} />
            </button>
          </section>
        )}
      {keyboardHelpOpen && (
        <div
          aria-label="Tastaturhilfe"
          aria-modal="true"
          className="keyboard-help-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setKeyboardHelpOpen(false);
          }}
          role="dialog"
        >
          <section
            aria-labelledby="keyboard-help-heading"
            className="keyboard-help"
            onKeyDown={(event) => {
              if (event.key === "Escape") setKeyboardHelpOpen(false);
            }}
          >
            <header>
              <div>
                <p className="eyebrow">TASTATUR</p>
                <h2 id="keyboard-help-heading">Schnell navigieren</h2>
              </div>
              <button
                aria-label="Tastaturhilfe schliessen"
                className="keyboard-help__close"
                onClick={() => setKeyboardHelpOpen(false)}
                ref={keyboardHelpCloseRef}
                type="button"
              >
                <X aria-hidden="true" size={18} strokeWidth={1.8} />
              </button>
            </header>
            <p>
              Die Kürzel sind in Eingabefeldern deaktiviert, damit Sie ungestört
              suchen und schreiben können.
            </p>
            <dl>
              <div>
                <dt>
                  <kbd>?</kbd>
                </dt>
                <dd>Diese Tastaturhilfe öffnen</dd>
              </div>
              <div>
                <dt>
                  <kbd>J</kbd> <kbd>K</kbd>
                </dt>
                <dd>
                  Vorheriges oder nächstes Ticket der gefilterten Liste
                  auswählen
                </dd>
              </div>
              <div>
                <dt>
                  <kbd>Enter</kbd>
                </dt>
                <dd>Ausgewähltes Ticket öffnen</dd>
              </div>
              <div>
                <dt>
                  <kbd>Esc</kbd>
                </dt>
                <dd>Dialog schliessen</dd>
              </div>
            </dl>
            <div className="keyboard-help__actions">
              <button
                className="primary-button"
                onClick={() => setKeyboardHelpOpen(false)}
                type="button"
              >
                Verstanden
              </button>
            </div>
          </section>
        </div>
      )}
      {workspacePreferencesOpen && (
        <div
          aria-label="Arbeitsbereichseinstellungen"
          aria-modal="true"
          className="workspace-preferences-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeWorkspacePreferences();
            }
          }}
          role="dialog"
        >
          <section
            aria-labelledby="workspace-preferences-heading"
            className="workspace-preferences"
            id="workspace-preferences"
            onKeyDown={handleWorkspacePreferencesKeyDown}
          >
            <header>
              <div>
                <p className="eyebrow">
                  {isPersonalAppearanceDialog
                    ? "PERSÖNLICHE DARSTELLUNG"
                    : "TICKETS / ANSICHT"}
                </p>
                <h2 id="workspace-preferences-heading">
                  {isPersonalAppearanceDialog
                    ? "Darstellung anpassen"
                    : "Ticketansicht anpassen"}
                </h2>
              </div>
              <button
                aria-label="Arbeitsbereichseinstellungen schliessen"
                className="workspace-preferences__close"
                onClick={closeWorkspacePreferences}
                ref={workspacePreferencesCloseRef}
                type="button"
              >
                <X aria-hidden="true" size={18} strokeWidth={1.8} />
              </button>
            </header>
            <div className="workspace-preferences__fields">
              {isPersonalAppearanceDialog && (
                <>
                  <label>
                    Startansicht
                    <select
                      onChange={(event) =>
                        updateWorkspacePreferences({
                          startSection: event.target.value as Section,
                        })
                      }
                      value={workspacePreferences.startSection}
                    >
                      {workSections.map((item) => (
                        <option key={item.label} value={item.label}>
                          {sectionDisplayLabel(item.label)}
                        </option>
                      ))}
                    </select>
                    <span>
                      Wird bei der nächsten Anmeldung als erste Ansicht
                      geöffnet.
                    </span>
                  </label>
                  <label>
                    Farbschema
                    <select
                      onChange={(event) =>
                        updateWorkspacePreferences({
                          theme: event.target.value as WorkspaceTheme,
                        })
                      }
                      value={workspacePreferences.theme}
                    >
                      <option value="light">Hell</option>
                      <option value="dark">Dunkel</option>
                      <option value="system">Systemeinstellung</option>
                    </select>
                    <span>
                      Standard ist Hell. Systemeinstellung folgt dem Farbschema
                      des Geräts.
                    </span>
                  </label>
                </>
              )}
              {!isPersonalAppearanceDialog &&
                pageViewOptions.includes("ticketDensity") && (
                  <label>
                    Listendichte
                    <select
                      onChange={(event) =>
                        updateWorkspacePreferences({
                          density: event.target.value as TicketListDensity,
                        })
                      }
                      value={workspacePreferences.density}
                    >
                      <option value="compact">Kompakt</option>
                      <option value="standard">Standard</option>
                      <option value="comfortable">Komfortabel</option>
                    </select>
                    <span>
                      Passt Abstand und Informationsdichte der Ticketliste an.
                    </span>
                  </label>
                )}
              {!isPersonalAppearanceDialog &&
                pageViewOptions.includes("ticketSplitView") && (
                  <label className="workspace-preferences__toggle">
                    <input
                      checked={workspacePreferences.ticketSplitView}
                      onChange={(event) =>
                        updateWorkspacePreferences({
                          ticketSplitView: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    <span>
                      <strong>Listen-Detail-Ansicht</strong>
                      <small>
                        Zeigt auf breiten Bildschirmen Ticketliste und
                        Ticketzusammenfassung nebeneinander an.
                      </small>
                    </span>
                  </label>
                )}
              {isPersonalAppearanceDialog && (
                <>
                  <label className="workspace-preferences__toggle">
                    <input
                      checked={workspacePreferences.highContrast}
                      onChange={(event) =>
                        updateWorkspacePreferences({
                          highContrast: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    <span>
                      <strong>Hoher Kontrast</strong>
                      <small>
                        Erhöht die Abgrenzung von Texten, Flächen und
                        Steuerelementen.
                      </small>
                    </span>
                  </label>
                  <label className="workspace-preferences__toggle">
                    <input
                      checked={workspacePreferences.reduceMotion}
                      onChange={(event) =>
                        updateWorkspacePreferences({
                          reduceMotion: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    <span>
                      <strong>Bewegung reduzieren</strong>
                      <small>
                        Blendet Übergänge und Animationen weitgehend aus.
                      </small>
                    </span>
                  </label>
                </>
              )}
            </div>
            <div className="workspace-preferences__actions">
              {isPersonalAppearanceDialog && (
                <button
                  className="secondary-button"
                  onClick={() =>
                    setWorkspacePreferences(DEFAULT_WORKSPACE_PREFERENCES)
                  }
                  type="button"
                >
                  Standard wiederherstellen
                </button>
              )}
              <button
                className="primary-button"
                onClick={closeWorkspacePreferences}
                type="button"
              >
                Fertig
              </button>
            </div>
          </section>
        </div>
      )}
      {activeTenant && ticketComposerOpen && (
        <div
          aria-label="Ticket erfassen"
          aria-modal="true"
          className="ticket-compose-dialog"
          onKeyDown={(event) => {
            if (event.key === "Escape") setTicketComposerOpen(false);
          }}
          role="dialog"
        >
          <div className="ticket-compose-dialog__surface">
            <button
              aria-label="Ticketerfassung schliessen"
              className="ticket-compose-dialog__close"
              onClick={() => setTicketComposerOpen(false)}
              type="button"
            >
              <X aria-hidden="true" size={20} strokeWidth={1.8} />
            </button>
            <TicketComposer
              currentUserId={session?.user.id ?? null}
              onCreated={(ticketId) => {
                setTicketPage(0);
                setDashboardRevision((value) => value + 1);
                setTicketComposerOpen(false);
                setSection("Tickets");
                setSelectedTicketId(ticketId);
              }}
              tenantId={activeTenant.id}
            />
          </div>
        </div>
      )}
      {activeTenant &&
        selectedTicketId &&
        isSupabaseConfigured &&
        isFeatureEnabled("ticketing.detail") && (
          <TicketDetail
            currentUserId={session?.user.id ?? null}
            onChanged={() => setDashboardRevision((value) => value + 1)}
            onClose={() => setSelectedTicketId(null)}
            tenantId={activeTenant.id}
            ticketId={selectedTicketId}
          />
        )}
    </div>
  );
}

function BulkTicketStatusActions({
  onApplied,
  onDeleted,
  onClearSelection,
  selectedTicketIds,
  tenantId,
}: {
  onApplied: (updated: number, statusLabel: string) => void;
  onDeleted: (deleted: number, cleanupPending: number) => void;
  onClearSelection: () => void;
  selectedTicketIds: ReadonlySet<string>;
  tenantId: string;
}) {
  const [statuses, setStatuses] = useState<BulkStatusOption[]>([]);
  const [statusKey, setStatusKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [closeConfirmationPending, setCloseConfirmationPending] =
    useState(false);
  const [deleteConfirmationPending, setDeleteConfirmationPending] =
    useState(false);
  const [deleteTicketIds, setDeleteTicketIds] = useState<string[] | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    setLoading(true);
    setStatusKey("");
    setErrorMessage("");
    setCloseConfirmationPending(false);
    setDeleteConfirmationPending(false);
    setDeleteTicketIds(null);
    void supabase.functions
      .invoke("ticket-bulk-status", {
        body: { type: "listStatusOptions", tenantId },
      })
      .then(({ data, error }) => {
        if (error) throw error;
        const parsed = bulkStatusOptionsFromResponse(data);
        if (!parsed) throw new Error("invalid_bulk_status_options_response");
        if (mounted) setStatuses(parsed);
      })
      .catch(async (error: unknown) => {
        if (!mounted) return;
        setStatuses([]);
        setErrorMessage(
          await functionErrorMessage(
            error,
            "Die verfügbaren Ticketstatus konnten nicht geladen werden.",
          ),
        );
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [tenantId]);

  useEffect(() => {
    setDeleteConfirmationPending(false);
    setDeleteTicketIds(null);
  }, [selectedTicketIds]);

  if (selectedTicketIds.size === 0) return null;

  const selectedStatus = statuses.find((status) => status.key === statusKey);
  async function updateStatus(confirmClose = false) {
    if (!supabase || !selectedStatus) return;
    if (selectedStatus.isClosed && !confirmClose) {
      setDeleteConfirmationPending(false);
      setCloseConfirmationPending(true);
      return;
    }
    setPending(true);
    setErrorMessage("");
    try {
      const { data, error } = await supabase.functions.invoke(
        "ticket-bulk-status",
        {
          body: {
            type: "applyStatus",
            tenantId,
            ticketIds: [...selectedTicketIds],
            statusKey: selectedStatus.key,
            confirmClose,
          },
        },
      );
      if (error) throw error;
      if (
        !isRecord(data) ||
        !isRecord(data.data) ||
        typeof data.data.updated !== "number"
      ) {
        throw new Error("invalid_bulk_status_response");
      }
      onApplied(data.data.updated, selectedStatus.label);
    } catch (error: unknown) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          "Die ausgewählten Tickets konnten nicht aktualisiert werden.",
        ),
      );
    } finally {
      setPending(false);
    }
  }

  function prepareTicketDeletion() {
    if (selectedTicketIds.size > 50) {
      setErrorMessage(
        "Für eine Mehrfachlöschung können höchstens 50 Tickets ausgewählt werden.",
      );
      return;
    }
    setCloseConfirmationPending(false);
    setDeleteTicketIds([...selectedTicketIds]);
    setDeleteConfirmationPending(true);
  }

  async function deleteTickets() {
    if (!supabase) return;
    if (!deleteTicketIds || deleteTicketIds.length < 1) return;
    setPending(true);
    setErrorMessage("");
    try {
      const { data, error } = await supabase.functions.invoke(
        "ticket-bulk-status",
        {
          body: {
            type: "deleteTickets",
            tenantId,
            ticketIds: deleteTicketIds,
            confirmDelete: true,
          },
        },
      );
      if (error) throw error;
      if (
        !isRecord(data) ||
        !isRecord(data.data) ||
        typeof data.data.deleted !== "number"
      ) {
        throw new Error("invalid_bulk_ticket_delete_response");
      }
      onDeleted(
        data.data.deleted,
        typeof data.data.cleanupPending === "number"
          ? data.data.cleanupPending
          : 0,
      );
    } catch (error: unknown) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          "Die ausgewählten Tickets konnten nicht gelöscht werden.",
        ),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="ticket-bulk-actions"
      onSubmit={(event) => {
        event.preventDefault();
        void updateStatus(false);
      }}
    >
      <div>
        <strong>{selectedTicketIds.size} Tickets ausgewählt</strong>
        <span>
          Der Status wird nur gesetzt, wenn Sie für jedes Ticket berechtigt
          sind.
        </span>
      </div>
      <label>
        <span>Neuer Status</span>
        <select
          disabled={loading || pending || statuses.length === 0}
          onChange={(event) => {
            setStatusKey(event.target.value);
            setCloseConfirmationPending(false);
            setDeleteConfirmationPending(false);
          }}
          value={statusKey}
        >
          <option value="">
            {loading ? "Status werden geladen …" : "Status auswählen"}
          </option>
          {statuses.map((status) => (
            <option key={status.key} value={status.key}>
              {status.label}
              {status.isClosed ? " · schliesst Ticket" : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="ticket-bulk-actions__buttons">
        <button
          className="secondary-button"
          disabled={pending}
          onClick={() => {
            setCloseConfirmationPending(false);
            setDeleteConfirmationPending(false);
            setDeleteTicketIds(null);
            onClearSelection();
          }}
          type="button"
        >
          Auswahl aufheben
        </button>
        <button
          className="primary-button"
          disabled={!selectedStatus || pending}
          type="submit"
        >
          {pending
            ? "Status wird gesetzt …"
            : selectedStatus?.isClosed
              ? "Abschluss vorbereiten"
              : "Status für Auswahl setzen"}
        </button>
        <button
          className="ticket-bulk-actions__delete-button"
          disabled={pending}
          onClick={prepareTicketDeletion}
          type="button"
        >
          Tickets löschen
        </button>
      </div>
      {closeConfirmationPending && selectedStatus?.isClosed && (
        <div
          aria-labelledby="bulk-close-confirmation-title"
          className="ticket-bulk-actions__confirmation"
          role="group"
        >
          <div>
            <strong id="bulk-close-confirmation-title">
              {selectedTicketIds.size} Tickets verbindlich schliessen?
            </strong>
            <p>
              Der Status «{selectedStatus.label}» wird für alle ausgewählten
              Tickets gesetzt. Die Berechtigung wird für jedes Ticket nochmals
              auf dem Server geprüft und der Abschluss im Verlauf protokolliert.
            </p>
          </div>
          <div className="ticket-bulk-actions__confirmation-buttons">
            <button
              className="primary-button"
              disabled={pending}
              onClick={() => void updateStatus(true)}
              type="button"
            >
              {selectedTicketIds.size} Tickets schliessen
            </button>
            <button
              className="secondary-button"
              disabled={pending}
              onClick={() => setCloseConfirmationPending(false)}
              type="button"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
      {deleteConfirmationPending && deleteTicketIds && (
        <div
          aria-labelledby="bulk-delete-confirmation-title"
          className="ticket-bulk-actions__confirmation ticket-bulk-actions__confirmation--danger"
          role="group"
        >
          <div>
            <strong id="bulk-delete-confirmation-title">
              {deleteTicketIds.length} Tickets endgültig löschen?
            </strong>
            <p>
              Tickets, Kommentare und zugehörige Einträge werden unwiderruflich
              entfernt.
            </p>
          </div>
          <div className="ticket-bulk-actions__confirmation-buttons">
            <button
              className="ticket-bulk-actions__delete-button"
              disabled={pending}
              onClick={() => void deleteTickets()}
              type="button"
            >
              {deleteTicketIds.length} Tickets endgültig löschen
            </button>
            <button
              className="secondary-button"
              disabled={pending}
              onClick={() => {
                setDeleteConfirmationPending(false);
                setDeleteTicketIds(null);
              }}
              type="button"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
      {errorMessage && (
        <p
          aria-live="polite"
          className="ticket-bulk-actions__error"
          role="status"
        >
          {errorMessage}
        </p>
      )}
    </form>
  );
}

function SavedTicketViews({
  canManageTenantViews,
  currentUserId,
  filters,
  loading,
  onApply,
  onSavedViewsChange,
  savedViews,
  tenantId,
}: {
  canManageTenantViews: boolean;
  currentUserId: string | undefined;
  filters: SavedTicketViewFilters;
  loading: boolean;
  onApply: (filters: SavedTicketViewFilters) => void;
  onSavedViewsChange: (savedViews: SavedTicketView[]) => void;
  savedViews: SavedTicketView[];
  tenantId: string;
}) {
  const [selectedViewId, setSelectedViewId] = useState("");
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"private" | "tenant">("private");
  const [pending, setPending] = useState<"save" | "delete" | null>(null);
  const [status, setStatus] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const selectedView =
    savedViews.find((savedView) => savedView.id === selectedViewId) ?? null;
  const canDelete = Boolean(
    selectedView &&
    (selectedView.ownerId === currentUserId ||
      (selectedView.visibility === "tenant" && canManageTenantViews)),
  );

  useEffect(() => {
    if (!selectedViewId) return;
    const nextSelectedView = savedViews.find(
      (savedView) => savedView.id === selectedViewId,
    );
    if (nextSelectedView) return;
    setSelectedViewId("");
    setName("");
    setVisibility("private");
  }, [savedViews, selectedViewId]);

  function applySelectedView(viewId: string) {
    setErrorMessage("");
    setStatus("");
    setSelectedViewId(viewId);
    const nextSelectedView = savedViews.find(
      (savedView) => savedView.id === viewId,
    );
    if (!nextSelectedView) {
      setName("");
      setVisibility("private");
      return;
    }
    setName(nextSelectedView.name);
    setVisibility(nextSelectedView.visibility);
    onApply(nextSelectedView.filters);
    setStatus(`Ansicht „${nextSelectedView.name}“ angewendet.`);
  }

  function startNewView() {
    setSelectedViewId("");
    setName("");
    setVisibility("private");
    setErrorMessage("");
    setEditorOpen(true);
    setStatus("Neue Ansicht aus den aktuellen Filtern anlegen.");
  }

  function startEditView() {
    if (!selectedView) return;
    setErrorMessage("");
    setEditorOpen(true);
    setStatus(`Ansicht „${selectedView.name}“ bearbeiten.`);
  }

  async function saveView(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !currentUserId) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMessage("Bitte geben Sie einen Namen für die Ansicht ein.");
      return;
    }

    setPending("save");
    setErrorMessage("");
    setStatus("");
    const updating = Boolean(selectedView);
    try {
      const { data, error } = await supabase.functions.invoke(
        "ticket-saved-views",
        {
          body: {
            type: "saveSavedView",
            tenantId,
            ...(selectedView ? { viewId: selectedView.id } : {}),
            name: trimmedName,
            visibility,
            filters,
          },
        },
      );
      if (error) throw error;
      const savedView = savedTicketViewFromSaveResponse(data);
      if (!savedView) throw new Error("invalid_saved_view_response");
      onSavedViewsChange(
        [
          ...savedViews.filter((view) => view.id !== savedView.id),
          savedView,
        ].sort(
          (left, right) =>
            left.visibility.localeCompare(right.visibility) ||
            right.updatedAt.localeCompare(left.updatedAt),
        ),
      );
      setSelectedViewId(savedView.id);
      setName(savedView.name);
      setVisibility(savedView.visibility);
      setEditorOpen(false);
      setStatus(
        updating
          ? `Ansicht „${savedView.name}“ aktualisiert.`
          : `Ansicht „${savedView.name}“ gespeichert.`,
      );
    } catch (error: unknown) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          "Die Ansicht konnte nicht gespeichert werden. Prüfen Sie Name und Berechtigung.",
        ),
      );
    } finally {
      setPending(null);
    }
  }

  async function deleteView() {
    if (!supabase || !selectedView || !canDelete) return;
    setPending("delete");
    setErrorMessage("");
    setStatus("");
    try {
      const { error } = await supabase.functions.invoke("ticket-saved-views", {
        body: {
          type: "deleteSavedView",
          tenantId,
          viewId: selectedView.id,
        },
      });
      if (error) throw error;
      onSavedViewsChange(
        savedViews.filter((savedView) => savedView.id !== selectedView.id),
      );
      setSelectedViewId("");
      setName("");
      setVisibility("private");
      setEditorOpen(false);
      setStatus(`Ansicht „${selectedView.name}“ gelöscht.`);
    } catch (error: unknown) {
      setErrorMessage(
        await functionErrorMessage(
          error,
          "Die Ansicht konnte nicht gelöscht werden.",
        ),
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <section
      aria-label="Gespeicherte Ticketansichten"
      className="saved-ticket-views"
    >
      <div className="saved-ticket-views__picker">
        <label>
          <span>Gespeicherte Ansicht</span>
          <select
            disabled={loading || pending !== null}
            onChange={(event) => applySelectedView(event.target.value)}
            value={selectedViewId}
          >
            <option value="">
              {loading ? "Ansichten werden geladen …" : "Aktuelle Filter"}
            </option>
            {savedViews.map((savedView) => (
              <option key={savedView.id} value={savedView.id}>
                {savedView.name}
                {savedView.visibility === "tenant"
                  ? " · Mandant"
                  : " · Persönlich"}
              </option>
            ))}
          </select>
        </label>
        <button
          className="text-button"
          disabled={pending !== null}
          onClick={startNewView}
          type="button"
        >
          Neue Ansicht
        </button>
        {selectedView && (
          <button
            className="text-button"
            disabled={pending !== null}
            onClick={startEditView}
            type="button"
          >
            Bearbeiten
          </button>
        )}
      </div>
      {editorOpen && (
        <form className="saved-ticket-views__editor" onSubmit={saveView}>
          <label>
            <span>Name</span>
            <input
              disabled={loading || pending !== null}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="z. B. Meine offenen Tickets"
              required
              value={name}
            />
          </label>
          <label>
            <span>Sichtbarkeit</span>
            <select
              disabled={loading || pending !== null}
              onChange={(event) =>
                setVisibility(
                  event.target.value === "tenant" ? "tenant" : "private",
                )
              }
              value={visibility}
            >
              <option value="private">Nur für mich</option>
              <option value="tenant">Für den Mandanten</option>
            </select>
          </label>
          <div className="saved-ticket-views__actions">
            <button
              className="secondary-button"
              disabled={loading || pending !== null || !currentUserId}
              type="submit"
            >
              {pending === "save"
                ? "Wird gespeichert …"
                : selectedView
                  ? "Aktualisieren"
                  : "Ansicht speichern"}
            </button>
            {selectedView && canDelete && (
              <button
                className="danger-action"
                disabled={pending !== null}
                onClick={deleteView}
                type="button"
              >
                {pending === "delete" ? "Wird gelöscht …" : "Löschen"}
              </button>
            )}
            <button
              className="text-button"
              disabled={pending !== null}
              onClick={() => {
                setEditorOpen(false);
                setErrorMessage("");
              }}
              type="button"
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}
      {(status || errorMessage) && (
        <p
          aria-live="polite"
          className={
            errorMessage
              ? "saved-ticket-views__message error"
              : "saved-ticket-views__message"
          }
        >
          {errorMessage || status}
        </p>
      )}
    </section>
  );
}

function TicketListFilters({
  agents,
  departments,
  filters,
  hasActiveFilters,
  onChange,
  onClear,
  onQueryChange,
  priorities,
  query,
  statuses,
}: {
  agents: readonly TicketAgentOption[];
  departments: readonly { key: string; label: string }[];
  filters: TicketListRefinement;
  hasActiveFilters: boolean;
  onChange: (next: TicketListRefinement) => void;
  onClear: () => void;
  onQueryChange: (value: string) => void;
  priorities: readonly string[];
  query: string;
  statuses: readonly string[];
}) {
  const update = <Key extends keyof TicketListRefinement>(
    key: Key,
    value: TicketListRefinement[Key],
  ) => onChange({ ...filters, [key]: value });

  return (
    <section
      aria-labelledby="ticket-filter-heading"
      className="ticket-list-filters"
    >
      <div className="ticket-list-filters__heading">
        <div>
          <p className="eyebrow">Liste verfeinern</p>
          <h3 id="ticket-filter-heading">Filter &amp; Sortierung</h3>
        </div>
        {hasActiveFilters && (
          <button className="text-button" onClick={onClear} type="button">
            Filter zurücksetzen
          </button>
        )}
      </div>
      <label className="ticket-list-filters__search">
        <span>Ticket-Volltextsuche</span>
        <input
          autoComplete="off"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Ticketnummer, Betreff oder Beschreibung durchsuchen"
          spellCheck={false}
          type="search"
          value={query}
        />
        <small>
          Mindestens 2 Zeichen. Filter und Sortierung bleiben aktiv.
        </small>
      </label>
      <div className="ticket-list-filters__controls">
        <label>
          <span>Agent</span>
          <select
            onChange={(event) => update("agent", event.target.value)}
            value={filters.agent}
          >
            <option value="all">Alle Agenten</option>
            <option value="mine">Mir zugewiesen</option>
            <option value="unassigned">Nicht zugewiesen</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select
            onChange={(event) => update("status", event.target.value)}
            value={filters.status}
          >
            <option value="all">Alle Status</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Abteilung</span>
          <select
            onChange={(event) => update("department", event.target.value)}
            value={filters.department}
          >
            <option value="all">Alle Abteilungen</option>
            {departments.map((department) => (
              <option key={department.key} value={department.key}>
                {department.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Priorität</span>
          <select
            onChange={(event) => update("priority", event.target.value)}
            value={filters.priority}
          >
            <option value="all">Alle Prioritäten</option>
            {priorities.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Sortieren nach</span>
          <select
            onChange={(event) =>
              update("sortBy", event.target.value as TicketSortBy)
            }
            value={filters.sortBy}
          >
            <option value="updated">Letzte Änderung</option>
            <option value="agent">Agent</option>
            <option value="status">Status</option>
            <option value="department">Abteilung</option>
            <option value="priority">Priorität</option>
          </select>
        </label>
        <label>
          <span>Reihenfolge</span>
          <select
            onChange={(event) =>
              update("sortDirection", event.target.value as TicketSortDirection)
            }
            value={filters.sortDirection}
          >
            <option value="desc">Absteigend</option>
            <option value="asc">Aufsteigend</option>
          </select>
        </label>
      </div>
    </section>
  );
}

function QueueTabs({
  queue,
  queueCount,
  queueOptions,
  setQueue,
}: {
  queue: string;
  queueCount: (key: string) => number;
  queueOptions: readonly [string, string][];
  setQueue: (key: string) => void;
}) {
  return (
    <div className="queue-tabs" role="group" aria-label="Ticket-Queue">
      <button
        className={queue === "alle" ? "queue-tab selected" : "queue-tab"}
        onClick={() => setQueue("alle")}
        type="button"
      >
        Alle Queues
      </button>
      {queueOptions.map(([key, label]) => (
        <button
          className={queue === key ? "queue-tab selected" : "queue-tab"}
          key={key}
          onClick={() => setQueue(key)}
          type="button"
        >
          {label}
          <span>{queueCount(key)}</span>
        </button>
      ))}
    </div>
  );
}
