// IPAM «Übersicht»: Live-Suche, Kennzahlen, Top-Auslastung, Agenten,
// zuletzt geändert.

import { Search } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Meter, Pill, useDebounced, useIpamQuery, errorText } from "./ipam-ui";
import { ipamCall } from "./lib/ipam-api";
import { formatCount } from "./lib/ipam-cidr";
import {
  AGENT_STATUS_LABEL,
  AGENT_STATUS_TONE,
  changeActor,
  findingsSummary,
  forecastLabel,
  formatChangeTime,
} from "./lib/ipam-format";
import {
  ADDRESS_STATUS_LABEL,
  formatRelative,
  type IpamAddress,
  type IpamOverview,
  type IpamPrefix,
} from "./lib/ipam-model";
import type { Dashboard } from "./lib/ipam-redesign-types";

export type SearchHit = {
  key: string;
  kind: "Adresse" | "Subnetz" | "VLAN";
  title: string;
  sub: string;
  open: () => void;
};

type Props = {
  canManage: boolean;
  onOpenAddress: (address: IpamAddress) => void;
  onOpenChanges: () => void;
  onOpenFindings: () => void;
  onOpenNetworks: () => void;
  onOpenPrefix: (prefixId: string) => void;
  onOpenVlans: () => void;
  overview: IpamOverview;
  revision: number;
  tenantId: string;
};

export function IpamOverviewPage(props: Props) {
  const { data, error } = useIpamQuery<Dashboard>(
    { type: "dashboard", tenantId: props.tenantId },
    `${props.tenantId}-${props.revision}`,
  );
  return (
    <div className="ipam-page">
      <LiveSearch {...props} />
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
      {data ? (
        <DashboardView dashboard={data} {...props} />
      ) : !error ? (
        <p className="ipam-muted">Übersicht wird geladen …</p>
      ) : null}
    </div>
  );
}

function LiveSearch({
  onOpenAddress,
  onOpenPrefix,
  onOpenVlans,
  overview,
  tenantId,
}: Props) {
  const [query, setQuery] = useState("");
  const term = useDebounced(query.trim(), 300);
  const [result, setResult] = useState<{
    addresses: IpamAddress[];
    prefixes: IpamPrefix[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (term.length < 2) {
      setResult(null);
      return;
    }
    let active = true;
    setError(null);
    ipamCall<{ addresses: IpamAddress[]; prefixes: IpamPrefix[] }>({
      type: "search",
      tenantId,
      query: term,
    })
      .then((value) => {
        if (active) setResult(value);
      })
      .catch((failure: unknown) => {
        if (active)
          setError(errorText(failure, "Die Suche ist fehlgeschlagen."));
      });
    return () => {
      active = false;
    };
  }, [term, tenantId]);

  const hits = useMemo(
    () =>
      searchHits(
        term,
        result,
        overview,
        onOpenAddress,
        onOpenPrefix,
        onOpenVlans,
      ),
    [term, result, overview, onOpenAddress, onOpenPrefix, onOpenVlans],
  );
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && hits[0]) hits[0].open();
    if (event.key === "Escape") setQuery("");
  };

  return (
    <section className="ipam-card ipam-search">
      <label className="ipam-search__label" htmlFor="ipam-live-search">
        Suchen
      </label>
      <div className="ipam-search__field">
        <Search aria-hidden="true" size={20} />
        <input
          autoComplete="off"
          id="ipam-live-search"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKey}
          placeholder="IP, MAC, Hostname, VLAN oder Subnetz – z. B. 10.20.30 oder SW016"
          spellCheck={false}
          type="search"
          value={query}
        />
      </div>
      {error ? <p className="ipam-muted">{error}</p> : null}
      {term.length >= 2 && (result || hits.length) ? (
        <div aria-live="polite" className="ipam-search__results">
          {hits.map((hit) => (
            <button key={hit.key} onClick={hit.open} type="button">
              <span className="ipam-search__kind">{hit.kind}</span>
              <span className="ipam-mono ipam-search__title">{hit.title}</span>
              <span className="ipam-search__sub">{hit.sub}</span>
            </button>
          ))}
          {result && hits.length === 0 ? (
            <p className="ipam-muted ipam-search__empty">Keine Treffer.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Combines server hits with VLANs from the loaded overview. */
export function searchHits(
  term: string,
  result: { addresses: IpamAddress[]; prefixes: IpamPrefix[] } | null,
  overview: Pick<IpamOverview, "vlans" | "sites">,
  onOpenAddress: (address: IpamAddress) => void,
  onOpenPrefix: (prefixId: string) => void,
  onOpenVlans: () => void,
): SearchHit[] {
  if (term.length < 2) return [];
  const sites = new Map(overview.sites.map((site) => [site.id, site.name]));
  const vlansById = new Map(overview.vlans.map((vlan) => [vlan.id, vlan]));
  const hits: SearchHit[] = [];
  for (const address of result?.addresses.slice(0, 8) ?? []) {
    hits.push({
      key: `a-${address.id}`,
      kind: "Adresse",
      title: address.address,
      sub: [
        address.hostname,
        ADDRESS_STATUS_LABEL[address.status],
        address.macAddress,
        address.switchName
          ? `${address.switchName}${address.switchPort ? ` Port ${address.switchPort}` : ""}`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
      open: () => onOpenAddress(address),
    });
  }
  for (const prefix of result?.prefixes.slice(0, 8) ?? []) {
    const vlan = prefix.vlanId ? vlansById.get(prefix.vlanId) : undefined;
    hits.push({
      key: `p-${prefix.id}`,
      kind: "Subnetz",
      title: prefix.prefix,
      sub: [
        prefix.description,
        vlan ? `VLAN ${vlan.vlanNumber}` : null,
        prefix.siteId ? sites.get(prefix.siteId) : null,
      ]
        .filter(Boolean)
        .join(" · "),
      open: () => onOpenPrefix(prefix.id),
    });
  }
  const lower = term.toLowerCase();
  const vlanHits = overview.vlans
    .filter(
      (vlan) =>
        String(vlan.vlanNumber) === term ||
        vlan.name.toLowerCase().includes(lower),
    )
    .slice(0, 5);
  for (const vlan of vlanHits) {
    const count = overview.vlans.filter(
      (other) => other.vlanNumber === vlan.vlanNumber,
    ).length;
    hits.push({
      key: `v-${vlan.id}`,
      kind: "VLAN",
      title: `${vlan.vlanNumber} ${vlan.name}`,
      sub: [
        vlan.siteId ? sites.get(vlan.siteId) : null,
        count > 1 ? `an ${count} Standorten` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      open: onOpenVlans,
    });
  }
  return hits;
}

export function DashboardView({
  dashboard,
  onOpenChanges,
  onOpenFindings,
  onOpenNetworks,
  onOpenPrefix,
}: { dashboard: Dashboard } & Pick<
  Props,
  "onOpenChanges" | "onOpenFindings" | "onOpenNetworks" | "onOpenPrefix"
>) {
  const { kpis } = dashboard;
  const now = new Date();
  return (
    <>
      <section aria-label="Kennzahlen" className="ipam-kpis">
        <div className="ipam-kpi">
          <span>Freie IPv4-Adressen</span>
          <strong>{formatCount(BigInt(Math.max(0, kpis.freeIpv4)))}</strong>
          <small>
            in {kpis.activePrefixes} aktiven{" "}
            {kpis.activePrefixes === 1 ? "Subnetz" : "Subnetzen"}
          </small>
        </div>
        <button className="ipam-kpi" onClick={onOpenNetworks} type="button">
          <span>Subnetze über Warnschwelle</span>
          <strong className={kpis.overThreshold ? "is-warn" : ""}>
            {kpis.overThreshold}
          </strong>
          <small>
            {kpis.fullWithin30Days
              ? `${kpis.fullWithin30Days} davon in unter 30 Tagen voll`
              : "keines in den nächsten 30 Tagen voll"}
          </small>
        </button>
        <button className="ipam-kpi" onClick={onOpenFindings} type="button">
          <span>Offene Funde</span>
          <strong className={kpis.openFindings ? "is-bad" : ""}>
            {kpis.openFindings}
          </strong>
          <small>
            {findingsSummary(kpis.findingsByKind) || "keine Abweichungen"}
          </small>
        </button>
        <div className="ipam-kpi">
          <span>Reservierungen laufen ab</span>
          <strong>{kpis.expiringReservations30Days}</strong>
          <small>in den nächsten 30 Tagen</small>
        </div>
      </section>

      <div className="ipam-columns">
        <section className="ipam-card ipam-columns__main">
          <div className="ipam-card__head">
            <h3>Am stärksten ausgelastet</h3>
            <button
              className="text-button"
              onClick={onOpenNetworks}
              type="button"
            >
              Alle Netze
            </button>
          </div>
          {dashboard.topUtilization.length === 0 ? (
            <p className="ipam-muted">Noch keine aktiven IPv4-Subnetze.</p>
          ) : (
            <div className="ipam-table-wrap">
              <table className="ipam-table ipam-table--wide">
                <thead>
                  <tr>
                    <th>Subnetz</th>
                    <th>VLAN</th>
                    <th>Standort</th>
                    <th className="ipam-col-meter">Auslastung</th>
                    <th>Prognose</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.topUtilization.map((entry) => {
                    const forecast = forecastLabel(entry.forecast);
                    return (
                      <tr key={entry.prefixId}>
                        <td>
                          <button
                            className="text-button ipam-mono"
                            onClick={() => onOpenPrefix(entry.prefixId)}
                            type="button"
                          >
                            {entry.prefix}
                          </button>
                          {entry.name ? <small> {entry.name}</small> : null}
                        </td>
                        <td>
                          {entry.vlanNumber !== null
                            ? `${entry.vlanNumber}${entry.vlanName ? ` ${entry.vlanName}` : ""}`
                            : "–"}
                        </td>
                        <td>{entry.siteName ?? "–"}</td>
                        <td>
                          <Meter label={entry.prefix} percent={entry.percent} />
                        </td>
                        <td className={`ipam-tone-${forecast.tone}`}>
                          {forecast.text}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="ipam-columns__side">
          <section className="ipam-card">
            <h3>Netzwerkagenten</h3>
            {dashboard.agents.length === 0 ? (
              <p className="ipam-muted">
                Noch kein Netzwerkagent eingerichtet (Verwaltung → Discovery
                &amp; Agenten).
              </p>
            ) : (
              <ul className="ipam-agent-list">
                {dashboard.agents.map((agent) => (
                  <li key={agent.id}>
                    <div>
                      <strong>{agent.name}</strong>
                      <small>
                        {[
                          agent.platform,
                          agent.lastSeenAt
                            ? `zuletzt ${formatRelative(agent.lastSeenAt)}`
                            : "noch nie gemeldet",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </div>
                    <Pill tone={AGENT_STATUS_TONE[agent.status]}>
                      {AGENT_STATUS_LABEL[agent.status]}
                    </Pill>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="ipam-card">
            <div className="ipam-card__head">
              <h3>Zuletzt geändert</h3>
              <button
                className="text-button"
                onClick={onOpenChanges}
                type="button"
              >
                Protokoll
              </button>
            </div>
            {dashboard.recentChanges.length === 0 ? (
              <p className="ipam-muted">Noch keine Änderungen protokolliert.</p>
            ) : (
              <ul className="ipam-recent">
                {dashboard.recentChanges.map((entry) => (
                  <li key={entry.id}>
                    <span>
                      <span className="ipam-mono">{entry.objectLabel}</span>{" "}
                      {entry.summary}
                    </span>
                    <small>
                      {changeActor(entry)} · {formatChangeTime(entry.at, now)}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
