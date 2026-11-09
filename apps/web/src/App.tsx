import { useTicketHoverPreview } from "./ticket-hover-preview";
import {
  AGENT_TOUR,
  markTourSeen,
  OnboardingTour,
  tourSeen,
} from "./onboarding-tour";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  AtSign,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  ArrowUp,
  BadgeCheck,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarClock,
  CalendarDays,
  ChartNoAxesCombined,
  Columns3,
  ChevronDown,
  ClipboardList,
  CircleCheck,
  CircleEllipsis,
  Filter,
  FileWarning,
  FileText,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Minus,
  MonitorCog,
  Network,
  ShieldAlert,
  Plus,
  Settings,
  SlidersHorizontal,
  Ticket,
  UserRound,
  UsersRound,
  Boxes,
  ShoppingBag,
  List,
  ListChecks,
  Package,
  Trash2,
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
  ticketTeamsFromResponse,
  type LiveDashboardSnapshot,
  type TicketAgentOption,
  type TicketFilterCatalog,
  type TenantOption,
} from "./lib/live-dashboard";
import {
  drilldownChipLabel,
  normalizeTicketDrilldown,
  type TicketDrilldown,
} from "./lib/ticket-drilldown";
import { createPersonalWorkspace, deleteAccount } from "./lib/account";
import { assetIdFromSearch, rackFromSearch } from "./lib/asset-labels";
import { acceptTenantInvitations } from "./lib/tenant-invitations";
import { normalizeQueueSelection, shouldShowQueueTabs } from "./lib/queue-tabs";
import {
  collapsedNavigationCategoryAttentionCount,
  navigationItemAttentionCount,
} from "./lib/navigation-category-attention";
import { timeOfDayGreeting } from "./lib/greeting";
import { TicketComposer } from "./ticket-composer";
import { clearTicketComposerDraft } from "./lib/ticket-composer-draft";
import { TicketListIncidentHint } from "./ticket-learning";
import { TicketDetail } from "./ticket-detail";
import { TenantAdminSettings } from "./tenant-admin-settings";
import { KnowledgeBase } from "./knowledge-base";
import { GlobalSearch, type GlobalSearchResult } from "./global-search";
import { PersonOverview } from "./person-overview";
import type { PersonRef } from "./lib/person-overview";
import { ServiceReporting } from "./service-reporting";
import { TeamSupervision } from "./team-supervision";
import { MyPrioritiesCard } from "./my-priorities";
import { ProblemCandidates } from "./problem-insights";
import { TicketKanban } from "./ticket-kanban";
import { SupportLevelQueueFilter } from "./support-level-queue-filter";
import {
  supportLevelOfFilter,
  type SupportLevelFilter,
} from "./lib/support-levels";
import { Infrastructure } from "./infrastructure";
import { SecurityCases } from "./security-cases";
import {
  HomeLayoutEditor,
  loadHomeLayout,
  saveHomeLayout,
  type HomeLayout,
} from "./home-layout";
import { absenceLabel, loadActiveAbsences } from "./lib/active-absences";
import { ServiceAssets } from "./service-assets";
import {
  isPublicServiceStatusBadgeRequested,
  isPublicServiceStatusRequested,
  NavigationStatusBadge,
  PublicServiceStatusBadgePage,
  PublicServiceStatusPage,
  ServiceStatus,
} from "./service-status";
import { IMPRINT_URL, PRIVACY_URL, SUPPORT_URL } from "./lib/site-links";
import { Contracts } from "./contracts";
import { Licenses } from "./licenses";
import { EventSpaces } from "./event-spaces";
import { Onboarding } from "./onboarding";
import { Inventory } from "./inventory";
import { Shop } from "./shop";
import { PersonalSettings } from "./personal-settings";
import { ApprovalInboxCard } from "./approval-inbox";
import {
  OAuthConsentScreen,
  pendingOAuthAuthorizationId,
} from "./oauth-consent";
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
import { TicketTrashDialog } from "./ticket-trash";
import {
  bootstrapBrowserAuthSession,
  cleanBrowserAuthCallbackUrl,
  createBrowserAuthSessionGate,
  hasBrowserAuthCallback,
} from "./lib/auth-callback";
import { requiresWorkspaceContextReset } from "./lib/auth-session-context";
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
  isServiceStatusAvailable,
  tenantTicketAccessFromResponse,
} from "./lib/tenant-ticket-access";
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
import {
  splitWorkplaceNavigation,
  workplaceFirstNavigation,
} from "./lib/workplace-first-navigation";
import { nextExpandedAccordionId } from "./lib/navigation-accordion";
import { appRedirectUrl, isSupabaseConfigured, supabase } from "./lib/supabase";
import { loadServiceTaskAccess, ServiceTasks } from "./service-tasks";

type Section =
  | "Übersicht"
  | "Tickets"
  | "Shop"
  | "Arbeitsplatz"
  | "Erwähnungen"
  | "Mein Portal"
  | "Services"
  | "Serviceaufgaben"
  | "Systemstatus"
  | "Assets"
  | "Infrastruktur"
  | "Lager"
  | "Fälle"
  | "Sicherheitsfälle"
  | "Verträge"
  | "Lizenzen"
  | "Raumplanung"
  | "Eintritte"
  | "Wissen"
  | "Berichte"
  | "Teamführung"
  | "Einstellungen";
type TicketScope =
  "all" | "mine" | "unassigned" | "open" | "closed" | "delegated";
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
  followUp: { Icon: CalendarClock, label: "Wiedervorlage erfassen" },
  ticket: { Icon: Ticket, label: "Ticket erfassen" },
  problem: { Icon: FileWarning, label: "Fall erfassen" },
  serviceTask: { Icon: ListChecks, label: "Serviceaufgabe erfassen" },
  knowledge: { Icon: BookOpen, label: "Wissensartikel erfassen" },
  inventoryItem: { Icon: Package, label: "Lagerartikel erfassen" },
  contract: { Icon: FileText, label: "Vertrag erfassen" },
  license: { Icon: KeyRound, label: "Lizenz erfassen" },
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
  ownerName?: string | null;
  sharedDepartmentId?: string | null;
  sharedDepartmentName?: string | null;
  updatedAt: string;
  visibility: "private";
};

type BulkStatusOption = {
  isClosed: boolean;
  key: string;
  label: string;
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

const sections: readonly { label: Section; Icon: LucideIcon }[] =
  workplaceFirstNavigation([
    { label: "Übersicht", Icon: LayoutDashboard },
    { label: "Tickets", Icon: Ticket },
    { label: "Shop", Icon: ShoppingBag },
    { label: "Fälle", Icon: FileWarning },
    { label: "Sicherheitsfälle", Icon: ShieldAlert },
    { label: "Wissen", Icon: BookOpen },
    { label: "Services", Icon: MonitorCog },
    { label: "Serviceaufgaben", Icon: ListChecks },
    { label: "Assets", Icon: Boxes },
    { label: "Infrastruktur", Icon: Network },
    { label: "Lager", Icon: Boxes },
    { label: "Systemstatus", Icon: CircleCheck },
    { label: "Raumplanung", Icon: CalendarDays },
    { label: "Eintritte", Icon: ClipboardList },
    { label: "Verträge", Icon: FileText },
    { label: "Lizenzen", Icon: KeyRound },
    { label: "Berichte", Icon: ChartNoAxesCombined },
    { label: "Arbeitsplatz", Icon: BriefcaseBusiness },
    { label: "Teamführung", Icon: UsersRound },
  ]);

const NAVIGATION_CATEGORIES = [
  {
    heading: "ARBEITSBEREICH",
    id: "navigation-category-workspace",
    navigationLabel: "Arbeitsbereich",
    sectionLabels: ["Tickets", "Shop", "Fälle", "Sicherheitsfälle"],
  },
  {
    heading: "PLANUNG & BETRIEB",
    id: "navigation-category-operations",
    navigationLabel: "Planung und Betrieb",
    sectionLabels: ["Raumplanung", "Eintritte", "Serviceaufgaben"],
  },
  {
    heading: "WISSEN & RESSOURCEN",
    id: "navigation-category-resources",
    navigationLabel: "Wissen und Ressourcen",
    sectionLabels: ["Wissen", "Assets", "Lager", "Verträge", "Lizenzen"],
  },
  {
    heading: "DIENSTE & ÜBERWACHUNG",
    id: "navigation-category-services",
    navigationLabel: "Dienste und Überwachung",
    sectionLabels: ["Services", "Infrastruktur", "Systemstatus"],
  },
] as const satisfies readonly {
  heading: string;
  id: string;
  navigationLabel: string;
  sectionLabels: readonly Section[];
}[];

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
  delegatedForNames,
  loading,
  metrics,
  onOpenScope,
  selectedScope,
  trends,
}: {
  canWorkTickets: boolean;
  /** People the user currently stands in for (empty: no tile). */
  delegatedForNames: readonly string[];
  loading: boolean;
  metrics: DashboardMetrics;
  onOpenScope: (scope: TicketScope) => void;
  selectedScope: TicketScope | null;
  trends: DashboardMetricTrends;
}) {
  const className = (scope: TicketScope) =>
    `metric-card metric-button${
      selectedScope === scope ? " metric-card--active" : ""
    }`;

  return (
    <section
      className="metric-strip ticket-scope-metrics"
      aria-label="Ticket-Schnellfilter"
    >
      <button
        aria-pressed={selectedScope === "mine"}
        className={className("mine")}
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
          {delegatedForNames.length > 0 ? (
            <button
              aria-pressed={selectedScope === "delegated"}
              className={className("delegated")}
              disabled={loading}
              onClick={() => onOpenScope("delegated")}
              type="button"
            >
              <p>Stellvertretung</p>
              <div>
                <strong className="metric-card__names">
                  {delegatedForNames.join(", ")}
                </strong>
              </div>
              <small>Tickets der vertretenen Personen</small>
            </button>
          ) : null}
        </>
      )}
    </section>
  );
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
    value === "closed" ||
    value === "delegated"
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
  if (section === "Services") return "Dienste";
  return section === "Wissen" ? "Wissensdatenbank" : section;
}

/** Page title in the top bar; internal section keys stay stable. */
function sectionPageTitle(section: Section): string {
  return section === "Services" ? "Dienste" : section;
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
    value.visibility !== "private" ||
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
    ownerName: typeof value.ownerName === "string" ? value.ownerName : null,
    sharedDepartmentId:
      typeof value.sharedDepartmentId === "string"
        ? value.sharedDepartmentId
        : null,
    sharedDepartmentName:
      typeof value.sharedDepartmentName === "string"
        ? value.sharedDepartmentName
        : null,
    updatedAt: value.updatedAt,
    visibility: value.visibility,
  };
}

function savedTicketViewsFromResponse(value: unknown): {
  savedViews: SavedTicketView[];
} | null {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.savedViews)
  )
    return null;
  const savedViews = value.data.savedViews.map(savedTicketViewFromValue);
  return savedViews.every(
    (savedView): savedView is SavedTicketView => savedView !== null,
  )
    ? { savedViews }
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

function notificationPayloadNumber(
  notification: NotificationItem,
  key: string,
): number | null {
  if (!isRecord(notification.payload)) return null;
  const value = notification.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

function SupervisorRequestReply({
  notification,
  onAnswered,
}: {
  notification: NotificationItem;
  onAnswered: (notificationId: string) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState("");
  const requestId =
    notification.payload &&
    typeof notification.payload === "object" &&
    typeof (notification.payload as { requestId?: unknown }).requestId ===
      "string"
      ? (notification.payload as { requestId: string }).requestId
      : null;
  if (!requestId) return null;

  async function send() {
    const text = answer.trim();
    if (!supabase || !text || state === "saving" || !requestId) return;
    setState("saving");
    setError("");
    const { error: rpcError } = await supabase.rpc(
      "answer_ticket_supervisor_request",
      { p_answer: text, p_request_id: requestId },
    );
    if (rpcError) {
      setState("idle");
      setError(
        rpcError.code === "23505"
          ? "Diese Anfrage wurde bereits beantwortet."
          : "Die Antwort konnte nicht gespeichert werden.",
      );
      return;
    }
    setState("done");
    onAnswered(notification.id);
  }

  if (state === "done") {
    return (
      <p className="notification-reply__done" role="status">
        Antwort gespeichert. Sie steht als interne Notiz im Ticket.
      </p>
    );
  }
  return (
    <form
      className="notification-reply"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <label>
        <span className="sr-only">Antwort</span>
        <textarea
          disabled={state === "saving"}
          maxLength={4000}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder="Antwort schreiben …"
          rows={2}
          value={answer}
        />
      </label>
      <button
        className="primary-button"
        disabled={state === "saving" || !answer.trim()}
        type="submit"
      >
        {state === "saving" ? "Wird gesendet …" : "Antworten"}
      </button>
      {error ? (
        <small className="notification-reply__error" role="alert">
          {error}
        </small>
      ) : null}
    </form>
  );
}

/** Forwarded copies for a stand-in name the absent person. */
function notificationPresentation(
  notification: NotificationItem,
): NotificationPresentation {
  const base = baseNotificationPresentation(notification);
  const delegatedFrom = notificationPayloadText(
    notification,
    "delegatedFromName",
    200,
  );
  return delegatedFrom
    ? {
        ...base,
        description: `Stellvertretung für ${delegatedFrom}: ${base.description}`,
      }
    : base;
}

function baseNotificationPresentation(
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
    case "ticket.requester_reminder":
      return {
        description: `${ticketLabel} wartet auf Ihre Rückmeldung. Ist Ihr Problem gelöst?`,
        Icon: MessageSquareText,
        title: "Erinnerung: Ihre Rückmeldung fehlt",
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
    case "ticket.supervisor_request": {
      const askedBy =
        notificationPayloadText(notification, "askedByName", 120) ??
        "Eine Person";
      const question =
        notificationPayloadText(notification, "question", 1000) ?? "";
      return {
        description: `${askedBy} fragt zu ${ticketLabel}: ${question}`,
        Icon: MessageSquareText,
        title: "Anfrage an dich",
      };
    }
    case "ticket.supervisor_answer": {
      const answeredBy =
        notificationPayloadText(notification, "answeredByName", 120) ??
        "Eine Person";
      const answer =
        notificationPayloadText(notification, "answer", 1000) ?? "";
      return {
        description: `${answeredBy} zu ${ticketLabel}: ${answer}`,
        Icon: MessageSquareText,
        title: "Antwort auf deine Anfrage",
      };
    }
    case "infrastructure.due": {
      const asset =
        notificationPayloadText(notification, "assetName", 200) ?? "Ein Gerät";
      const reason = notificationPayloadText(notification, "reason", 40);
      const dueOn = notificationPayloadText(notification, "dueOn", 20);
      const what =
        reason === "warranty"
          ? "Die Garantie"
          : reason === "support"
            ? "Der Herstellersupport"
            : reason === "end_of_life"
              ? "Das End of Life"
              : "Die Wartung";
      const date = dueOn
        ? new Date(`${dueOn}T00:00:00`).toLocaleDateString("de-CH")
        : "bald";
      return {
        description: `${what} von ${asset} ist am ${date} fällig.`,
        Icon: AlertTriangle,
        title: "Infrastruktur: Fälligkeit",
      };
    }
    case "problem.recurring_detected": {
      const asset =
        notificationPayloadText(notification, "assetName", 200) ?? "Ein Gerät";
      const count = notificationPayloadNumber(notification, "alertCount");
      return {
        description: `${asset} hatte ${count ?? "mehrere"} Störungen in 30 Tagen. Ein Problemfall wurde eröffnet.`,
        Icon: AlertTriangle,
        title: "Wiederkehrende Störung",
      };
    }
    case "ticket.children_done": {
      const childCount = notificationPayloadNumber(notification, "childCount");
      return {
        description:
          childCount && childCount > 1
            ? `Alle ${childCount} Teil-Tickets von ${ticketLabel} sind erledigt. Das Hauptticket kann jetzt abgeschlossen werden.`
            : `Die Teil-Tickets von ${ticketLabel} sind erledigt. Das Hauptticket kann jetzt abgeschlossen werden.`,
        Icon: CheckCircle2,
        title: "Teil-Tickets erledigt",
      };
    }
    case "ticket.kudos": {
      const rawName = notificationPayloadText(
        notification,
        "requesterName",
        120,
      );
      const name =
        rawName && !rawName.includes("@") ? rawName : "Die meldende Person";
      const score = notificationPayloadNumber(notification, "score");
      const excerpt = notificationPayloadText(notification, "excerpt", 200);
      return {
        description: `${name} hat ${ticketLabel} ${score ? `mit ${score}/5 ` : ""}bewertet${excerpt ? `: «${excerpt}»` : "."}`,
        Icon: BadgeCheck,
        title: "Lob von Kund:innen",
      };
    }
    case "ticket.vendor_reminder": {
      const vendor =
        notificationPayloadText(notification, "vendorName", 160) ??
        "Der Drittanbieter";
      const caseNumber = notificationPayloadText(
        notification,
        "externalCaseNumber",
        120,
      );
      const silentSince = notificationPayloadDateTime(
        notification,
        "silentSince",
      );
      return {
        description: `${vendor}${caseNumber ? ` (Fall ${caseNumber})` : ""} hat sich zu ${ticketLabel} ${silentSince ? `seit ${notificationTime(silentSince)} ` : ""}nicht mehr gemeldet. Bitte nachfassen.`,
        Icon: CalendarClock,
        title: "Drittanbieter nachfassen",
      };
    }
    case "ticket.rule_reminder": {
      const rule =
        notificationPayloadText(notification, "ruleName", 160) ?? "Regel";
      return {
        description: `${ticketLabel}: ausgelöst durch die Regel «${rule}».`,
        Icon: AlertTriangle,
        title: "Erinnerung aus Regel",
      };
    }
    case "maintenance.upcoming": {
      const title =
        notificationPayloadText(notification, "title", 200) ?? "Wartung";
      const startsAt = notificationPayloadText(notification, "startsAt", 40);
      const services = notificationPayloadText(notification, "services", 400);
      const when = startsAt
        ? new Intl.DateTimeFormat("de-CH", {
            dateStyle: "short",
            timeStyle: "short",
            timeZone: "Europe/Zurich",
          }).format(new Date(startsAt))
        : "demnächst";
      return {
        description: `${title} beginnt am ${when}${services ? `. Betroffen: ${services}` : ""}.`,
        Icon: CalendarClock,
        title: "Geplante Wartung",
      };
    }
    case "team.overload": {
      const agent =
        notificationPayloadText(notification, "agentName", 120) ??
        "Ein Teammitglied";
      const department = notificationPayloadText(
        notification,
        "departmentName",
        120,
      );
      const open = notificationPayloadNumber(notification, "openTickets");
      const overdue = notificationPayloadNumber(notification, "overdueTickets");
      return {
        description: `${agent}${department ? ` (${department})` : ""} trägt ${open ?? "viele"} offene Tickets${overdue ? `, davon ${overdue} mit überschrittener SLA` : ""}. Prüfen Sie eine Umverteilung.`,
        Icon: AlertTriangle,
        title: "Frühwarnung: Überlastung",
      };
    }
    case "ticket.watch.status": {
      const status = notificationPayloadText(notification, "statusLabel", 80);
      const actor = notificationPayloadText(notification, "actorName", 120);
      return {
        description: actor
          ? `${actor} hat den Status von ${ticketLabel} auf «${status ?? "neu"}» gesetzt.`
          : `${ticketLabel} hat jetzt den Status «${status ?? "neu"}».`,
        Icon: Bell,
        title: "Beobachtet: Status geändert",
      };
    }
    case "ticket.watch.assigned": {
      const assignee = notificationPayloadText(
        notification,
        "assigneeName",
        120,
      );
      return {
        description: assignee
          ? `${ticketLabel} ist jetzt ${assignee} zugewiesen.`
          : `${ticketLabel} ist nicht mehr zugewiesen.`,
        Icon: Bell,
        title: "Beobachtet: neue Zuweisung",
      };
    }
    case "ticket.watch.comment": {
      const author =
        notificationPayloadText(notification, "authorName", 120) ??
        "Eine Person";
      const internal =
        isRecord(notification.payload) &&
        notification.payload.visibility === "internal";
      return {
        description: `${author} hat in ${ticketLabel} ${internal ? "eine interne Notiz" : "eine Nachricht"} geschrieben.`,
        Icon: MessageSquareText,
        title: internal
          ? "Beobachtet: interne Notiz"
          : "Beobachtet: neue Nachricht",
      };
    }
    case "ticket.escalation_opened":
      return {
        description: `${ticketLabel} wurde eskaliert.`,
        Icon: ArrowUp,
        title: "Ticket eskaliert",
      };
    case "ticket.security_report": {
      const risk = notificationPayloadText(notification, "riskLabel", 20);
      return {
        description: `Eine verdächtige E-Mail wurde gemeldet (${ticketLabel}${risk ? `, Risiko ${risk}` : ""}).`,
        Icon: AlertTriangle,
        title: "Phishing-Meldung",
      };
    }
    case "ticket.sla.supervisor_risk": {
      const agent = notificationPayloadText(notification, "agentName", 200);
      return {
        description: `${ticketLabel} verletzt in weniger als einer Stunde die SLA${agent ? ` (${agent})` : " (nicht zugewiesen)"}.`,
        Icon: AlertTriangle,
        title: "Team: SLA in Gefahr",
      };
    }
    case "ticket.sla.supervisor_no_response": {
      const agent = notificationPayloadText(notification, "agentName", 200);
      return {
        description: `${ticketLabel} ist seit über 24 Stunden ohne Antwort${agent ? ` (${agent})` : " (nicht zugewiesen)"}.`,
        Icon: AlertTriangle,
        title: "Team: Ticket ohne Antwort",
      };
    }
    case "delegation.started": {
      const agent =
        notificationPayloadText(notification, "agentName", 200) ?? "Kolleg:in";
      const count = (key: string) => {
        const value = isRecord(notification.payload)
          ? notification.payload[key]
          : null;
        return typeof value === "number" ? value : 0;
      };
      const note = notificationPayloadText(notification, "note", 2000);
      return {
        description: `Du vertrittst ${agent}: ${count("openTickets")} offene Tickets, ${count("openFollowUps")} Wiedervorlagen, ${count("openServiceTasks")} Serviceaufgaben.${note ? ` Notiz: ${note}` : ""}`,
        Icon: UserRound,
        title: "Stellvertretung beginnt",
      };
    }
    case "delegation.ended": {
      const delegate =
        notificationPayloadText(notification, "delegateName", 200) ??
        "Deine Stellvertretung";
      const count = (key: string) => {
        const value = isRecord(notification.payload)
          ? notification.payload[key]
          : null;
        return typeof value === "number" ? value : 0;
      };
      return {
        description: `Willkommen zurück! ${delegate} hat ${count("handledTickets")} deiner Tickets bearbeitet, ${count("resolvedTickets")} wurden gelöst. Offen: ${count("openTickets")}.`,
        Icon: UserRound,
        title: "Stellvertretung beendet",
      };
    }
    default:
      if (notification.kind.startsWith("shop.order.")) {
        const orderNumber =
          notificationPayloadText(notification, "orderNumber", 40) ?? "";
        const shopTitles: Record<string, string> = {
          "shop.order.approval_requested": "Freigabe für Bestellung",
          "shop.order.submitted": "Neue Bestellung",
          "shop.order.placed_for_you": "Bestellung für dich erfasst",
          "shop.order.approved": "Bestellung freigegeben",
          "shop.order.in_progress": "Bestellung in Bearbeitung",
          "shop.order.ready": "Bereit zur Abholung",
          "shop.order.issued": "Bestellung ausgegeben",
          "shop.order.returned": "Rückgabe bestätigt",
          "shop.order.rejected": "Bestellung abgelehnt",
          "shop.order.cancelled": "Bestellung storniert",
          "shop.order.note": "Nachricht zur Bestellung",
        };
        return {
          description: `Shop · Bestellung ${orderNumber}`.trim(),
          Icon: ShoppingBag,
          title: shopTitles[notification.kind] ?? "Shop",
        };
      }
      if (notification.kind === "license.reclaim_candidates") {
        const payload = isRecord(notification.payload)
          ? notification.payload
          : {};
        const count = typeof payload.count === "number" ? payload.count : 0;
        const saving =
          typeof payload.monthlySaving === "number" ? payload.monthlySaving : 0;
        const currency =
          typeof payload.currency === "string" ? payload.currency : "CHF";
        return {
          description: `${count} Lizenzplatz/-plätze ungenutzt${
            saving > 0
              ? ` · ca. ${currency} ${saving.toFixed(2)} pro Monat`
              : ""
          }. Siehe Lizenzen › Rückgewinnung.`,
          Icon: Bell,
          title: "Lizenzen zurückgewinnen",
        };
      }
      if (notification.kind.startsWith("service_task.")) {
        const title =
          notificationPayloadText(notification, "title", 120) ??
          "Serviceaufgabe";
        return {
          description: title,
          Icon: ListChecks,
          title:
            notification.kind === "service_task.overdue"
              ? "Serviceaufgabe überfällig"
              : "Serviceaufgabe heute fällig",
        };
      }
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
          <a href={SUPPORT_URL}>SUPPORT</a>
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
        <nav
          aria-label="Rechtliches und Support"
          className="access-footer-links"
        >
          <a href={SUPPORT_URL}>Support</a>
          <a href={PRIVACY_URL}>Datenschutz</a>
          <a href={IMPRINT_URL}>Impressum</a>
        </nav>
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
  const [passwordMode, setPasswordMode] = useState(false);
  const [password, setPassword] = useState("");
  const [registerMode, setRegisterMode] = useState(false);
  const [fullName, setFullName] = useState("");

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const name = fullName.trim().replace(/\s+/g, " ");
    if (name.length < 2) {
      setStatus("error");
      setMessage("Bitte geben Sie Ihren Namen ein.");
      return;
    }
    if (password.length < 8) {
      setStatus("error");
      setMessage("Das Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }
    setStatus("sending");
    setMessage("");
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: appRedirectUrl(),
      },
    });
    if (error) {
      setStatus("error");
      setMessage(
        "Das Konto konnte nicht erstellt werden. Bitte prüfen Sie Ihre Angaben und versuchen Sie es erneut.",
      );
      return;
    }
    setPassword("");
    if (data.session) return;
    // Supabase answers a sign-up for an already registered address with a
    // user without identities and sends no e-mail at all. So the person still
    // receives a message, send a sign-in link instead; the on-screen response
    // stays the same for both cases to avoid revealing registered addresses.
    if (data.user && (data.user.identities ?? []).length === 0) {
      await supabase.auth
        .signInWithOtp({
          email: email.trim().toLowerCase(),
          options: {
            emailRedirectTo: appRedirectUrl(),
            shouldCreateUser: false,
          },
        })
        .catch(() => undefined);
    }
    setStatus("sent");
    setMessage(
      "Fast geschafft: Wir haben Ihnen eine E-Mail gesendet. Bestätigen Sie Ihre Adresse über den Link und erstellen Sie danach Ihren Arbeitsbereich. Ist die Adresse bereits registriert, enthält die E-Mail stattdessen einen Anmeldelink.",
    );
  }

  async function signInWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setStatus("sending");
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setStatus("error");
      setMessage(
        "Die Anmeldung war nicht möglich. Bitte prüfen Sie E-Mail-Adresse und Passwort.",
      );
      return;
    }
    setPassword("");
  }

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
        // Bei einer Verbindungsanfrage (z. B. Gemini-Connector) lässt
        // Microsoft das Konto wählen, statt still das Browserkonto zu nehmen.
        ...(pendingOAuthAuthorizationId()
          ? { queryParams: { prompt: "select_account" } }
          : {}),
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

  if (registerMode) {
    return (
      <AccessShell>
        <p className="eyebrow">KONTO ERSTELLEN</p>
        <h2>
          Ihr eigener
          <br />
          Arbeitsbereich.
        </h2>
        <p className="access-lead">
          Auch ohne Firma: Erstellen Sie ein Konto, verwalten Sie Ihre Tickets
          und laden Sie Teammitglieder zur Zusammenarbeit ein.
        </p>
        <form className="access-form" onSubmit={register}>
          <label>
            Name
            <input
              autoComplete="name"
              disabled={status === "sending" || status === "sent"}
              onChange={(event) => setFullName(event.target.value)}
              required
              type="text"
              value={fullName}
            />
          </label>
          <label>
            E-Mail-Adresse
            <input
              autoComplete="email"
              disabled={status === "sending" || status === "sent"}
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@beispiel.ch"
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            Passwort (mindestens 8 Zeichen)
            <input
              autoComplete="new-password"
              disabled={status === "sending" || status === "sent"}
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <button
            className="email-access-button"
            disabled={status === "sending" || status === "sent"}
            type="submit"
          >
            {status === "sending" ? "Konto wird erstellt …" : "Konto erstellen"}
          </button>
          <p className="access-legal">
            Mit der Registrierung akzeptieren Sie die{" "}
            <a href={PRIVACY_URL}>Datenschutzerklärung</a>. Ihr Konto können Sie
            jederzeit in den persönlichen Einstellungen löschen.
          </p>
          <button
            className="access-toggle"
            disabled={status === "sending"}
            onClick={() => {
              setRegisterMode(false);
              setPassword("");
              setStatus("idle");
              setMessage("");
            }}
            type="button"
          >
            Bereits registriert? Anmelden
          </button>
        </form>
        {message && <p className={`access-message ${status}`}>{message}</p>}
      </AccessShell>
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
        Organisationen melden sich über ihr Unternehmens-SSO an und werden
        automatisch dem richtigen Mandanten zugeordnet. Einzelpersonen und
        kleine Teams melden sich mit E-Mail an oder erstellen ein Konto.
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
      <form
        className="access-form"
        onSubmit={passwordMode ? signInWithPassword : requestMagicLink}
      >
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
        {passwordMode ? (
          <label>
            Passwort
            <input
              autoComplete="current-password"
              disabled={status === "sending" || status === "sso"}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
        ) : null}
        <button
          className="email-access-button"
          disabled={
            status === "sending" || status === "sso" || status === "sent"
          }
          type="submit"
        >
          {status === "sending"
            ? passwordMode
              ? "Anmeldung läuft …"
              : "Link wird vorbereitet …"
            : passwordMode
              ? "Anmelden"
              : "Anmeldelink senden"}
        </button>
        <button
          className="access-toggle"
          disabled={status === "sending" || status === "sso"}
          onClick={() => {
            setPasswordMode((current) => !current);
            setPassword("");
            setStatus("idle");
            setMessage("");
          }}
          type="button"
        >
          {passwordMode
            ? "Stattdessen Anmeldelink per E-Mail"
            : "Mit Passwort anmelden"}
        </button>
        <button
          className="access-toggle access-register"
          disabled={status === "sending" || status === "sso"}
          onClick={() => {
            setRegisterMode(true);
            setPassword("");
            setStatus("idle");
            setMessage("");
          }}
          type="button"
        >
          Neu bei nextDesk? Konto erstellen
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
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "deleting">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (trimmed.length < 2) {
      setMessage(
        "Bitte geben Sie einen Namen mit mindestens zwei Zeichen ein.",
      );
      return;
    }
    setState("saving");
    setMessage("");
    try {
      await createPersonalWorkspace(trimmed);
      // Reload so the regular, server-confirmed tenant selection runs.
      window.location.reload();
    } catch (error) {
      setState("idle");
      setMessage(
        error instanceof Error
          ? error.message
          : "Der Arbeitsbereich konnte nicht erstellt werden.",
      );
    }
  }

  async function removeAccount() {
    if (
      !window.confirm(
        "Konto endgültig löschen? Ihr Konto und Ihre persönlichen Daten werden unwiderruflich gelöscht.",
      )
    )
      return;
    setState("deleting");
    setMessage("");
    try {
      await deleteAccount();
      window.location.reload();
    } catch (error) {
      setState("idle");
      setMessage(
        error instanceof Error
          ? error.message
          : "Das Konto konnte nicht gelöscht werden.",
      );
    }
  }

  return (
    <AccessShell>
      <p className="eyebrow">WILLKOMMEN BEI NEXTDESK</p>
      <h2>Arbeitsbereich erstellen.</h2>
      <p className="access-lead">
        Ihr Konto gehört noch zu keiner Organisation. Erstellen Sie Ihren
        eigenen Arbeitsbereich, um Tickets zu erfassen und zu bearbeiten.
        Teammitglieder laden Sie danach unter Einstellungen → Benutzer ein.
        Wurden Sie von einem Team eingeladen, öffnen Sie den Link aus der
        Einladungs-E-Mail.
      </p>
      <form className="access-form" onSubmit={submit}>
        <label>
          Name des Arbeitsbereichs
          <input
            disabled={state !== "idle"}
            maxLength={160}
            onChange={(event) => setName(event.target.value)}
            placeholder="z. B. Muster IT oder Max Muster"
            required
            type="text"
            value={name}
          />
        </label>
        <button
          className="email-access-button"
          disabled={state !== "idle"}
          type="submit"
        >
          {state === "saving"
            ? "Arbeitsbereich wird erstellt …"
            : "Arbeitsbereich erstellen"}
        </button>
        <button
          className="access-toggle"
          disabled={state !== "idle"}
          onClick={onSignOut}
          type="button"
        >
          Abmelden
        </button>
        <button
          className="access-toggle access-danger"
          disabled={state !== "idle"}
          onClick={() => void removeAccount()}
          type="button"
        >
          {state === "deleting" ? "Konto wird gelöscht …" : "Konto löschen"}
        </button>
      </form>
      {message && <p className="access-message error">{message}</p>}
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

type TicketListAssignment = {
  tenantId: string;
  currentUserId: string | null;
  onChanged: () => void;
};

type QuickAssignOption = { id: string; label: string; isClosed?: boolean };

async function loadQuickAssignOptions(
  kind: "agent" | "team" | "status",
  tenantId: string,
  ticket: DashboardTicket,
  currentUserId: string | null,
): Promise<QuickAssignOption[]> {
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  if (kind === "status") {
    const { data, error } = await supabase
      .from("ticket_statuses")
      .select("key, label, is_closed, sort_order")
      .eq("tenant_id", tenantId)
      .order("sort_order");
    if (error) throw error;
    return (
      (
        (data ?? []) as {
          key: string;
          label: string;
          is_closed: boolean;
        }[]
      )
        // "Neu" can only stay selected, it cannot be chosen again.
        .filter(
          (status) => status.key !== "new" || status.label === ticket.state,
        )
        .map((status) => ({
          id: status.key,
          label: status.label,
          isClosed: status.is_closed,
        }))
    );
  }
  if (kind === "agent") {
    const { data, error } = await supabase.functions.invoke(
      "ticket-agent-assignment",
      {
        body: {
          tenantId,
          ticketId: ticket.recordId ?? ticket.id,
          type: "list",
        },
      },
    );
    if (error) throw error;
    const agents = (data as { data?: { agents?: unknown } } | null)?.data
      ?.agents;
    if (!Array.isArray(agents)) throw new Error("invalid_agents_response");
    // Absent agents are marked; new assignments go to their stand-in.
    const absences = await loadActiveAbsences(tenantId);
    const names = new Map<string, string>();
    for (const agent of agents as { id?: unknown; displayName?: unknown }[]) {
      if (
        typeof agent?.id === "string" &&
        typeof agent.displayName === "string"
      )
        names.set(agent.id, agent.displayName);
    }
    return agents
      .flatMap((agent: unknown) => {
        const row = agent as { id?: unknown; displayName?: unknown };
        return typeof row?.id === "string" &&
          typeof row.displayName === "string"
          ? [
              {
                id: row.id,
                label: absenceLabel(
                  row.id === currentUserId
                    ? `${row.displayName} (ich)`
                    : row.displayName,
                  absences.get(row.id),
                  (id) => names.get(id),
                ),
              },
            ]
          : [];
      })
      .sort((left, right) =>
        left.label.localeCompare(right.label, "de-CH", { sensitivity: "base" }),
      );
  }
  const { data, error } = await supabase.functions.invoke(
    "ticket-agent-assignment",
    { body: { tenantId, type: "listTeams" } },
  );
  if (error) throw error;
  return ticketTeamsFromResponse(data)
    .filter(
      (team) =>
        !ticket.departmentId ||
        team.departmentId === null ||
        team.departmentId === ticket.departmentId,
    )
    .map((team) => ({ id: team.id, label: team.name }));
}

function ticketAgentLabel(ticket: DashboardTicket): string {
  return ticket.isUnassigned
    ? "Nicht zugewiesen"
    : ticket.assignedToCurrentUser
      ? "Mir zugewiesen"
      : (ticket.assignedAgentName ?? "Zugewiesen");
}

function TicketQuickAssign({
  assignment,
  ticket,
}: {
  assignment: TicketListAssignment;
  ticket: DashboardTicket;
}) {
  const [open, setOpen] = useState<"agent" | "team" | "status" | null>(null);
  const [pendingClose, setPendingClose] = useState<QuickAssignOption | null>(
    null,
  );
  const [options, setOptions] = useState<QuickAssignOption[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ticketId = ticket.recordId ?? ticket.id;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setOptions(null);
    setError("");
    setPendingClose(null);
    loadQuickAssignOptions(
      open,
      assignment.tenantId,
      ticket,
      assignment.currentUserId,
    )
      .then((next) => {
        if (active) setOptions(next);
      })
      .catch(() => {
        if (active) {
          setOptions([]);
          setError("Die Auswahl konnte nicht geladen werden.");
        }
      });
    const closeOnOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      active = false;
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
    // Options depend on the ticket only while the popover is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ticketId, assignment.tenantId]);

  async function choose(value: string, confirmed = false) {
    if (!supabase || !open || saving) return;
    if (open === "status") {
      const status = options?.find((option) => option.id === value);
      if (!status) return;
      if (value !== "new" && ticket.isUnassigned && ticket.state === "Neu") {
        setError(
          "Der Status «Neu» kann erst geändert werden, wenn das Ticket einer Person zugewiesen ist.",
        );
        return;
      }
      // Closing needs an explicit confirmation, as in the ticket detail.
      if (status.isClosed && !confirmed) {
        setPendingClose(status);
        return;
      }
    }
    setSaving(true);
    setError("");
    try {
      const { error: invokeError } =
        open === "status"
          ? await supabase.functions.invoke("ticket-operations", {
              body: {
                statusKey: value,
                ...(options?.find((option) => option.id === value)?.isClosed
                  ? { confirmClose: true }
                  : {}),
                tenantId: assignment.tenantId,
                ticketId,
                type: "updateTicket",
              },
            })
          : open === "agent"
            ? await supabase.functions.invoke("ticket-agent-assignment", {
                body: {
                  assignedAgentId: value || null,
                  tenantId: assignment.tenantId,
                  ticketId,
                  type: "assign",
                },
              })
            : await supabase.functions.invoke("ticket-operations", {
                body: {
                  assignedTeamId: value || null,
                  tenantId: assignment.tenantId,
                  ticketId,
                  type: "updateTicket",
                },
              });
      if (invokeError) throw invokeError;
      setOpen(null);
      setPendingClose(null);
      assignment.onChanged();
    } catch (saveError) {
      setPendingClose(null);
      setError(
        open === "status"
          ? await functionErrorMessage(
              saveError,
              "Der Status konnte nicht gespeichert werden.",
            )
          : open === "agent"
            ? "Die Zuweisung konnte nicht gespeichert werden."
            : "Das Team konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  const agentLabel = ticketAgentLabel(ticket);
  const teamLabel = ticket.assignedTeamName ?? "Kein Team";
  const currentValue =
    open === "status"
      ? (options?.find((option) => option.label === ticket.state)?.id ?? "")
      : open === "agent"
        ? (ticket.assignedAgentId ?? "")
        : (ticket.assignedTeamId ?? "");

  return (
    <div
      className="ticket-quick-assign"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      ref={containerRef}
    >
      <button
        aria-expanded={open === "agent"}
        aria-label={`Zuweisung: ${agentLabel}. Ändern`}
        className={`ticket-assign-chip${
          ticket.isUnassigned ? " ticket-assign-chip--unassigned" : ""
        }`}
        onClick={() =>
          setOpen((current) => (current === "agent" ? null : "agent"))
        }
        type="button"
      >
        <UserRound aria-hidden="true" size={13} strokeWidth={2} />
        {agentLabel}
      </button>
      <button
        aria-expanded={open === "team"}
        aria-label={`Team: ${teamLabel}. Ändern`}
        className={`ticket-assign-chip${
          ticket.assignedTeamId ? "" : " ticket-assign-chip--empty"
        }`}
        onClick={() =>
          setOpen((current) => (current === "team" ? null : "team"))
        }
        type="button"
      >
        <UsersRound aria-hidden="true" size={13} strokeWidth={2} />
        {teamLabel}
      </button>
      <button
        aria-expanded={open === "status"}
        aria-label={`Status: ${ticket.state}. Ändern`}
        className={`state-badge ${statusClass(ticket.state)} ticket-status-chip`}
        onClick={() =>
          setOpen((current) => (current === "status" ? null : "status"))
        }
        type="button"
      >
        <span aria-hidden="true" className="state-badge__indicator" />
        {ticket.state}
      </button>
      {open ? (
        <div
          className="ticket-quick-assign__popover"
          role="dialog"
          aria-label={
            open === "status"
              ? "Status ändern"
              : open === "agent"
                ? "Person zuweisen"
                : "Team zuweisen"
          }
        >
          <label>
            {open === "status"
              ? "Status"
              : open === "agent"
                ? "Zuweisen an"
                : "Team"}
            <select
              autoFocus
              disabled={options === null || saving || pendingClose !== null}
              onChange={(event) => void choose(event.target.value)}
              value={currentValue}
            >
              {open === "status" ? (
                options === null ? (
                  <option value="">Wird geladen …</option>
                ) : null
              ) : (
                <option value="">
                  {options === null
                    ? "Wird geladen …"
                    : open === "agent"
                      ? "Nicht zugewiesen"
                      : "Kein Team"}
                </option>
              )}
              {(options ?? []).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {open === "agent" &&
          assignment.currentUserId &&
          !ticket.assignedToCurrentUser &&
          options?.some((option) => option.id === assignment.currentUserId) ? (
            <button
              className="text-button"
              disabled={saving}
              onClick={() => void choose(assignment.currentUserId ?? "")}
              type="button"
            >
              Mir zuweisen
            </button>
          ) : null}
          {pendingClose ? (
            <div className="ticket-quick-assign__confirm" role="group">
              <small>
                Ticket auf «{pendingClose.label}» setzen und schliessen?
              </small>
              <span>
                <button
                  className="primary-button"
                  disabled={saving}
                  onClick={() => void choose(pendingClose.id, true)}
                  type="button"
                >
                  Ja, schliessen
                </button>
                <button
                  className="text-button"
                  disabled={saving}
                  onClick={() => setPendingClose(null)}
                  type="button"
                >
                  Abbrechen
                </button>
              </span>
            </div>
          ) : null}
          {saving ? <small>Wird gespeichert …</small> : null}
          {error ? (
            <small className="ticket-quick-assign__error" role="alert">
              {error}
            </small>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// "?wissen=<article id>" opens a knowledge article directly, e.g. from the
// ticket detail in a new browser tab. The parameter is removed afterwards.
const KNOWLEDGE_DEEP_LINK_PARAM = "wissen";
const initialKnowledgeDeepLink: string | null = (() => {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const value = url.searchParams.get(KNOWLEDGE_DEEP_LINK_PARAM);
    if (!value || !/^[0-9a-f-]{36}$/i.test(value)) return null;
    url.searchParams.delete(KNOWLEDGE_DEEP_LINK_PARAM);
    window.history.replaceState(window.history.state, "", url.toString());
    return value.toLowerCase();
  } catch {
    return null;
  }
})();

// "?asset=<uuid>" and "?rack=<name>" are the web fallback of printed asset
// labels (QR code). They open the asset list or the rack view.
const initialAssetLabelDeepLink: {
  assetId: string | null;
  rack: string | null;
} = (() => {
  if (typeof window === "undefined") return { assetId: null, rack: null };
  try {
    const url = new URL(window.location.href);
    const assetId = assetIdFromSearch(url.search);
    const rack = assetId ? null : rackFromSearch(url.search);
    if (url.searchParams.has("asset") || url.searchParams.has("rack")) {
      url.searchParams.delete("asset");
      url.searchParams.delete("rack");
      window.history.replaceState(window.history.state, "", url.toString());
    }
    return { assetId, rack };
  } catch {
    return { assetId: null, rack: null };
  }
})();

function TicketList({
  assignment,
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
  assignment?: TicketListAssignment;
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
  const hoverPreview = useTicketHoverPreview();
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
      {hoverPreview.overlay}
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
            {...(onOpen
              ? hoverPreview.bind(ticketId, `${ticket.id} · ${ticket.subject}`)
              : {})}
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
                {ticket.requesterName ? (
                  <span
                    className="ticket-meta__requester"
                    title="Anfragende Person"
                  >
                    <UserRound aria-hidden="true" size={12} strokeWidth={2} />
                    <span className="sr-only">Anfragende Person: </span>
                    {ticket.requesterName}
                  </span>
                ) : null}
                {ticket.priority ? <span>{ticket.priority}</span> : null}
                <span>vor {ticket.age}</span>
              </p>
            </div>
            <div className="ticket-state">
              {assignment && !ticket.isClosed ? (
                <TicketQuickAssign assignment={assignment} ticket={ticket} />
              ) : (
                <div className="ticket-quick-assign">
                  {assignment ? (
                    // Solved and closed tickets still show who handled them.
                    <>
                      <span
                        aria-label={`Zuweisung: ${ticketAgentLabel(ticket)}`}
                        className="ticket-assign-chip ticket-assign-chip--static"
                      >
                        <UserRound
                          aria-hidden="true"
                          size={13}
                          strokeWidth={2}
                        />
                        {ticketAgentLabel(ticket)}
                      </span>
                      <span
                        aria-label={`Team: ${ticket.assignedTeamName ?? "Kein Team"}`}
                        className={`ticket-assign-chip ticket-assign-chip--static${
                          ticket.assignedTeamId
                            ? ""
                            : " ticket-assign-chip--empty"
                        }`}
                      >
                        <UsersRound
                          aria-hidden="true"
                          size={13}
                          strokeWidth={2}
                        />
                        {ticket.assignedTeamName ?? "Kein Team"}
                      </span>
                    </>
                  ) : null}
                  <span
                    aria-label={`Status: ${ticket.state}`}
                    className={`state-badge ${statusClass(ticket.state)}`}
                  >
                    <span
                      aria-hidden="true"
                      className="state-badge__indicator"
                    />
                    {ticket.state}
                  </span>
                </div>
              )}
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
        {ticket.requesterName ? (
          <div>
            <dt>Anfragende Person</dt>
            <dd>{ticket.requesterName}</dd>
          </div>
        ) : null}
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

function useDebouncedValue(value: string, delayMs: number): string {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, value]);

  return debouncedValue;
}

function AuthenticatedApp() {
  const [section, setRequestedSection] = useState<Section>("Übersicht");
  const [tourOpen, setTourOpen] = useState(false);
  const [globalSearchTarget, setGlobalSearchTarget] =
    useState<GlobalSearchResult | null>(null);
  const [workplaceRequestedView, setWorkplaceRequestedView] =
    useState<WorkplaceRequestedView | null>(null);
  const [period, setPeriod] = useState<Period>("Heute");
  const [queue, setQueue] = useState("alle");
  const [supportLevelFilter, setSupportLevelFilter] =
    useState<SupportLevelFilter>("all");
  const [ticketScope, setTicketScope] = useState<TicketScope>("all");
  const [delegatedForIds, setDelegatedForIds] = useState<string[]>([]);
  // Departments the user supervises (role "Vorgesetzter Agent").
  const [problemListVersion, setProblemListVersion] = useState(0);
  const [homeLayout, setHomeLayout] = useState<HomeLayout>(loadHomeLayout);
  const changeHomeLayout = (next: HomeLayout) => {
    setHomeLayout(next);
    saveHomeLayout(next);
  };
  const [ticketLayout, setTicketLayout] = useState<"list" | "kanban">(() => {
    try {
      return window.localStorage.getItem("nextdesk.ticketLayout") === "kanban"
        ? "kanban"
        : "list";
    } catch {
      return "list";
    }
  });
  const changeTicketLayout = (layout: "list" | "kanban") => {
    setTicketLayout(layout);
    try {
      window.localStorage.setItem("nextdesk.ticketLayout", layout);
    } catch {
      // Only a convenience; the list stays the default.
    }
  };
  const [supervisedDepartmentIds, setSupervisedDepartmentIds] = useState<
    string[]
  >([]);
  const [ticketListRefinement, setTicketListRefinement] =
    useState<TicketListRefinement>(DEFAULT_TICKET_LIST_REFINEMENT);
  const [metricTicketFilter, setMetricTicketFilter] =
    useState<MetricTicketFilter | null>(null);
  // «Aus Bericht: …»: drilldown from a report, filtered server-side.
  const [reportDrilldown, setReportDrilldown] =
    useState<TicketDrilldown | null>(null);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);
  const [savedTicketViews, setSavedTicketViews] = useState<SavedTicketView[]>(
    [],
  );
  const [savedTicketViewsLoading, setSavedTicketViewsLoading] = useState(false);
  const [oauthAuthorizationId] = useState(() => pendingOAuthAuthorizationId());
  const [session, setSession] = useState<Session | null | undefined>(
    isSupabaseConfigured ? undefined : null,
  );
  const latestSessionRef = useRef<Session | null | undefined>(
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
  // «Ticket für … erfassen» from the person overview.
  const [composerRequester, setComposerRequester] = useState<{
    id: string;
    displayName: string;
  } | null>(null);
  const [personOverview, setPersonOverview] = useState<PersonRef | null>(null);
  const [knowledgeFocusArticleId, setKnowledgeFocusArticleId] = useState<
    string | undefined
  >(initialKnowledgeDeepLink ?? undefined);
  // Device opened from a ticket: the asset list starts filtered to it.
  const [assetFocusQuery, setAssetFocusQuery] = useState<{
    query: string;
    id: number;
  } | null>(null);
  const [createdTicketToast, setCreatedTicketToast] = useState<{
    ticketId: string;
    ticketNumber: string;
  } | null>(null);
  useEffect(() => {
    if (!createdTicketToast) return;
    const timer = window.setTimeout(() => setCreatedTicketToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [createdTicketToast]);
  // "Ihr Entwurf wurde gespeichert" after a suggestion closed the composer.
  const [composerDraftNotice, setComposerDraftNotice] = useState(false);
  useEffect(() => {
    if (!composerDraftNotice) return;
    const timer = window.setTimeout(() => setComposerDraftNotice(false), 8000);
    return () => window.clearTimeout(timer);
  }, [composerDraftNotice]);
  useEffect(() => {
    if (ticketComposerOpen) setComposerDraftNotice(false);
  }, [ticketComposerOpen]);
  const [quickCreateMenuOpen, setQuickCreateMenuOpen] = useState(false);
  const [expandedNavigationCategoryId, setExpandedNavigationCategoryId] =
    useState<string | null>("navigation-category-workspace");
  const [quickCreateRequest, setQuickCreateRequest] =
    useState<QuickCreateRequest | null>(null);
  const [
    serviceMaintenanceCreateRequestId,
    setServiceMaintenanceCreateRequestId,
  ] = useState<number | undefined>(undefined);
  const [canWorkTickets, setCanWorkTickets] = useState(false);
  const [eventSpaceAttentionCount, setEventSpaceAttentionCount] = useState<
    number | null
  >(null);
  const [eventSpaceNavigationAccess, setEventSpaceNavigationAccess] =
    useState(false);
  const [eventSpaceAttentionRevision, setEventSpaceAttentionRevision] =
    useState(0);
  // Navigation badges for new shop orders and untouched onboarding entries.
  const [shopAttentionCount, setShopAttentionCount] = useState<number | null>(
    null,
  );
  const [onboardingAttentionCount, setOnboardingAttentionCount] = useState<
    number | null
  >(null);
  const [navigationAttentionTick, setNavigationAttentionTick] = useState(0);
  const [canManageContracts, setCanManageContracts] = useState(false);
  const [canManageServiceStatus, setCanManageServiceStatus] = useState(false);
  const [canReadReports, setCanReadReports] = useState(false);
  const [canReadServiceTasks, setCanReadServiceTasks] = useState(false);
  const [serviceTaskFocusId, setServiceTaskFocusId] = useState<string | null>(
    null,
  );
  const [serviceStatusAccessTenantId, setServiceStatusAccessTenantId] =
    useState<string | null>(null);
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
  // While the personal settings are open, no menu item is marked active.
  const navSection: Section | null = personalSettingsOpen ? null : section;
  const [ssoEnforced, setSsoEnforced] = useState(false);
  const [tenantFeatures, setTenantFeatures] = useState<Record<string, boolean>>(
    {},
  );
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
    const category = NAVIGATION_CATEGORIES.find((candidate) => {
      const categorySections = candidate.sectionLabels as readonly Section[];
      return categorySections.includes(section);
    });
    if (category) setExpandedNavigationCategoryId(category.id);
  }, [section]);

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
    setReportDrilldown(null);
  }, [activeTenantId]);

  useEffect(() => {
    setServiceMaintenanceCreateRequestId(undefined);
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
      latestSessionRef.current = nextSession;
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
      setCanManageContracts(false);
      setCanManageServiceStatus(false);
      setCanReadReports(false);
      setServiceStatusAccessTenantId(null);
      setTicketAccessLoading(Boolean(nextSession));
      setTenantFeaturesLoading(Boolean(nextSession));
      setIsTenantAdmin(false);
      setWorkspacePreferencesOpen(false);
      setWorkspacePreferencesContext("page");
      setPersonalSettingsOpen(false);
      setWorkplaceRequestedView(null);
      setSsoEnforced(false);
      setTenantFeatures({});
      setActiveIncidentNotices([]);
      setTenantWorkspaceBranding(null);
      setExperienceNotice(null);
      setExperienceFollowUpsRevision(0);
    };
    const { data } = auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      if (!callbackSessionGate.accepts(nextSession)) return;

      const currentSession = latestSessionRef.current;
      const resetWorkspace = requiresWorkspaceContextReset({
        event,
        currentUserId:
          currentSession === undefined
            ? undefined
            : (currentSession?.user.id ?? null),
        nextUserId: nextSession?.user.id ?? null,
      });

      if (resetWorkspace) {
        applySession(nextSession);
        return;
      }

      // Supabase can re-emit SIGNED_IN or TOKEN_REFRESHED when this browser
      // window regains focus. The client already owns the fresh tokens, so a
      // same-user event must not clear and reload the tenant workspace.
      latestSessionRef.current = nextSession;
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
  // Eigenes Profilfoto aus Entra (nur wenn vorhanden; sonst Initialen).
  const [operatorPhotoUrl, setOperatorPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    setOperatorPhotoUrl(null);
    if (!supabase || !session || !activeTenant) return;
    let active = true;
    void supabase.functions
      .invoke("service-assets", {
        body: { type: "ownPhoto", tenantId: activeTenant.id },
      })
      .then(({ data, error }) => {
        if (!active || error) return;
        const url = (data as { data?: { photoUrl?: unknown } } | null)?.data
          ?.photoUrl;
        if (typeof url === "string" && url.startsWith("https://")) {
          setOperatorPhotoUrl(url);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [activeTenant?.id, session]);
  const experienceWorkspaceEnabled =
    isSupabaseConfigured && tenantFeatures["experience.workspace"] === true;
  const requesterPortalEnabled =
    isSupabaseConfigured && tenantFeatures["requester.portal"] === true;
  const agentWorkbenchEnabled =
    isSupabaseConfigured &&
    canWorkTickets &&
    tenantFeatures["agent.workbench"] === true;
  // Follow-ups are ticket work; employees only get their personal area.
  const workplaceFollowUpsEnabled =
    experienceWorkspaceEnabled && (canWorkTickets || !isSupabaseConfigured);
  // "Mein Portal" lives in the workplace as "Mein Bereich".
  const workplaceAvailable = isWorkplaceAvailable(
    agentWorkbenchEnabled,
    workplaceFollowUpsEnabled,
    canWorkTickets && requesterPortalEnabled,
  );
  const contractsAvailable =
    isSupabaseConfigured &&
    canManageContracts &&
    tenantFeatures["contracts.management"] === true;
  const reportsAvailable =
    isSupabaseConfigured &&
    canReadReports &&
    tenantFeatures["reporting.service"] === true;
  // Every member may read the status; managing needs asset.manage.
  const serviceStatusReadable =
    isSupabaseConfigured && tenantFeatures["assets.management"] === true;
  const serviceStatusAvailable =
    serviceStatusAccessTenantId === activeTenant?.id &&
    isServiceStatusAvailable({
      assetManagementEnabled:
        isSupabaseConfigured && tenantFeatures["assets.management"] === true,
      canManageServiceStatus,
    });
  const knowledgeDeepLinkConsumedRef = useRef(false);
  const assetLabelDeepLinkConsumedRef = useRef(false);
  // Rack from a label QR code; only for the first visit of the rack view.
  const [infrastructureRackFocus, setInfrastructureRackFocus] = useState<
    string | null
  >(initialAssetLabelDeepLink.rack);
  useEffect(() => {
    if (section !== "Infrastruktur" && assetLabelDeepLinkConsumedRef.current) {
      setInfrastructureRackFocus(null);
    }
  }, [section]);
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
    // A deep link to a knowledge article wins over the start page.
    if (initialKnowledgeDeepLink && !knowledgeDeepLinkConsumedRef.current) {
      knowledgeDeepLinkConsumedRef.current = true;
      setKnowledgeFocusArticleId(initialKnowledgeDeepLink);
      setSection("Wissen");
      return;
    }
    // Asset label QR code (web fallback): open the asset or the rack.
    if (!assetLabelDeepLinkConsumedRef.current) {
      assetLabelDeepLinkConsumedRef.current = true;
      if (initialAssetLabelDeepLink.assetId) {
        setAssetFocusQuery({
          query: initialAssetLabelDeepLink.assetId,
          id: Date.now(),
        });
        setSection("Assets");
        return;
      }
      if (initialAssetLabelDeepLink.rack) {
        setSection("Infrastruktur");
        return;
      }
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
      })
      .catch(async (error: unknown) => {
        if (!mounted) return;
        setSavedTicketViews([]);
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
    // Serviceaufgaben: visible with the module switched on and at least the
    // read permission; the function answers with the caller's rights.
    if (!session || !activeTenant || tenantFeatures["service.tasks"] !== true) {
      setCanReadServiceTasks(false);
      return;
    }
    let mounted = true;
    void loadServiceTaskAccess(activeTenant.id).then((serviceTaskAccess) => {
      if (mounted) setCanReadServiceTasks(serviceTaskAccess?.canRead === true);
    });
    return () => {
      mounted = false;
    };
  }, [activeTenant, session, tenantFeatures]);

  useEffect(() => {
    if (!supabase || !session || !activeTenant) {
      setCanWorkTickets(false);
      setCanManageContracts(false);
      setCanManageServiceStatus(false);
      setCanReadReports(false);
      setServiceStatusAccessTenantId(null);
      setIsTenantAdmin(false);
      setTicketAccessLoading(false);
      return;
    }
    let mounted = true;
    setTicketAccessLoading(true);
    setCanManageServiceStatus(false);
    setServiceStatusAccessTenantId(null);
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
        setCanManageContracts(access.canManageContracts);
        setCanManageServiceStatus(access.canManageServiceStatus);
        setCanReadReports(access.canReadReports);
        setServiceStatusAccessTenantId(activeTenant.id);
        setIsTenantAdmin(access.isTenantAdmin);
      })
      .catch(() => {
        if (!mounted) return;
        setCanWorkTickets(false);
        setCanManageContracts(false);
        setCanManageServiceStatus(false);
        setCanReadReports(false);
        setServiceStatusAccessTenantId(null);
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
    if (!supabase || !session || !activeTenant) {
      setEventSpaceAttentionCount(null);
      setEventSpaceNavigationAccess(false);
      return;
    }
    let mounted = true;
    setEventSpaceAttentionCount(null);
    void supabase.functions
      .invoke("event-spaces", {
        body: { type: "navigationSummary", tenantId: activeTenant.id },
      })
      .then(({ data, error }) => {
        if (error) throw error;
        const summary =
          data && typeof data === "object"
            ? (
                data as {
                  data?: { attentionCount?: unknown; canAccess?: unknown };
                }
              ).data
            : null;
        const value = summary?.attentionCount;
        if (
          !Number.isSafeInteger(value) ||
          typeof value !== "number" ||
          value < 0 ||
          summary?.canAccess !== true
        ) {
          throw new Error("invalid_event_space_navigation_summary");
        }
        if (mounted) {
          setEventSpaceAttentionCount(value);
          setEventSpaceNavigationAccess(true);
        }
      })
      .catch(() => {
        if (mounted) {
          setEventSpaceAttentionCount(null);
          setEventSpaceNavigationAccess(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [activeTenant?.id, eventSpaceAttentionRevision, session?.user.id]);

  // Refresh the menu badges every minute and whenever the section changes.
  useEffect(() => {
    const timer = window.setInterval(
      () => setNavigationAttentionTick((tick) => tick + 1),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!supabase || !session || !activeTenant) {
      setShopAttentionCount(null);
      setOnboardingAttentionCount(null);
      return;
    }
    let mounted = true;
    const tenantId = activeTenant.id;
    const readCount = (data: unknown, key: string): number | null => {
      const payload =
        data && typeof data === "object"
          ? (data as { data?: Record<string, unknown> }).data
          : null;
      const value = payload?.[key];
      return typeof value === "number" && Number.isSafeInteger(value)
        ? value
        : null;
    };
    void supabase.functions
      .invoke("shop", { body: { type: "getContext", tenantId } })
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          setShopAttentionCount(null);
          return;
        }
        const canFulfill =
          data && typeof data === "object"
            ? (data as { data?: { canFulfill?: unknown } }).data?.canFulfill
            : false;
        setShopAttentionCount(
          canFulfill === true ? readCount(data, "newOrders") : null,
        );
      })
      .catch(() => mounted && setShopAttentionCount(null));
    void supabase.functions
      .invoke("onboarding", { body: { type: "navigationSummary", tenantId } })
      .then(({ data, error }) => {
        if (!mounted) return;
        setOnboardingAttentionCount(
          error ? null : readCount(data, "attentionCount"),
        );
      })
      .catch(() => mounted && setOnboardingAttentionCount(null));
    return () => {
      mounted = false;
    };
  }, [activeTenant?.id, navigationAttentionTick, section, session?.user.id]);

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
    const restrictedWorkspaceSections: Section[] = [];
    if (contractsAvailable) {
      restrictedWorkspaceSections.push("Verträge", "Lizenzen");
    }
    if (reportsAvailable) restrictedWorkspaceSections.push("Berichte");
    // Employees open the read-only status from the badge in the navigation.
    if (serviceStatusReadable) restrictedWorkspaceSections.push("Systemstatus");
    if (restrictedWorkspaceSections.includes(section)) return;
    if (!canRequesterOpenSection(section, requesterPortalEnabled)) {
      // Employees start on their tickets.
      setSection("Tickets");
    }
  }, [
    canWorkTickets,
    contractsAvailable,
    eventSpaceNavigationAccess,
    reportsAvailable,
    requesterPortalEnabled,
    section,
    serviceStatusAvailable,
    tenantFeatures,
    tenantFeaturesLoading,
    ticketAccessLoading,
  ]);

  useEffect(() => {
    setTicketPage(0);
  }, [
    activeTenant?.id,
    canWorkTickets,
    debouncedQuery,
    metricTicketFilter,
    reportDrilldown,
    period,
    queue,
    supportLevelFilter,
    ticketListRefinement,
    ticketScope,
  ]);

  useEffect(() => {
    setSelectedTicketIds(new Set());
    setTicketActionStatus("");
    setSplitSelectedTicketId(null);
    setSupportLevelFilter("all");
  }, [activeTenant?.id]);

  useEffect(() => {
    setSelectedTicketIds(new Set());
    setTicketActionStatus("");
  }, [ticketListRefinement]);

  useEffect(() => {
    if (!session || !activeTenant) return;

    let mounted = true;
    setDashboardLoading(true);
    setErrorMessage("");
    void loadLiveDashboard(
      activeTenant,
      period,
      ticketPage,
      ticketListRefinement,
      {
        drilldown: reportDrilldown,
        metricTicketIds: metricTicketFilter?.ticketIds ?? null,
        query: debouncedQuery,
        queue,
        supportLevel: supportLevelOfFilter(supportLevelFilter),
        // Employees see every ticket they may read: their own and those of
        // their direct reports.
        scope: canWorkTickets ? ticketScope : "all",
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
    debouncedQuery,
    metricTicketFilter,
    reportDrilldown,
    period,
    queue,
    session,
    supportLevelFilter,
    ticketListRefinement,
    ticketPage,
    ticketScope,
  ]);

  useEffect(() => {
    if (!supabase || !session || !activeTenant) return;

    const realtimeClient = supabase;
    let refreshTimer: number | null = null;
    const scheduleDashboardRefresh = () => {
      if (document.visibilityState !== "visible" || refreshTimer !== null)
        return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        setDashboardRevision((current) => current + 1);
      }, 250);
    };
    const channel = realtimeClient
      .channel(
        `ticket-dashboard-invalidation:${activeTenant.id}:${session.user.id}`,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          filter: `tenant_id=eq.${activeTenant.id}`,
          schema: "public",
          table: "tickets",
        },
        scheduleDashboardRefresh,
      )
      .subscribe();

    // Realtime depends on the database publication and can drop silently, so a
    // slow poll and a refresh on returning to the tab keep the list current.
    const pollTimer = window.setInterval(scheduleDashboardRefresh, 30_000);
    document.addEventListener("visibilitychange", scheduleDashboardRefresh);

    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.clearInterval(pollTimer);
      document.removeEventListener(
        "visibilitychange",
        scheduleDashboardRefresh,
      );
      void realtimeClient.removeChannel(channel);
    };
  }, [activeTenant?.id, session?.user.id]);

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

  const setSectionRef = useRef<(section: Section) => void>(() => {});
  const navigateForTour = useMemo(
    () => (target: string) => setSectionRef.current(target as Section),
    [],
  );

  // New agents see the introduction once (per browser and person).
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || !canWorkTickets || tourSeen(userId)) return;
    setTourOpen(true);
    markTourSeen(userId, true);
  }, [canWorkTickets, session?.user.id]);

  function setSection(requestedSection: Section) {
    // "Mein Portal" is now the "Mein Bereich" view of the workplace.
    if (requestedSection === "Mein Portal") {
      setWorkplaceRequestedView("portal");
    }
    const nextSection: Section =
      requestedSection === "Mein Portal" ? "Arbeitsplatz" : requestedSection;
    const nonTicketSectionAllowed =
      ((nextSection === "Verträge" || nextSection === "Lizenzen") &&
        contractsAvailable) ||
      (nextSection === "Berichte" && reportsAvailable) ||
      (nextSection === "Systemstatus" && serviceStatusReadable);
    if (
      !canWorkTickets &&
      !nonTicketSectionAllowed &&
      !canRequesterOpenSection(nextSection, requesterPortalEnabled)
    ) {
      setGlobalSearchTarget(null);
      setRequestedSection("Tickets");
      return;
    }
    setRequestedSection(nextSection);
  }
  setSectionRef.current = setSection;

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
    } else if (notification.kind.startsWith("shop.order.")) {
      setSection("Shop");
      setNotificationPanelOpen(false);
    } else if (notification.kind === "team.overload") {
      setSection("Teamführung");
      setNotificationPanelOpen(false);
    } else if (notification.kind === "problem.recurring_detected") {
      setSection("Fälle");
      setNotificationPanelOpen(false);
    } else if (notification.kind === "maintenance.upcoming") {
      setSection("Systemstatus");
      setNotificationPanelOpen(false);
    } else if (notification.kind === "infrastructure.due") {
      setSection("Infrastruktur");
      setNotificationPanelOpen(false);
    } else if (notification.kind.startsWith("service_task.")) {
      const occurrenceId = notificationPayloadText(
        notification,
        "occurrenceId",
        64,
      );
      setServiceTaskFocusId(occurrenceId);
      setSection("Serviceaufgaben");
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
  const departmentQueueKeys = useMemo(
    () =>
      Object.fromEntries(
        (view.ticketFilterCatalog?.departments ?? []).map((department) => [
          department.id,
          { key: department.key, label: department.label },
        ]),
      ),
    [view.ticketFilterCatalog?.departments],
  );
  const queueOptions = useMemo<readonly [string, string][]>(() => {
    const configuredQueues = view.ticketFilterCatalog?.departments ?? [];
    return configuredQueues.map((department): [string, string] => [
      department.key,
      department.label,
    ]);
  }, [view.ticketFilterCatalog?.departments]);
  const hasAuthorizedQueueCatalog = Boolean(view.ticketFilterCatalog);
  useEffect(() => {
    if (!hasAuthorizedQueueCatalog) return;

    setQueue((currentQueue) =>
      normalizeQueueSelection(currentQueue, queueOptions),
    );
  }, [hasAuthorizedQueueCatalog, queueOptions]);
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
  // Active delegations in which the current user stands in for someone.
  const delegationUserId = session?.user.id ?? null;
  const delegationTenantId = activeTenant?.id ?? null;
  const [delegatorProfileNames, setDelegatorProfileNames] = useState<
    Record<string, string>
  >({});
  useEffect(() => {
    if (
      !supabase ||
      !delegationUserId ||
      !delegationTenantId ||
      !canWorkTickets
    ) {
      setDelegatedForIds([]);
      return;
    }
    const client = supabase;
    let active = true;
    const load = async () => {
      const now = new Date().toISOString();
      const { data, error } = await client
        .from("agent_delegations")
        .select("agent_id")
        .eq("tenant_id", delegationTenantId)
        .eq("delegate_id", delegationUserId)
        .is("ended_at", null)
        .lte("starts_at", now)
        .gt("ends_at", now);
      if (!active || error) return;
      const ids = [
        ...new Set(
          (data ?? []).flatMap((row) =>
            typeof row.agent_id === "string" ? [row.agent_id] : [],
          ),
        ),
      ];
      setDelegatedForIds(ids);
      if (ids.length === 0) return;
      const profiles = await client
        .from("user_profiles")
        .select("id, display_name")
        .in("id", ids);
      if (!active || profiles.error) return;
      setDelegatorProfileNames(
        Object.fromEntries(
          (profiles.data ?? []).flatMap((row) =>
            typeof row.id === "string" &&
            typeof row.display_name === "string" &&
            row.display_name.trim()
              ? [[row.id, row.display_name.trim()]]
              : [],
          ),
        ),
      );
    };
    void load();
    // Delegations start and end over time.
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [canWorkTickets, delegationTenantId, delegationUserId]);
  useEffect(() => {
    if (!supabase || !delegationTenantId || !canWorkTickets) {
      setSupervisedDepartmentIds([]);
      return;
    }
    let active = true;
    void supabase
      .rpc("my_supervised_department_ids", { p_tenant_id: delegationTenantId })
      .then(({ data, error }) => {
        if (!active) return;
        setSupervisedDepartmentIds(
          !error && Array.isArray(data)
            ? data.filter((entry): entry is string => typeof entry === "string")
            : [],
        );
      });
    return () => {
      active = false;
    };
  }, [canWorkTickets, delegationTenantId]);
  useEffect(() => {
    // The scope disappears when the last delegation ends.
    if (ticketScope === "delegated" && delegatedForIds.length === 0) {
      setTicketScope("all");
    }
  }, [delegatedForIds, ticketScope]);
  // Agents the current user stands in for right now (active delegations).
  const delegatedForNames = useMemo(() => {
    const names = new Map(
      ticketFilterOptions.agents.map((agent) => [agent.id, agent.displayName]),
    );
    return delegatedForIds.map(
      (id) => delegatorProfileNames[id] ?? names.get(id) ?? "Kolleg:in",
    );
  }, [delegatedForIds, delegatorProfileNames, ticketFilterOptions.agents]);
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
  const [greeting, setGreeting] = useState(() => timeOfDayGreeting());
  useEffect(() => {
    // Keep the greeting right when the page stays open across the day.
    const timer = window.setInterval(
      () => setGreeting(timeOfDayGreeting()),
      5 * 60_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const queueCount = (queueKey: string) =>
    view.tickets.filter((ticket) => ticket.queue === queueKey).length;
  const openTicketScope = (scope: TicketScope) => {
    setMetricTicketFilter(null);
    setReportDrilldown(null);
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
    // Exactly the tickets of this queue: department and team, or the
    // tickets without a team (nil UUID, see migration 0251).
    setReportDrilldown({
      source: "queue",
      label: `${teamQueue.departmentName?.trim() || department.key} · ${
        teamQueue.teamId
          ? `Team ${teamQueue.teamName?.trim() || "ohne Namen"}`
          : "ohne Teamzuordnung"
      }`,
      departmentIds: [teamQueue.departmentId],
      teamIds: [teamQueue.teamId ?? "00000000-0000-0000-0000-000000000000"],
      statusClosed: false,
    });
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
    setReportDrilldown(null);
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
    setReportDrilldown(null);
    setMetricTicketFilter(filter);
    setSection("Tickets");
    setSplitSelectedTicketId(null);
  };
  /** Report drilldown: opens the ticket list with only the report filter. */
  const openReportDrilldown = (drilldown: TicketDrilldown) => {
    const normalized = normalizeTicketDrilldown(drilldown);
    if (!normalized) return;
    clearTicketSelection();
    setQuery("");
    setTicketListRefinement(DEFAULT_TICKET_LIST_REFINEMENT);
    setQueue("alle");
    setTicketScope(canWorkTickets ? "all" : "mine");
    setMetricTicketFilter(null);
    setReportDrilldown(normalized);
    setSelectedTicketId(null);
    setSplitSelectedTicketId(null);
    setSection("Tickets");
  };
  const ticketScopeLabel: Record<TicketScope, string> = {
    all: "Alle sichtbaren Tickets",
    closed: "Gelöste Tickets",
    mine: "Meine Tickets",
    open: "Offene Tickets",
    unassigned: "Nicht zugewiesene Tickets",
    delegated: delegatedForNames.length
      ? `Stellvertretung für ${delegatedForNames.join(", ")}`
      : "Stellvertretung",
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
      return workplaceAvailable;
    }
    if (item.label === "Systemstatus") return serviceStatusReadable;
    if (
      item.label === "Services" ||
      item.label === "Assets" ||
      item.label === "Fälle"
    ) {
      return isFeatureEnabled("assets.management");
    }
    if (item.label === "Infrastruktur") {
      return isFeatureEnabled("assets.management");
    }
    if (item.label === "Sicherheitsfälle") return canWorkTickets;
    if (item.label === "Lager") return isFeatureEnabled("inventory.management");
    if (item.label === "Shop") return isFeatureEnabled("self_service.shop");
    if (item.label === "Wissen") return isFeatureEnabled("knowledge.base");
    if (item.label === "Verträge" || item.label === "Lizenzen") {
      return contractsAvailable;
    }
    if (item.label === "Berichte") return reportsAvailable;
    if (item.label === "Teamführung") {
      return canWorkTickets && supervisedDepartmentIds.length > 0;
    }
    if (item.label === "Serviceaufgaben") {
      return isFeatureEnabled("service.tasks") && canReadServiceTasks;
    }
    if (item.label === "Raumplanung") return isFeatureEnabled("event.spaces");
    if (item.label === "Eintritte") {
      return isFeatureEnabled("onboarding.entries");
    }
    return true;
  });
  const requesterSections = requesterNavigationSections(featureSections);
  const restrictedWorkSections = featureSections.filter(
    (item) =>
      item.label === "Verträge" ||
      item.label === "Lizenzen" ||
      item.label === "Berichte" ||
      item.label === "Systemstatus" ||
      item.label === "Serviceaufgaben" ||
      item.label === "Lager",
  );
  // The shop is open to everybody, also next to restricted work sections.
  const shopSections = featureSections.filter((item) => item.label === "Shop");
  // Employees without ticket work get a flat menu without room planning,
  // inventory or workplace; the status is a badge on top of the menu.
  const employeeHiddenSections: readonly Section[] = [
    "Raumplanung",
    "Infrastruktur",
    "Lager",
    "Arbeitsplatz",
    "Systemstatus",
  ];
  const workSections = canWorkTickets
    ? featureSections
    : [...requesterSections, ...restrictedWorkSections, ...shopSections].filter(
        (item, index, list) =>
          !employeeHiddenSections.includes(item.label) &&
          list.findIndex((other) => other.label === item.label) === index,
      );
  const workSectionAvailable = (label: Section) =>
    workSections.some((item) => item.label === label);
  const quickCreateActions = quickCreateActionsForContext({
    assetManagementEnabled: isFeatureEnabled("assets.management"),
    canWorkTickets,
    experienceWorkspaceEnabled,
    hasActiveTenant: activeTenant !== null,
    knowledgeBaseEnabled: isFeatureEnabled("knowledge.base"),
    serviceTasksAvailable: workSectionAvailable("Serviceaufgaben"),
    inventoryAvailable: workSectionAvailable("Lager"),
    contractsAvailable:
      workSectionAvailable("Verträge") && workSectionAvailable("Lizenzen"),
  });

  useEffect(() => {
    if (ticketAccessLoading || tenantFeaturesLoading) return;
    const sectionFeature: Partial<Record<Section, string>> = {
      Fälle: "assets.management",
      Assets: "assets.management",
      Lager: "inventory.management",
      Shop: "self_service.shop",
      Systemstatus: "assets.management",
      Berichte: "reporting.service",
      Serviceaufgaben: "service.tasks",
      Services: "assets.management",
      Wissen: "knowledge.base",
      Verträge: "contracts.management",
      Lizenzen: "contracts.management",
    };
    const featureKey = sectionFeature[section];
    const workplaceUnavailable =
      section === "Arbeitsplatz" && !workplaceAvailable;
    const serviceStatusUnavailable =
      section === "Systemstatus" && !serviceStatusReadable;
    if (
      ((workplaceUnavailable || featureKey) &&
        isSupabaseConfigured &&
        (workplaceUnavailable || tenantFeatures[featureKey!] !== true)) ||
      serviceStatusUnavailable ||
      ((section === "Verträge" || section === "Lizenzen") &&
        !contractsAvailable) ||
      (section === "Berichte" && !reportsAvailable)
    ) {
      setSection("Übersicht");
    }
  }, [
    agentWorkbenchEnabled,
    experienceWorkspaceEnabled,
    contractsAvailable,
    reportsAvailable,
    section,
    serviceStatusReadable,
    workplaceAvailable,
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
    setCanManageContracts(false);
    setCanReadReports(false);
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

  /** Closing "Ticket erfassen" explicitly discards the stored draft. */
  function cancelTicketComposer() {
    if (activeTenant)
      clearTicketComposerDraft(session?.user.id ?? null, activeTenant.id);
    setTicketComposerOpen(false);
    setComposerRequester(null);
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
    const actionSections: Record<
      Exclude<QuickCreateAction, "ticket">,
      Section
    > = {
      followUp: "Arbeitsplatz",
      problem: "Fälle",
      serviceTask: "Serviceaufgaben",
      knowledge: "Wissen",
      inventoryItem: "Lager",
      contract: "Verträge",
      license: "Lizenzen",
    };
    setSection(actionSections[action]);
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

  // Employees without ticket work: flat menu, status badge on top.
  const employeeNavigation = isSupabaseConfigured && !canWorkTickets;
  const visibleSections = isTenantAdmin
    ? [...workSections, { label: "Einstellungen" as const, Icon: Settings }]
    : workSections;
  const primaryNavigationSections = visibleSections.filter(
    (item) => item.label !== "Einstellungen",
  );
  const { workplaceNavigationItem, remainingNavigationSections } =
    splitWorkplaceNavigation(primaryNavigationSections);
  // Übersicht, Arbeitsplatz und Teamführung stehen als primäre Einträge über
  // den Kategorien.
  const primaryNavigationItems = [
    remainingNavigationSections.find((item) => item.label === "Übersicht"),
    workplaceNavigationItem,
    remainingNavigationSections.find((item) => item.label === "Teamführung"),
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const settingsNavigationItem = visibleSections.find(
    (item) => item.label === "Einstellungen",
  );
  const navigationItemsBySection = new Map(
    remainingNavigationSections.map((item) => [item.label, item]),
  );
  const navigationAttentionFor = (label: Section): number | null =>
    navigationItemAttentionCount(
      label === "Raumplanung"
        ? eventSpaceNavigationAccess
          ? eventSpaceAttentionCount
          : null
        : label === "Shop"
          ? shopAttentionCount
          : label === "Eintritte"
            ? onboardingAttentionCount
            : null,
    );
  const navigationAttentionDescription = (label: Section): string =>
    label === "Raumplanung"
      ? "Raumaufträge benötigen Zuweisung oder Klärung"
      : label === "Shop"
        ? "neue Bestellungen warten auf Bearbeitung"
        : "Eintritte sind noch nicht in Bearbeitung";
  // Berichte stands on its own below the categories.
  const reportsNavigationItem = navigationItemsBySection.get("Berichte");
  const navigationGroups = NAVIGATION_CATEGORIES.map((category) => ({
    ...category,
    items: category.sectionLabels.flatMap((label) => {
      const item = navigationItemsBySection.get(label);
      return item ? [item] : [];
    }),
  })).filter((category) => category.items.length > 0);
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
  if (isSupabaseConfigured && session && oauthAuthorizationId) {
    return (
      <OAuthConsentScreen
        authorizationId={oauthAuthorizationId}
        Shell={AccessShell}
        userLabel={session.user.email ?? "angemeldete Person"}
      />
    );
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
            setReportDrilldown(null);
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
        {employeeNavigation ? (
          <>
            {serviceStatusReadable && activeTenant ? (
              <div className="workplace-primary-navigation employee-status-navigation">
                <NavigationStatusBadge
                  active={navSection === "Systemstatus"}
                  onOpenInternal={() => {
                    setPersonalSettingsOpen(false);
                    setSection("Systemstatus");
                  }}
                  tenantId={activeTenant.id}
                />
              </div>
            ) : null}
            <nav
              aria-label="Navigation"
              className="nav-list employee-navigation"
            >
              {remainingNavigationSections
                .filter((item) => item.label !== "Übersicht")
                .map((item) => {
                  const attentionCount = navigationAttentionFor(item.label);
                  const hasAttention = attentionCount !== null;
                  const label = sectionDisplayLabel(item.label);
                  return (
                    <button
                      aria-current={
                        navSection === item.label ? "page" : undefined
                      }
                      aria-label={
                        hasAttention
                          ? `${label} – ${attentionCount} ${navigationAttentionDescription(item.label)}`
                          : label
                      }
                      className={
                        navSection === item.label
                          ? "nav-item active"
                          : "nav-item"
                      }
                      key={item.label}
                      onClick={() => {
                        setPersonalSettingsOpen(false);
                        setSection(item.label);
                      }}
                      type="button"
                    >
                      <item.Icon
                        aria-hidden="true"
                        size={18}
                        strokeWidth={1.8}
                      />
                      <span className="nav-item__label">{label}</span>
                      {hasAttention ? (
                        <span
                          aria-hidden="true"
                          className="nav-item__badge nav-item__badge--trailing"
                        >
                          {attentionCount > 99 ? "99+" : attentionCount}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
            </nav>
          </>
        ) : (
          <>
            {primaryNavigationItems.length > 0 && (
              <nav
                aria-label="Übersicht und Arbeitsplatz"
                className="workplace-primary-navigation"
              >
                {primaryNavigationItems.map((item) => (
                  <button
                    className={
                      navSection === item.label ? "nav-item active" : "nav-item"
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
            )}
            <div className="navigation-categories">
              {navigationGroups.map((category) => {
                const categoryExpanded =
                  expandedNavigationCategoryId === category.id;
                const categoryAttentionCount =
                  collapsedNavigationCategoryAttentionCount({
                    categoryExpanded,
                    itemCounts: category.items.map((item) =>
                      navigationAttentionFor(item.label),
                    ),
                  });
                const hasCategoryAttention = categoryAttentionCount !== null;
                const panelId = `${category.id}-panel`;

                return (
                  <section className="navigation-cluster" key={category.id}>
                    <h2 className="navigation-label">
                      <button
                        aria-controls={panelId}
                        aria-expanded={categoryExpanded}
                        aria-label={
                          hasCategoryAttention
                            ? `${category.navigationLabel} – ${categoryAttentionCount} offene Einträge`
                            : category.navigationLabel
                        }
                        className="navigation-cluster__toggle"
                        id={category.id}
                        onClick={() =>
                          setExpandedNavigationCategoryId((current) =>
                            nextExpandedAccordionId(current, category.id),
                          )
                        }
                        type="button"
                      >
                        <span className="navigation-cluster__heading">
                          <span>{category.heading}</span>
                          {hasCategoryAttention ? (
                            <span
                              aria-hidden="true"
                              className="navigation-cluster__badge"
                            >
                              {categoryAttentionCount > 99
                                ? "99+"
                                : categoryAttentionCount}
                            </span>
                          ) : null}
                        </span>
                        <ChevronDown
                          aria-hidden="true"
                          className="navigation-cluster__chevron"
                          size={15}
                          strokeWidth={1.9}
                        />
                      </button>
                    </h2>
                    <div
                      className="navigation-cluster__content"
                      hidden={!categoryExpanded}
                      id={panelId}
                    >
                      <nav aria-labelledby={category.id} className="nav-list">
                        {category.items.map((item) => {
                          const attentionCount = navigationAttentionFor(
                            item.label,
                          );
                          const hasAttention = attentionCount !== null;
                          const label = sectionDisplayLabel(item.label);
                          return (
                            <button
                              aria-current={
                                navSection === item.label ? "page" : undefined
                              }
                              aria-label={
                                hasAttention
                                  ? `${label} – ${attentionCount} ${navigationAttentionDescription(item.label)}`
                                  : label
                              }
                              className={
                                navSection === item.label
                                  ? "nav-item active"
                                  : "nav-item"
                              }
                              key={item.label}
                              onClick={() => {
                                setPersonalSettingsOpen(false);
                                setSection(item.label);
                              }}
                              type="button"
                            >
                              <item.Icon
                                aria-hidden="true"
                                size={18}
                                strokeWidth={1.8}
                              />
                              <span className="nav-item__label">{label}</span>
                              {hasAttention ? (
                                <span
                                  aria-hidden="true"
                                  className="nav-item__badge nav-item__badge--trailing"
                                >
                                  {attentionCount > 99 ? "99+" : attentionCount}
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </nav>
                    </div>
                  </section>
                );
              })}
            </div>
            {reportsNavigationItem ? (
              <nav
                aria-label="Berichte"
                className="workplace-primary-navigation rail-reports-navigation"
              >
                <button
                  aria-current={
                    navSection === reportsNavigationItem.label
                      ? "page"
                      : undefined
                  }
                  className={
                    navSection === reportsNavigationItem.label
                      ? "nav-item active"
                      : "nav-item"
                  }
                  onClick={() => {
                    setPersonalSettingsOpen(false);
                    setSection(reportsNavigationItem.label);
                  }}
                  type="button"
                >
                  <reportsNavigationItem.Icon
                    aria-hidden="true"
                    size={18}
                    strokeWidth={1.8}
                  />
                  {sectionDisplayLabel(reportsNavigationItem.label)}
                </button>
              </nav>
            ) : null}
          </>
        )}
        <div className="rail-footer">
          {settingsNavigationItem && (
            <nav aria-label="Einstellungen" className="rail-footer__settings">
              <button
                className={
                  navSection === settingsNavigationItem.label
                    ? "nav-item active"
                    : "nav-item"
                }
                onClick={() => {
                  setPersonalSettingsOpen(false);
                  setSection(settingsNavigationItem.label);
                }}
                type="button"
              >
                <settingsNavigationItem.Icon
                  aria-hidden="true"
                  size={18}
                  strokeWidth={1.8}
                />
                {sectionDisplayLabel(settingsNavigationItem.label)}
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
              <span className="operator-avatar">
                {operatorPhotoUrl ? (
                  <img
                    alt=""
                    className="operator-avatar__photo"
                    referrerPolicy="no-referrer"
                    src={operatorPhotoUrl}
                  />
                ) : (
                  initials(operatorName)
                )}
              </span>
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
              <span>
                {personalSettingsOpen
                  ? "Mein Konto"
                  : sectionPageTitle(section)}
              </span>
            </p>
            <h1>
              {personalSettingsOpen
                ? "Persönliche Einstellungen"
                : section === "Übersicht"
                  ? `${greeting}, ${greetingName}.`
                  : sectionPageTitle(section)}
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
                      setReportDrilldown(null);
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
                    !(
                      sectionFromGlobalSearchResult(result) === "Raumplanung" &&
                      eventSpaceNavigationAccess
                    ) &&
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
                onSelectPerson={
                  canWorkTickets
                    ? (person) => setPersonOverview(person)
                    : undefined
                }
                onSelectRecent={(item) => {
                  setGlobalSearchTarget(null);
                  if (item.itemType === "ticket") {
                    setSection("Tickets");
                    setSelectedTicketId(item.itemId);
                    return;
                  }
                  if (!canWorkTickets) return;
                  setSelectedTicketId(null);
                  if (item.itemType === "knowledge_article") {
                    setKnowledgeFocusArticleId(item.itemId);
                    setSection("Wissen");
                    return;
                  }
                  if (isFeatureEnabled("assets.management")) {
                    setAssetFocusQuery({ query: item.title, id: Date.now() });
                    setSection("Assets");
                  }
                }}
                scope={
                  canWorkTickets || eventSpaceNavigationAccess
                    ? "all"
                    : "tickets-only"
                }
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
                            {notification.kind ===
                            "ticket.supervisor_request" ? (
                              <SupervisorRequestReply
                                notification={notification}
                                onAnswered={(notificationId) =>
                                  setNotifications((current) =>
                                    current.map((item) =>
                                      item.id === notificationId
                                        ? {
                                            ...item,
                                            readAt:
                                              item.readAt ??
                                              new Date().toISOString(),
                                          }
                                        : item,
                                    ),
                                  )
                                }
                              />
                            ) : null}
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
            employeeView={!canWorkTickets}
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
              onOpenTicket={(ticketId) => setSelectedTicketId(ticketId)}
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
                : knowledgeFocusArticleId
            }
            onCreateArticleRequestConsumed={consumeQuickCreateRequest}
            onOpenTicket={(ticketId) => setSelectedTicketId(ticketId)}
            readOnly={isSupabaseConfigured && !canWorkTickets}
            tenantId={activeTenant.id}
          />
        ) : section === "Verträge" && activeTenant && contractsAvailable ? (
          <Contracts
            createRequestId={
              activeQuickCreateRequest?.action === "contract"
                ? activeQuickCreateRequest.id
                : undefined
            }
            onCreateRequestConsumed={consumeQuickCreateRequest}
            tenantId={activeTenant.id}
          />
        ) : section === "Lizenzen" && activeTenant && contractsAvailable ? (
          <Licenses
            createRequestId={
              activeQuickCreateRequest?.action === "license"
                ? activeQuickCreateRequest.id
                : undefined
            }
            onCreateRequestConsumed={consumeQuickCreateRequest}
            tenantId={activeTenant.id}
          />
        ) : section === "Assets" &&
          activeTenant &&
          isFeatureEnabled("assets.management") ? (
          <ServiceAssets
            assetQueryRequest={assetFocusQuery ?? undefined}
            fixedTab="assets"
            key={`service-assets:${activeTenant.id}:assets`}
            labelBranding={{
              name: workspaceBrandName,
              logoUrl: activeWorkspaceBranding?.logoUrl ?? null,
            }}
            tenantId={activeTenant.id}
          />
        ) : section === "Sicherheitsfälle" && activeTenant && canWorkTickets ? (
          <SecurityCases key={activeTenant.id} tenantId={activeTenant.id} />
        ) : section === "Infrastruktur" &&
          activeTenant &&
          isFeatureEnabled("assets.management") ? (
          <Infrastructure
            initialRack={infrastructureRackFocus ?? undefined}
            labelBranding={{
              name: workspaceBrandName,
              logoUrl: activeWorkspaceBranding?.logoUrl ?? null,
            }}
            onOpenTicket={(ticketId) => setSelectedTicketId(ticketId)}
            tenantId={activeTenant.id}
          />
        ) : section === "Lager" &&
          activeTenant &&
          isFeatureEnabled("inventory.management") ? (
          <Inventory
            createRequestId={
              activeQuickCreateRequest?.action === "inventoryItem"
                ? activeQuickCreateRequest.id
                : undefined
            }
            onCreateRequestConsumed={consumeQuickCreateRequest}
            tenantId={activeTenant.id}
          />
        ) : section === "Shop" &&
          activeTenant &&
          isFeatureEnabled("self_service.shop") ? (
          <Shop key={activeTenant.id} tenantId={activeTenant.id} />
        ) : section === "Serviceaufgaben" && activeTenant ? (
          <ServiceTasks
            createRequestId={
              activeQuickCreateRequest?.action === "serviceTask"
                ? activeQuickCreateRequest.id
                : undefined
            }
            onCreateRequestConsumed={consumeQuickCreateRequest}
            focusOccurrenceId={serviceTaskFocusId}
            key={activeTenant.id}
            onFocusHandled={() => setServiceTaskFocusId(null)}
            tenantId={activeTenant.id}
          />
        ) : section === "Raumplanung" && activeTenant ? (
          <EventSpaces
            focusRequestId={
              globalSearchTarget?.resultType === "event_space"
                ? globalSearchTarget.entityId
                : undefined
            }
            onAttentionChanged={() =>
              setEventSpaceAttentionRevision((revision) => revision + 1)
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
          <ServiceAssets
            fixedTab="services"
            key={`service-assets:${activeTenant.id}:services`}
            onCreateMaintenance={
              serviceStatusAvailable
                ? () => {
                    setServiceMaintenanceCreateRequestId(
                      (requestId) => (requestId ?? 0) + 1,
                    );
                    setSection("Systemstatus");
                  }
                : undefined
            }
            tenantId={activeTenant.id}
          />
        ) : section === "Systemstatus" &&
          activeTenant &&
          serviceStatusReadable ? (
          <ServiceStatus
            createMaintenanceRequestId={serviceMaintenanceCreateRequestId}
            onCreateMaintenanceRequestConsumed={(requestId) =>
              setServiceMaintenanceCreateRequestId((currentRequestId) =>
                currentRequestId === requestId ? undefined : currentRequestId,
              )
            }
            tenantId={activeTenant.id}
          />
        ) : section === "Fälle" &&
          activeTenant &&
          isFeatureEnabled("assets.management") ? (
          <>
            <ProblemCandidates
              onCreated={() => setProblemListVersion((current) => current + 1)}
              onOpenTicket={(ticketId) => setSelectedTicketId(ticketId)}
              tenantId={activeTenant.id}
            />
            <ServiceAssets
              createProblemRequestId={
                activeQuickCreateRequest?.action === "problem"
                  ? activeQuickCreateRequest.id
                  : undefined
              }
              fixedTab="problems"
              key={`service-assets:${activeTenant.id}:problems:${problemListVersion}`}
              onCreateProblemRequestConsumed={consumeQuickCreateRequest}
              tenantId={activeTenant.id}
            />
          </>
        ) : section === "Teamführung" &&
          activeTenant &&
          supervisedDepartmentIds.length > 0 ? (
          <TeamSupervision
            onOpenTicket={(ticketId) => {
              setSelectedTicketId(ticketId);
            }}
            onOpenTicketList={openReportDrilldown}
            tenantId={activeTenant.id}
          />
        ) : section === "Berichte" && activeTenant && reportsAvailable ? (
          <ServiceReporting
            onOpenTicketList={openReportDrilldown}
            branding={{
              accentColor: activeWorkspaceBranding?.accentColor ?? "#075985",
              logoUrl: workspaceBrandLogo,
              name: workspaceBrandName,
              primaryColor: activeWorkspaceBranding?.primaryColor ?? "#4338CA",
              secondaryColor:
                activeWorkspaceBranding?.secondaryColor ?? "#3730A3",
            }}
            tenantId={activeTenant.id}
          />
        ) : section === "Arbeitsplatz" &&
          activeTenant &&
          session &&
          workplaceAvailable ? (
          <>
            <IntroTip
              tenantId={activeTenant.id}
              tip={canWorkTickets ? "arbeitsplatz" : "mein-portal"}
              userId={session.user.id}
            />
            <AgentWorkbenchPanel
              canManageIncidents={isTenantAdmin}
              followUpsEnabled={workplaceFollowUpsEnabled}
              followUpsPanel={
                workplaceFollowUpsEnabled ? (
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
              portalPanel={
                requesterPortalEnabled ? (
                  <RequesterPortalPanel
                    embedded={
                      agentWorkbenchEnabled || workplaceFollowUpsEnabled
                    }
                    onCreateTicket={() => startQuickCreate("ticket")}
                    onOpenShop={
                      workSections.some((item) => item.label === "Shop")
                        ? () => setSection("Shop")
                        : undefined
                    }
                    onOpenTicket={(ticketId) => {
                      setSection("Tickets");
                      setSelectedTicketId(ticketId);
                    }}
                    onOpenTickets={() => setSection("Tickets")}
                    tenantId={activeTenant.id}
                  />
                ) : undefined
              }
              requestedView={
                workplaceRequestedView === "portal"
                  ? "portal"
                  : requestedWorkplaceViewForFollowUps(
                      workplaceFollowUpsEnabled,
                      workplaceRequestedView === "followUps" ||
                        activeQuickCreateRequest?.action === "followUp" ||
                        globalSearchTarget?.resultType === "follow_up",
                    )
              }
              showAgentWorkbench={agentWorkbenchEnabled}
              tenantId={activeTenant.id}
            />
          </>
        ) : section === "Tickets" ? (
          <>
            <section className="ticket-panel panel ticket-module">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Autorisierte Vorgänge</p>
                  <h2>
                    {metricTicketFilter?.label ??
                      (reportDrilldown
                        ? reportDrilldown.source === "queue"
                          ? "Tickets der Warteschlange"
                          : "Tickets aus Bericht"
                        : ticketScopeLabel[effectiveTicketScope])}
                  </h2>
                </div>
                <div className="ticket-list-heading-actions">
                  <span className="data-caption">
                    {view.hasMoreTickets
                      ? `${filteredTickets.length} geladen`
                      : `${filteredTickets.length} Treffer`}
                  </span>
                </div>
              </div>
              <TicketScopeMetricTiles
                canWorkTickets={canWorkTickets}
                delegatedForNames={delegatedForNames}
                loading={dashboardMetricsLoading}
                metrics={view.metrics}
                onOpenScope={openTicketScope}
                selectedScope={
                  metricTicketFilter || reportDrilldown
                    ? null
                    : effectiveTicketScope
                }
                trends={dashboardTrends}
              />
              {activeTenant && isSupabaseConfigured && canWorkTickets && (
                <TicketListFilters
                  onTicketsRestored={() => {
                    setTicketPage(0);
                    setDashboardRevision((current) => current + 1);
                  }}
                  agents={ticketFilterOptions.agents}
                  departments={ticketFilterOptions.departments}
                  filters={ticketListRefinement}
                  hasActiveFilters={hasTicketListRefinement}
                  onChange={setTicketListRefinement}
                  onClear={clearTicketFilters}
                  onQueryChange={updateTicketSearchQuery}
                  onSavedViewApply={(filters) => {
                    clearTicketSelection();
                    setMetricTicketFilter(null);
                    setReportDrilldown(null);
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
                  priorities={ticketFilterOptions.priorities}
                  query={query}
                  savedViewFilters={{
                    ...ticketListRefinement,
                    query,
                    queue,
                    ticketScope,
                  }}
                  savedViews={savedTicketViews}
                  savedViewsLoading={savedTicketViewsLoading}
                  statuses={ticketFilterOptions.statuses}
                  tenantId={activeTenant.id}
                  currentUserId={session?.user.id}
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
                        : `${deleted} Tickets wurden in den Papierkorb verschoben. Sie lassen sich 90 Tage lang über den Filter «Gelöschte Tickets» wiederherstellen.`,
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
              {activeTenant && isSupabaseConfigured && canWorkTickets && (
                <SupportLevelQueueFilter
                  onChange={setSupportLevelFilter}
                  tenantId={activeTenant.id}
                  value={supportLevelFilter}
                />
              )}
              {activeTenant && isSupabaseConfigured && canWorkTickets && (
                <TicketListIncidentHint
                  onShowTickets={(incident, label) =>
                    openMetricTickets({ label, ticketIds: incident.ticketIds })
                  }
                  tenantId={activeTenant.id}
                />
              )}
              {reportDrilldown && (
                <div
                  aria-label={
                    reportDrilldown.source === "queue"
                      ? "Filter aus Warteschlange"
                      : "Filter aus Bericht"
                  }
                  className="ticket-drilldown-chips"
                  role="group"
                >
                  <span className="ticket-drilldown-chip">
                    <span>{drilldownChipLabel(reportDrilldown)}</span>
                    <button
                      aria-label={`Filter «${drilldownChipLabel(reportDrilldown)}» entfernen`}
                      className="ticket-drilldown-chip__remove"
                      onClick={() => setReportDrilldown(null)}
                      title="Filter entfernen"
                      type="button"
                    >
                      <X aria-hidden="true" size={14} strokeWidth={2.2} />
                    </button>
                  </span>
                </div>
              )}
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
              {isSupabaseConfigured && canWorkTickets && activeTenant ? (
                <div
                  aria-label="Darstellung der Tickets"
                  className="ticket-layout-switch"
                  role="group"
                >
                  {(["list", "kanban"] as const).map((layout) => (
                    <button
                      aria-pressed={ticketLayout === layout}
                      className={ticketLayout === layout ? "is-active" : ""}
                      key={layout}
                      onClick={() => changeTicketLayout(layout)}
                      type="button"
                    >
                      {layout === "list" ? (
                        <List aria-hidden="true" size={15} />
                      ) : (
                        <Columns3 aria-hidden="true" size={15} />
                      )}
                      {layout === "list" ? "Liste" : "Kanban"}
                    </button>
                  ))}
                </div>
              ) : null}
              {ticketLayout === "kanban" &&
              isSupabaseConfigured &&
              canWorkTickets &&
              activeTenant ? (
                <TicketKanban
                  onChanged={() =>
                    setDashboardRevision((current) => current + 1)
                  }
                  onOpen={(ticketId) => setSelectedTicketId(ticketId)}
                  tenantId={activeTenant.id}
                  tickets={filteredTickets}
                />
              ) : (
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
                      {...(isSupabaseConfigured &&
                      canWorkTickets &&
                      activeTenant
                        ? {
                            assignment: {
                              currentUserId: session?.user.id ?? null,
                              onChanged: () =>
                                setDashboardRevision((current) => current + 1),
                              tenantId: activeTenant.id,
                            },
                          }
                        : {})}
                      {...(isSupabaseConfigured && canWorkTickets
                        ? {
                            onOpen: openTicketFromList,
                            onSelectionChange: updateTicketSelection,
                            selectedTicketIds,
                          }
                        : isSupabaseConfigured
                          ? { onOpen: setSelectedTicketId }
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
              )}
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

            <HomeLayoutEditor layout={homeLayout} onChange={changeHomeLayout} />
            {homeLayout.hidden.includes("metrics") ? null : (
              <TicketScopeMetricTiles
                canWorkTickets={canWorkTickets}
                delegatedForNames={delegatedForNames}
                loading={dashboardMetricsLoading}
                metrics={view.metrics}
                onOpenScope={openTicketScope}
                selectedScope={null}
                trends={dashboardTrends}
              />
            )}

            <section
              className={`content-grid${homeLayout.hidden.includes("tickets") ? " content-grid--no-tickets" : ""}`}
            >
              {homeLayout.hidden.includes("tickets") ? null : (
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
                    {...(isSupabaseConfigured && canWorkTickets && activeTenant
                      ? {
                          assignment: {
                            currentUserId: session?.user.id ?? null,
                            onChanged: () =>
                              setDashboardRevision((current) => current + 1),
                            tenantId: activeTenant.id,
                          },
                        }
                      : {})}
                    keyboardActiveTicketId={keyboardActiveTicketId}
                    {...(activeTenant
                      ? { onCreateTicket: () => setTicketComposerOpen(true) }
                      : {})}
                    tickets={filteredTickets}
                  />
                </article>
              )}

              <aside className="side-stack">
                {homeLayout.order
                  .filter((key) => !homeLayout.hidden.includes(key))
                  .map((key) => (
                    <Fragment key={key}>
                      {key === "myPriorities" ? (
                        <>
                          {activeTenant && canWorkTickets && (
                            <MyPrioritiesCard
                              onOpenTicket={(ticketId) => {
                                setSection("Tickets");
                                setSelectedTicketId(ticketId);
                              }}
                              refreshKey={dashboardRevision}
                              tenantId={activeTenant.id}
                            />
                          )}
                        </>
                      ) : key === "approvals" ? (
                        <>
                          {activeTenant &&
                            isFeatureEnabled("ticketing.detail") && (
                              <ApprovalInboxCard
                                onOpenTicket={(ticketId) => {
                                  setSection("Tickets");
                                  setSelectedTicketId(ticketId);
                                }}
                                tenantId={activeTenant.id}
                              />
                            )}
                        </>
                      ) : key === "agentMetrics" ? (
                        <>
                          {activeTenant && agentWorkbenchEnabled && (
                            <AgentMetricsCard
                              onOpenTickets={openMetricTickets}
                              tenantId={activeTenant.id}
                            />
                          )}
                        </>
                      ) : key === "myDay" ? (
                        <>
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
                        </>
                      ) : key === "activity" ? (
                        <article className="panel activity-panel">
                          <div className="panel-heading">
                            <div>
                              <p className="eyebrow">Ereignisse</p>
                              <h2>Gerade passiert</h2>
                            </div>
                          </div>
                          {view.activity.length === 0 ? (
                            <p className="empty-state">
                              Keine autorisierten Ereignisse im gewählten
                              Zeitraum.
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
                      ) : null}
                    </Fragment>
                  ))}
              </aside>
            </section>
          </>
        )}
      </main>
      {tourOpen ? (
        <OnboardingTour
          onClose={() => {
            setTourOpen(false);
            if (session?.user.id) markTourSeen(session.user.id, true);
          }}
          onNavigate={navigateForTour}
          steps={AGENT_TOUR}
        />
      ) : null}
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
                  {canWorkTickets ? (
                    <button
                      className="text-button"
                      onClick={() => setTourOpen(true)}
                      type="button"
                    >
                      Einführung erneut starten
                    </button>
                  ) : null}
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
            if (event.key === "Escape") cancelTicketComposer();
          }}
          role="dialog"
        >
          <div className="ticket-compose-dialog__surface">
            <button
              aria-label="Ticketerfassung schliessen"
              className="ticket-compose-dialog__close"
              onClick={cancelTicketComposer}
              type="button"
            >
              <X aria-hidden="true" size={20} strokeWidth={1.8} />
            </button>
            <TicketComposer
              currentUserId={session?.user.id ?? null}
              initialRequester={composerRequester}
              key={composerRequester?.id ?? "self"}
              onCreated={(ticketId, ticketNumber) => {
                setTicketPage(0);
                setDashboardRevision((value) => value + 1);
                setTicketComposerOpen(false);
                setComposerRequester(null);
                setSection("Tickets");
                setSelectedTicketId(ticketId);
                setCreatedTicketToast({ ticketId, ticketNumber });
              }}
              onOpenKnowledgeArticle={(articleId, draftKept) => {
                setTicketComposerOpen(false);
                setComposerDraftNotice(draftKept);
                setGlobalSearchTarget(null);
                setKnowledgeFocusArticleId(articleId);
                setSection("Wissen");
              }}
              onOpenTicket={(ticketId, _ticketNumber, draftKept) => {
                setTicketComposerOpen(false);
                setComposerDraftNotice(draftKept);
                setSection("Tickets");
                setSelectedTicketId(ticketId);
              }}
              tenantId={activeTenant.id}
            />
          </div>
        </div>
      )}
      {composerDraftNotice && !ticketComposerOpen && !createdTicketToast && (
        <aside className="ticket-success-toast" aria-live="polite">
          <CheckCircle2 aria-hidden="true" size={24} strokeWidth={1.8} />
          <div>
            <strong>Ihr Entwurf wurde gespeichert</strong>
            <span>
              Beim nächsten Öffnen von «Ticket erfassen» ist er wieder da.
            </span>
          </div>
          <button
            className="ticket-toast-open"
            onClick={() => {
              setComposerDraftNotice(false);
              setTicketComposerOpen(true);
            }}
            type="button"
          >
            Fortsetzen
            <ArrowRight aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
          <button
            aria-label="Hinweis schliessen"
            className="ticket-toast-dismiss"
            onClick={() => setComposerDraftNotice(false)}
            type="button"
          >
            <X aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
        </aside>
      )}
      {createdTicketToast && (
        <aside className="ticket-success-toast" aria-live="polite">
          <CheckCircle2 aria-hidden="true" size={24} strokeWidth={1.8} />
          <div>
            <strong>Ticket erstellt</strong>
            <span>{createdTicketToast.ticketNumber}</span>
          </div>
          <span aria-hidden="true" />
          <button
            aria-label="Bestätigung schliessen"
            className="ticket-toast-dismiss"
            onClick={() => setCreatedTicketToast(null)}
            type="button"
          >
            <X aria-hidden="true" size={16} strokeWidth={1.8} />
          </button>
        </aside>
      )}
      {activeTenant &&
        selectedTicketId &&
        isSupabaseConfigured &&
        isFeatureEnabled("ticketing.detail") && (
          <TicketDetail
            currentUserId={session?.user.id ?? null}
            onChanged={() => setDashboardRevision((value) => value + 1)}
            onClose={() => setSelectedTicketId(null)}
            onOpenKnowledgeArticle={(articleId) => {
              setSelectedTicketId(null);
              setGlobalSearchTarget(null);
              setKnowledgeFocusArticleId(articleId);
              setSection("Wissen");
            }}
            onOpenAsset={
              isFeatureEnabled("assets.management")
                ? (query) => {
                    setSelectedTicketId(null);
                    setGlobalSearchTarget(null);
                    setAssetFocusQuery({ query, id: Date.now() });
                    setSection("Assets");
                  }
                : undefined
            }
            onOpenTicket={(ticketId) => setSelectedTicketId(ticketId)}
            onOpenPerson={
              canWorkTickets ? (person) => setPersonOverview(person) : undefined
            }
            requesterView={!canWorkTickets}
            tenantId={activeTenant.id}
            ticketId={selectedTicketId}
          />
        )}
      {activeTenant && personOverview && canWorkTickets && (
        <PersonOverview
          onClose={() => setPersonOverview(null)}
          onCreateTicket={(requester) => {
            setPersonOverview(null);
            setComposerRequester(requester);
            setTicketComposerOpen(true);
          }}
          onOpenAsset={
            isFeatureEnabled("assets.management")
              ? (query) => {
                  setPersonOverview(null);
                  setSelectedTicketId(null);
                  setGlobalSearchTarget(null);
                  setAssetFocusQuery({ query, id: Date.now() });
                  setSection("Assets");
                }
              : undefined
          }
          onOpenTicket={(ticketId) => {
            setPersonOverview(null);
            setSection("Tickets");
            setSelectedTicketId(ticketId);
          }}
          person={personOverview}
          tenantId={activeTenant.id}
        />
      )}
    </div>
  );
}

export function App() {
  const publicStatusBadgeId = isPublicServiceStatusBadgeRequested();
  if (publicStatusBadgeId) {
    return <PublicServiceStatusBadgePage publicId={publicStatusBadgeId} />;
  }
  const publicStatusId = isPublicServiceStatusRequested();
  return publicStatusId ? (
    <PublicServiceStatusPage publicId={publicStatusId} />
  ) : (
    <AuthenticatedApp />
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
              {deleteTicketIds.length} Tickets löschen?
            </strong>
            <p>
              Die Tickets kommen in den Papierkorb und sind nirgends mehr
              sichtbar. Sie lassen sich 90 Tage lang wiederherstellen und werden
              danach endgültig entfernt.
            </p>
          </div>
          <div className="ticket-bulk-actions__confirmation-buttons">
            <button
              className="ticket-bulk-actions__delete-button"
              disabled={pending}
              onClick={() => void deleteTickets()}
              type="button"
            >
              {deleteTicketIds.length} Tickets löschen
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
  currentUserId,
  filters,
  loading,
  onApply,
  onSavedViewsChange,
  savedViews,
  selectRef,
  tenantId,
}: {
  currentUserId: string | undefined;
  filters: SavedTicketViewFilters;
  loading: boolean;
  onApply: (filters: SavedTicketViewFilters) => void;
  onSavedViewsChange: (savedViews: SavedTicketView[]) => void;
  savedViews: SavedTicketView[];
  selectRef?: RefObject<HTMLSelectElement | null>;
  tenantId: string;
}) {
  const [selectedViewId, setSelectedViewId] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState<"save" | "delete" | null>(null);
  const [status, setStatus] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [shareDepartmentId, setShareDepartmentId] = useState("");
  const [shareDepartments, setShareDepartments] = useState<
    { id: string; name: string }[]
  >([]);
  const selectedView =
    savedViews.find((savedView) => savedView.id === selectedViewId) ?? null;
  const ownViews = savedViews.filter(
    (savedView) => savedView.ownerId === currentUserId,
  );
  const sharedViews = savedViews.filter(
    (savedView) => savedView.ownerId !== currentUserId,
  );

  useEffect(() => {
    if (!editorOpen || !supabase || shareDepartments.length) return;
    let active = true;
    void supabase.functions
      .invoke("ticket-saved-views", {
        body: { type: "listSavedViews", tenantId },
      })
      .then(({ data }) => {
        const departments =
          isRecord(data) && isRecord(data.data) ? data.data.departments : null;
        if (!active || !Array.isArray(departments)) return;
        setShareDepartments(
          departments.filter(
            (entry): entry is { id: string; name: string } =>
              isRecord(entry) &&
              typeof entry.id === "string" &&
              typeof entry.name === "string",
          ),
        );
      });
    return () => {
      active = false;
    };
  }, [editorOpen, shareDepartments.length, tenantId]);
  const canDelete = Boolean(
    selectedView && selectedView.ownerId === currentUserId,
  );

  useEffect(() => {
    if (!selectedViewId) return;
    const nextSelectedView = savedViews.find(
      (savedView) => savedView.id === selectedViewId,
    );
    if (nextSelectedView) return;
    setSelectedViewId("");
    setName("");
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
      return;
    }
    setName(nextSelectedView.name);
    onApply(nextSelectedView.filters);
    setStatus(`Ansicht „${nextSelectedView.name}“ angewendet.`);
  }

  function startNewView() {
    setSelectedViewId("");
    setName("");
    setShareDepartmentId("");
    setErrorMessage("");
    setEditorOpen(true);
    setStatus("Neue Ansicht aus den aktuellen Filtern anlegen.");
  }

  function startEditView() {
    if (!selectedView || selectedView.ownerId !== currentUserId) return;
    setShareDepartmentId(selectedView.sharedDepartmentId ?? "");
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
            filters,
            sharedDepartmentId: shareDepartmentId || null,
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
        ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      );
      setSelectedViewId(savedView.id);
      setName(savedView.name);
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
      <div className="saved-ticket-views__heading">
        <div>
          <p className="eyebrow">GESPEICHERTE ANSICHTEN</p>
          <p>Eigene Ansichten und Ansichten, die Ihr Team mit Ihnen teilt.</p>
        </div>
      </div>
      <div className="saved-ticket-views__picker">
        <label>
          <span>Gespeicherte Ansicht</span>
          <select
            disabled={loading || pending !== null}
            onChange={(event) => applySelectedView(event.target.value)}
            ref={selectRef}
            value={selectedViewId}
          >
            <option value="">
              {loading ? "Ansichten werden geladen …" : "Aktuelle Filter"}
            </option>
            {ownViews.length ? (
              <optgroup label="Meine Ansichten">
                {ownViews.map((savedView) => (
                  <option key={savedView.id} value={savedView.id}>
                    {savedView.name}
                    {savedView.sharedDepartmentName
                      ? ` (geteilt mit ${savedView.sharedDepartmentName})`
                      : ""}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {sharedViews.length ? (
              <optgroup label="Vom Team geteilt">
                {sharedViews.map((savedView) => (
                  <option key={savedView.id} value={savedView.id}>
                    {savedView.name}
                    {savedView.ownerName ? ` · ${savedView.ownerName}` : ""}
                  </option>
                ))}
              </optgroup>
            ) : null}
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
        {selectedView && selectedView.ownerId === currentUserId && (
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
            <span>Teilen mit</span>
            <select
              disabled={loading || pending !== null}
              onChange={(event) => setShareDepartmentId(event.target.value)}
              value={shareDepartmentId}
            >
              <option value="">Niemandem (nur für mich)</option>
              {shareDepartments.map((department) => (
                <option key={department.id} value={department.id}>
                  Abteilung {department.name}
                </option>
              ))}
            </select>
          </label>
          <div className="saved-ticket-views__actions">
            <button
              className="secondary-button"
              disabled={loading || pending !== null || !currentUserId}
              type="submit"
            >
              {pending === "save" ? "Wird gespeichert …" : "Ansicht speichern"}
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
  currentUserId,
  departments,
  filters,
  hasActiveFilters,
  onChange,
  onClear,
  onQueryChange,
  onSavedViewApply,
  onSavedViewsChange,
  priorities,
  query,
  savedViewFilters,
  savedViews,
  savedViewsLoading,
  statuses,
  tenantId,
  onTicketsRestored,
}: {
  onTicketsRestored?: (count: number) => void;
  agents: readonly TicketAgentOption[];
  currentUserId: string | undefined;
  departments: readonly { key: string; label: string }[];
  filters: TicketListRefinement;
  hasActiveFilters: boolean;
  onChange: (next: TicketListRefinement) => void;
  onClear: () => void;
  onQueryChange: (value: string) => void;
  onSavedViewApply: (filters: SavedTicketViewFilters) => void;
  onSavedViewsChange: (savedViews: SavedTicketView[]) => void;
  priorities: readonly string[];
  query: string;
  savedViewFilters: SavedTicketViewFilters;
  savedViews: SavedTicketView[];
  savedViewsLoading: boolean;
  statuses: readonly string[];
  tenantId: string;
}) {
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isTrashOpen, setIsTrashOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const savedViewsSelectRef = useRef<HTMLSelectElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const activeControlCount = [
    filters.agent !== "all",
    filters.status !== "all",
    filters.department !== "all",
    filters.priority !== "all",
    filters.sortBy !== "updated",
    filters.sortDirection !== "desc",
  ].filter(Boolean).length;
  const activeFilterCount =
    activeControlCount + Number(query.trim().length > 0);
  const update = <Key extends keyof TicketListRefinement>(
    key: Key,
    value: TicketListRefinement[Key],
  ) => onChange({ ...filters, [key]: value });

  const closePanel = () => {
    setIsPanelOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!isPanelOpen) return;
    const frame = window.requestAnimationFrame(() =>
      (savedViewsSelectRef.current ?? panelRef.current)?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [isPanelOpen]);

  const clear = () => {
    onClear();
  };

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePanel();
      return;
    }
    if (event.key !== "Tab") {
      event.stopPropagation();
      return;
    }

    const focusableElements = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const firstFocusableElement = focusableElements[0];
    const lastFocusableElement =
      focusableElements[focusableElements.length - 1];
    if (!firstFocusableElement || !lastFocusableElement) {
      event.stopPropagation();
      return;
    }

    if (event.shiftKey && document.activeElement === firstFocusableElement) {
      event.preventDefault();
      event.stopPropagation();
      lastFocusableElement.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === lastFocusableElement) {
      event.preventDefault();
      event.stopPropagation();
      firstFocusableElement.focus();
      return;
    }

    event.stopPropagation();
  };

  return (
    <>
      <div className="ticket-list-filters">
        <button
          aria-controls="ticket-list-filter-panel"
          aria-expanded={isPanelOpen}
          aria-haspopup="dialog"
          aria-label={
            activeFilterCount > 0
              ? `Filter & Sortierung öffnen (${activeFilterCount} aktiv)`
              : "Filter & Sortierung öffnen"
          }
          className={
            activeFilterCount > 0
              ? "ticket-list-filters__trigger ticket-list-filters__trigger--active"
              : "ticket-list-filters__trigger"
          }
          onClick={() => setIsPanelOpen(true)}
          ref={triggerRef}
          title="Filter & Sortierung"
          type="button"
        >
          <Filter aria-hidden="true" size={19} strokeWidth={2} />
        </button>
      </div>
      {isPanelOpen && (
        <div
          className="ticket-list-filter-panel-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePanel();
          }}
        >
          <section
            aria-describedby="ticket-list-filter-description"
            aria-labelledby="ticket-list-filter-heading"
            aria-modal="true"
            className="ticket-list-filter-panel"
            id="ticket-list-filter-panel"
            onKeyDown={handlePanelKeyDown}
            ref={panelRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="ticket-list-filter-panel__header">
              <div>
                <p className="eyebrow">TICKETLISTE</p>
                <h2 id="ticket-list-filter-heading">Filter &amp; Sortierung</h2>
                <p id="ticket-list-filter-description">
                  Verfeinern Sie die sichtbaren Tickets nach den gewünschten
                  Kriterien.
                </p>
              </div>
              <button
                aria-label="Filter & Sortierung schliessen"
                className="ticket-list-filter-panel__close"
                onClick={closePanel}
                title="Schliessen"
                type="button"
              >
                <X aria-hidden="true" size={20} strokeWidth={2} />
              </button>
            </header>
            <div className="ticket-list-filter-panel__content">
              <SavedTicketViews
                currentUserId={currentUserId}
                filters={savedViewFilters}
                loading={savedViewsLoading}
                onApply={onSavedViewApply}
                onSavedViewsChange={onSavedViewsChange}
                savedViews={savedViews}
                selectRef={savedViewsSelectRef}
                tenantId={tenantId}
              />
              <label className="ticket-list-filter-panel__search">
                <span>Tickets durchsuchen</span>
                <input
                  autoComplete="off"
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder="Ticketnummer, Betreff oder Beschreibung durchsuchen"
                  spellCheck={false}
                  type="search"
                  value={query}
                />
              </label>
              <div className="ticket-list-filter-panel__controls">
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
                    onChange={(event) =>
                      update("department", event.target.value)
                    }
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
                      update(
                        "sortDirection",
                        event.target.value as TicketSortDirection,
                      )
                    }
                    value={filters.sortDirection}
                  >
                    <option value="desc">Absteigend</option>
                    <option value="asc">Aufsteigend</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="ticket-list-filter-panel__trash">
              <button
                className="secondary-button"
                onClick={() => {
                  setIsPanelOpen(false);
                  setIsTrashOpen(true);
                }}
                type="button"
              >
                <Trash2 aria-hidden="true" size={16} /> Gelöschte Tickets
                anzeigen
              </button>
              <small>
                Gelöschte Tickets 90 Tage lang ansehen und wiederherstellen.
              </small>
            </div>
            <footer className="ticket-list-filter-panel__footer">
              <button
                className="secondary-button"
                disabled={!hasActiveFilters}
                onClick={clear}
                type="button"
              >
                Filter zurücksetzen
              </button>
              <button
                className="primary-button"
                onClick={closePanel}
                type="button"
              >
                Fertig
              </button>
            </footer>
          </section>
        </div>
      )}
      {isTrashOpen && (
        <TicketTrashDialog
          onClose={() => {
            setIsTrashOpen(false);
            window.requestAnimationFrame(() => triggerRef.current?.focus());
          }}
          onRestored={(count) => onTicketsRestored?.(count)}
          tenantId={tenantId}
        />
      )}
    </>
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
  if (!shouldShowQueueTabs(queueOptions)) return null;

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
