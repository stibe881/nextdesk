import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Network, RefreshCw } from "lucide-react";
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
  const sequence = useRef(0);

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
            </li>
          ))}
        </ul>
      ) : null}

      {lookup && unknown.length > 0 ? (
        <p className="data-caption">
          Im Ticket erkannt, aber nicht im IPAM: {unknown.join(", ")}
        </p>
      ) : null}
    </section>
  );
}
