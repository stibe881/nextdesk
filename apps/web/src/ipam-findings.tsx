// IPAM «Funde»: Funde der Discovery, Soll/Ist-Vergleich und
// Änderungsprotokoll mit «Rückgängig».

import { Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Notice,
  Segmented,
  errorText,
  useIpamQuery,
  type IpamDrawer,
} from "./ipam-ui";
import { ipamCall } from "./lib/ipam-api";
import {
  ACTION_LABEL,
  OBJECT_TYPE_LABEL,
  SOURCE_LABEL,
  changeActor,
  changeDiff,
  formatChangeTime,
} from "./lib/ipam-format";
import {
  FINDING_GROUPS,
  FINDING_KIND_LABEL,
  formatRelative,
  type FindingKind,
  type IpamFinding,
} from "./lib/ipam-model";
import type {
  ChangeLogEntry,
  ChangeLogPage,
  ChangeSource,
  CompareObserved,
  ObjectType,
} from "./lib/ipam-redesign-types";

export type FindingsMode = "findings" | "compare" | "changes";

type Props = {
  canManage: boolean;
  mode: FindingsMode;
  onChanged: (message?: string) => void;
  onMode: (mode: FindingsMode) => void;
  onOpenAddress: (drawer: IpamDrawer) => void;
  onOpenDiscovery: () => void;
  onOpenPrefix: (prefixId: string) => void;
  onOpenTicket: ((ticketId: string) => void) | undefined;
  revision: number;
  tenantId: string;
};

export function IpamFindingsPage(props: Props) {
  return (
    <div className="ipam-page">
      <div className="ipam-toolbar ipam-toolbar--plain">
        <Segmented
          label="Ansicht"
          onChange={props.onMode}
          options={[
            { value: "findings", label: "Funde" },
            { value: "compare", label: "Soll / Ist" },
            { value: "changes", label: "Änderungsprotokoll" },
          ]}
          value={props.mode}
        />
        <span className="ipam-toolbar__spacer" />
        <button
          className="secondary-button"
          onClick={props.onOpenDiscovery}
          type="button"
        >
          Discovery &amp; Agenten
        </button>
      </div>
      {props.mode === "findings" ? <FindingsList {...props} /> : null}
      {props.mode === "compare" ? <CompareView {...props} /> : null}
      {props.mode === "changes" ? <ChangeLogView {...props} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Findings

const KIND_TONE: Record<FindingKind, string> = {
  conflict: "danger",
  foreign_mac: "danger",
  ghost: "warning",
  dns_mismatch: "info",
  stale: "neutral",
  utilization: "warning",
  outside_prefix: "neutral",
};

const KIND_SHORT: Record<FindingKind, string> = {
  conflict: "Konflikt",
  foreign_mac: "Fremde MAC",
  ghost: "Ghost-IP",
  dns_mismatch: "DNS",
  stale: "Veraltet",
  utilization: "Auslastung",
  outside_prefix: "Ausserhalb",
};

/** Readable details of a finding (MAC, vendor, switch …). */
export function findingDetailText(details: Record<string, unknown>): string {
  const labels: Record<string, string> = {
    mac: "MAC",
    macAddress: "MAC",
    vendor: "Hersteller",
    hostname: "Hostname",
    dnsName: "DNS",
    switchName: "Switch",
    switchPort: "Port",
    source: "Quelle",
    message: "",
  };
  return Object.entries(details)
    .filter(
      ([, value]) => typeof value === "string" || typeof value === "number",
    )
    .slice(0, 6)
    .map(([key, value]) => {
      const label = labels[key] ?? key;
      return label ? `${label}: ${String(value)}` : String(value);
    })
    .join(" · ");
}

function FindingsList({
  onChanged,
  onOpenAddress,
  onOpenTicket,
  revision,
  tenantId,
}: Props) {
  const [status, setStatus] = useState<"open" | "resolved" | "ignored" | "all">(
    "open",
  );
  const [group, setGroup] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useIpamQuery<{ canManage: boolean; findings: IpamFinding[] }>(
    { type: "findings", tenantId, status },
    `${tenantId}-${status}-${revision}`,
  );
  const findings = query.data?.findings ?? [];
  const canManage = query.data?.canManage === true;
  const activeGroup = FINDING_GROUPS.find((entry) => entry.label === group);
  const visible = activeGroup
    ? findings.filter((finding) => activeGroup.kinds.includes(finding.kind))
    : findings;

  const act = async (
    id: string,
    body: Record<string, unknown>,
    message: string,
  ) => {
    setBusyId(id);
    setError(null);
    try {
      const result = await ipamCall<{
        ticketId?: string;
        ticketNumber?: string;
      }>({
        ...body,
        tenantId,
      });
      if (result.ticketId) onOpenTicket?.(result.ticketId);
      onChanged(
        result.ticketNumber
          ? `Ticket ${result.ticketNumber} erstellt.`
          : message,
      );
    } catch (failure) {
      setError(
        errorText(failure, "Die Aktion konnte nicht ausgeführt werden."),
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="ipam-card">
      <div className="ipam-card__head ipam-card__head--wrap">
        <div aria-label="Art" className="ipam-chips" role="group">
          <button
            className={group === null ? "is-active" : ""}
            onClick={() => setGroup(null)}
            type="button"
          >
            Alle <span>{findings.length}</span>
          </button>
          {FINDING_GROUPS.map((entry) => {
            const count = findings.filter((finding) =>
              entry.kinds.includes(finding.kind),
            ).length;
            if (!count && group !== entry.label) return null;
            return (
              <button
                className={group === entry.label ? "is-active" : ""}
                key={entry.label}
                onClick={() => setGroup(entry.label)}
                type="button"
              >
                {entry.label} <span>{count}</span>
              </button>
            );
          })}
        </div>
        <select
          aria-label="Status"
          onChange={(event) => setStatus(event.target.value as typeof status)}
          value={status}
        >
          <option value="open">Offen</option>
          <option value="resolved">Erledigt</option>
          <option value="ignored">Ignoriert</option>
          <option value="all">Alle</option>
        </select>
      </div>
      <Notice error={error ?? query.error} />
      {!query.data && !query.error ? (
        <p className="ipam-muted">Wird geladen …</p>
      ) : null}
      {query.data && visible.length === 0 ? (
        <p className="ipam-muted">
          {status === "open"
            ? "Keine offenen Funde. Funde entstehen, sobald die Discovery Abweichungen meldet."
            : "Keine Funde."}
        </p>
      ) : null}
      <ul className="ipam-findings2">
        {visible.map((finding) => (
          <li key={finding.id}>
            <span
              className={`ipam-kind ipam-kind--${KIND_TONE[finding.kind] ?? "neutral"}`}
              title={FINDING_KIND_LABEL[finding.kind] ?? finding.kind}
            >
              {KIND_SHORT[finding.kind] ?? finding.kind}
            </span>
            <button
              className="text-button ipam-mono ipam-findings2__ip"
              onClick={() =>
                onOpenAddress({
                  addressId: finding.addressId,
                  ip: finding.addressId ? null : finding.address,
                  vrfId: finding.vrfId,
                })
              }
              type="button"
            >
              {finding.address}
            </button>
            <span className="ipam-findings2__text">
              {[
                FINDING_KIND_LABEL[finding.kind],
                findingDetailText(finding.details),
                finding.prefix ? `in ${finding.prefix}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <small className="ipam-muted">
              {formatRelative(finding.lastSeenAt ?? finding.firstSeenAt)}
            </small>
            <span className="ipam-findings2__actions">
              {finding.ticketId ? (
                <button
                  className="text-button"
                  onClick={() => onOpenTicket?.(finding.ticketId!)}
                  type="button"
                >
                  {finding.ticketNumber ?? "Ticket"}
                </button>
              ) : null}
              {canManage && finding.status === "open" ? (
                <>
                  {finding.kind === "ghost" ||
                  finding.kind === "outside_prefix" ? (
                    <button
                      className="primary-button"
                      disabled={busyId === finding.id}
                      onClick={() =>
                        void act(
                          finding.id,
                          { type: "adoptFinding", findingId: finding.id },
                          `${finding.address} übernommen.`,
                        )
                      }
                      type="button"
                    >
                      Übernehmen
                    </button>
                  ) : null}
                  {!finding.ticketId ? (
                    <button
                      className="secondary-button"
                      disabled={busyId === finding.id}
                      onClick={() =>
                        void act(
                          finding.id,
                          { type: "findingTicket", findingId: finding.id },
                          "Ticket erstellt.",
                        )
                      }
                      type="button"
                    >
                      Ticket
                    </button>
                  ) : null}
                  <button
                    className="secondary-button"
                    disabled={busyId === finding.id}
                    onClick={() =>
                      void act(
                        finding.id,
                        {
                          type: "resolveFinding",
                          findingId: finding.id,
                          status: "resolved",
                        },
                        "Fund erledigt.",
                      )
                    }
                    type="button"
                  >
                    Erledigt
                  </button>
                  <button
                    className="text-button"
                    disabled={busyId === finding.id}
                    onClick={() =>
                      void act(
                        finding.id,
                        {
                          type: "resolveFinding",
                          findingId: finding.id,
                          status: "ignored",
                        },
                        "Fund ignoriert.",
                      )
                    }
                    type="button"
                  >
                    Ignorieren
                  </button>
                </>
              ) : null}
              {canManage && finding.status !== "open" ? (
                <button
                  className="text-button"
                  disabled={busyId === finding.id}
                  onClick={() =>
                    void act(
                      finding.id,
                      {
                        type: "resolveFinding",
                        findingId: finding.id,
                        status: "open",
                      },
                      "Fund wieder geöffnet.",
                    )
                  }
                  type="button"
                >
                  Wieder öffnen
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Soll / Ist

function CompareView({ onOpenPrefix, revision, tenantId }: Props) {
  const query = useIpamQuery<CompareObserved>(
    { type: "compareObserved", tenantId },
    `${tenantId}-${revision}`,
  );
  const data = query.data;
  return (
    <section className="ipam-card">
      <div className="ipam-card__head ipam-card__head--wrap">
        <p className="ipam-muted">
          Vergleich der Dokumentation mit dem, was die Netzwerkagenten in den
          letzten 7 Tagen gesehen haben.
        </p>
        {data ? (
          <span className="ipam-muted">
            Letzter Scan:{" "}
            {data.lastScanAt ? formatRelative(data.lastScanAt) : "noch keiner"}
          </span>
        ) : null}
      </div>
      <Notice error={query.error} />
      {!data && !query.error ? (
        <p className="ipam-muted">Wird geladen …</p>
      ) : null}
      {data && data.rows.length === 0 ? (
        <p className="ipam-muted">
          Noch keine Beobachtungen. Sobald ein Netzwerkagent scannt, erscheint
          hier der Abgleich je Subnetz.
        </p>
      ) : null}
      {data && data.rows.length ? (
        <div className="ipam-table-wrap">
          <table className="ipam-table ipam-table--wide">
            <thead>
              <tr>
                <th>Subnetz</th>
                <th>Dokumentiert</th>
                <th>Gesehen</th>
                <th className="ipam-col-meter">Übereinstimmung</th>
                <th>Nur gesehen</th>
                <th>Nur dokumentiert</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.prefixId}>
                  <td>
                    <button
                      className="text-button ipam-mono"
                      onClick={() => onOpenPrefix(row.prefixId)}
                      type="button"
                    >
                      {row.prefix}
                    </button>
                    {row.name ? <small> {row.name}</small> : null}
                  </td>
                  <td>{row.documented}</td>
                  <td>{row.seen}</td>
                  <td>
                    <MatchMeter percent={row.matchPercent} />
                  </td>
                  <td
                    className={
                      row.onlySeen ? "ipam-tone-warning ipam-strong" : ""
                    }
                  >
                    {row.onlySeen || "–"}
                  </td>
                  <td className="ipam-muted-cell">
                    {row.onlyDocumented || "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

/** Match: green from 95 %, yellow from 85 %, otherwise red (inverse). */
function MatchMeter({ percent }: { percent: number | null }) {
  if (percent === null) return <span className="ipam-muted">–</span>;
  const tone = percent >= 95 ? "ok" : percent >= 85 ? "warning" : "danger";
  return (
    <span className={`ipam-meter ipam-meter--${tone}`}>
      <span
        aria-label={`Übereinstimmung ${Math.round(percent)} %`}
        className="ipam-meter__track"
        role="img"
      >
        <span
          className="ipam-meter__fill"
          style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
        />
      </span>
      <span className="ipam-meter__text">{Math.round(percent)} %</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Change log

const PERIODS = [
  { value: "30", label: "Letzte 30 Tage" },
  { value: "7", label: "Letzte 7 Tage" },
  { value: "all", label: "Alles" },
] as const;

/** Request body of the change log for the chosen filters. */
export function changeLogRequest(
  objectType: ObjectType | "",
  source: ChangeSource | "",
  period: string,
  before: number | null,
  now = Date.now(),
): Record<string, unknown> {
  const body: Record<string, unknown> = { limit: 50 };
  if (objectType) body.objectType = objectType;
  if (source) body.source = source;
  if (period !== "all") {
    body.since = new Date(now - Number(period) * 86_400_000).toISOString();
  }
  if (before !== null) body.before = before;
  return body;
}

function ChangeLogView({ canManage, onChanged, revision, tenantId }: Props) {
  const [objectType, setObjectType] = useState<ObjectType | "">("");
  const [source, setSource] = useState<ChangeSource | "">("");
  const [period, setPeriod] = useState<string>("30");
  const [entries, setEntries] = useState<ChangeLogEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = async (before: number | null) => {
    setLoading(true);
    setError(null);
    try {
      const page = await ipamCall<ChangeLogPage>({
        type: "changeLog",
        tenantId,
        ...changeLogRequest(objectType, source, period, before),
      });
      setEntries((current) =>
        before === null ? page.entries : [...current, ...page.entries],
      );
      setNextBefore(page.nextBefore);
    } catch (failure) {
      setError(
        errorText(
          failure,
          "Das Änderungsprotokoll konnte nicht geladen werden.",
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectType, source, period, revision, tenantId]);

  const undo = async (entry: ChangeLogEntry) => {
    if (
      !window.confirm(
        `Änderung an ${entry.objectLabel} rückgängig machen?\n${changeDiff(entry)}`,
      )
    )
      return;
    setBusyId(entry.id);
    setError(null);
    setMessage(null);
    try {
      await ipamCall({ type: "undoChange", tenantId, entryId: entry.id });
      setMessage(`Änderung an ${entry.objectLabel} rückgängig gemacht.`);
      onChanged();
    } catch (failure) {
      setError(
        errorText(
          failure,
          "Die Änderung konnte nicht rückgängig gemacht werden.",
        ),
      );
    } finally {
      setBusyId(null);
    }
  };
  const now = new Date();

  return (
    <section className="ipam-card">
      <div className="ipam-filters">
        <select
          aria-label="Objekt"
          onChange={(event) =>
            setObjectType(event.target.value as ObjectType | "")
          }
          value={objectType}
        >
          <option value="">Alle Objekte</option>
          {(Object.keys(OBJECT_TYPE_LABEL) as ObjectType[]).map((key) => (
            <option key={key} value={key}>
              {OBJECT_TYPE_LABEL[key]}
            </option>
          ))}
        </select>
        <select
          aria-label="Herkunft"
          onChange={(event) =>
            setSource(event.target.value as ChangeSource | "")
          }
          value={source}
        >
          <option value="">Alle Herkünfte</option>
          {(Object.keys(SOURCE_LABEL) as ChangeSource[]).map((key) => (
            <option key={key} value={key}>
              {key === "user" ? "Personen" : SOURCE_LABEL[key]}
            </option>
          ))}
        </select>
        <select
          aria-label="Zeitraum"
          onChange={(event) => setPeriod(event.target.value)}
          value={period}
        >
          {PERIODS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>
      <Notice error={error} message={message} />
      {!loading && entries.length === 0 && !error ? (
        <p className="ipam-muted">Keine Änderungen in diesem Zeitraum.</p>
      ) : null}
      <ol className="ipam-log">
        {entries.map((entry) => (
          <li key={entry.id}>
            <time dateTime={entry.at}>{formatChangeTime(entry.at, now)}</time>
            <div>
              <span>
                <b>{changeActor(entry)}</b> {ACTION_LABEL[entry.action]}{" "}
                <span className="ipam-mono">{entry.objectLabel}</span>
              </span>
              <small className="ipam-muted">{changeDiff(entry)}</small>
            </div>
            {canManage && entry.undoable ? (
              <button
                className="secondary-button"
                disabled={busyId !== null}
                onClick={() => void undo(entry)}
                type="button"
              >
                <Undo2 aria-hidden="true" size={15} />
                {busyId === entry.id ? "Wird zurückgenommen …" : "Rückgängig"}
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      {loading ? <p className="ipam-muted">Wird geladen …</p> : null}
      {nextBefore !== null && !loading ? (
        <button
          className="secondary-button"
          onClick={() => void load(nextBefore)}
          type="button"
        >
          Ältere Einträge laden
        </button>
      ) : null}
    </section>
  );
}
