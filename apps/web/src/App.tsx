import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  ChartNoAxesCombined,
  CircleEllipsis,
  LayoutDashboard,
  LogOut,
  MonitorCog,
  Plus,
  Search,
  Settings,
  Ticket,
  X,
  type LucideIcon,
} from "lucide-react";
import { productDefaults } from "@nextdesk/config";
import {
  activityItems,
  dashboardTickets,
  previewMetrics,
  serviceHealth,
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
import { TicketDetail } from "./ticket-detail";
import { TenantAdminSettings } from "./tenant-admin-settings";
import { KnowledgeBase } from "./knowledge-base";
import { TicketTemplates } from "./ticket-templates";
import { SlaManagement } from "./sla-management";
import { CustomerOrganizations } from "./customer-organizations";
import { ServiceReporting } from "./service-reporting";
import { ServiceAssets } from "./service-assets";
import {
  OwnerConsoleScreen,
  resolveOwnerAccess,
  type OwnerAccess,
} from "./platform-owner";
import { functionErrorMessage } from "./lib/function-error";
import {
  matchesTicketSearch,
  parseTicketSearch,
  removeTicketSearchClause,
} from "./lib/ticket-search";
import { appRedirectUrl, isSupabaseConfigured, supabase } from "./lib/supabase";

type Section =
  | "Übersicht"
  | "Tickets"
  | "Services"
  | "Wissen"
  | "Berichte"
  | "Einstellungen";
type TicketScope = "all" | "mine" | "unassigned" | "open" | "closed";

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

const sections: readonly { label: Section; Icon: LucideIcon }[] = [
  { label: "Übersicht", Icon: LayoutDashboard },
  { label: "Tickets", Icon: Ticket },
  { label: "Services", Icon: MonitorCog },
  { label: "Wissen", Icon: BookOpen },
  { label: "Berichte", Icon: ChartNoAxesCombined },
];

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
  if (!email) return "Support Team";
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

function displayAuthError(message: string): string {
  if (message.toLocaleLowerCase("en-US").includes("email rate limit")) {
    return "Zu viele Anmelde-E-Mails wurden für dieses Projekt versendet. Bitte warten Sie bis zu einer Stunde und fordern Sie danach nur einen neuen Magic Link an.";
  }
  return message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
        Eigentümer melden sich über Gross ICT an. Mandantenzugänge folgen der
        jeweiligen Unternehmensrichtlinie.
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
            : "Magic Link senden"}
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
  tickets,
  onClearFilters,
  onOpen,
  onSelectionChange,
  selectedTicketIds,
}: {
  tickets: readonly DashboardTicket[];
  onClearFilters?: () => void;
  onOpen?: (ticketId: string) => void;
  onSelectionChange?: (ticketId: string, selected: boolean) => void;
  selectedTicketIds?: ReadonlySet<string>;
}) {
  if (tickets.length === 0) {
    return (
      <div className="empty-state ticket-empty-state">
        <strong>Keine passenden Tickets gefunden.</strong>
        <span>
          Prüfen Sie die Suchbegriffe oder setzen Sie die aktiven Filter zurück.
        </span>
        {onClearFilters && (
          <button onClick={onClearFilters} type="button">
            Filter zurücksetzen
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="ticket-list">
      {tickets.map((ticket) => {
        const ticketId = ticket.recordId ?? ticket.id;
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
            className={`${onOpen ? "ticket-row ticket-row--actionable" : "ticket-row"}${
              onSelectionChange ? " ticket-row--selectable" : ""
            }`}
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
            tabIndex={onOpen && !onSelectionChange ? 0 : undefined}
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
              <span className={`state-badge ${statusClass(ticket.state)}`}>
                {ticket.state}
              </span>
              <span className={`sla ${ticket.risk}`}>{slaLabel}</span>
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
  const [ticketPage, setTicketPage] = useState(0);
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [ticketActionStatus, setTicketActionStatus] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [ownerAccess, setOwnerAccess] = useState<OwnerAccess>("idle");
  const [ownerAccessError, setOwnerAccessError] = useState("");
  const [ownerView, setOwnerView] = useState<"console" | "tenant">("console");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketComposerOpen, setTicketComposerOpen] = useState(false);
  const [isTenantAdmin, setIsTenantAdmin] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const [notificationStatus, setNotificationStatus] = useState("");
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [notificationActionPending, setNotificationActionPending] = useState<
    string | null
  >(null);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const notificationPanelRef = useRef<HTMLElement>(null);

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
      .then(() => Promise.all([loadActiveTenants(), loadProfileName()]))
      .then(([activeTenants, profileName]) => {
        if (!mounted) return;
        setTenants(activeTenants);
        setOperatorName(
          profileName ?? displayNameFromEmail(session.user.email),
        );
        setActiveTenantId((current) => current || activeTenants[0]?.id || "");
      })
      .catch((error: Error) => {
        if (mounted) setTenantLoadError(error.message);
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

  useEffect(() => {
    if (!supabase || !session || !activeTenant) {
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
  }, [activeTenant, session]);

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
    if (!supabase || !session || !activeTenant) {
      setIsTenantAdmin(false);
      return;
    }
    let mounted = true;
    void supabase.functions
      .invoke("tenant-admin-settings", {
        body: { type: "getSettings", tenantId: activeTenant.id },
      })
      .then(({ error }) => {
        if (mounted) setIsTenantAdmin(!error);
      })
      .catch(() => {
        if (mounted) setIsTenantAdmin(false);
      });
    return () => {
      mounted = false;
    };
  }, [activeTenant, session]);

  useEffect(() => {
    setTicketPage(0);
  }, [activeTenant?.id, dashboardRevision, period]);

  useEffect(() => {
    setSelectedTicketIds(new Set());
    setTicketActionStatus("");
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
  const filteredTickets = useMemo(
    () =>
      view.tickets.filter((ticket) => {
        const inQueue = queue === "alle" || ticket.queue === queue;
        const inScope =
          ticketScope === "all" ||
          (ticketScope === "mine" && ticket.assignedToCurrentUser) ||
          (ticketScope === "unassigned" && ticket.isUnassigned) ||
          (ticketScope === "open" && !ticket.isClosed) ||
          (ticketScope === "closed" && ticket.isClosed);
        const match = matchesTicketSearch(ticket, parsedTicketSearch);
        return inQueue && inScope && match;
      }),
    [parsedTicketSearch, queue, ticketScope, view.tickets],
  );

  const greetingName = operatorName.split(" ")[0] || operatorName;
  const queueCount = (queueKey: string) =>
    view.tickets.filter((ticket) => ticket.queue === queueKey).length;
  const openTicketScope = (scope: TicketScope) => {
    setTicketScope(scope);
    setQueue("alle");
    setSection("Tickets");
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
    setTicketScope("all");
  };
  const ticketScopeLabel: Record<TicketScope, string> = {
    all: "Alle sichtbaren Tickets",
    closed: "Gelöste Tickets",
    mine: "Meine Tickets",
    open: "Offene Tickets",
    unassigned: "Nicht zugewiesene Tickets",
  };
  const visibleSections = isTenantAdmin
    ? [...sections, { label: "Einstellungen" as const, Icon: Settings }]
    : sections;
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
  if (isSupabaseConfigured && session && ownerAccess === "checking") {
    return <LoadingScreen message="Eigentümerzugang wird geprüft." />;
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
  if (isSupabaseConfigured && session && ownerAccess === "error") {
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
  if (isSupabaseConfigured && session && tenants.length === 0) {
    return <NoMembershipScreen onSignOut={() => void signOut()} />;
  }

  return (
    <div className="app-shell">
      <aside className="command-rail" aria-label="Hauptnavigation">
        <div className="brand-lockup">
          <img
            alt=""
            aria-hidden="true"
            className="brand-logo-mark"
            src="/assets/nextdesk-logo-product.png"
          />
          <span>{productDefaults.productName}</span>
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
                onClick={() => setSection(item.label)}
                type="button"
              >
                <item.Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="rail-footer">
          <div className="operator-avatar">{initials(operatorName)}</div>
          <div>
            <strong>{operatorName}</strong>
            <small>
              {isSupabaseConfigured ? "Angemeldet" : "Service Operations"}
            </small>
          </div>
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
              Operations / <span>{section}</span>
            </p>
            <h1>
              {section === "Übersicht"
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
            <label className="search-field">
              <Search aria-hidden="true" size={17} strokeWidth={1.8} />
              <input
                aria-label="Tickets durchsuchen"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Suche oder status:offen"
                value={query}
              />
            </label>
            <div style={{ position: "relative" }}>
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
                  id="notification-center-panel"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") closeNotificationPanel();
                  }}
                  ref={notificationPanelRef}
                  role="dialog"
                  style={{
                    background: "#fff",
                    border: "1px solid #dbe3e6",
                    borderRadius: "6px",
                    boxShadow: "0 14px 32px rgba(18, 40, 58, 0.18)",
                    maxHeight: "min(540px, calc(100vh - 96px))",
                    overflowY: "auto",
                    padding: "14px",
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 8px)",
                    width: "min(380px, calc(100vw - 32px))",
                    zIndex: 20,
                  }}
                  tabIndex={-1}
                >
                  <div
                    style={{
                      alignItems: "center",
                      display: "flex",
                      gap: "12px",
                      justifyContent: "space-between",
                      marginBottom: "12px",
                    }}
                  >
                    <div>
                      <p className="eyebrow">Benachrichtigungen</p>
                      <h2
                        id="notification-center-heading"
                        style={{ fontSize: "18px", margin: 0 }}
                      >
                        Aktueller Mandant
                      </h2>
                    </div>
                    <button
                      onClick={closeNotificationPanel}
                      style={{
                        background: "transparent",
                        border: 0,
                        padding: "4px",
                      }}
                      type="button"
                    >
                      Schließen
                    </button>
                  </div>
                  {!notificationsLoading && unreadNotificationCount > 0 && (
                    <button
                      disabled={notificationActionPending !== null}
                      onClick={() => void markAllNotificationsAsRead()}
                      style={{ marginBottom: "12px" }}
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
                      style={{ listStyle: "none", margin: 0, padding: 0 }}
                    >
                      {notifications.map((notification) => {
                        const subject = notificationSubject(notification);
                        const time = notificationTime(notification.createdAt);
                        const ticketLabel = notification.ticket
                          ? `Ticket ${notification.ticket.ticketNumber}`
                          : "";
                        return (
                          <li
                            key={notification.id}
                            style={{ marginBottom: "8px" }}
                          >
                            <button
                              aria-label={`${subject}. Art: ${notification.kind}. ${time}${
                                ticketLabel ? `. ${ticketLabel}` : ""
                              }${notification.readAt ? "" : ". Ungelesen"}`}
                              disabled={notificationActionPending !== null}
                              onClick={() =>
                                void handleNotificationClick(notification)
                              }
                              style={{
                                background: notification.readAt
                                  ? "#fff"
                                  : "#f6fafb",
                                border: "1px solid #dbe3e6",
                                borderRadius: "5px",
                                color: "#183042",
                                cursor: "pointer",
                                display: "grid",
                                gap: "4px",
                                padding: "10px",
                                textAlign: "left",
                                width: "100%",
                              }}
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
        {isSupabaseConfigured && errorMessage && (
          <section className="preview-notice error-notice" aria-live="polite">
            <span className="notice-beacon" aria-hidden="true" />
            <div>
              <strong>Datenzugriff prüfen</strong>
              <span>{errorMessage}</span>
            </div>
          </section>
        )}

        {section === "Einstellungen" && activeTenant && isTenantAdmin ? (
          <>
            <TenantAdminSettings
              onClose={() => setSection("Übersicht")}
              tenantId={activeTenant.id}
            />
            <CustomerOrganizations tenantId={activeTenant.id} />
            <TicketTemplates tenantId={activeTenant.id} />
          </>
        ) : section === "Wissen" && activeTenant ? (
          <KnowledgeBase tenantId={activeTenant.id} />
        ) : section === "Services" && activeTenant ? (
          <>
            <ServiceAssets tenantId={activeTenant.id} />
            <SlaManagement tenantId={activeTenant.id} />
          </>
        ) : section === "Berichte" && activeTenant ? (
          <ServiceReporting tenantId={activeTenant.id} />
        ) : section === "Tickets" ? (
          <>
            <section className="ticket-panel panel ticket-module">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Autorisierte Vorgänge</p>
                  <h2>{ticketScopeLabel[ticketScope]}</h2>
                </div>
                <span className="data-caption">
                  {view.hasMoreTickets
                    ? `${filteredTickets.length} geladen`
                    : `${filteredTickets.length} Treffer`}
                </span>
              </div>
              {activeTenant && isSupabaseConfigured && (
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
              {activeTenant && isSupabaseConfigured && (
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
              {ticketActionStatus && (
                <p
                  aria-live="polite"
                  className="ticket-action-status"
                  role="status"
                >
                  {ticketActionStatus}
                </p>
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
              <TicketList
                {...(isSupabaseConfigured
                  ? {
                      onOpen: setSelectedTicketId,
                      onSelectionChange: updateTicketSelection,
                      selectedTicketIds,
                    }
                  : {})}
                {...(query.trim() || queue !== "alle" || ticketScope !== "all"
                  ? { onClearFilters: clearTicketFilters }
                  : {})}
                tickets={filteredTickets}
              />
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
                <small>{view.metrics.mineDetail}</small>
              </button>
              <button
                className="metric-card metric-button"
                onClick={() => openTicketScope("unassigned")}
                type="button"
              >
                <p>Nicht zugewiesene Tickets</p>
                <div>
                  <strong>{metricDisplay(view.metrics.unassigned)}</strong>
                </div>
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
                <small>{view.metrics.closedDetail}</small>
              </button>
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
                  tickets={filteredTickets}
                />
              </article>

              <aside className="side-stack">
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
      {activeTenant && selectedTicketId && isSupabaseConfigured && (
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

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    setLoading(true);
    setStatusKey("");
    setErrorMessage("");
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
  async function applyStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !selectedStatus) return;
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
      onSubmit={(event) => void applyStatus(event)}
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
          onChange={(event) => setStatusKey(event.target.value)}
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
          onClick={onClearSelection}
          type="button"
        >
          Auswahl aufheben
        </button>
        <button
          className="primary-button"
          disabled={!selectedStatus || pending}
          type="submit"
        >
          {pending ? "Status wird gesetzt …" : "Status für Auswahl setzen"}
        </button>
      </div>
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
    setStatus("Neue Ansicht aus den aktuellen Filtern anlegen.");
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
      </div>
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
        </div>
      </form>
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
