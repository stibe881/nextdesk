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
  Search,
  Settings,
  Ticket,
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
import {
  OwnerConsoleScreen,
  resolveOwnerAccess,
  type OwnerAccess,
} from "./platform-owner";
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
  metrics: DashboardMetrics;
  serviceHealth: readonly ServiceHealth[];
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

const sections: readonly { label: Section; Icon: LucideIcon }[] = [
  { label: "Übersicht", Icon: LayoutDashboard },
  { label: "Tickets", Icon: Ticket },
  { label: "Services", Icon: MonitorCog },
  { label: "Wissen", Icon: BookOpen },
  { label: "Berichte", Icon: ChartNoAxesCombined },
];

const previewView: DashboardView = {
  activity: activityItems,
  metrics: previewMetrics,
  serviceHealth,
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
            src="/assets/nextdesk-logo-mark-a.png"
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
        {status === "sso" ? "SSO wird geöffnet …" : "MIT GROSS ICT ANMELDEN"}
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
  onOpen,
}: {
  tickets: readonly DashboardTicket[];
  onOpen?: (ticketId: string) => void;
}) {
  if (tickets.length === 0) {
    return (
      <p className="empty-state">
        Keine Tickets entsprechen dem aktuellen Filter.
      </p>
    );
  }

  return (
    <div className="ticket-list">
      {tickets.map((ticket) => {
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
            className={
              onOpen ? "ticket-row ticket-row--actionable" : "ticket-row"
            }
            key={ticket.id}
            onClick={
              onOpen ? () => onOpen(ticket.recordId ?? ticket.id) : undefined
            }
            onKeyDown={
              onOpen
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpen(ticket.recordId ?? ticket.id);
                    }
                  }
                : undefined
            }
            role={onOpen ? "button" : undefined}
            tabIndex={onOpen ? 0 : undefined}
          >
            <div className={`risk-line ${ticket.risk}`} aria-hidden="true" />
            <div className="ticket-main">
              <div className="ticket-id">
                {ticket.id}
                <span>{ticket.queueLabel}</span>
              </div>
              <h3>{ticket.subject}</h3>
              <p>
                {ticket.priority ? `${ticket.priority} · ` : ""}vor {ticket.age}
              </p>
            </div>
            <div className="ticket-state">
              <span className={`state-badge ${statusClass(ticket.state)}`}>
                {ticket.state}
              </span>
              <strong className={`sla ${ticket.risk}`}>{slaLabel}</strong>
            </div>
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
  const [errorMessage, setErrorMessage] = useState("");
  const [ownerAccess, setOwnerAccess] = useState<OwnerAccess>("idle");
  const [ownerAccessError, setOwnerAccessError] = useState("");
  const [ownerView, setOwnerView] = useState<"console" | "tenant">("console");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
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
    if (!session || !activeTenant) return;

    let mounted = true;
    setDashboardLoading(true);
    setSnapshot(null);
    setErrorMessage("");
    void loadLiveDashboard(activeTenant, period)
      .then((nextSnapshot) => {
        if (mounted) setSnapshot(nextSnapshot);
      })
      .catch((error: Error) => {
        if (mounted) setErrorMessage(error.message);
      })
      .finally(() => {
        if (mounted) setDashboardLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [activeTenant, dashboardRevision, period, session]);

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
        metrics: previewMetrics,
        serviceHealth: [],
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
        const match =
          `${ticket.id} ${ticket.subject} ${ticket.queueLabel} ${ticket.state}`
            .toLocaleLowerCase("de-CH")
            .includes(query.toLocaleLowerCase("de-CH"));
        return inQueue && inScope && match;
      }),
    [query, queue, ticketScope, view.tickets],
  );

  const greetingName = operatorName.split(" ")[0] || operatorName;
  const queueCount = (queueKey: string) =>
    view.tickets.filter((ticket) => ticket.queue === queueKey).length;
  const openTicketScope = (scope: TicketScope) => {
    setTicketScope(scope);
    setQueue("alle");
    setSection("Tickets");
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
            src="/assets/nextdesk-logo-mark-a.png"
          />
          <span>{productDefaults.productName}</span>
        </div>
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
            <label className="search-field">
              <Search aria-hidden="true" size={17} strokeWidth={1.8} />
              <input
                aria-label="Tickets durchsuchen"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tickets durchsuchen"
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
          <SlaManagement tenantId={activeTenant.id} />
        ) : section === "Berichte" && activeTenant ? (
          <ServiceReporting tenantId={activeTenant.id} />
        ) : section === "Tickets" ? (
          <>
            {activeTenant && (
              <TicketComposer
                onCreated={(ticketId) => {
                  setDashboardRevision((value) => value + 1);
                  setSelectedTicketId(ticketId);
                }}
                tenantId={activeTenant.id}
              />
            )}
            <section className="ticket-panel panel ticket-module">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Autorisierte Vorgänge</p>
                  <h2>
                    {view.ticketListNote
                      ? "Neueste autorisierte Tickets"
                      : ticketScopeLabel[ticketScope]}
                  </h2>
                </div>
                <span className="data-caption">
                  {filteredTickets.length} Treffer
                </span>
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
                <article className="panel service-panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">
                        {isSupabaseConfigured
                          ? "Datenkontext"
                          : "Servicezustand"}
                      </p>
                      <h2>
                        {isSupabaseConfigured
                          ? "Was ist sichtbar?"
                          : "Was läuft?"}
                      </h2>
                    </div>
                  </div>
                  <div className="service-list">
                    {view.serviceHealth.length === 0 ? (
                      <p className="empty-state">
                        Noch keine RLS-autorisierte Datensicht geladen.
                      </p>
                    ) : (
                      view.serviceHealth.map((service) => (
                        <div className="service-row" key={service.name}>
                          <span className={`service-dot ${service.state}`} />
                          <div>
                            <strong>{service.name}</strong>
                            <small>{service.detail}</small>
                          </div>
                          <b>{service.availability}</b>
                        </div>
                      ))
                    )}
                  </div>
                </article>
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
      {activeTenant && selectedTicketId && isSupabaseConfigured && (
        <TicketDetail
          onChanged={() => setDashboardRevision((value) => value + 1)}
          onClose={() => setSelectedTicketId(null)}
          tenantId={activeTenant.id}
          ticketId={selectedTicketId}
        />
      )}
    </div>
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
