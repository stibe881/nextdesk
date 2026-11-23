import { useEffect, useId, useState } from "react";
import { supabase } from "./lib/supabase";

type MergeStats = {
  days: number;
  total: number;
  unmerged: number;
  bySource: { label: string; count: number }[];
  byMethod: { label: string; count: number }[];
  topRequesters: { label: string; count: number }[];
};

const SOURCE_LABELS: Record<string, string> = {
  email: "E-Mail",
  portal: "Portal",
  phone: "Telefon",
  api: "Schnittstelle",
  automation: "Automation",
  unbekannt: "Unbekannt",
};

const METHOD_LABELS: Record<string, string> = {
  manual: "Von Hand im Ticket",
  bulk: "Mehrfachauswahl",
  ai_triage: "KI-Triage",
  auto_exact: "Automatisch (eindeutiges Duplikat)",
};

function entries(
  value: unknown,
  key: string,
  labels: Record<string, string> = {},
): { label: string; count: number }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const row = item as Record<string, unknown>;
    const raw = typeof row[key] === "string" ? (row[key] as string) : "";
    const count = typeof row.count === "number" ? row.count : 0;
    if (!raw || count <= 0) return [];
    return [{ label: labels[raw] ?? raw, count }];
  });
}

export function parseMergeStats(value: unknown): MergeStats | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.total !== "number") return null;
  return {
    days: typeof row.days === "number" ? row.days : 90,
    total: row.total,
    unmerged: typeof row.unmerged === "number" ? row.unmerged : 0,
    bySource: entries(row.bySource, "source", SOURCE_LABELS),
    byMethod: entries(row.byMethod, "method", METHOD_LABELS),
    topRequesters: entries(row.topRequesters, "name"),
  };
}

function daysOf(range: { startsAt: string; endsAt: string }): number {
  const span = Date.parse(range.endsAt) - Date.parse(range.startsAt);
  return Number.isFinite(span) && span > 0
    ? Math.min(730, Math.max(1, Math.ceil(span / 86_400_000)))
    : 90;
}

/**
 * Zusammengeführte Tickets im Service-Reporting: wie viele Duplikate
 * entstehen, über welchen Kanal und bei welchen Personen gehäuft.
 */
export function MergeReportPanel({
  range,
  tenantId,
}: {
  range: { startsAt: string; endsAt: string };
  tenantId: string;
}) {
  const headingId = useId();
  const days = daysOf(range);
  const key = `${tenantId}|${days}`;
  const [state, setState] = useState<{
    key: string;
    stats: MergeStats | null;
  } | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase
      .rpc("ticket_merge_stats", { p_tenant_id: tenantId, p_days: days })
      .then(({ data, error }) => {
        if (active)
          setState({ key, stats: error ? null : parseMergeStats(data) });
      });
    return () => {
      active = false;
    };
    // days and tenantId are part of key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = state?.key === key ? state : null;
  // Ohne Daten (z. B. ältere Datenbank) bleibt der Bereich ausgeblendet.
  if (current && !current.stats) return null;
  const stats = current?.stats ?? null;

  const list = (title: string, rows: { label: string; count: number }[]) =>
    rows.length ? (
      <>
        <h3 className="service-reporting__row-label">{title}</h3>
        <ul className="service-reporting__list">
          {rows.map((row) => (
            <li key={row.label}>
              <div className="service-reporting__row">
                <div className="service-reporting__row-label">{row.label}</div>
                <strong>{row.count}</strong>
              </div>
            </li>
          ))}
        </ul>
      </>
    ) : null;

  return (
    <section
      aria-labelledby={`${headingId}-merges`}
      className="service-reporting__panel"
    >
      <div className="service-reporting__section-heading">
        <div>
          <h2 id={`${headingId}-merges`}>Zusammengeführte Tickets</h2>
          <p className="service-reporting__detail">
            Duplikate der letzten {days} Tage: Kanal, Art und Personen mit den
            meisten Mehrfachmeldungen.
          </p>
        </div>
      </div>
      {!stats ? (
        <p className="service-reporting__empty" role="status">
          Statistik wird geladen …
        </p>
      ) : stats.total === 0 ? (
        <p className="service-reporting__empty">
          Im Zeitraum wurden keine Tickets zusammengeführt.
        </p>
      ) : (
        <>
          <p className="service-reporting__time-total">
            <strong>{stats.total}</strong>{" "}
            {stats.total === 1 ? "Ticket" : "Tickets"} zusammengeführt
            {stats.unmerged > 0 ? (
              <>
                <br />
                <span className="service-reporting__comparison">
                  {stats.unmerged} Zusammenführungen wurden wieder aufgehoben
                </span>
              </>
            ) : null}
          </p>
          {list("Nach Eingangskanal", stats.bySource)}
          {list("Nach Art", stats.byMethod)}
          {list("Häufigste Mehrfachmeldungen", stats.topRequesters)}
        </>
      )}
    </section>
  );
}
