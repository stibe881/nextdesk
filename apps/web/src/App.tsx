import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  AtSign,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  CircleEllipsis,
  Command,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Minus,
  MonitorCog,
  Plus,
  Search,
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
  type TenantOption,
} from "./lib/live-dashboard";
import { acceptTenantInvitations } from "./lib/tenant-invitations";
import { TicketComposer } from "./ticket-composer";
import { TicketCsvExport } from "./ticket-csv-export";
import { TicketCsvImport } from "./ticket-csv-import";
import { TicketDetail } from "./ticket-detail";
import { TenantAdminSettings } from "./tenant-admin-settings";
import { KnowledgeBase } from "./knowledge-base";
import { SlaManagement } from "./sla-management";
import { ServiceReporting } from "./service-reporting";
import { ServiceAssets } from "./service-assets";
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
import { OpsCenterPanel } from "./ops-center";
import { RequesterPortalPanel } from "./requester-portal";
import { IntroTip } from "./intro-tips";
import {
  OwnerConsoleScreen,
  resolveOwnerAccess,
  type OwnerAccess,
} from "./platform-owner";
import { functionErrorMessage } from "./lib/function-error";
import { resolveTenantSsoAccess } from "./lib/tenant-sso-access";
import {
  matchesTicketSearch,
  parseTicketSearch,
  removeTicketSearchClause,
} from "./lib/ticket-search";
import { appRedirectUrl, isSupabaseConfigured, supabase } from "./lib/supabase";

type Section =
  | "Übersicht"
  | "Tickets"
  | "Arbeitsplatz"
  | "Erwähnungen"
  | "Mein Portal"
  | "Services"
  | "Assets"
  | "Wissen"
  | "Berichte"
  | "Wiedervorlagen"
  | "Einstellungen";
type TicketScope = "all" | "mine" | "unassigned" | "open" | "closed";
type TicketListDensity = "compact" | "standard" | "comfortable";
type WorkspaceTheme = "light" | "dark" | "system";
type WorkspacePreferences = {
  density: TicketListDensity;
  highContrast: boolean;
  reduceMotion: boolean;
  startSection: Section;
  ticketSplitView: boolean;
  theme: WorkspaceTheme;
};

type DashboardView = {
  activity: readonly TimelineItem[];
  hasMoreTickets: boolean;
  metrics: DashboardMetrics;
  serviceHealth: readonly ServiceHealth[];
  ticketCount: number;
  ticketListNote?: string;
  tickets: readonly DashboardTicket[];
  updatedAt: string;
};

type NotificationTicketReference = {
  id: string;
  subject: string;
  ticketNumber: string;
};

type NotificationItem = {
  createdAt: string;
  id: string;
  kind: string;
  payload: unknown;
  readAt: string | null;
  ticket: NotificationTicketReference | null;
};

type SavedTicketViewFilters = {
  query: string;
  queue: string;
  ticketScope: TicketScope;
};

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
  portalName: string;
  primaryColor: string | null;
  secondaryColor: string | null;
};

const sections: readonly { label: Section; Icon: LucideIcon }[] = [
  { label: "Übersicht", Icon: LayoutDashboard },
  { label: "Tickets", Icon: Ticket },
  { label: "Arbeitsplatz", Icon: BriefcaseBusiness },
  { label: "Erwähnungen", Icon: AtSign },
  { label: "Mein Portal", Icon: UserRound },
  { label: "Services", Icon: MonitorCog },
  { label: "Assets", Icon: Boxes },
  { label: "Wissen", Icon: BookOpen },
  { label: "Berichte", Icon: ChartNoAxesCombined },
  { label: "Wiedervorlagen", Icon: ListTodo },
];

const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  density: "standard",
  highContrast: false,
  reduceMotion: false,
  startSection: "Übersicht",
  ticketSplitView: false,
  theme: "system",
};

const previewView: DashboardView = {
  activity: activityItems,
  hasMoreTickets: false,
  metrics: previewMetrics,
  serviceHealth,
  ticketCount: dashboardTickets.length,
  tickets: dashboardTickets,
  updatedAt: "09:45 · Europe/Zurich",
};

function statusClass(value: string): string {
  return value.toLocaleLowerCase("de-CH").replaceAll(" ", "-");
}

function displayNameFromEmail(email: string | undefined): string {
  if (!email) return "Support-Team";
  return (email.split("@")[0] ?? email).replaceAll(/[._-]/g, " ");
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

function unreadMentionCountFromResponse(value: unknown): number | null {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.mentions)
  ) {
    return null;
  }

  let unread = 0;
  for (const mention of value.data.mentions) {
    if (!isRecord(mention) || !("read_at" in mention)) return null;
    if (mention.read_at === null) unread += 1;
    else if (typeof mention.read_at !== "string") return null;
  }
  return unread;
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

function isSection(value: unknown): value is Section {
  return sections.some((section) => section.label === value);
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
  if (!isRecord(value) || !isSection(value.startSection)) return null;
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
    startSection: value.startSection,
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
  return {
    createdAt: value.createdAt,
    filters: {
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
      typeof value.ticket.subject !== "string" ||
      typeof value.ticket.ticketNumber !== "string"
    ) {
      return null;
    }
    ticket = value.ticket as NotificationTicketReference;
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

function notificationSubject(notification: NotificationItem): string {
  if (notification.ticket?.subject.trim()) return notification.ticket.subject;
  if (isRecord(notification.payload)) {
    for (const key of ["subject", "title", "message"]) {
      const value = notification.payload[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return "Benachrichtigung";
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
      options: { redirectTo: appRedirectUrl(), scopes: "email" },
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
  const [section, setSection] = useState<Section>("Übersicht");
  const [period, setPeriod] = useState<Period>("Heute");
  const [queue, setQueue] = useState("alle");
  const [ticketScope, setTicketScope] = useState<TicketScope>("all");
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
  const [canWorkTickets, setCanWorkTickets] = useState(false);
  const [isTenantAdmin, setIsTenantAdmin] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const [notificationStatus, setNotificationStatus] = useState("");
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [notificationActionPending, setNotificationActionPending] = useState<
    string | null
  >(null);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandActiveIndex, setCommandActiveIndex] = useState(0);
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
  const [personalSettingsOpen, setPersonalSettingsOpen] = useState(false);
  const [ssoEnforced, setSsoEnforced] = useState(false);
  const [tenantFeatures, setTenantFeatures] = useState<Record<string, boolean>>(
    {},
  );
  const [departmentQueueKeys, setDepartmentQueueKeys] = useState<
    Record<string, { key: string; label: string }>
  >({});
  const [unreadMentionCount, setUnreadMentionCount] = useState(0);
  const [activeIncidentNotices, setActiveIncidentNotices] = useState<
    ActiveIncidentNotice[]
  >([]);
  const [tenantFeatureRevision, setTenantFeatureRevision] = useState(0);
  const [tenantWorkspaceBranding, setTenantWorkspaceBranding] =
    useState<TenantWorkspaceBranding | null>(null);
  const [tenantBrandingRevision, setTenantBrandingRevision] = useState(0);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const notificationPanelRef = useRef<HTMLElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const keyboardHelpCloseRef = useRef<HTMLButtonElement>(null);
  const workspacePreferencesSyncTenantRef = useRef<string | null>(null);
  const workspacePreferencesLastSavedRef = useRef<string | null>(null);
  const workspacePreferencesStorageKey = `nextdesk:workspace-preferences:${session?.user.id ?? "preview"}`;

  useEffect(() => {
    if (isSupabaseConfigured && session === undefined) return;

    setWorkspacePreferencesHydrated(false);
    try {
      const parsed = workspacePreferencesFromValue(
        JSON.parse(
          window.localStorage.getItem(workspacePreferencesStorageKey) ?? "null",
        ),
      );
      setWorkspacePreferences(parsed ?? DEFAULT_WORKSPACE_PREFERENCES);
    } catch {
      setWorkspacePreferences(DEFAULT_WORKSPACE_PREFERENCES);
    } finally {
      setWorkspacePreferencesHydrated(true);
    }
  }, [workspacePreferencesStorageKey]);

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
    if (!workspacePreferencesHydrated) return;
    setSection(workspacePreferences.startSection);
  }, [workspacePreferencesHydrated, workspacePreferencesStorageKey]);

  useEffect(() => {
    if (!supabase) return;

    let mounted = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setErrorMessage(error.message);
      setTenantLoading(Boolean(data.session));
      setSession(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
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
      setIsTenantAdmin(false);
      setPersonalSettingsOpen(false);
      setSsoEnforced(false);
      setTenantFeatures({});
      setDepartmentQueueKeys({});
      setUnreadMentionCount(0);
      setActiveIncidentNotices([]);
      setTenantWorkspaceBranding(null);
      setExperienceNotice(null);
      setExperienceFollowUpsRevision(0);
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
        // Entra employee. Load memberships only after that guarded step so the
        // first SSO login lands in the tenant without a timing race.
        const ssoAccess = await resolveTenantSsoAccess();
        const [activeTenants, profileName] = await Promise.all([
          loadActiveTenants(),
          loadProfileName(),
        ]);
        const scopedTenants =
          ssoAccess.scope === "tenant"
            ? activeTenants.filter((tenant) => tenant.id === ssoAccess.tenantId)
            : activeTenants;
        if (ssoAccess.scope === "tenant" && scopedTenants.length !== 1) {
          throw new Error(
            "Die Mandantenmitgliedschaft konnte nach der SSO-Anmeldung nicht bestätigt werden.",
          );
        }
        return {
          activeTenants: scopedTenants,
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
          portalName: portalName || activeTenant.name,
          primaryColor: usableBrandColor(brandingResult.data?.primary_color),
          secondaryColor: usableBrandColor(
            brandingResult.data?.secondary_color,
          ),
        });
      })
      .catch(() => {
        if (!mounted) return;
        setTenantWorkspaceBranding({
          accentColor: null,
          logoUrl: null,
          portalName: activeTenant.name,
          primaryColor: null,
          secondaryColor: null,
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
    if (!commandMenuOpen) return;
    const frame = window.requestAnimationFrame(() =>
      commandInputRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [commandMenuOpen]);

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
      return;
    }
    let mounted = true;
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
      });
    return () => {
      mounted = false;
    };
  }, [activeTenant, session]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !session || !activeTenant) {
      setTenantFeatures({});
      return;
    }

    let mounted = true;
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
    if (!supabase || !session || !activeTenant || !agentWorkbenchEnabled) {
      setUnreadMentionCount(0);
      return;
    }

    let mounted = true;
    void supabase.functions
      .invoke("agent-workbench", {
        body: {
          onlyMine: true,
          tenantId: activeTenant.id,
          type: "listMentions",
        },
      })
      .then(({ data, error }) => {
        if (error) throw error;
        const unread = unreadMentionCountFromResponse(data);
        if (unread === null) throw new Error("invalid_mentions_response");
        if (mounted) setUnreadMentionCount(unread);
      })
      .catch(() => {
        // The navigation never advertises a gated or unavailable inbox.
        if (mounted) setUnreadMentionCount(0);
      });

    return () => {
      mounted = false;
    };
  }, [activeTenant, agentWorkbenchEnabled, session]);

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
    if (canWorkTickets) return;
    setTicketScope("mine");
    setSelectedTicketIds(new Set());
    setTicketActionStatus("");
    if (
      section === "Services" ||
      section === "Assets" ||
      section === "Wissen" ||
      section === "Berichte" ||
      section === "Arbeitsplatz" ||
      section === "Erwähnungen" ||
      section === "Einstellungen"
    ) {
      setSection("Übersicht");
    }
  }, [canWorkTickets, section]);

  useEffect(() => {
    setTicketPage(0);
  }, [activeTenant?.id, dashboardRevision, period]);

  useEffect(() => {
    setSelectedTicketIds(new Set());
    setTicketActionStatus("");
    setSplitSelectedTicketId(null);
  }, [activeTenant?.id]);

  useEffect(() => {
    if (!session || !activeTenant) return;

    let mounted = true;
    setDashboardLoading(true);
    if (ticketPage === 0) setSnapshot(null);
    setErrorMessage("");
    void loadLiveDashboard(activeTenant, period, ticketPage)
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
              ticketListNote: `Die Liste zeigt ${tickets.length} von ${nextSnapshot.ticketCount} autorisierten Tickets.`,
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
  }, [activeTenant, dashboardRevision, period, session, ticketPage]);

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
        metrics: previewMetrics,
        serviceHealth: [],
        ticketCount: 0,
        tickets: [],
        updatedAt: "wird geladen",
      })
    : previewView;
  const queueOptions = useMemo(
    () =>
      Array.from(
        new Map(
          view.tickets.map((ticket) => [ticket.queue, ticket.queueLabel]),
        ).entries(),
      ),
    [view.tickets],
  );
  const parsedTicketSearch = useMemo(() => parseTicketSearch(query), [query]);
  const effectiveTicketScope = canWorkTickets ? ticketScope : "mine";
  const filteredTickets = useMemo(
    () =>
      view.tickets.filter((ticket) => {
        const inQueue = queue === "alle" || ticket.queue === queue;
        const inScope =
          effectiveTicketScope === "all" ||
          (effectiveTicketScope === "mine" && ticket.assignedToCurrentUser) ||
          (effectiveTicketScope === "unassigned" && ticket.isUnassigned) ||
          (effectiveTicketScope === "open" && !ticket.isClosed) ||
          (effectiveTicketScope === "closed" && ticket.isClosed);
        const match = matchesTicketSearch(ticket, parsedTicketSearch);
        return inQueue && inScope && match;
      }),
    [effectiveTicketScope, parsedTicketSearch, queue, view.tickets],
  );
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
    setQuery("");
    setQueue(department.key);
    setTicketScope("open");
    setSection("Tickets");
    setSplitSelectedTicketId(null);
  };
  const updateTicketSelection = (ticketId: string, selected: boolean) => {
    setTicketActionStatus("");
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
    setQuery("");
    setQueue("alle");
    setTicketScope(canWorkTickets ? "all" : "mine");
  };
  const ticketScopeLabel: Record<TicketScope, string> = {
    all: "Alle sichtbaren Tickets",
    closed: "Gelöste Tickets",
    mine: "Meine Tickets",
    open: "Offene Tickets",
    unassigned: "Nicht zugewiesene Tickets",
  };
  const normalizedCommandQuery = commandQuery.trim().toLocaleLowerCase("de-CH");
  const isFeatureEnabled = (featureKey: string) =>
    !isSupabaseConfigured || tenantFeatures[featureKey] === true;
  const featureSections = sections.filter((item) => {
    if (item.label === "Arbeitsplatz" || item.label === "Erwähnungen") {
      return agentWorkbenchEnabled;
    }
    if (item.label === "Mein Portal") return requesterPortalEnabled;
    if (item.label === "Assets") return isFeatureEnabled("assets.management");
    if (item.label === "Wissen") return isFeatureEnabled("knowledge.base");
    if (item.label === "Berichte") return isFeatureEnabled("reporting.service");
    if (item.label === "Wiedervorlagen") return experienceWorkspaceEnabled;
    return true;
  });
  const workSections = canWorkTickets
    ? featureSections
    : featureSections.filter(
        (item) =>
          item.label === "Übersicht" ||
          item.label === "Tickets" ||
          item.label === "Mein Portal" ||
          item.label === "Wiedervorlagen",
      );

  useEffect(() => {
    const sectionFeature: Partial<Record<Section, string>> = {
      Arbeitsplatz: "agent.workbench",
      Assets: "assets.management",
      Berichte: "reporting.service",
      Erwähnungen: "agent.workbench",
      "Mein Portal": "requester.portal",
      Wissen: "knowledge.base",
      Wiedervorlagen: "experience.workspace",
    };
    const featureKey = sectionFeature[section];
    if (
      featureKey &&
      isSupabaseConfigured &&
      tenantFeatures[featureKey] !== true
    ) {
      setSection("Übersicht");
    }
  }, [section, tenantFeatures]);

  useEffect(() => {
    if (isSupabaseConfigured && tenantFeatures["ticketing.detail"] !== true) {
      setSelectedTicketId(null);
    }
  }, [tenantFeatures]);

  const commandActions = [
    {
      id: "create-ticket",
      label: "Ticket erfassen",
      description: "Neuen Vorgang anlegen",
      keywords: "neu erstellen anlegen",
    },
    ...workSections.map((item) => ({
      id: `section:${item.label}`,
      label: item.label,
      description: "Arbeitsbereich öffnen",
      keywords: item.label.toLocaleLowerCase("de-CH"),
    })),
  ].filter((action) => {
    if (action.id !== "create-ticket" || activeTenant) return true;
    return false;
  });
  const matchingCommandActions = commandActions.filter((action) =>
    normalizedCommandQuery
      ? `${action.label} ${action.description} ${action.keywords}`
          .toLocaleLowerCase("de-CH")
          .includes(normalizedCommandQuery)
      : true,
  );
  const matchingCommandTickets = isFeatureEnabled("ticketing.detail")
    ? view.tickets
        .filter((ticket) => {
          if (!normalizedCommandQuery) return false;
          return `${ticket.id} ${ticket.subject} ${ticket.queueLabel}`
            .toLocaleLowerCase("de-CH")
            .includes(normalizedCommandQuery);
        })
        .slice(0, 6)
    : [];
  const commandResults = [
    ...matchingCommandActions.map((action) => ({
      actionId: action.id,
      id: `action:${action.id}`,
      kind: "action" as const,
      label: action.label,
    })),
    ...matchingCommandTickets.map((ticket) => ({
      id: `ticket:${ticket.recordId ?? ticket.id}`,
      kind: "ticket" as const,
      label: ticket.id,
      ticketId: ticket.recordId ?? ticket.id,
    })),
  ];
  const activeCommandResult = commandResults[commandActiveIndex];
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
    if (!commandMenuOpen) return;
    setCommandActiveIndex(0);
  }, [commandMenuOpen, commandQuery]);

  useEffect(() => {
    if (commandActiveIndex < commandResults.length) return;
    setCommandActiveIndex(Math.max(commandResults.length - 1, 0));
  }, [commandActiveIndex, commandResults.length]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isInputLikeTarget(event.target)) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandMenuOpen(true);
        return;
      }

      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key === "?" &&
        !commandMenuOpen &&
        !workspacePreferencesOpen &&
        !ticketComposerOpen &&
        !selectedTicketId &&
        !notificationPanelOpen
      ) {
        event.preventDefault();
        setKeyboardHelpOpen(true);
        return;
      }

      if (
        commandMenuOpen ||
        workspacePreferencesOpen ||
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
    commandMenuOpen,
    keyboardHelpOpen,
    keyboardNavigableTickets,
    notificationPanelOpen,
    selectedTicketId,
    ticketComposerOpen,
    workspacePreferencesOpen,
  ]);

  function closeCommandMenu() {
    setCommandMenuOpen(false);
    setCommandQuery("");
    setCommandActiveIndex(0);
  }

  function runCommand(actionId: string) {
    if (actionId === "create-ticket") {
      closeCommandMenu();
      setTicketComposerOpen(true);
      return;
    }
    if (actionId.startsWith("section:")) {
      const target = actionId.slice("section:".length) as Section;
      closeCommandMenu();
      setSection(target);
    }
  }

  function runCommandResult(result: (typeof commandResults)[number]) {
    if (result.kind === "action") {
      runCommand(result.actionId);
      return;
    }
    closeCommandMenu();
    setSection("Tickets");
    setSelectedTicketId(result.ticketId);
  }

  function updateWorkspacePreferences(updates: Partial<WorkspacePreferences>) {
    setWorkspacePreferences((current) => ({ ...current, ...updates }));
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

  useEffect(() => {
    if (!workspaceLiveMessage) setDismissedLiveMessage(null);
  }, [workspaceLiveMessage]);

  const workspaceClassName = [
    "app-shell",
    `app-shell--theme-${workspacePreferences.theme}`,
    `app-shell--density-${workspacePreferences.density}`,
    workspacePreferences.highContrast ? "app-shell--high-contrast" : "",
    workspacePreferences.reduceMotion ? "app-shell--reduced-motion" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const workspaceBrandName =
    tenantWorkspaceBranding?.portalName ??
    activeTenant?.name ??
    productDefaults.productName;
  const workspaceBrandLogo =
    tenantWorkspaceBranding?.logoUrl ?? "/assets/nextdesk-logo-product.png";
  const workspaceBrandStyle = {
    "--brand-accent": tenantWorkspaceBranding?.accentColor ?? "#075985",
    "--brand-primary": tenantWorkspaceBranding?.primaryColor ?? "#4338CA",
    "--brand-primary-hover":
      tenantWorkspaceBranding?.secondaryColor ?? "#3730A3",
  } as CSSProperties;

  const visibleSections = isTenantAdmin
    ? [...workSections, { label: "Einstellungen" as const, Icon: Settings }]
    : workSections;
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
            setActiveTenantId(tenantId);
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
            tenantWorkspaceBranding?.logoUrl
              ? "brand-lockup brand-lockup--tenant"
              : "brand-lockup"
          }
        >
          <img
            alt={`${workspaceBrandName} Logo`}
            className={
              tenantWorkspaceBranding?.logoUrl
                ? "brand-logo-mark brand-logo-mark--tenant"
                : "brand-logo-mark"
            }
            src={workspaceBrandLogo}
          />
          <span>{workspaceBrandName}</span>
        </div>
        <div className="navigation-cluster">
          <p className="navigation-label">ARBEITSBEREICH</p>
          <nav className="nav-list">
            {visibleSections.map((item) => (
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
                {item.label}
                {item.label === "Erwähnungen" && unreadMentionCount > 0 && (
                  <span
                    aria-label={`${unreadMentionCount} ungelesene Erwähnungen`}
                    className="nav-item__badge"
                  >
                    {unreadMentionCount > 99 ? "99+" : unreadMentionCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
        <div className="rail-footer">
          <button
            aria-label="Persönliche Einstellungen öffnen"
            className="operator-profile-trigger"
            disabled={!session}
            onClick={() => setPersonalSettingsOpen(true)}
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
              <CircleEllipsis aria-hidden="true" size={19} strokeWidth={1.8} />
            </button>
          )}
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
                    onChange={(event) => setActiveTenantId(event.target.value)}
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
            {activeTenant && (
              <button
                className="create-ticket-button"
                onClick={() => setTicketComposerOpen(true)}
                type="button"
              >
                <Plus aria-hidden="true" size={17} strokeWidth={2} />
                Ticket erfassen
              </button>
            )}
            <button
              aria-controls="workspace-preferences"
              aria-expanded={workspacePreferencesOpen}
              aria-label="Arbeitsbereichseinstellungen öffnen"
              className="workspace-preferences-trigger"
              onClick={() => setWorkspacePreferencesOpen(true)}
              type="button"
            >
              <SlidersHorizontal
                aria-hidden="true"
                size={17}
                strokeWidth={1.9}
              />
              <span>Ansicht</span>
            </button>
            <button
              aria-controls="workspace-command-menu"
              aria-expanded={commandMenuOpen}
              aria-label="Befehlsmenü öffnen"
              className="command-menu-trigger"
              onClick={() => setCommandMenuOpen(true)}
              type="button"
            >
              <Command aria-hidden="true" size={16} strokeWidth={1.9} />
              <span>Befehle</span>
              <kbd>⌘ K</kbd>
            </button>
            <label className="search-field">
              <Search aria-hidden="true" size={17} strokeWidth={1.8} />
              <input
                aria-label="Tickets durchsuchen"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Suche oder status:offen"
                value={query}
              />
            </label>
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
                        const subject = notificationSubject(notification);
                        const time = notificationTime(notification.createdAt);
                        const ticketLabel = notification.ticket
                          ? `Ticket ${notification.ticket.ticketNumber}`
                          : "";
                        return (
                          <li key={notification.id}>
                            <button
                              aria-label={`${subject}. Art: ${notification.kind}. ${time}${
                                ticketLabel ? `. ${ticketLabel}` : ""
                              }${notification.readAt ? "" : ". Ungelesen"}`}
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
                              <strong>{subject}</strong>
                              <small>
                                Art: {notification.kind} · {time}
                              </small>
                              {notification.ticket && (
                                <small>{ticketLabel}</small>
                              )}
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
        {section === "Übersicht" && activeTenant && session ? (
          <IntroTip
            onAction={() => setCommandMenuOpen(true)}
            tenantId={activeTenant.id}
            tip="befehle"
            userId={session.user.id}
          />
        ) : null}
        {personalSettingsOpen && session ? (
          <PersonalSettings
            onBack={() => setPersonalSettingsOpen(false)}
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
            <OpsCenterPanel
              canManage={isTenantAdmin}
              tenantId={activeTenant.id}
            />
          </>
        ) : section === "Wissen" &&
          activeTenant &&
          isFeatureEnabled("knowledge.base") ? (
          <KnowledgeBase tenantId={activeTenant.id} />
        ) : section === "Assets" &&
          activeTenant &&
          isFeatureEnabled("assets.management") ? (
          <ServiceAssets initialTab="assets" tenantId={activeTenant.id} />
        ) : section === "Services" && activeTenant ? (
          <>
            <ServiceAssets
              allowAssets={isFeatureEnabled("assets.management")}
              tenantId={activeTenant.id}
            />
            {isFeatureEnabled("automation.sla") ? (
              <SlaManagement tenantId={activeTenant.id} />
            ) : null}
          </>
        ) : section === "Berichte" &&
          activeTenant &&
          isFeatureEnabled("reporting.service") ? (
          <ServiceReporting tenantId={activeTenant.id} />
        ) : section === "Wiedervorlagen" &&
          activeTenant &&
          experienceWorkspaceEnabled ? (
          <ExperienceWorkspace
            onChanged={() =>
              setExperienceFollowUpsRevision((revision) => revision + 1)
            }
            onNotice={(message, tone) => setExperienceNotice({ message, tone })}
            onOpenTicket={(ticketId) => {
              setSection("Tickets");
              setSelectedTicketId(ticketId);
            }}
            tenantId={activeTenant.id}
            tickets={view.tickets}
          />
        ) : section === "Arbeitsplatz" &&
          activeTenant &&
          session &&
          agentWorkbenchEnabled ? (
          <>
            <IntroTip
              tenantId={activeTenant.id}
              tip="arbeitsplatz"
              userId={session.user.id}
            />
            <AgentWorkbenchPanel
              canManageIncidents={isTenantAdmin}
              onOpenQueue={openTeamQueue}
              onOpenTicket={(ticketId) => {
                setSection("Tickets");
                setSelectedTicketId(ticketId);
              }}
              onUnreadMentionsChange={setUnreadMentionCount}
              tenantId={activeTenant.id}
            />
          </>
        ) : section === "Erwähnungen" &&
          activeTenant &&
          agentWorkbenchEnabled ? (
          <AgentWorkbenchPanel
            canManageIncidents={isTenantAdmin}
            initialView="mentions"
            onOpenQueue={openTeamQueue}
            onOpenTicket={(ticketId) => {
              setSection("Tickets");
              setSelectedTicketId(ticketId);
            }}
            onUnreadMentionsChange={setUnreadMentionCount}
            tenantId={activeTenant.id}
          />
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
                  <h2>{ticketScopeLabel[effectiveTicketScope]}</h2>
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
                  {activeTenant && (
                    <TicketCsvExport tenantId={activeTenant.id} />
                  )}
                  {activeTenant && (
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
              {activeTenant && isSupabaseConfigured && canWorkTickets && (
                <SavedTicketViews
                  canManageTenantViews={canManageTenantViews}
                  currentUserId={session?.user.id}
                  filters={{ query, queue, ticketScope }}
                  loading={savedTicketViewsLoading}
                  onApply={(filters) => {
                    setQuery(filters.query);
                    setQueue(filters.queue);
                    setTicketScope(filters.ticketScope);
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
                          setQuery(removeTicketSearchClause(query, chip.raw))
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
                    (canWorkTickets && ticketScope !== "all")
                      ? { onClearFilters: clearTicketFilters }
                      : {})}
                    hasActiveFilters={Boolean(
                      query.trim() ||
                      queue !== "alle" ||
                      (canWorkTickets && ticketScope !== "all"),
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
              className="signal-row"
              aria-label="Aktueller Betriebszustand"
            >
              <div className="signal-copy">
                <span className="signal-dot" />
                <strong>
                  {isSupabaseConfigured
                    ? "Mandantenkontext aktiv"
                    : "Alle Kernservices operativ"}
                </strong>
                <span>
                  {dashboardLoading
                    ? "Daten werden aktualisiert …"
                    : `Letzte Aktualisierung ${view.updatedAt}`}
                </span>
              </div>
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

            <section className="metric-strip" aria-label="Ticket-Schnellfilter">
              <button
                className="metric-card metric-button emphasis"
                onClick={() => openTicketScope("mine")}
                type="button"
              >
                <p>Meine Tickets</p>
                <div>
                  <strong>{metricDisplay(view.metrics.mine)}</strong>
                </div>
                <MetricTrend trend={dashboardTrends.mine} />
                <small>{view.metrics.mineDetail}</small>
              </button>
              {canWorkTickets && (
                <>
                  <button
                    className="metric-card metric-button"
                    onClick={() => openTicketScope("unassigned")}
                    type="button"
                  >
                    <p>Nicht zugewiesene Tickets</p>
                    <div>
                      <strong>{metricDisplay(view.metrics.unassigned)}</strong>
                    </div>
                    <MetricTrend trend={dashboardTrends.unassigned} />
                    <small>{view.metrics.unassignedDetail}</small>
                  </button>
                  <button
                    className="metric-card metric-button"
                    onClick={() => openTicketScope("open")}
                    type="button"
                  >
                    <p>Offene Tickets</p>
                    <div>
                      <strong>{metricDisplay(view.metrics.open)}</strong>
                    </div>
                    <MetricTrend trend={dashboardTrends.open} />
                    <small>{view.metrics.openDetail}</small>
                  </button>
                  <button
                    className="metric-card metric-button"
                    onClick={() => openTicketScope("closed")}
                    type="button"
                  >
                    <p>Gelöste Tickets</p>
                    <div>
                      <strong>{metricDisplay(view.metrics.closed)}</strong>
                    </div>
                    <MetricTrend trend={dashboardTrends.closed} />
                    <small>{view.metrics.closedDetail}</small>
                  </button>
                </>
              )}
            </section>

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
                  <AgentMetricsCard tenantId={activeTenant.id} />
                )}
                {activeTenant && experienceWorkspaceEnabled && (
                  <MyDayCard
                    onOpenFollowUps={() => setSection("Wiedervorlagen")}
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
                  <kbd>Ctrl</kbd>/<kbd>⌘</kbd> <kbd>K</kbd>
                </dt>
                <dd>Befehlspalette öffnen</dd>
              </div>
              <div>
                <dt>
                  <kbd>Esc</kbd>
                </dt>
                <dd>Dialog oder Befehlspalette schliessen</dd>
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
              setWorkspacePreferencesOpen(false);
            }
          }}
          role="dialog"
        >
          <section
            aria-labelledby="workspace-preferences-heading"
            className="workspace-preferences"
            id="workspace-preferences"
            onKeyDown={(event) => {
              if (event.key === "Escape") setWorkspacePreferencesOpen(false);
            }}
          >
            <header>
              <div>
                <p className="eyebrow">PERSÖNLICHE ANSICHT</p>
                <h2 id="workspace-preferences-heading">
                  Arbeitsbereich anpassen
                </h2>
              </div>
              <button
                aria-label="Arbeitsbereichseinstellungen schliessen"
                className="workspace-preferences__close"
                onClick={() => setWorkspacePreferencesOpen(false)}
                type="button"
              >
                <X aria-hidden="true" size={18} strokeWidth={1.8} />
              </button>
            </header>
            <div className="workspace-preferences__fields">
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
                      {item.label}
                    </option>
                  ))}
                </select>
                <span>
                  Wird bei der nächsten Anmeldung als erste Ansicht geöffnet.
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
                  <option value="system">Systemeinstellung</option>
                  <option value="light">Hell</option>
                  <option value="dark">Dunkel</option>
                </select>
                <span>
                  Folgt der Systemeinstellung oder verwendet dauerhaft ein
                  helles beziehungsweise dunkles Farbschema.
                </span>
              </label>
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
            </div>
            <div className="workspace-preferences__actions">
              <button
                className="secondary-button"
                onClick={() =>
                  setWorkspacePreferences(DEFAULT_WORKSPACE_PREFERENCES)
                }
                type="button"
              >
                Standard wiederherstellen
              </button>
              <button
                className="primary-button"
                onClick={() => setWorkspacePreferencesOpen(false)}
                type="button"
              >
                Fertig
              </button>
            </div>
          </section>
        </div>
      )}
      {commandMenuOpen && (
        <div
          aria-label="Befehlsmenü"
          aria-modal="true"
          className="command-menu-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCommandMenu();
          }}
          role="dialog"
        >
          <section
            aria-labelledby="workspace-command-menu-heading"
            className="command-menu"
            id="workspace-command-menu"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeCommandMenu();
                return;
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                if (commandResults.length === 0) return;
                event.preventDefault();
                setCommandActiveIndex((current) =>
                  event.key === "ArrowDown"
                    ? (current + 1) % commandResults.length
                    : (current - 1 + commandResults.length) %
                      commandResults.length,
                );
                return;
              }
              if (
                event.key === "Enter" &&
                event.target === commandInputRef.current &&
                activeCommandResult
              ) {
                event.preventDefault();
                runCommandResult(activeCommandResult);
              }
            }}
          >
            <div className="command-menu__search">
              <Search aria-hidden="true" size={18} strokeWidth={1.9} />
              <input
                aria-describedby="workspace-command-menu-hint workspace-command-menu-selection"
                aria-label="Befehle oder Tickets suchen"
                onChange={(event) => setCommandQuery(event.target.value)}
                placeholder="Befehl oder Ticket suchen …"
                ref={commandInputRef}
                value={commandQuery}
              />
              <button
                aria-label="Befehlsmenü schliessen"
                className="command-menu__close"
                onClick={closeCommandMenu}
                type="button"
              >
                <X aria-hidden="true" size={18} strokeWidth={1.8} />
              </button>
            </div>
            <p className="data-caption" id="workspace-command-menu-hint">
              Schnellnavigation und aktuell geladene Tickets · Mit Pfeil
              hoch/runter auswählen, mit Enter öffnen · Esc zum Schliessen
            </p>
            <p
              aria-live="polite"
              className="sr-only"
              id="workspace-command-menu-selection"
            >
              {activeCommandResult
                ? `${activeCommandResult.label} ausgewählt, Enter zum Öffnen.`
                : "Keine Auswahl verfügbar."}
            </p>
            {matchingCommandActions.length > 0 && (
              <div className="command-menu__group">
                <p className="command-menu__label">AKTIONEN</p>
                {matchingCommandActions.map((action, index) => (
                  <button
                    aria-current={
                      commandActiveIndex === index ? "true" : undefined
                    }
                    className={`command-menu__item${
                      commandActiveIndex === index
                        ? " command-menu__item--active"
                        : ""
                    }`}
                    key={action.id}
                    onClick={() => {
                      const result = commandResults[index];
                      if (result) runCommandResult(result);
                    }}
                    onFocus={() => setCommandActiveIndex(index)}
                    onMouseMove={() => setCommandActiveIndex(index)}
                    type="button"
                  >
                    <Command aria-hidden="true" size={16} strokeWidth={1.8} />
                    <span>
                      <strong>{action.label}</strong>
                      <small>{action.description}</small>
                    </span>
                    <ArrowRight
                      aria-hidden="true"
                      size={16}
                      strokeWidth={1.8}
                    />
                  </button>
                ))}
              </div>
            )}
            {matchingCommandTickets.length > 0 && (
              <div className="command-menu__group">
                <p className="command-menu__label">TICKETS</p>
                {matchingCommandTickets.map((ticket, index) => {
                  const resultIndex = matchingCommandActions.length + index;
                  return (
                    <button
                      aria-current={
                        commandActiveIndex === resultIndex ? "true" : undefined
                      }
                      className={`command-menu__item${
                        commandActiveIndex === resultIndex
                          ? " command-menu__item--active"
                          : ""
                      }`}
                      key={ticket.recordId ?? ticket.id}
                      onClick={() => {
                        const result = commandResults[resultIndex];
                        if (result) runCommandResult(result);
                      }}
                      onFocus={() => setCommandActiveIndex(resultIndex)}
                      onMouseMove={() => setCommandActiveIndex(resultIndex)}
                      type="button"
                    >
                      <Ticket aria-hidden="true" size={16} strokeWidth={1.8} />
                      <span>
                        <strong>{ticket.id}</strong>
                        <small>{ticket.subject}</small>
                      </span>
                      <ArrowRight
                        aria-hidden="true"
                        size={16}
                        strokeWidth={1.8}
                      />
                    </button>
                  );
                })}
              </div>
            )}
            {matchingCommandActions.length === 0 &&
              matchingCommandTickets.length === 0 && (
                <p className="command-menu__empty">
                  Keine passende Aktion oder kein passendes geladenes Ticket.
                </p>
              )}
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
  onClearSelection,
  selectedTicketIds,
  tenantId,
}: {
  onApplied: (updated: number, statusLabel: string) => void;
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

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    setLoading(true);
    setStatusKey("");
    setErrorMessage("");
    setCloseConfirmationPending(false);
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

  if (selectedTicketIds.size === 0) return null;

  const selectedStatus = statuses.find((status) => status.key === statusKey);
  async function updateStatus(confirmClose = false) {
    if (!supabase || !selectedStatus) return;
    if (selectedStatus.isClosed && !confirmClose) {
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
