// «Feedback-Auswertung mit KI» (web): contract of the feedback-insights edge
// function and small presentation helpers. Pure, no I/O.

export type FeedbackSentiment = "positive" | "neutral" | "negative" | "mixed";

export type RatingMonth = {
  month: string;
  count: number;
  average: number | null;
  distribution: number[];
  commentCount: number;
};

export type ThemeSummary = {
  key: string;
  label: string;
  count: number;
  share: number;
  sentiments: Record<FeedbackSentiment, number>;
};

export type FeedbackQuote = {
  themeKey: string;
  sentiment: FeedbackSentiment;
  quote: string;
};

export type FeedbackThemes = {
  totalMentions: number;
  top: ThemeSummary[];
  trend: { month: string; counts: Record<string, number> }[];
  quotes: FeedbackQuote[];
  pendingCount: number;
};

export type FeedbackReport = {
  aiEnabled: boolean;
  aiReason: string | null;
  months: string[];
  ratings: RatingMonth[];
  themes: FeedbackThemes | null;
  filters: {
    departments: { id: string; name: string }[];
    teams: { id: string; name: string; departmentId: string | null }[];
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function text(value: unknown, max = 500): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

function sentiment(value: unknown): FeedbackSentiment {
  return value === "positive" || value === "negative" || value === "mixed"
    ? value
    : "neutral";
}

const MONTH = /^\d{4}-\d{2}-01$/;

export function parseFeedbackReport(value: unknown): FeedbackReport | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const data = value.data;
  if (typeof data.aiEnabled !== "boolean" || !Array.isArray(data.months)) {
    return null;
  }
  const months = data.months.filter(
    (month): month is string => typeof month === "string" && MONTH.test(month),
  );
  const ratings = (Array.isArray(data.ratings) ? data.ratings : [])
    .filter(isRecord)
    .flatMap((row): RatingMonth[] => {
      const month = text(row.month, 10);
      if (!month || !MONTH.test(month)) return [];
      const distribution = Array.isArray(row.distribution)
        ? row.distribution.slice(0, 5).map(count)
        : [];
      while (distribution.length < 5) distribution.push(0);
      return [
        {
          month,
          count: count(row.count),
          average:
            typeof row.average === "number" && Number.isFinite(row.average)
              ? row.average
              : null,
          distribution,
          commentCount: count(row.commentCount),
        },
      ];
    });
  let themes: FeedbackThemes | null = null;
  if (isRecord(data.themes)) {
    const raw = data.themes;
    themes = {
      totalMentions: count(raw.totalMentions),
      pendingCount: count(raw.pendingCount),
      top: (Array.isArray(raw.top) ? raw.top : [])
        .filter(isRecord)
        .flatMap((row): ThemeSummary[] => {
          const key = text(row.key, 40);
          const label = text(row.label, 80);
          if (!key || !label) return [];
          const sentiments = isRecord(row.sentiments) ? row.sentiments : {};
          return [
            {
              key,
              label,
              count: count(row.count),
              share: count(row.share),
              sentiments: {
                positive: count(sentiments.positive),
                neutral: count(sentiments.neutral),
                negative: count(sentiments.negative),
                mixed: count(sentiments.mixed),
              },
            },
          ];
        }),
      trend: (Array.isArray(raw.trend) ? raw.trend : [])
        .filter(isRecord)
        .flatMap((row) => {
          const month = text(row.month, 10);
          if (!month) return [];
          const counts: Record<string, number> = {};
          if (isRecord(row.counts)) {
            for (const [key, value] of Object.entries(row.counts)) {
              counts[key] = count(value);
            }
          }
          return [{ month, counts }];
        }),
      quotes: (Array.isArray(raw.quotes) ? raw.quotes : [])
        .filter(isRecord)
        .flatMap((row): FeedbackQuote[] => {
          const themeKey = text(row.themeKey, 40);
          const quote = text(row.quote, 400);
          return themeKey && quote
            ? [{ themeKey, quote, sentiment: sentiment(row.sentiment) }]
            : [];
        }),
    };
  }
  const filters = isRecord(data.filters) ? data.filters : {};
  return {
    aiEnabled: data.aiEnabled,
    aiReason: text(data.aiReason, 80),
    months,
    ratings,
    themes: data.aiEnabled ? themes : null,
    filters: {
      departments: (Array.isArray(filters.departments)
        ? filters.departments
        : []
      )
        .filter(isRecord)
        .flatMap((row) => {
          const id = text(row.id, 64);
          const name = text(row.name, 200);
          return id && name ? [{ id, name }] : [];
        }),
      teams: (Array.isArray(filters.teams) ? filters.teams : [])
        .filter(isRecord)
        .flatMap((row) => {
          const id = text(row.id, 64);
          const name = text(row.name, 200);
          return id && name
            ? [{ id, name, departmentId: text(row.departmentId, 64) }]
            : [];
        }),
    },
  };
}

/** «Nov. 26» for YYYY-MM-01. */
export function monthLabel(month: string): string {
  const date = new Date(`${month}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return month;
  return date.toLocaleDateString("de-CH", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

export const SENTIMENT_LABELS: Record<FeedbackSentiment, string> = {
  positive: "positiv",
  neutral: "neutral",
  negative: "negativ",
  mixed: "gemischt",
};

/** Dominant sentiment of a theme (ties: negative before positive). */
export function dominantSentiment(
  sentiments: Record<FeedbackSentiment, number>,
): FeedbackSentiment {
  const order: FeedbackSentiment[] = [
    "negative",
    "positive",
    "mixed",
    "neutral",
  ];
  return order.reduce((best, current) =>
    sentiments[current] > sentiments[best] ? current : best,
  );
}

/** Teams for the filter: those of the selected department, or all. */
export function teamsForDepartment(
  teams: FeedbackReport["filters"]["teams"],
  departmentId: string | null,
): FeedbackReport["filters"]["teams"] {
  return departmentId
    ? teams.filter((team) => team.departmentId === departmentId)
    : teams;
}

/** Totals over all months of the ratings block. */
export function ratingTotals(ratings: readonly RatingMonth[]): {
  count: number;
  average: number | null;
  commentCount: number;
} {
  let sum = 0;
  let total = 0;
  let comments = 0;
  for (const month of ratings) {
    total += month.count;
    comments += month.commentCount;
    month.distribution.forEach((value, index) => {
      sum += value * (index + 1);
    });
  }
  return {
    count: total,
    average: total ? Math.round((sum / total) * 100) / 100 : null,
    commentCount: comments,
  };
}

export function aiReasonText(reason: string | null): string {
  switch (reason) {
    case "ai_provider_not_approved":
      return "Für diesen Mandanten ist keine KI-Providerfreigabe aktiv.";
    case "ai_purpose_not_approved":
      return "Der KI-Zweck «Allgemeine Entwürfe» ist nicht freigegeben.";
    case "ai_budget_exceeded":
      return "Der freigegebene KI-Rahmen reicht für die Auswertung nicht aus.";
    case "ai_governance_unavailable":
      return "Die KI-Governance ist derzeit nicht verfügbar.";
    default:
      return "Die KI-Unterstützung ist für diesen Mandanten ausgeschaltet.";
  }
}
