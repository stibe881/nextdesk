import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Link2, Network, RefreshCw } from "lucide-react";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";
import {
  detectNetworkCandidates,
  hasNetworkCandidates,
  networkLookupTerms,
} from "./lib/ipam-ticket-detect";
import {
  addressStatusLabel,
  addressStatusTone,
  findingLabel,
  lastSeenLabel,
  linkOptions,
  type NetworkLookup,
  networkContextLine,
  parseNetworkLookup,
} from "./lib/ipam-network-view";
import "./ipam-integrations.css";

/*
 * «Netzwerk» im Ticketdetail: erkennt IP-/MAC-Adressen und Gerätenamen in
 * Betreff, Beschreibung und Verlauf und zeigt die im IPAM dokumentierten
 * Daten (Status, Hostname, VLAN, Standort, Switch-Port, zuletzt gesehen,
 * Gerät, offene Funde). Die Erkennung im Browser entscheidet nur, ob
 * nachgefragt wird; der Server liest das Ticket selbst (Leserecht) und
 * prüft ipam.read sowie das Modul ipam.management. Ohne Recht, mit
 * ausgeschaltetem Modul oder ohne Treffer bleibt der Bereich weg.
 *
 * Mit Bearbeitungsrecht am Ticket lassen sich Gerät und Dienste einer
 * Adresse ans Ticket hängen (service-assets: linkTicket) und eine erkannte,
 * noch freie IP reservieren (ipam-sync: reserveAddress, braucht ipam.manage).
 */

type Props = {
  tenantId: string;
  ticketId: string;
  subject: string;
  description: string;
  /** Texte der Kommentare (für die Vorprüfung im Browser). */
  comments: readonly string[];
  /** Ändert sich bei neuen Kommentaren oder Bearbeitungen. */
  refreshKey?: string | undefined;
  onOpenAsset?: ((query: string) => void) | undefined;
  /** Öffnet die IP-Adressverwaltung mit einer Suche (falls verdrahtet). */
  onOpenIpam?: ((query: string) => void) | undefined;
  /** Darf das Ticket bearbeiten (Gerät/Dienst anhängen). */
  canUpdate?: boolean | undefined;
  /** Nach dem Anhängen eines Geräts oder Dienstes. */
  onLinked?: (() => void) | undefined;
  /** Ticketnummer für die Beschreibung einer Reservierung. */
  ticketNumber?: string | undefined;
};

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; lookup: NetworkLookup }
  | { kind: "hidden" };

export function IpamTicketPanel({
  tenantId,
  ticketId,
  subject,
  description,
  comments,
  refreshKey,
  onOpenAsset,
  onOpenIpam,
  canUpdate = false,
  onLinked,
  ticketNumber,
}: Props) {
  const candidates = useMemo(
    () => detectNetworkCandidates([subject, description, ...comments]),
    [subject, description, comments],
  );
  const signature = useMemo(
    () => JSON.stringify(networkLookupTerms(candidates)),
    [candidates],
  );
  const [state, setState] = useState<State>({ kind: "idle" });
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReserve, setConfirmReserve] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const sequence = useRef(0);

  async function link(
    kind: "asset" | "service",
    targetId: string,
    label: string,
  ) {
    if (!supabase) return;
    setBusy(`${kind}:${targetId}`);
    setActionMessage(null);
    try {
      const { error } = await supabase.functions.invoke("service-assets", {
        body: { type: "linkTicket", tenantId, ticketId, kind, targetId },
      });
      if (error) throw error;
      setActionMessage({
        tone: "success",
        text:
          kind === "asset"
            ? `Gerät «${label}» hängt jetzt am Ticket.`
            : `Dienst «${label}» hängt jetzt am Ticket.`,
      });
      onLinked?.();
      setReload((value) => value + 1);
    } catch (error) {
      setActionMessage({
        tone: "error",
        text: await functionErrorMessage(
          error,
          kind === "asset"
            ? "Das Gerät konnte nicht angehängt werden."
            : "Der Dienst konnte nicht angehängt werden.",
        ),
      });
    } finally {
      setBusy(null);
    }
  }

  async function reserve(prefixId: string, address: string) {
    if (!supabase) return;
    setBusy(`reserve:${address}`);
    setActionMessage(null);
    try {
      const { error } = await supabase.functions.invoke("ipam-sync", {
        body: {
          type: "reserveAddress",
          tenantId,
          prefixId,
          address,
          description: ticketNumber
            ? `Reserviert aus Ticket ${ticketNumber}`
            : "Reserviert aus einem Ticket",
          confirmed: true,
        },
      });
      if (error) throw error;
      setActionMessage({
        tone: "success",
        text: `${address} ist jetzt in der IP-Adressverwaltung reserviert.`,
      });
      setConfirmReserve(null);
      setReload((value) => value + 1);
    } catch (error) {
      setActionMessage({
        tone: "error",
        text: await functionErrorMessage(
          error,
          "Die Adresse konnte nicht reserviert werden. Für Reservierungen braucht es das Recht, IP-Adressen zu verwalten.",
        ),
      });
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    const requestId = ++sequence.current;
    if (!hasNetworkCandidates(candidates) || !supabase) {
      setState({ kind: "hidden" });
      return;
    }
    setState({ kind: "loading" });
    void (async () => {
      try {
        const { data, error } = await supabase!.functions.invoke("ipam-sync", {
          body: { type: "ticketLookup", tenantId, ticketId },
        });
        if (error) throw error;
        const lookup = parseNetworkLookup(
          (data as { data?: unknown } | null)?.data,
        );
        if (requestId !== sequence.current) return;
        setState(lookup ? { kind: "ready", lookup } : { kind: "hidden" });
      } catch {
        // Modul aus, kein Recht oder ältere Version: Bereich ausblenden.
        if (requestId === sequence.current) setState({ kind: "hidden" });
      }
    })();
    return () => {
      sequence.current += 1;
    };
    // signature fasst die Kandidaten zusammen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, ticketId, signature, refreshKey, reload]);

  if (state.kind === "hidden" || state.kind === "idle") return null;

  const lookup = state.kind === "ready" ? state.lookup : null;
  const documented = new Set(
    lookup?.addresses.flatMap((entry) => [
      entry.address,
      (entry.hostname ?? "").toUpperCase(),
      entry.macAddress ?? "",
    ]) ?? [],
  );
  const covered = new Set(lookup?.prefixes.map((entry) => entry.matched) ?? []);
  const unknown = [
    ...candidates.ipv4,
    ...candidates.ipv6,
    ...candidates.macs,
    ...candidates.hostnames,
  ].filter(
    (value) =>
      !documented.has(value) &&
      !documented.has(value.toUpperCase()) &&
      !covered.has(value),
  );

  return (
    <section
      aria-busy={state.kind === "loading"}
      aria-labelledby="ipam-ticket-panel-heading"
      className="ticket-detail-primary ipam-ticket-panel"
    >
      <div className="ticket-detail-section-heading">
        <div>
          <p className="eyebrow">NETZWERK</p>
          <h3 id="ipam-ticket-panel-heading">Netzwerk</h3>
        </div>
        <button
          aria-label="Netzwerkdaten neu laden"
          className="ipam-ticket-panel__icon-button"
          disabled={state.kind === "loading"}
          onClick={() => setReload((value) => value + 1)}
          title="Neu laden"
          type="button"
        >
          <RefreshCw aria-hidden="true" size={15} />
        </button>
      </div>

      {state.kind === "loading" ? (
        <p className="data-caption" role="status">
          Netzwerkdaten werden geladen …
        </p>
      ) : null}

      {lookup && lookup.addresses.length > 0 ? (
        <ul className="ipam-ticket-panel__list">
          {lookup.addresses.map((entry) => {
            const context = networkContextLine(entry);
            return (
              <li className="ipam-ticket-panel__item" key={entry.id}>
                <div className="ipam-ticket-panel__row">
                  <Network aria-hidden="true" size={15} />
                  {onOpenIpam ? (
                    <button
                      className="ipam-ticket-panel__address ipam-ticket-panel__link"
                      onClick={() => onOpenIpam(entry.address)}
                      title="In der IP-Adressverwaltung öffnen"
                      type="button"
                    >
                      {entry.address}
                    </button>
                  ) : (
                    <strong className="ipam-ticket-panel__address">
                      {entry.address}
                    </strong>
                  )}
                  <span
                    className={`ipam-badge ipam-badge--${addressStatusTone(entry.status)}`}
                  >
                    {addressStatusLabel(entry.status)}
                  </span>
                </div>
                {entry.hostname || entry.dnsName ? (
                  <p className="ipam-ticket-panel__host">
                    {entry.hostname ?? entry.dnsName}
                    {entry.hostname && entry.dnsName
                      ? ` · ${entry.dnsName}`
                      : ""}
                  </p>
                ) : null}
                <dl className="ipam-ticket-panel__facts">
                  {context ? (
                    <>
                      <dt>Netz</dt>
                      <dd>{context}</dd>
                    </>
                  ) : null}
                  {entry.switchName ? (
                    <>
                      <dt>Switch-Port</dt>
                      <dd>
                        {entry.switchName}
                        {entry.switchPort ? ` ${entry.switchPort}` : ""}
                      </dd>
                    </>
                  ) : null}
                  {entry.macAddress ? (
                    <>
                      <dt>MAC</dt>
                      <dd>
                        <code>{entry.macAddress}</code>
                        {entry.vendor ? ` · ${entry.vendor}` : ""}
                      </dd>
                    </>
                  ) : null}
                  <dt>Zuletzt gesehen</dt>
                  <dd>
                    {lastSeenLabel(entry.lastSeenAt)}
                    {entry.lastSeenAt && entry.lastSeenSource
                      ? ` (${entry.lastSeenSource})`
                      : ""}
                  </dd>
                  {entry.asset ? (
                    <>
                      <dt>Gerät</dt>
                      <dd>
                        {onOpenAsset ? (
                          <button
                            className="ipam-ticket-panel__link"
                            onClick={() =>
                              onOpenAsset(
                                entry.asset!.assetTag ?? entry.asset!.name,
                              )
                            }
                            title="Asset öffnen"
                            type="button"
                          >
                            {entry.asset.name}
                          </button>
                        ) : (
                          entry.asset.name
                        )}
                      </dd>
                    </>
                  ) : null}
                  {entry.owner || entry.intuneUser ? (
                    <>
                      <dt>Person</dt>
                      <dd>{entry.owner ?? entry.intuneUser}</dd>
                    </>
                  ) : null}
                </dl>
                {entry.intuneDeviceId || entry.prtgDeviceId ? (
                  <p className="ipam-ticket-panel__chips">
                    {entry.intuneDeviceId ? (
                      <span className="ipam-badge ipam-badge--neutral">
                        Intune
                      </span>
                    ) : null}
                    {entry.prtgDeviceId ? (
                      <span className="ipam-badge ipam-badge--neutral">
                        PRTG
                      </span>
                    ) : null}
                  </p>
                ) : null}
                {canUpdate && lookup ? (
                  <LinkButtons
                    busy={busy}
                    onLink={(kind, id, label) => void link(kind, id, label)}
                    options={linkOptions(entry, lookup)}
                  />
                ) : null}
                {entry.findings.length > 0 ? (
                  <ul className="ipam-ticket-panel__findings">
                    {entry.findings.map((finding) => (
                      <li
                        className={`ipam-finding ipam-finding--${finding.severity}`}
                        key={finding.id}
                      >
                        <AlertTriangle aria-hidden="true" size={14} />
                        {findingLabel(finding.kind)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {lookup && lookup.prefixes.length > 0 ? (
        <ul className="ipam-ticket-panel__list">
          {lookup.prefixes.map((entry) => (
            <li
              className="ipam-ticket-panel__item"
              key={`${entry.id}-${entry.matched}`}
            >
              <div className="ipam-ticket-panel__row">
                <Network aria-hidden="true" size={15} />
                <strong className="ipam-ticket-panel__address">
                  {entry.matched}
                </strong>
                <span className="ipam-badge ipam-badge--warning">
                  Nicht dokumentiert
                </span>
              </div>
              <p className="data-caption">
                Liegt im Subnetz {entry.prefix}
                {networkContextLine({ ...entry, prefix: null })
                  ? ` · ${networkContextLine({ ...entry, prefix: null })}`
                  : ""}
                {entry.percent !== null ? ` · ${entry.percent} % belegt` : ""}
              </p>
              {confirmReserve === entry.matched ? (
                <div className="ipam-ticket-panel__actions" role="group">
                  <span className="data-caption">
                    {entry.matched} in {entry.prefix} reservieren?
                  </span>
                  <button
                    className="ipam-ticket-panel__action ipam-ticket-panel__action--primary"
                    disabled={busy !== null}
                    onClick={() => void reserve(entry.id, entry.matched)}
                    type="button"
                  >
                    Reservieren
                  </button>
                  <button
                    className="ipam-ticket-panel__action"
                    disabled={busy !== null}
                    onClick={() => setConfirmReserve(null)}
                    type="button"
                  >
                    Abbrechen
                  </button>
                </div>
              ) : canUpdate && !entry.matched.includes("/") ? (
                <div className="ipam-ticket-panel__actions">
                  <button
                    className="ipam-ticket-panel__action"
                    disabled={busy !== null}
                    onClick={() => setConfirmReserve(entry.matched)}
                    type="button"
                  >
                    IP reservieren
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {actionMessage ? (
        <p
          aria-live="polite"
          className={`form-message${actionMessage.tone === "error" ? " form-message--error" : ""}`}
          role={actionMessage.tone === "error" ? "alert" : "status"}
        >
          {actionMessage.text}
        </p>
      ) : null}

      {lookup && unknown.length > 0 ? (
        <p className="data-caption">
          Im Ticket erkannt, aber nicht im IPAM: {unknown.join(", ")}
        </p>
      ) : null}
    </section>
  );
}

function LinkButtons({
  options,
  busy,
  onLink,
}: {
  options: ReturnType<typeof linkOptions>;
  busy: string | null;
  onLink: (kind: "asset" | "service", id: string, label: string) => void;
}) {
  const entries = [
    ...(options.asset
      ? [{ kind: "asset" as const, ...options.asset, label: "Gerät" }]
      : []),
    ...options.services.map((service) => ({
      kind: "service" as const,
      ...service,
      label: "Dienst",
    })),
  ];
  if (entries.length === 0) return null;
  return (
    <div className="ipam-ticket-panel__actions">
      {entries.map((entry) =>
        entry.linked ? (
          <span
            className="ipam-badge ipam-badge--success"
            key={`${entry.kind}:${entry.id}`}
          >
            {entry.label} «{entry.name}» am Ticket
          </span>
        ) : (
          <button
            className="ipam-ticket-panel__action"
            disabled={busy !== null}
            key={`${entry.kind}:${entry.id}`}
            onClick={() => onLink(entry.kind, entry.id, entry.name)}
            title={`${entry.label} «${entry.name}» ans Ticket hängen`}
            type="button"
          >
            <Link2 aria-hidden="true" size={14} />
            {busy === `${entry.kind}:${entry.id}`
              ? "Wird angehängt …"
              : `${entry.label} «${entry.name}» ans Ticket hängen`}
          </button>
        ),
      )}
    </div>
  );
}
