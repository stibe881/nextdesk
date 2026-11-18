// IPAM «Übersicht»: Live-Suche (auch kompakt im Kopf, Taste «/»),
// Kennzahlen mit Grafiken, Top-Auslastung mit Sparkline und Prognose,
// Agenten, zuletzt geändert.

import { Search } from "lucide-react";
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { tn } from "./lib/formality";
import { Meter, Pill, useDebounced, useIpamQuery, errorText } from "./ipam-ui";
import { RingGauge, Sparkline, StackedBar, type StackPart } from "./ipam-viz";
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
import type { Dashboard, UtilizationHistory } from "./lib/ipam-redesign-types";

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
  const trends = useTrends(
    props.tenantId,
    data?.topUtilization.map((entry) => entry.prefixId) ?? [],
    props.revision,
  );
  const kpis = props.overview.kpis;
  return (
    <div className="ipam-page">
      <LiveSearch
        onOpenAddress={props.onOpenAddress}
        onOpenPrefix={props.onOpenPrefix}
        onOpenVlans={props.onOpenVlans}
        overview={props.overview}
        tenantId={props.tenantId}
      />
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}
      {data ? (
        <DashboardView
          dashboard={data}
          onOpenChanges={props.onOpenChanges}
          onOpenFindings={props.onOpenFindings}
          onOpenNetworks={props.onOpenNetworks}
          onOpenPrefix={props.onOpenPrefix}
          trends={trends}
          usage={{ used: kpis.usedV4, capacity: kpis.capacityV4 }}
        />
      ) : !error ? (
        <div aria-hidden="true" className="ipam-skeleton ipam-skeleton--kpis" />
      ) : null}
    </div>
  );
}

/** 30-day utilization of the top subnets for the sparklines. */
function useTrends(
  tenantId: string,
  prefixIds: string[],
  revision: number,
): Record<string, number[]> {
  const [trends, setTrends] = useState<Record<string, number[]>>({});
  const key = prefixIds.join(",");
  useEffect(() => {
    if (!key) return;
    let active = true;
    void Promise.all(
      key.split(",").map((prefixId) =>
        ipamCall<UtilizationHistory>({
          type: "utilizationHistory",
          tenantId,
          prefixId,
          days: 30,
        })
          .then(
            (history) =>
              [prefixId, history.points.map((point) => point.percent)] as const,
          )
          .catch(() => [prefixId, [] as number[]] as const),
      ),
    ).then((entries) => {
      if (active) setTrends(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [key, tenantId, revision]);
  return trends;
}

export const LIVE_SEARCH_ID = "ipam-live-search";

/**
 * Live search over addresses, subnets and VLANs. «/» focuses it (handled by
 * the module shell), ↑/↓ choose a hit, Enter opens it, Escape clears.
 * `compact` is the variant in the module header.
 */
export function LiveSearch({
  compact = false,
  onOpenAddress,
  onOpenPrefix,
  onOpenVlans,
  overview,
  tenantId,
}: {
  compact?: boolean;
  onOpenAddress: (address: IpamAddress) => void;
  onOpenPrefix: (prefixId: string) => void;
  onOpenVlans: () => void;
  overview: Pick<IpamOverview, "vlans" | "sites">;
  tenantId: string;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(true);
  const term = useDebounced(query.trim(), 250);
  const listId = useId();
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
        if (active) {
          setResult(value);
          setActiveIndex(0);
        }
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
  const choose = (hit: SearchHit | undefined) => {
    if (!hit) return;
    hit.open();
    setOpen(false);
    if (compact) setQuery("");
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && hits.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % hits.length);
    } else if (event.key === "ArrowUp" && hits.length) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(hits[activeIndex] ?? hits[0]);
    } else if (event.key === "Escape") {
      if (query) setQuery("");
      else event.currentTarget.blur();
    }
  };
  const showResults =
    open && term.length >= 2 && Boolean(result || hits.length);

  return (
    <section
      className={`ipam-search${compact ? " ipam-search--compact" : " ipam-card"}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
      onFocus={() => setOpen(true)}
    >
      <label
        className={compact ? "sr-only" : "ipam-search__label"}
        htmlFor={LIVE_SEARCH_ID}
      >
        Suchen
      </label>
      <div className="ipam-search__field">
        <Search aria-hidden="true" size={compact ? 16 : 20} />
        <input
          aria-activedescendant={
            showResults && hits[activeIndex]
              ? `${listId}-${activeIndex}`
              : undefined
          }
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={showResults}
          autoComplete="off"
          id={LIVE_SEARCH_ID}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onKey}
          placeholder={
            compact
              ? "IP, MAC, Hostname, VLAN …"
              : "IP, MAC, Hostname, VLAN oder Subnetz – z. B. 10.20.30 oder SW016"
          }
          role="combobox"
          spellCheck={false}
          type="search"
          value={query}
        />
        <kbd
          aria-hidden="true"
          className="ipam-kbd"
          title="Taste / fokussiert die Suche"
        >
          /
        </kbd>
      </div>
      {error ? <p className="ipam-muted">{error}</p> : null}
      <div
        aria-label="Treffer"
        className="ipam-search__results"
        hidden={!showResults}
        id={listId}
        role="listbox"
      >
        {showResults
          ? hits.map((hit, index) => (
              <div
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "is-active" : ""}
                id={`${listId}-${index}`}
                key={hit.key}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(hit)}
                onMouseEnter={() => setActiveIndex(index)}
                role="option"
              >
                <span className="ipam-search__kind">{hit.kind}</span>
                <span className="ipam-mono ipam-search__title">
                  {hit.title}
                </span>
                <span className="ipam-search__sub">{hit.sub}</span>
              </div>
            ))
          : null}
        {showResults && result && hits.length === 0 ? (
          <p className="ipam-muted ipam-search__empty">
            Keine Treffer für «{term}».
          </p>
        ) : null}
        {showResults && hits.length ? (
          <p className="ipam-search__foot" aria-hidden="true">
            ↑ ↓ auswählen · Enter öffnen · Esc leeren
          </p>
        ) : null}
      </div>
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

const FINDING_TONE: Record<string, string> = {
  conflict: "conflict",
  foreign_mac: "conflict",
  ghost: "ghost",
  dns_mismatch: "dhcp",
  stale: "deprecated",
  utilization: "reserved",
  outside_prefix: "reserved",
};

const FINDING_NAME: Record<string, string> = {
  conflict: "Konflikte",
  foreign_mac: "Fremde MAC",
  ghost: "Ghost-IPs",
  dns_mismatch: "DNS",
  stale: "Veraltet",
  utilization: "Auslastung",
  outside_prefix: "Ausserhalb",
};

export function DashboardView({
  dashboard,
  onOpenChanges,
  onOpenFindings,
  onOpenNetworks,
  onOpenPrefix,
  trends = {},
  usage,
}: {
  dashboard: Dashboard;
  /** 30-day percent values per prefix id (sparklines). */
  trends?: Record<string, number[]>;
  /** Used/total IPv4 of all active subnets (ring of the first KPI). */
  usage?: { used: number; capacity: string };
} & Pick<
  Props,
  "onOpenChanges" | "onOpenFindings" | "onOpenNetworks" | "onOpenPrefix"
>) {
  const { kpis } = dashboard;
  const now = new Date();
  const capacity = usage ? Number(usage.capacity || "0") : 0;
  const usedPercent =
    usage && capacity > 0
      ? Math.round((usage.used / capacity) * 1000) / 10
      : null;
  const findingParts: StackPart[] = Object.entries(kpis.findingsByKind)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => ({
      key: kind,
      label: FINDING_NAME[kind] ?? kind,
      count,
      tone: FINDING_TONE[kind] ?? "deprecated",
    }));
  return (
    <>
      <section aria-label="Kennzahlen" className="ipam-kpis">
        <div className="ipam-kpi ipam-kpi--visual">
          <div>
            <span>Freie IPv4-Adressen</span>
            <strong>{formatCount(BigInt(Math.max(0, kpis.freeIpv4)))}</strong>
            <small>
              in {kpis.activePrefixes} aktiven{" "}
              {kpis.activePrefixes === 1 ? "Subnetz" : "Subnetzen"}
            </small>
          </div>
          {usedPercent !== null ? (
            <RingGauge
              caption="belegt"
              label="Alle aktiven IPv4-Subnetze"
              percent={usedPercent}
              size={64}
            />
          ) : null}
        </div>
        <button className="ipam-kpi" onClick={onOpenNetworks} type="button">
          <span>Subnetze über Warnschwelle</span>
          <strong className={kpis.overThreshold ? "is-warn" : ""}>
            {kpis.overThreshold}
          </strong>
          <span
            aria-hidden="true"
            className="ipam-kpi__ratio"
            title={`${kpis.overThreshold} von ${kpis.activePrefixes}`}
          >
            <span
              style={{
                width: `${kpis.activePrefixes ? Math.min(100, (kpis.overThreshold / kpis.activePrefixes) * 100) : 0}%`,
              }}
            />
          </span>
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
          {findingParts.length ? (
            <StackedBar label="Funde nach Art" parts={findingParts} />
          ) : null}
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
            <p className="ipam-empty">
              {tn(
                "Noch keine aktiven IPv4-Subnetze. Lege unter «Netze» ein Subnetz an oder importiere bestehende Listen.",
                "Noch keine aktiven IPv4-Subnetze. Legen Sie unter «Netze» ein Subnetz an oder importieren Sie bestehende Listen.",
              )}
            </p>
          ) : (
            <ul className="ipam-top">
              {dashboard.topUtilization.map((entry) => {
                const forecast = forecastLabel(entry.forecast);
                const trend = trends[entry.prefixId] ?? [];
                return (
                  <li key={entry.prefixId}>
                    <button
                      className="ipam-top__row"
                      onClick={() => onOpenPrefix(entry.prefixId)}
                      type="button"
                    >
                      <span className="ipam-top__name">
                        <span className="ipam-mono">{entry.prefix}</span>
                        <small>
                          {[
                            entry.name,
                            entry.vlanNumber !== null
                              ? `${entry.vlanNumber}${entry.vlanName ? ` ${entry.vlanName}` : ""}`
                              : null,
                            entry.siteName,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </span>
                      <span className="ipam-top__meter">
                        <Meter label={entry.prefix} percent={entry.percent} />
                      </span>
                      <span className="ipam-top__spark">
                        {trend.length > 1 ? (
                          <Sparkline
                            label={`Verlauf ${entry.prefix}`}
                            values={trend}
                          />
                        ) : (
                          <span
                            aria-hidden="true"
                            className="ipam-spark ipam-spark--empty"
                          />
                        )}
                      </span>
                      <span
                        className={`ipam-top__forecast ipam-chip ipam-chip--tone-${forecast.tone}`}
                      >
                        {forecast.text}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="ipam-columns__side">
          <section className="ipam-card">
            <h3>Netzwerkagenten</h3>
            {dashboard.agents.length === 0 ? (
              <p className="ipam-empty">
                Noch kein Netzwerkagent eingerichtet (Verwaltung → Discovery
                &amp; Agenten).
              </p>
            ) : (
              <ul className="ipam-agent-list">
                {dashboard.agents.map((agent) => (
                  <li key={agent.id}>
                    <i
                      aria-hidden="true"
                      className={`ipam-status-dot ipam-status-dot--${AGENT_STATUS_TONE[agent.status]}`}
                    />
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
              <p className="ipam-empty">Noch keine Änderungen protokolliert.</p>
            ) : (
              <ol className="ipam-recent ipam-recent--timeline">
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
              </ol>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
