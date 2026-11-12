import {
  BookOpen,
  Megaphone,
  Network,
  Ticket as TicketIcon,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { functionErrorMessage } from "./lib/function-error";
import {
  parseArticleDraft,
  TICKET_SOURCE_LABELS,
  type IncidentDetail,
  type IncidentNeighbour,
} from "./lib/incidents";
import {
  INCIDENT_MESSAGE_STATE_LABELS,
  INCIDENT_MESSAGE_STATES,
  parseIncidentMessages,
  type IncidentMessage,
  type IncidentMessageState,
} from "./lib/incidents-public-messages";
import { supabase } from "./lib/supabase";

// Cards of the incident view: linked tickets, network context, public
// status message (Teil B's service-status actions) and the knowledge draft.

async function invoke(
  name: string,
  body: Record<string, unknown>,
  fallback: string,
): Promise<unknown> {
  if (!supabase) throw new Error("Die Verbindung ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw new Error(await functionErrorMessage(error, fallback));
  return data;
}

const DATE_TIME = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Zurich",
});

export function IncidentTicketsCard({
  detail,
  busy,
  onLink,
  onUnlink,
  onOpenTicket,
}: {
  detail: IncidentDetail;
  busy: boolean;
  onLink: (ticket: string) => Promise<boolean>;
  onUnlink: (ticketId: string) => void;
  onOpenTicket?: ((ticketId: string) => void) | undefined;
}) {
  const [reference, setReference] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reference.trim()) return;
    if (await onLink(reference.trim())) setReference("");
  }

  return (
    <article className="incident-card">
      <div className="incident-card__head">
        <h3>
          <TicketIcon aria-hidden="true" size={15} /> Tickets
        </h3>
        <span className="incident-muted">
          {detail.tickets.length === 1
            ? "1 Ticket"
            : `${detail.tickets.length} Tickets`}
        </span>
      </div>
      {detail.tickets.length ? (
        <ul className="incident-sensors">
          {detail.tickets.map((ticket) => (
            <li key={ticket.id}>
              <span>
                {onOpenTicket ? (
                  <button
                    className="text-button incident-ticket__open"
                    onClick={() => onOpenTicket(ticket.id)}
                    type="button"
                  >
                    {ticket.number} · {ticket.subject}
                  </button>
                ) : (
                  <strong>
                    {ticket.number} · {ticket.subject}
                  </strong>
                )}
                <small>
                  {TICKET_SOURCE_LABELS[ticket.source]}
                  {ticket.notifiedAt
                    ? ` · informiert ${DATE_TIME.format(new Date(ticket.notifiedAt))}`
                    : ""}
                </small>
              </span>
              <span className="incident-ticket__actions">
                <span
                  className={`incident-chip incident-chip--${ticket.closed ? "ok" : "line"}`}
                >
                  {ticket.status || "–"}
                </span>
                {detail.state !== "closed" ? (
                  <button
                    aria-label={`${ticket.number} von der Störung lösen`}
                    className="text-button"
                    disabled={busy}
                    onClick={() => onUnlink(ticket.id)}
                    title="Von der Störung lösen"
                    type="button"
                  >
                    <X aria-hidden="true" size={14} />
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="incident-muted">
          Noch keine Tickets. Tickets zum gestörten Gerät oder Dienst werden
          während der Störung automatisch zugeordnet.
        </p>
      )}
      {detail.hiddenTickets ? (
        <p className="incident-muted">
          {detail.hiddenTickets === 1
            ? "1 weiteres Ticket sehen Sie nicht (andere Abteilung)."
            : `${detail.hiddenTickets} weitere Tickets sehen Sie nicht (andere Abteilung).`}
        </p>
      ) : null}
      {detail.state !== "closed" ? (
        <form
          className="incident-note"
          onSubmit={(event) => void submit(event)}
        >
          <label className="sr-only" htmlFor="incident-ticket-link">
            Ticketnummer
          </label>
          <input
            disabled={busy}
            id="incident-ticket-link"
            maxLength={64}
            onChange={(event) => setReference(event.target.value)}
            placeholder="Ticketnummer zuordnen …"
            type="text"
            value={reference}
          />
          <button
            className="secondary-button"
            disabled={busy || !reference.trim()}
            type="submit"
          >
            Zuordnen
          </button>
        </form>
      ) : null}
    </article>
  );
}

function NeighbourList({
  entries,
  onOpen,
  withPort,
}: {
  entries: IncidentNeighbour[];
  onOpen: (incidentId: string) => void;
  withPort: boolean;
}) {
  return (
    <ul className="incident-topology">
      {entries.map((entry, index) => (
        <li key={`${entry.assetId ?? entry.address ?? entry.name}-${index}`}>
          <span
            aria-hidden="true"
            className={`incident-dot incident-dot--${entry.state === "down" ? "bad" : entry.state === "warning" ? "warn" : entry.state === "ok" ? "ok" : "unknown"}`}
          />
          {entry.incidentId ? (
            <button
              className="text-button"
              onClick={() => onOpen(entry.incidentId!)}
              type="button"
            >
              {entry.name}
            </button>
          ) : (
            <span>{entry.name}</span>
          )}
          <small className="incident-muted">
            {[withPort ? entry.port : null, entry.address]
              .filter(Boolean)
              .join(" · ")}
            {entry.state === "down"
              ? " · Ausfall"
              : entry.state === "warning"
                ? " · Warnung"
                : entry.state === "unknown"
                  ? " · nicht überwacht"
                  : ""}
          </small>
        </li>
      ))}
    </ul>
  );
}

export function IncidentNetworkCard({
  detail,
  onOpen,
}: {
  detail: IncidentDetail;
  onOpen: (incidentId: string) => void;
}) {
  const network = detail.network;
  if (
    !network ||
    (!network.addresses.length &&
      !network.subnetNeighbours.length &&
      !network.switchNeighbours.length)
  ) {
    return null;
  }
  const down = [...network.subnetNeighbours, ...network.switchNeighbours]
    .filter((entry) => entry.state === "down")
    .map((entry) => entry.assetId ?? entry.name);
  const neighbours =
    network.subnetNeighbours.length + network.switchNeighbours.length;
  const summary = [
    network.addresses
      .map((address) => address.address)
      .filter(Boolean)
      .join(", "),
    neighbours
      ? `${neighbours} ${neighbours === 1 ? "Nachbar" : "Nachbarn"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <article className="incident-card">
      {/* Long list of neighbours: collapsed by default. */}
      <details className="incident-collapsible">
        <summary>
          <h3>
            <Network aria-hidden="true" size={15} /> Netzwerk
          </h3>
          {summary ? <span className="incident-muted">{summary}</span> : null}
        </summary>
        {network.addresses.map((address, index) => (
          <dl
            className="incident-kv"
            key={`${address.address ?? "mac"}-${index}`}
          >
            {address.address ? (
              <>
                <dt>IP</dt>
                <dd className="incident-mono">
                  {address.address}
                  {address.hostname ? ` · ${address.hostname}` : ""}
                </dd>
              </>
            ) : null}
            {address.prefix ? (
              <>
                <dt>Subnetz</dt>
                <dd className="incident-mono">
                  {address.prefix}
                  {address.gateway ? ` · GW ${address.gateway}` : ""}
                </dd>
              </>
            ) : null}
            {address.vlanNumber !== null ? (
              <>
                <dt>VLAN</dt>
                <dd>
                  {address.vlanNumber}
                  {address.vlanName ? ` · ${address.vlanName}` : ""}
                </dd>
              </>
            ) : null}
            {address.site ? (
              <>
                <dt>Standort</dt>
                <dd>{address.site}</dd>
              </>
            ) : null}
            {address.switchName ? (
              <>
                <dt>Switch-Port</dt>
                <dd className="incident-mono">
                  {address.switchName}
                  {address.switchPort ? ` · ${address.switchPort}` : ""}
                  {address.portSource === "lldp" || address.portSource === "fdb"
                    ? " (erkannt)"
                    : ""}
                </dd>
              </>
            ) : null}
          </dl>
        ))}
        {network.subnetNeighbours.length ? (
          <>
            <h4 className="incident-subhead">Weitere Geräte im Subnetz</h4>
            <NeighbourList
              entries={network.subnetNeighbours}
              onOpen={onOpen}
              withPort={false}
            />
          </>
        ) : null}
        {network.switchNeighbours.length ? (
          <>
            <h4 className="incident-subhead">Am selben Switch</h4>
            <NeighbourList
              entries={network.switchNeighbours}
              onOpen={onOpen}
              withPort
            />
          </>
        ) : null}
      </details>
      {new Set(down).size >= 2 ? (
        <p className="incident-muted">
          Mehrere Geräte im selben Netz sind gestört: Ursache eher im Netzwerk
          (Switch, Uplink, Strom) suchen.
        </p>
      ) : null}
    </article>
  );
}

/**
 * Public status message for the incident («Öffentliche Meldung»): uses the
 * service-status actions publishIncidentMessage / incidentMessages.
 */
export function IncidentPublicMessageCard({
  detail,
  tenantId,
}: {
  detail: IncidentDetail;
  tenantId: string;
}) {
  const [messages, setMessages] = useState<IncidentMessage[] | null>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<IncidentMessageState>("investigating");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setMessages(
        parseIncidentMessages(
          await invoke(
            "service-status",
            {
              type: "incidentMessages",
              tenantId,
              monitoringIncidentId: detail.id,
            },
            "Die öffentlichen Meldungen sind gerade nicht verfügbar.",
          ),
        ),
      );
    } catch {
      setMessages([]);
    }
  }, [detail.id, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  function start() {
    const latest = messages?.[0];
    setState(
      latest
        ? detail.state === "active"
          ? "monitoring"
          : "resolved"
        : "investigating",
    );
    setTitle(
      latest?.title ??
        `Störung: ${detail.services.map((service) => service.name).join(", ") || detail.deviceName || detail.title}`,
    );
    setBody("");
    setServiceIds(detail.services.map((service) => service.id));
    setMessage("");
    setOpen(true);
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await invoke(
        "service-status",
        {
          type: "publishIncidentMessage",
          tenantId,
          monitoringIncidentId: detail.id,
          serviceIds,
          state,
          title: title.trim(),
          body: body.trim(),
        },
        "Die Meldung konnte nicht veröffentlicht werden.",
      );
      setOpen(false);
      setMessage("Die Meldung ist auf der Statusseite veröffentlicht.");
      await load();
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="incident-card">
      <div className="incident-card__head">
        <h3>
          <Megaphone aria-hidden="true" size={15} /> Statusseite
        </h3>
        {!open ? (
          <button className="text-button" onClick={start} type="button">
            {messages?.length
              ? "Update veröffentlichen"
              : "Öffentliche Meldung"}
          </button>
        ) : null}
      </div>
      {messages?.length ? (
        <ul className="incident-sensors">
          {messages.map((entry) => (
            <li key={entry.id}>
              <span>
                <strong>{entry.title}</strong>
                <small>
                  {entry.body ? `${entry.body} · ` : ""}
                  {DATE_TIME.format(
                    new Date(entry.updatedAt ?? entry.createdAt),
                  )}
                </small>
              </span>
              <span
                className={`incident-chip incident-chip--${entry.state === "resolved" ? "ok" : "warn"}`}
              >
                {INCIDENT_MESSAGE_STATE_LABELS[entry.state]}
              </span>
            </li>
          ))}
        </ul>
      ) : !open ? (
        <p className="incident-muted">
          Informieren Sie Mitarbeitende und Abonnenten über die Statusseite.
        </p>
      ) : null}
      {open ? (
        <form
          className="incident-close"
          onSubmit={(event) => void publish(event)}
        >
          <label className="incident-field">
            Zustand
            <select
              disabled={busy}
              onChange={(event) =>
                setState(event.target.value as IncidentMessageState)
              }
              value={state}
            >
              {INCIDENT_MESSAGE_STATES.map((entry) => (
                <option key={entry} value={entry}>
                  {INCIDENT_MESSAGE_STATE_LABELS[entry]}
                </option>
              ))}
            </select>
          </label>
          <label className="incident-field">
            Titel
            <input
              disabled={busy}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              required
              type="text"
              value={title}
            />
          </label>
          <label className="incident-field">
            Text
            <textarea
              disabled={busy}
              maxLength={4000}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Was ist betroffen, was tun wir, wann gibt es das nächste Update?"
              required
              rows={3}
              value={body}
            />
          </label>
          {detail.services.length ? (
            <fieldset className="incident-checks">
              <legend>Betroffene Dienste</legend>
              {detail.services.map((service) => (
                <label key={service.id}>
                  <input
                    checked={serviceIds.includes(service.id)}
                    disabled={busy}
                    onChange={(event) =>
                      setServiceIds((current) =>
                        event.target.checked
                          ? [...current, service.id]
                          : current.filter((id) => id !== service.id),
                      )
                    }
                    type="checkbox"
                  />
                  {service.name}
                </label>
              ))}
            </fieldset>
          ) : null}
          <div className="incident-actions">
            <button
              className="primary-button"
              disabled={busy || !title.trim() || !body.trim()}
              type="submit"
            >
              Veröffentlichen
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setOpen(false)}
              type="button"
            >
              Abbrechen
            </button>
          </div>
        </form>
      ) : null}
      {message ? (
        <p className="incident-muted" role="status">
          {message}
        </p>
      ) : null}
    </article>
  );
}

/** «Wissensartikel-Entwurf» from a closed incident with a cause. */
export function IncidentKnowledgeCard({
  detail,
  tenantId,
}: {
  detail: IncidentDetail;
  tenantId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    articleId: string;
    title: string;
    aiUsed: boolean;
  } | null>(null);
  const [error, setError] = useState("");

  if (
    detail.state !== "closed" ||
    !detail.cause ||
    !detail.permissions.draftArticle
  ) {
    return null;
  }

  async function draft() {
    setBusy(true);
    setError("");
    try {
      const parsed = parseArticleDraft(
        await invoke(
          "incidents",
          { type: "draftArticle", tenantId, incidentId: detail.id },
          "Der Artikelentwurf konnte nicht erstellt werden.",
        ),
      );
      if (!parsed) throw new Error("Die Antwort ist unvollständig.");
      setResult(parsed);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="incident-card">
      <h3>
        <BookOpen aria-hidden="true" size={15} /> Wissen
      </h3>
      {result ? (
        <p className="incident-muted" role="status">
          Entwurf «{result.title}» erstellt
          {result.aiUsed ? " (mit KI)" : ""}.{" "}
          <a href={`?wissen=${encodeURIComponent(result.articleId)}`}>
            Entwurf öffnen
          </a>
        </p>
      ) : (
        <>
          <p className="incident-muted">
            Halten Sie Ursache und Lösung als internen Wissensartikel fest. Der
            Entwurf wird erst nach Ihrer Prüfung veröffentlicht.
          </p>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void draft()}
            type="button"
          >
            {busy
              ? "Entwurf wird erstellt …"
              : "Wissensartikel-Entwurf erstellen"}
          </button>
        </>
      )}
      {error ? (
        <p className="ticket-detail-message error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
