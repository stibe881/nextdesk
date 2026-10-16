import { useMemo, useState } from "react";
import { productDefaults } from "@nextdesk/config";
import {
  activityItems,
  dashboardTickets,
  serviceHealth,
  type QueueKey,
} from "./dashboard-data";
import { isSupabaseConfigured } from "./lib/supabase";

type Section = "Übersicht" | "Tickets" | "Services" | "Wissen" | "Berichte";
type Period = "Heute" | "7 Tage" | "30 Tage";

const sections: readonly { label: Section; glyph: string }[] = [
  { label: "Übersicht", glyph: "▦" },
  { label: "Tickets", glyph: "▤" },
  { label: "Services", glyph: "◌" },
  { label: "Wissen", glyph: "◇" },
  { label: "Berichte", glyph: "⌁" },
];

const queueLabels: Record<QueueKey, string> = {
  alle: "Alle Queues",
  ict: "ICT",
  infrastruktur: "Infrastruktur",
};

const periodMetrics: Record<
  Period,
  { resolved: string; change: string; response: string; trend: string }
> = {
  Heute: {
    resolved: "68",
    change: "+8.2 %",
    response: "11 min",
    trend: "– 2 min",
  },
  "7 Tage": {
    resolved: "428",
    change: "+5.6 %",
    response: "13 min",
    trend: "– 4 min",
  },
  "30 Tage": {
    resolved: "1’764",
    change: "+3.1 %",
    response: "14 min",
    trend: "– 3 min",
  },
};

function statusClass(value: string): string {
  return value.toLowerCase().replaceAll(" ", "-");
}

export function App() {
  const [section, setSection] = useState<Section>("Übersicht");
  const [period, setPeriod] = useState<Period>("Heute");
  const [queue, setQueue] = useState<QueueKey>("alle");
  const [query, setQuery] = useState("");

  const metrics = periodMetrics[period];
  const tickets = useMemo(
    () =>
      dashboardTickets.filter((ticket) => {
        const inQueue = queue === "alle" || ticket.queue === queue;
        const match = `${ticket.id} ${ticket.subject} ${ticket.requester}`
          .toLocaleLowerCase("de-CH")
          .includes(query.toLocaleLowerCase("de-CH"));
        return inQueue && match;
      }),
    [query, queue],
  );

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
              key={item.label}
              className={
                section === item.label ? "nav-item active" : "nav-item"
              }
              onClick={() => setSection(item.label)}
            >
              <span aria-hidden="true">{item.glyph}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="rail-footer">
          <div className="operator-avatar">MK</div>
          <div>
            <strong>Mara Keller</strong>
            <small>Service Operations</small>
          </div>
          <button className="more-button" aria-label="Profiloptionen">
            •••
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">
              Operations / <span>{section}</span>
            </p>
            <h1>{section === "Übersicht" ? "Guten Morgen, Mara." : section}</h1>
          </div>
          <div className="topbar-actions">
            <label className="search-field">
              <span aria-hidden="true">⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tickets durchsuchen"
                aria-label="Tickets durchsuchen"
              />
            </label>
            <button
              className="notification-button"
              aria-label="2 neue Benachrichtigungen"
            >
              <span aria-hidden="true">♢</span>
              <b>2</b>
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

        {section !== "Übersicht" ? (
          <section className="module-stub">
            <p className="eyebrow">{section}</p>
            <h2>Dieser Bereich wird als nächstes angebunden.</h2>
            <p>
              Die Navigation ist bereits bereit. Die Datenansicht folgt nach der
              Verbindung mit der Supabase-Entwicklungsumgebung und den
              zugehörigen RLS-RPCs.
            </p>
            <button
              className="primary-button"
              onClick={() => setSection("Übersicht")}
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
                <span className="signal-dot" />{" "}
                <strong>Alle Kernservices operativ</strong>
                <span>Letzte Aktualisierung 09:45 · Europe/Zurich</span>
              </div>
              <div className="segmented" aria-label="Zeitraum">
                {(["Heute", "7 Tage", "30 Tage"] as const).map((option) => (
                  <button
                    key={option}
                    className={period === option ? "selected" : ""}
                    onClick={() => setPeriod(option)}
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
                  <strong>36</strong>
                  <span className="delta critical">+ 5 heute</span>
                </div>
                <small>6 ausserhalb des Zielkorridors</small>
              </article>
              <article className="metric-card">
                <p>Gelöste Tickets</p>
                <div>
                  <strong>{metrics.resolved}</strong>
                  <span className="delta positive">{metrics.change}</span>
                </div>
                <small>im gewählten Zeitraum</small>
              </article>
              <article className="metric-card">
                <p>Ø Erstreaktion</p>
                <div>
                  <strong>{metrics.response}</strong>
                  <span className="delta positive">{metrics.trend}</span>
                </div>
                <small>Ziel: unter 15 Minuten</small>
              </article>
              <article className="metric-card">
                <p>SLA erfüllt</p>
                <div>
                  <strong>94.8 %</strong>
                  <span className="delta positive">+ 1.2 %</span>
                </div>
                <small>gegenüber Vorperiode</small>
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
                  >
                    Alle Tickets <span>→</span>
                  </button>
                </div>
                <div
                  className="queue-tabs"
                  role="group"
                  aria-label="Ticket-Queue"
                >
                  {(Object.keys(queueLabels) as QueueKey[]).map((option) => (
                    <button
                      key={option}
                      className={
                        queue === option ? "queue-tab selected" : "queue-tab"
                      }
                      onClick={() => setQueue(option)}
                    >
                      {queueLabels[option]}
                      {option !== "alle" && (
                        <span>
                          {dashboardTickets.filter(
                            (ticket) => ticket.queue === option,
                          ).length + 14}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="ticket-list">
                  {tickets.length === 0 ? (
                    <p className="empty-state">
                      Keine Tickets entsprechen dem aktuellen Filter.
                    </p>
                  ) : (
                    tickets.map((ticket) => (
                      <article className="ticket-row" key={ticket.id}>
                        <div
                          className={`risk-line ${ticket.risk}`}
                          aria-hidden="true"
                        />
                        <div className="ticket-main">
                          <div className="ticket-id">
                            {ticket.id}
                            <span>{queueLabels[ticket.queue]}</span>
                          </div>
                          <h3>{ticket.subject}</h3>
                          <p>
                            {ticket.requester} · vor {ticket.age}
                          </p>
                        </div>
                        <div className="ticket-state">
                          <span
                            className={`state-badge ${statusClass(ticket.state)}`}
                          >
                            {ticket.state}
                          </span>
                          <strong className={`sla ${ticket.risk}`}>
                            {ticket.risk === "kritisch" ? "SLA in " : "SLA "}
                            {ticket.sla}
                          </strong>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </article>

              <aside className="side-stack">
                <article className="panel service-panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">Servicezustand</p>
                      <h2>Was läuft?</h2>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setSection("Services")}
                    >
                      Details →
                    </button>
                  </div>
                  <div className="service-list">
                    {serviceHealth.map((service) => (
                      <div className="service-row" key={service.name}>
                        <span className={`service-dot ${service.state}`} />
                        <div>
                          <strong>{service.name}</strong>
                          <small>{service.detail}</small>
                        </div>
                        <b>{service.availability}</b>
                      </div>
                    ))}
                  </div>
                </article>
                <article className="panel activity-panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">Ereignisse</p>
                      <h2>Gerade passiert</h2>
                    </div>
                  </div>
                  <ol>
                    {activityItems.map((item) => (
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
                </article>
              </aside>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
