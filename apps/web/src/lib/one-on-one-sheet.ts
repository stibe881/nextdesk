/** Printable conversation sheet for a 1:1 between supervisor and agent. */
export type SheetMetrics = {
  ticketsResolved: number;
  averageFirstResponseMinutes: number | null;
  averageResolutionMinutes: number | null;
  slaCompliancePercent: number | null;
  satisfactionAverage: number | null;
  qualityAverage: number | null;
  knowledgeArticles: number;
};
export type SheetNote = { kind: string; body: string; createdAt: string };
export type SheetReview = {
  rating: number;
  solutionCorrect: boolean;
  toneAppropriate: boolean;
  documentationOk: boolean | null;
  comment: string | null;
  ticketNumber: string | null;
  createdAt: string;
};

const escape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const day = (value: string) =>
  new Date(value).toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

function duration(minutes: number | null): string {
  if (minutes === null) return "–";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 48) return `${Math.round(minutes / 6) / 10} h`;
  return `${Math.round(minutes / 144) / 10} Tage`;
}

/** Arrow for a change: better ↑ / worse ↓ / equal →, «higher is better» or not. */
export function trendArrow(
  current: number | null,
  previous: number | null,
  higherIsBetter: boolean,
): string {
  if (current === null || previous === null || current === previous) return "→";
  const better = higherIsBetter ? current > previous : current < previous;
  return better ? "↑" : "↓";
}

const KIND_LABEL: Record<string, string> = {
  note: "Notiz",
  praise: "Lob",
  goal: "Ziel",
  concern: "Anliegen",
};

export function buildOneOnOneSheet(input: {
  agentName: string;
  supervisorName: string;
  monthLabel: string;
  current: SheetMetrics | null;
  previous: SheetMetrics | null;
  notes: SheetNote[];
  reviews: SheetReview[];
}): string {
  const { current, previous } = input;
  const row = (label: string, value: string, arrow: string) =>
    `<tr><th>${escape(label)}</th><td>${escape(value)}</td><td class="arrow">${arrow}</td></tr>`;
  const metrics = current
    ? [
        row(
          "Gelöste Tickets",
          String(current.ticketsResolved),
          trendArrow(
            current.ticketsResolved,
            previous?.ticketsResolved ?? null,
            true,
          ),
        ),
        row(
          "Erste Antwort (Ø)",
          duration(current.averageFirstResponseMinutes),
          trendArrow(
            current.averageFirstResponseMinutes,
            previous?.averageFirstResponseMinutes ?? null,
            false,
          ),
        ),
        row(
          "Lösungszeit (Ø)",
          duration(current.averageResolutionMinutes),
          trendArrow(
            current.averageResolutionMinutes,
            previous?.averageResolutionMinutes ?? null,
            false,
          ),
        ),
        row(
          "SLA eingehalten",
          current.slaCompliancePercent === null
            ? "–"
            : `${current.slaCompliancePercent} %`,
          trendArrow(
            current.slaCompliancePercent,
            previous?.slaCompliancePercent ?? null,
            true,
          ),
        ),
        row(
          "Zufriedenheit (Ø)",
          current.satisfactionAverage === null
            ? "–"
            : String(current.satisfactionAverage),
          trendArrow(
            current.satisfactionAverage,
            previous?.satisfactionAverage ?? null,
            true,
          ),
        ),
        row(
          "Qualitätsbewertung (Ø)",
          current.qualityAverage === null
            ? "–"
            : `${current.qualityAverage} / 5`,
          trendArrow(
            current.qualityAverage,
            previous?.qualityAverage ?? null,
            true,
          ),
        ),
        row("Wissensartikel", String(current.knowledgeArticles), "→"),
      ].join("")
    : `<tr><td colspan="3">Keine Kennzahlen für diesen Monat.</td></tr>`;
  const goals = input.notes.filter((note) => note.kind === "goal");
  const others = input.notes
    .filter((note) => note.kind !== "goal")
    .slice(0, 12);
  const list = (items: SheetNote[], empty: string) =>
    items.length
      ? `<ul>${items
          .map(
            (note) =>
              `<li><span class="meta">${day(note.createdAt)} · ${escape(KIND_LABEL[note.kind] ?? note.kind)}</span>${escape(note.body)}</li>`,
          )
          .join("")}</ul>`
      : `<p class="empty">${escape(empty)}</p>`;
  const reviews = input.reviews.slice(0, 8);
  return `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><title>Gesprächsblatt ${escape(input.agentName)}</title>
<style>
body{font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#17233f;margin:32px;font-size:12px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:22px 0 8px;border-bottom:1px solid #dfe5ef;padding-bottom:4px}
.sub{color:#59677c;margin:0 0 12px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:5px 6px;border-bottom:1px solid #eef1f6}
th{font-weight:600;width:45%}.arrow{width:30px;text-align:center;font-weight:700}ul{margin:0;padding-left:18px}li{margin:4px 0}
.meta{display:block;color:#59677c;font-size:10px}.empty{color:#59677c}.lines div{border-bottom:1px solid #c9d1de;height:24px}
@media print{body{margin:14mm}}
</style></head><body>
<h1>Gesprächsblatt: ${escape(input.agentName)}</h1>
<p class="sub">${escape(input.monthLabel)} · vorbereitet von ${escape(input.supervisorName)} · ${day(new Date().toISOString())}</p>
<h2>Kennzahlen (Trend zum Vormonat)</h2><table>${metrics}</table>
<h2>Ziele</h2>${list(goals, "Noch keine Ziele erfasst.")}
<h2>Notizen, Lob und Anliegen</h2>${list(others, "Keine Notizen.")}
<h2>Letzte Qualitätsprüfungen</h2>${
    reviews.length
      ? `<table>${reviews
          .map(
            (review) =>
              `<tr><th>${escape(review.ticketNumber ?? "Ticket")} · ${day(review.createdAt)}</th><td>${review.rating} / 5 · ${review.solutionCorrect ? "Lösung korrekt" : "Lösung prüfen"} · ${review.toneAppropriate ? "Ton passend" : "Ton prüfen"}${review.documentationOk === false ? " · Dokumentation lückenhaft" : ""}${review.comment ? ` · ${escape(review.comment)}` : ""}</td><td></td></tr>`,
          )
          .join("")}</table>`
      : `<p class="empty">Keine Qualitätsprüfungen.</p>`
  }
<h2>Gesprächsnotizen</h2><div class="lines"><div></div><div></div><div></div><div></div><div></div><div></div></div>
<h2>Vereinbarungen</h2><div class="lines"><div></div><div></div><div></div><div></div></div>
</body></html>`;
}
