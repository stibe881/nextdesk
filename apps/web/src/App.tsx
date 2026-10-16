import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
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
import { appRedirectUrl, isSupabaseConfigured, supabase } from "./lib/supabase";

type Section = "Übersicht" | "Tickets" | "Services" | "Wissen" | "Berichte";

type DashboardView = {
  activity: readonly TimelineItem[];
  metrics: DashboardMetrics;
  serviceHealth: readonly ServiceHealth[];
  ticketListNote?: string;
  tickets: readonly DashboardTicket[];
  updatedAt: string;
};

const sections: readonly { label: Section; glyph: string }[] = [
  { label: "Übersicht", glyph: "▦" },
  { label: "Tickets", glyph: "▤" },
  { label: "Services", glyph: "◌" },
  { label: "Wissen", glyph: "◇" },
  { label: "Berichte", glyph: "⌁" },
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

function AccessShell({ children }: { children: ReactNode }) {
  return (
    <main className="access-shell">
      <header className="access-header">
        <div className="access-brand">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>{productDefaults.productName}</span>
        </div>
        <nav aria-label="Zugangsbereiche">
          <span>PLATTFORM</span>
          <span>SUPPORT</span>
          <span>SICHERHEIT</span>
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
          <p>Tickets, Services und Mandantensteuerung an einem sicheren Ort.</p>
        </div>
        <section className="access-card">{children}</section>
      </section>
      <footer className="access-footer">
        TICKETHUB · BETRIEBEN FÜR GROSS ICT
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
      options: { redirectTo: appRedirectUrl() },
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
        <span aria-hidden="true">→</span>
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
      <p className="eyebrow">TicketHub wird vorbereitet</p>
      <h1>{message}</h1>
      <div className="loading-line" aria-hidden="true" />
    </AccessShell>
  );
}

function NoMembershipScreen({ onSignOut }: { onSignOut: () => void }) {
  return (
    <AccessShell>
      <p className="eyebrow">Zugriff ausstehend</p>
      <h1>Keine aktive Mandantenmitgliedschaft.</h1>
      <p>
        Ihre Anmeldung wurde bestätigt, aber es ist noch kein aktiver
        TicketHub-Mandant zugeordnet. Wenden Sie sich an die
        Mandantenadministration oder akzeptieren Sie eine offene Einladung.
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

function TicketList({ tickets }: { tickets: readonly DashboardTicket[] }) {
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
          <article className="ticket-row" key={ticket.id}>
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
  const [errorMessage, setErrorMessage] = useState("");

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
    void Promise.all([loadActiveTenants(), loadProfileName()])
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

  const activeTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === activeTenantId) ?? null,
    [activeTenantId, tenants],
  );

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
  }, [activeTenant, period, session]);

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
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
        const match =
          `${ticket.id} ${ticket.subject} ${ticket.queueLabel} ${ticket.state}`
            .toLocaleLowerCase("de-CH")
            .includes(query.toLocaleLowerCase("de-CH"));
        return inQueue && match;
      }),
    [query, queue, view.tickets],
  );

  const greetingName = operatorName.split(" ")[0] || operatorName;
  const queueCount = (queueKey: string) =>
    view.tickets.filter((ticket) => ticket.queue === queueKey).length;

  if (isSupabaseConfigured && session === undefined) {
    return <LoadingScreen message="Sichere Sitzung wird geprüft." />;
  }
  if (isSupabaseConfigured && session === null) {
    return <SignInScreen />;
  }
  if (isSupabaseConfigured && tenantLoading) {
    return <LoadingScreen message="Mandantenkontext wird geladen." />;
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
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>{productDefaults.productName}</span>
        </div>
        <nav className="nav-list">
          {sections.map((item) => (
            <button
              className={
                section === item.label ? "nav-item active" : "nav-item"
              }
              key={item.label}
              onClick={() => setSection(item.label)}
              type="button"
            >
              <span aria-hidden="true">{item.glyph}</span>
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
              ↗
            </button>
          ) : (
            <button
              className="more-button"
              aria-label="Profiloptionen"
              type="button"
            >
              •••
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
            {activeTenant && (
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
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="Tickets durchsuchen"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tickets durchsuchen"
                value={query}
              />
            </label>
            <button
              className="notification-button"
              aria-label="Benachrichtigungen folgen"
              type="button"
            >
              <span aria-hidden="true">♢</span>
              <b>{isSupabaseConfigured ? "0" : "2"}</b>
            </button>
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

        {section === "Tickets" ? (
          <section className="ticket-panel panel ticket-module">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Autorisierte Vorgänge</p>
                <h2>
                  {view.ticketListNote
                    ? "Neueste autorisierte Tickets"
                    : "Alle sichtbaren Tickets"}
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
            <TicketList tickets={filteredTickets} />
          </section>
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

            <section className="metric-strip" aria-label="Kennzahlen">
              <article className="metric-card emphasis">
                <p>Offene Tickets</p>
                <div>
                  <strong>{metricDisplay(view.metrics.open)}</strong>
                </div>
                <small>{view.metrics.openDetail}</small>
              </article>
              <article className="metric-card">
                <p>Gelöste Tickets</p>
                <div>
                  <strong>{metricDisplay(view.metrics.closed)}</strong>
                </div>
                <small>{view.metrics.closedDetail}</small>
              </article>
              <article className="metric-card">
                <p>Ø Erstreaktion</p>
                <div>
                  <strong>{metricDisplay(view.metrics.response)}</strong>
                </div>
                <small>{view.metrics.responseDetail}</small>
              </article>
              <article className="metric-card">
                <p>SLA erfüllt</p>
                <div>
                  <strong>{metricDisplay(view.metrics.sla)}</strong>
                </div>
                <small>{view.metrics.slaDetail}</small>
              </article>
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
                    Alle Tickets <span>→</span>
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
                <TicketList tickets={filteredTickets} />
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
