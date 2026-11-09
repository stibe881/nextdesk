import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  CircleSlash,
  KeyRound,
  Laptop,
  LoaderCircle,
  Lock,
  Mail,
  Monitor,
  Plus,
  ShoppingBag,
  Smartphone,
  Star,
  Tablet,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";
import {
  formatDuration,
  orderStatusLabel,
  parsePersonOverview,
  personInitials,
  personTimeline,
  satisfactionLabel,
  type PersonDevice,
  type PersonOverview as PersonOverviewData,
  type PersonRef,
  type PersonTicket,
} from "./lib/person-overview";
import "./person-overview.css";

type Tab = "tickets" | "devices" | "licenses" | "orders" | "history";
type TicketFilter = "all" | "open" | "closed";

type PersonOverviewProps = {
  tenantId: string;
  person: PersonRef;
  onClose: () => void;
  onOpenTicket: (ticketId: string) => void;
  /** Opens the ticket composer with this person as requester. */
  onCreateTicket?:
    ((requester: { id: string; displayName: string }) => void) | undefined;
  onOpenAsset?: ((query: string) => void) | undefined;
};

const dateFormat = new Intl.DateTimeFormat("de-CH", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const dateTimeFormat = new Intl.DateTimeFormat("de-CH", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDate(value: string | null): string {
  if (!value) return "–";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "–" : dateFormat.format(date);
}

function relativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";
  const diff = Date.now() - date.getTime();
  const hours = Math.round(diff / 3_600_000);
  if (hours < 1) return "gerade eben";
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  if (days === 1) return "gestern";
  if (days < 7) return `vor ${days} Tagen`;
  return dateFormat.format(date);
}

function statusTone(ticket: PersonTicket): string {
  if (ticket.isClosed) {
    return ticket.statusKey === "resolved" ? "ok" : "neutral";
  }
  if (ticket.statusKey.startsWith("waiting")) return "warn";
  if (ticket.statusKey === "new") return "info";
  return "primary";
}

function deviceIcon(device: PersonDevice) {
  const text =
    `${device.operatingSystem ?? ""} ${device.model ?? ""} ${device.name}`.toLowerCase();
  if (/iphone|android|phone/.test(text)) return Smartphone;
  if (/ipad|tablet/.test(text)) return Tablet;
  if (/monitor|display|bildschirm/.test(text)) return Monitor;
  return Laptop;
}

function complianceLabel(state: string | null): string | null {
  if (!state) return null;
  if (state === "compliant") return "Intune konform";
  if (state === "noncompliant") return "Intune nicht konform";
  return `Intune: ${state}`;
}

function Stars({ value }: { value: number }) {
  return (
    <span className="person-stars" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((index) => (
        <Star
          className={
            value >= index - 0.25
              ? "is-full"
              : value >= index - 0.75
                ? "is-half"
                : undefined
          }
          key={index}
          size={15}
          strokeWidth={1.8}
        />
      ))}
    </span>
  );
}

export function PersonOverview({
  tenantId,
  person,
  onClose,
  onOpenTicket,
  onCreateTicket,
  onOpenAsset,
}: PersonOverviewProps) {
  const [data, setData] = useState<PersonOverviewData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("tickets");
  const [ticketFilter, setTicketFilter] = useState<TicketFilter>("all");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const personKey = `${person.entraObjectId ?? ""}|${person.requesterContactId ?? ""}|${person.userId ?? ""}`;

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    setData(null);
    setError("");
    setTab("tickets");
    setTicketFilter("all");
    void supabase.functions
      .invoke("person-overview", {
        body: {
          type: "get",
          tenantId,
          entraObjectId: person.entraObjectId ?? null,
          requesterContactId: person.requesterContactId ?? null,
          userId: person.userId ?? null,
        },
      })
      .then(async ({ data: response, error: invokeError }) => {
        if (!active) return;
        if (invokeError) throw invokeError;
        const parsed = parsePersonOverview(response);
        if (!parsed) throw new Error("invalid_person_overview");
        setData(parsed);
      })
      .catch(async (loadError: unknown) => {
        if (!active) return;
        setError(
          await functionErrorMessage(
            loadError,
            "Die Personenübersicht konnte nicht geladen werden.",
          ),
        );
      });
    return () => {
      active = false;
    };
    // personKey covers the reference fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personKey, tenantId]);

  useEffect(() => {
    rootRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tickets = useMemo(() => {
    const all = data?.tickets ?? [];
    if (ticketFilter === "open") return all.filter((item) => !item.isClosed);
    if (ticketFilter === "closed") return all.filter((item) => item.isClosed);
    return all;
  }, [data, ticketFilter]);
  const openCount = data?.tickets.filter((item) => !item.isClosed).length ?? 0;
  const closedCount = (data?.tickets.length ?? 0) - openCount;
  const timeline = useMemo(() => (data ? personTimeline(data) : []), [data]);

  async function createTicket() {
    if (!data || !onCreateTicket || !supabase) return;
    const { person: info } = data;
    if (info.requesterContactId) {
      onCreateTicket({
        id: info.requesterContactId,
        displayName: info.displayName,
      });
      return;
    }
    setCreating(true);
    setCreateError("");
    try {
      const { data: response, error: invokeError } =
        await supabase.functions.invoke("ticket-requesters", {
          body: {
            type: "create",
            tenantId,
            displayName: info.displayName,
            ...(info.email ? { email: info.email } : {}),
          },
        });
      if (invokeError) throw invokeError;
      const payload =
        typeof response === "object" && response !== null
          ? (
              response as {
                data?: { id?: unknown; requester?: { id?: unknown } };
              }
            ).data
          : null;
      const requester = payload?.requester ?? payload;
      if (!requester || typeof requester.id !== "string") {
        throw new Error("invalid_requester");
      }
      onCreateTicket({ id: requester.id, displayName: info.displayName });
    } catch (createFailure) {
      setCreateError(
        await functionErrorMessage(
          createFailure,
          "Die Person konnte nicht als anfragende Person übernommen werden.",
        ),
      );
    } finally {
      setCreating(false);
    }
  }

  const name = data?.person.displayName ?? person.displayName ?? "Person";
  const firstName = name.split(/\s+/u)[0] ?? name;
  const satisfaction = data?.satisfaction;
  const average = satisfaction?.average ?? null;
  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: "tickets", label: "Tickets", count: data?.tickets.length ?? 0 },
  ];
  if (data?.devices) {
    tabs.push({ key: "devices", label: "Geräte", count: data.devices.length });
  }
  if (data?.licenses) {
    tabs.push({
      key: "licenses",
      label: "Lizenzen",
      count: data.licenses.length,
    });
  }
  if (data?.orders) {
    tabs.push({
      key: "orders",
      label: "Bestellungen",
      count: data.orders.length,
    });
  }
  tabs.push({ key: "history", label: "Verlauf" });

  return (
    <div
      aria-label={`Personenübersicht ${name}`}
      aria-modal="true"
      className="person-overview"
      ref={rootRef}
      role="dialog"
      tabIndex={-1}
    >
      <div className="person-overview__inner">
        <div className="person-overview__crumbs">
          <button
            className="person-overview__back"
            onClick={onClose}
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={16} />
            Zurück
          </button>
          <span>
            Personen / <b>{name}</b>
          </span>
          <button
            aria-label="Personenübersicht schliessen"
            className="person-overview__close"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        {error ? (
          <p className="person-overview__state" role="alert">
            {error}
          </p>
        ) : !data ? (
          <p className="person-overview__state" role="status">
            <LoaderCircle
              aria-hidden="true"
              className="person-overview__spin"
              size={18}
            />
            Personenübersicht wird geladen …
          </p>
        ) : (
          <>
            <section className="person-card person-head">
              <div
                className="person-avatar person-avatar--big"
                aria-hidden="true"
              >
                {personInitials(name)}
              </div>
              <div className="person-head__main">
                <h1>
                  {name}
                  {data.person.source === "entra" ? (
                    data.person.accountEnabled === false ? (
                      <span className="person-chip person-chip--bad">
                        <CircleSlash aria-hidden="true" size={12} />
                        {data.person.removedFromDirectory
                          ? "Nicht mehr im Verzeichnis"
                          : "Konto deaktiviert"}
                      </span>
                    ) : (
                      <span className="person-chip person-chip--ok">
                        <BadgeCheck aria-hidden="true" size={12} />
                        Konto aktiv
                      </span>
                    )
                  ) : null}
                  <span className="person-chip">
                    {data.person.source === "entra" ? "Entra" : "Kontakt"}
                  </span>
                </h1>
                <div className="person-head__facts">
                  {data.person.jobTitle || data.person.department ? (
                    <span>
                      {data.person.jobTitle ? (
                        <b>{data.person.jobTitle}</b>
                      ) : null}
                      {data.person.jobTitle && data.person.department
                        ? " · "
                        : null}
                      {data.person.department}
                    </span>
                  ) : null}
                  {data.person.email ? <span>{data.person.email}</span> : null}
                  {data.person.managerName ? (
                    <span>
                      Vorgesetzt: <b>{data.person.managerName}</b>
                    </span>
                  ) : null}
                  {data.person.lastSignInAt ? (
                    <span>
                      Letzte Anmeldung:{" "}
                      {dateTimeFormat.format(
                        new Date(data.person.lastSignInAt),
                      )}
                    </span>
                  ) : null}
                </div>
                {createError ? (
                  <p className="person-head__error" role="alert">
                    {createError}
                  </p>
                ) : null}
              </div>
              <div className="person-head__actions">
                {onCreateTicket ? (
                  <button
                    className="primary-button"
                    disabled={creating}
                    onClick={() => void createTicket()}
                    type="button"
                  >
                    <Plus aria-hidden="true" size={16} />
                    Ticket für {firstName} erfassen
                  </button>
                ) : null}
                {data.person.email ? (
                  <a
                    className="secondary-button"
                    href={`mailto:${data.person.email}`}
                  >
                    <Mail aria-hidden="true" size={16} />
                    E-Mail
                  </a>
                ) : null}
              </div>
            </section>

            <section className="person-kpis" aria-label="Kennzahlen">
              <div className="person-card person-kpi">
                <span>Offene Tickets</span>
                <strong>{data.stats.openTickets}</strong>
                <small>
                  {data.stats.waitingOnPerson > 0
                    ? `${data.stats.waitingOnPerson} davon ${data.stats.waitingOnPerson === 1 ? "wartet" : "warten"} auf ${firstName}`
                    : `${data.stats.totalTickets} insgesamt`}
                </small>
              </div>
              <div className="person-card person-kpi">
                <span>Tickets in 12 Monaten</span>
                <strong>{data.stats.ticketsLast12Months}</strong>
                <small>
                  Ø {(data.stats.ticketsLast12Months / 12).toFixed(1)} pro Monat
                  {" · "}Vorjahr {data.stats.ticketsPrevious12Months}
                </small>
              </div>
              <div className="person-card person-kpi">
                <span>Ø Lösungszeit</span>
                <strong>{formatDuration(data.stats.avgResolutionHours)}</strong>
                <small>
                  Mandant: {formatDuration(data.stats.tenantAvgResolutionHours)}
                </small>
              </div>
              <div className="person-card person-kpi person-kpi--sat">
                {average !== null ? (
                  <div
                    className="person-ring"
                    style={{
                      background: `conic-gradient(var(--success) 0 ${(average / 5) * 100}%, var(--border) ${(average / 5) * 100}% 100%)`,
                    }}
                  >
                    <i>{average.toFixed(1)}</i>
                  </div>
                ) : (
                  <div className="person-ring person-ring--empty">
                    <i>–</i>
                  </div>
                )}
                <div>
                  <span>Zufriedenheit</span>
                  {average !== null ? (
                    <>
                      <Stars value={average} />
                      <small>
                        Durchschnitt aus {satisfaction?.ratingCount} Bewertungen
                      </small>
                    </>
                  ) : (
                    <small>
                      {satisfaction?.ratingCount
                        ? `Erst ${satisfaction.ratingCount} von ${satisfaction.minimumRatings} nötigen Bewertungen`
                        : "Noch keine Bewertungen"}
                    </small>
                  )}
                </div>
              </div>
            </section>

            <div className="person-grid">
              <section className="person-card person-main">
                <div className="person-tabs" role="tablist">
                  {tabs.map((item) => (
                    <button
                      aria-selected={tab === item.key}
                      className={tab === item.key ? "is-active" : undefined}
                      key={item.key}
                      onClick={() => setTab(item.key)}
                      role="tab"
                      type="button"
                    >
                      {item.label}
                      {item.count !== undefined ? <em>{item.count}</em> : null}
                    </button>
                  ))}
                </div>

                {tab === "tickets" ? (
                  <>
                    <div className="person-filters">
                      <div
                        className="person-segmented"
                        role="group"
                        aria-label="Tickets filtern"
                      >
                        {(
                          [
                            ["all", `Alle ${data.tickets.length}`],
                            ["open", `Offen ${openCount}`],
                            ["closed", `Geschlossen ${closedCount}`],
                          ] as const
                        ).map(([key, label]) => (
                          <button
                            aria-pressed={ticketFilter === key}
                            className={
                              ticketFilter === key ? "is-active" : undefined
                            }
                            key={key}
                            onClick={() => setTicketFilter(key)}
                            type="button"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <span className="person-muted">
                        Sortiert nach Aktualisierung
                      </span>
                    </div>
                    {tickets.length === 0 ? (
                      <p className="person-empty">
                        {data.tickets.length === 0
                          ? `${firstName} hat noch keine Tickets, die Sie sehen dürfen.`
                          : "Keine Tickets in dieser Auswahl."}
                      </p>
                    ) : (
                      <div className="person-table-wrap">
                        <table className="person-table">
                          <thead>
                            <tr>
                              <th>Ticket</th>
                              <th>Status</th>
                              <th>Zuständig</th>
                              <th>Aktualisiert</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tickets.map((ticket) => (
                              <tr key={ticket.id}>
                                <td>
                                  <button
                                    className="person-ticket-link"
                                    onClick={() => onOpenTicket(ticket.id)}
                                    type="button"
                                  >
                                    <span className="person-ticket-number">
                                      {ticket.ticketNumber}
                                    </span>
                                    <strong>{ticket.subject}</strong>
                                    <small>
                                      {[
                                        ticket.categoryName,
                                        ticket.priorityLabel,
                                      ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </small>
                                  </button>
                                </td>
                                <td>
                                  <span
                                    className={`person-chip person-chip--${statusTone(ticket)}`}
                                  >
                                    {ticket.statusLabel}
                                  </span>
                                </td>
                                <td>
                                  {ticket.assignedAgentName ??
                                    "Nicht zugewiesen"}
                                </td>
                                <td className="person-muted">
                                  {relativeDate(ticket.updatedAt)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                ) : null}

                {tab === "devices" && data.devices ? (
                  data.devices.length === 0 ? (
                    <p className="person-empty">Keine Geräte zugeordnet.</p>
                  ) : (
                    <ul className="person-list">
                      {data.devices.map((device) => {
                        const Icon = deviceIcon(device);
                        return (
                          <li key={device.id}>
                            <span className="person-icon">
                              <Icon aria-hidden="true" size={18} />
                            </span>
                            <div>
                              <strong>{device.name}</strong>
                              <small>
                                {[
                                  [device.manufacturer, device.model]
                                    .filter(Boolean)
                                    .join(" "),
                                  device.operatingSystem,
                                  complianceLabel(device.complianceState),
                                  device.lastSyncAt
                                    ? `letzte Synchronisation ${relativeDate(device.lastSyncAt)}`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </small>
                            </div>
                            <span className="person-chip">
                              {device.source === "intune" ? "Intune" : "Assets"}
                            </span>
                            {onOpenAsset ? (
                              <button
                                className="secondary-button person-list__action"
                                onClick={() =>
                                  onOpenAsset(device.assetTag ?? device.name)
                                }
                                type="button"
                              >
                                Öffnen
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )
                ) : null}

                {tab === "licenses" && data.licenses ? (
                  data.licenses.length === 0 ? (
                    <p className="person-empty">Keine Lizenzen zugewiesen.</p>
                  ) : (
                    <ul className="person-list">
                      {data.licenses.map((license) => (
                        <li key={license.id}>
                          <span className="person-icon">
                            <KeyRound aria-hidden="true" size={18} />
                          </span>
                          <div>
                            <strong>{license.title}</strong>
                            <small>
                              {[
                                license.vendorName,
                                license.assignedAt
                                  ? `seit ${formatDate(license.assignedAt)}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </small>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}

                {tab === "orders" && data.orders ? (
                  data.orders.length === 0 ? (
                    <p className="person-empty">Keine Bestellungen.</p>
                  ) : (
                    <ul className="person-list">
                      {data.orders.map((order) => (
                        <li key={order.id}>
                          <span className="person-icon">
                            <ShoppingBag aria-hidden="true" size={18} />
                          </span>
                          <div>
                            <strong>
                              {order.orderNumber}
                              {order.items ? ` · ${order.items}` : ""}
                            </strong>
                            <small>{formatDate(order.createdAt)}</small>
                          </div>
                          <span className="person-chip">
                            {orderStatusLabel(order.status)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}

                {tab === "history" ? (
                  timeline.length === 0 ? (
                    <p className="person-empty">Noch keine Ereignisse.</p>
                  ) : (
                    <ol className="person-timeline">
                      {timeline.map((entry, index) => (
                        <li key={`${entry.kind}:${entry.at}:${index}`}>
                          <span
                            className={`person-timeline__dot person-timeline__dot--${entry.kind}`}
                          />
                          <div>
                            {entry.ticketId ? (
                              <button
                                className="person-timeline__link"
                                onClick={() =>
                                  entry.ticketId && onOpenTicket(entry.ticketId)
                                }
                                type="button"
                              >
                                {entry.title}
                              </button>
                            ) : (
                              <strong>{entry.title}</strong>
                            )}
                            <small>
                              {formatDate(entry.at)}
                              {entry.detail ? ` · ${entry.detail}` : ""}
                            </small>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )
                ) : null}
              </section>

              <aside className="person-side">
                <section className="person-card person-box">
                  <h2>Zufriedenheit</h2>
                  {average !== null ? (
                    <>
                      <div className="person-sat__value">
                        <strong>{average.toFixed(1)}</strong>
                        <span className="person-muted">
                          von 5 · {satisfaction?.ratingCount} Bewertungen
                        </span>
                      </div>
                      <p className="person-sat__label">
                        {satisfactionLabel(average)}
                      </p>
                      <div className="person-bar" aria-hidden="true">
                        <i style={{ width: `${(average / 5) * 100}%` }} />
                      </div>
                      <ul className="person-facts">
                        {satisfaction?.positiveShare !== null &&
                        satisfaction?.positiveShare !== undefined ? (
                          <li>
                            <span>Zufrieden (4–5 Sterne)</span>
                            <b>{satisfaction.positiveShare} %</b>
                          </li>
                        ) : null}
                        {satisfaction?.tenantAverage !== null &&
                        satisfaction?.tenantAverage !== undefined ? (
                          <li>
                            <span>Mandant (12 Monate)</span>
                            <b>{satisfaction.tenantAverage.toFixed(1)}</b>
                          </li>
                        ) : null}
                        {satisfaction?.trend ? (
                          <li>
                            <span>Tendenz (6 Monate)</span>
                            <b
                              className={`person-trend person-trend--${satisfaction.trend}`}
                            >
                              {satisfaction.trend === "up" ? (
                                <>
                                  <TrendingUp aria-hidden="true" size={14} />{" "}
                                  steigend
                                </>
                              ) : satisfaction.trend === "down" ? (
                                <>
                                  <TrendingDown aria-hidden="true" size={14} />{" "}
                                  sinkend
                                </>
                              ) : (
                                "stabil"
                              )}
                            </b>
                          </li>
                        ) : null}
                      </ul>
                    </>
                  ) : (
                    <p className="person-muted">
                      {satisfaction?.ratingCount
                        ? `Noch zu wenige Bewertungen (${satisfaction.ratingCount} von ${satisfaction.minimumRatings}).`
                        : "Noch keine Bewertungen."}
                    </p>
                  )}
                  <p className="person-note">
                    <Lock aria-hidden="true" size={13} />
                    Einzelne Bewertungen und Kommentare sind nicht sichtbar.
                    nextDesk zeigt nur den Durchschnitt.
                  </p>
                </section>

                {data.devices && data.devices.length > 0 ? (
                  <section className="person-card person-box">
                    <h2>
                      Geräte{" "}
                      <span className="person-muted">
                        aus Intune &amp; Assets
                      </span>
                    </h2>
                    <ul className="person-mini-list">
                      {data.devices.slice(0, 4).map((device) => {
                        const Icon = deviceIcon(device);
                        return (
                          <li key={device.id}>
                            <button
                              className="person-mini-list__item"
                              disabled={!onOpenAsset}
                              onClick={() =>
                                onOpenAsset?.(device.assetTag ?? device.name)
                              }
                              title={onOpenAsset ? "Gerät öffnen" : undefined}
                              type="button"
                            >
                              <span className="person-icon">
                                <Icon aria-hidden="true" size={16} />
                              </span>
                              <span className="person-mini-list__text">
                                <b>{device.name}</b>
                                <small>
                                  {[
                                    device.model,
                                    complianceLabel(device.complianceState),
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </small>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {data.devices.length > 4 ? (
                      <button
                        className="person-more"
                        onClick={() => setTab("devices")}
                        type="button"
                      >
                        Alle {data.devices.length} Geräte anzeigen
                      </button>
                    ) : null}
                  </section>
                ) : null}

                {data.topics.length > 0 ? (
                  <section className="person-card person-box">
                    <h2>Häufige Themen</h2>
                    {data.topics.map((topic) => (
                      <div className="person-topic" key={topic.name}>
                        <div>
                          <span>{topic.name}</span>
                          <b>{topic.count}</b>
                        </div>
                        <div className="person-bar" aria-hidden="true">
                          <i
                            style={{
                              width: `${Math.max(8, (topic.count / (data.topics[0]?.count || 1)) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </section>
                ) : null}

                {data.person.source === "entra" ? (
                  <p className="person-note person-note--source">
                    <CalendarClock aria-hidden="true" size={13} />
                    Angaben aus Microsoft Entra
                  </p>
                ) : null}
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
