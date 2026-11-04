/**
 * Pure report computations for the predefined service desk reports
 * (Servicedesk-Trends, Servicedesk-Übersicht, Mitarbeiterzufriedenheit,
 * Agentenleistung). The handler loads tenant-scoped, team-filtered rows; this
 * module only aggregates them so it can be tested without a database.
 */

export type InsightTicket = {
  id: string;
  assignedTeamId: string | null;
  assignedAgentId: string | null;
  requesterId: string | null;
  source: string | null;
  createdAt: string;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  responseDueAt: string | null;
  resolutionDueAt: string | null;
};

export type InsightComment = {
  ticketId: string;
  authorId: string | null;
  external: boolean;
  createdAt: string;
};

export type InsightRating = {
  ticketId: string;
  score: number;
  submittedAt: string;
};

export type InsightRange = { startsAt: string; endsAt: string };

type Mood = "happy" | "neutral" | "unhappy";

const SOURCES = ["email", "portal", "phone", "api", "automation"] as const;
const DAY_MS = 24 * 60 * 60 * 1_000;

function time(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function within(value: string | null, range: InsightRange): boolean {
  const at = time(value);
  return (
    at !== null &&
    at >= Date.parse(range.startsAt) &&
    at <= Date.parse(range.endsAt)
  );
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return (
    Math.round(
      (values.reduce((sum, value) => sum + value, 0) / values.length) * 100,
    ) / 100
  );
}

function percent(part: number, total: number): number | null {
  return total === 0 ? null : Math.round((part / total) * 10_000) / 100;
}

function minutesBetween(start: string | null, end: string | null) {
  const from = time(start);
  const to = time(end);
  return from === null || to === null || to < from
    ? null
    : (to - from) / 60_000;
}

const zurichParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function zurich(at: number): { date: string; hour: number } {
  const parts = zurichParts.formatToParts(new Date(at));
  const value = (kind: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === kind)?.value ?? "00";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")) % 24,
  };
}

/** Monday of the ISO week of a YYYY-MM-DD date. */
function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  const weekday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - weekday);
  return day.toISOString().slice(0, 10);
}

export function mood(score: number): Mood {
  if (score >= 4) return "happy";
  if (score === 3) return "neutral";
  return "unhappy";
}

/** Days of the range in Swiss local time, each with its last instant. */
export function rangeDays(
  range: InsightRange,
): { date: string; end: number }[] {
  const start = Date.parse(range.startsAt);
  const end = Date.parse(range.endsAt);
  const days: { date: string; end: number }[] = [];
  let cursor = start;
  let guard = 0;
  while (cursor <= end && guard < 400) {
    const { date } = zurich(cursor);
    // Advance to the first instant that belongs to the next Swiss day.
    let next = cursor + DAY_MS;
    while (zurich(next).date === date) next += 60 * 60 * 1_000;
    while (zurich(next - 60 * 60 * 1_000).date !== date) {
      next -= 60 * 60 * 1_000;
    }
    days.push({ date, end: Math.min(next - 1, end) });
    cursor = next;
    guard += 1;
  }
  return days;
}

type TicketFacts = {
  ticket: InsightTicket;
  /** Public agent replies (author is not the requester). */
  agentReplies: number;
  /** Minutes from a requester follow-up to the next public agent reply. */
  reactions: { at: string; minutes: number }[];
};

function ticketFacts(
  tickets: InsightTicket[],
  comments: InsightComment[],
): Map<string, TicketFacts> {
  const facts = new Map<string, TicketFacts>();
  for (const ticket of tickets) {
    facts.set(ticket.id, { ticket, agentReplies: 0, reactions: [] });
  }
  const byTicket = new Map<string, InsightComment[]>();
  for (const comment of comments) {
    if (!comment.external || !facts.has(comment.ticketId)) continue;
    const list = byTicket.get(comment.ticketId) ?? [];
    list.push(comment);
    byTicket.set(comment.ticketId, list);
  }
  for (const [ticketId, list] of byTicket) {
    const fact = facts.get(ticketId)!;
    list.sort((a, b) => (time(a.createdAt) ?? 0) - (time(b.createdAt) ?? 0));
    let waitingSince: string | null = null;
    for (const comment of list) {
      const fromAgent =
        comment.authorId !== null &&
        comment.authorId !== fact.ticket.requesterId;
      if (fromAgent) {
        fact.agentReplies += 1;
        if (waitingSince) {
          const minutes = minutesBetween(waitingSince, comment.createdAt);
          if (minutes !== null) {
            fact.reactions.push({ at: comment.createdAt, minutes });
          }
          waitingSince = null;
        }
      } else if (!waitingSince) {
        waitingSince = comment.createdAt;
      }
    }
  }
  return facts;
}

type Aggregate = {
  received: number;
  resolved: number;
  unresolved: number;
  firstContactResolutionRate: number | null;
  resolutionSlaCompliance: number | null;
  averageResolutionMinutes: number | null;
  firstResponseSlaCompliance: number | null;
  averageFirstResponseMinutes: number | null;
  averageReactionMinutes: number | null;
};

function aggregate(facts: TicketFacts[], range: InsightRange): Aggregate {
  const end = Date.parse(range.endsAt);
  let received = 0;
  let unresolved = 0;
  let resolved = 0;
  let firstContact = 0;
  let resolutionSlaTotal = 0;
  let resolutionSlaMet = 0;
  let responseSlaTotal = 0;
  let responseSlaMet = 0;
  const resolutionMinutes: number[] = [];
  const responseMinutes: number[] = [];
  const reactionMinutes: number[] = [];

  for (const fact of facts) {
    const ticket = fact.ticket;
    const created = time(ticket.createdAt);
    const resolvedAt = time(ticket.resolvedAt);
    if (within(ticket.createdAt, range)) received += 1;
    if (
      created !== null &&
      created <= end &&
      (resolvedAt === null || resolvedAt > end)
    ) {
      unresolved += 1;
    }
    if (within(ticket.resolvedAt, range)) {
      resolved += 1;
      if (fact.agentReplies <= 1) firstContact += 1;
      const minutes = minutesBetween(ticket.createdAt, ticket.resolvedAt);
      if (minutes !== null) resolutionMinutes.push(minutes);
      const due = time(ticket.resolutionDueAt);
      if (due !== null) {
        resolutionSlaTotal += 1;
        if (resolvedAt !== null && resolvedAt <= due) resolutionSlaMet += 1;
      }
    }
    if (within(ticket.firstRespondedAt, range)) {
      const minutes = minutesBetween(ticket.createdAt, ticket.firstRespondedAt);
      if (minutes !== null) responseMinutes.push(minutes);
      const due = time(ticket.responseDueAt);
      if (due !== null) {
        responseSlaTotal += 1;
        if ((time(ticket.firstRespondedAt) ?? Infinity) <= due) {
          responseSlaMet += 1;
        }
      }
    }
    for (const reaction of fact.reactions) {
      if (within(reaction.at, range)) reactionMinutes.push(reaction.minutes);
    }
  }

  return {
    received,
    resolved,
    unresolved,
    firstContactResolutionRate: percent(firstContact, resolved),
    resolutionSlaCompliance: percent(resolutionSlaMet, resolutionSlaTotal),
    averageResolutionMinutes: average(resolutionMinutes),
    firstResponseSlaCompliance: percent(responseSlaMet, responseSlaTotal),
    averageFirstResponseMinutes: average(responseMinutes),
    averageReactionMinutes: average(reactionMinutes),
  };
}

function moodShares(ratings: InsightRating[]) {
  const counts = { happy: 0, neutral: 0, unhappy: 0 };
  for (const rating of ratings) counts[mood(rating.score)] += 1;
  const total = ratings.length;
  return {
    responses: total,
    happy: counts.happy,
    neutral: counts.neutral,
    unhappy: counts.unhappy,
    happyPercent: percent(counts.happy, total),
    neutralPercent: percent(counts.neutral, total),
    unhappyPercent: percent(counts.unhappy, total),
  };
}

export function buildInsights(input: {
  current: InsightRange;
  previous: InsightRange;
  tickets: InsightTicket[];
  comments: InsightComment[];
  ratings: InsightRating[];
  teamNames: Map<string, string>;
  agentNames: Map<string, string>;
}) {
  const facts = ticketFacts(input.tickets, input.comments);
  const allFacts = [...facts.values()];

  // Servicedesk-Trends: daily received / resolved / open backlog.
  const days = rangeDays(input.current);
  const received = new Map<string, number>();
  const resolved = new Map<string, number>();
  const byHour = Array.from(
    { length: 24 },
    () =>
      Object.fromEntries(SOURCES.map((source) => [source, 0])) as Record<
        string,
        number
      >,
  );
  for (const { ticket } of allFacts) {
    const created = time(ticket.createdAt);
    if (created !== null && within(ticket.createdAt, input.current)) {
      const local = zurich(created);
      received.set(local.date, (received.get(local.date) ?? 0) + 1);
      const source = SOURCES.includes(ticket.source as (typeof SOURCES)[number])
        ? ticket.source!
        : "portal";
      byHour[local.hour][source] += 1;
    }
    const resolvedAt = time(ticket.resolvedAt);
    if (resolvedAt !== null && within(ticket.resolvedAt, input.current)) {
      const date = zurich(resolvedAt).date;
      resolved.set(date, (resolved.get(date) ?? 0) + 1);
    }
  }
  const daily = days.map((day) => ({
    date: day.date,
    received: received.get(day.date) ?? 0,
    resolved: resolved.get(day.date) ?? 0,
    unresolved: allFacts.filter(({ ticket }) => {
      const created = time(ticket.createdAt);
      const resolvedAt = time(ticket.resolvedAt);
      return (
        created !== null &&
        created <= day.end &&
        (resolvedAt === null || resolvedAt > day.end)
      );
    }).length,
  }));

  // Servicedesk-Übersicht with the immediately preceding period.
  const overview = {
    current: aggregate(allFacts, input.current),
    previous: aggregate(allFacts, input.previous),
  };

  // Mitarbeiterzufriedenheit.
  const ticketById = new Map(
    input.tickets.map((ticket) => [ticket.id, ticket]),
  );
  const currentRatings = input.ratings.filter(
    (rating) =>
      ticketById.has(rating.ticketId) &&
      within(rating.submittedAt, input.current),
  );
  const previousRatings = input.ratings.filter(
    (rating) =>
      ticketById.has(rating.ticketId) &&
      within(rating.submittedAt, input.previous),
  );
  const weekly = new Map<string, InsightRating[]>();
  for (const rating of currentRatings) {
    const at = time(rating.submittedAt);
    if (at === null) continue;
    const week = weekStart(zurich(at).date);
    weekly.set(week, [...(weekly.get(week) ?? []), rating]);
  }
  const groupRatings = (key: (ticket: InsightTicket) => string | null) => {
    const groups = new Map<string, InsightRating[]>();
    for (const rating of currentRatings) {
      const id = key(ticketById.get(rating.ticketId)!) ?? "";
      groups.set(id, [...(groups.get(id) ?? []), rating]);
    }
    return groups;
  };
  const satisfaction = {
    ...moodShares(currentRatings),
    surveysSent: overview.current.resolved,
    previousSurveysSent: overview.previous.resolved,
    previousResponses: previousRatings.length,
    weekly: [...weekly.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, ratings]) => ({ weekStart: week, ...moodShares(ratings) })),
    byTeam: [...groupRatings((ticket) => ticket.assignedTeamId).entries()]
      .map(([id, ratings]) => ({
        id: id || null,
        name: id ? (input.teamNames.get(id) ?? "Unbekanntes Team") : null,
        ...moodShares(ratings),
      }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "de-CH")),
  };

  // Agentenleistung: one row per assigned agent plus the overall total.
  const agentGroups = new Map<string, TicketFacts[]>();
  for (const fact of allFacts) {
    const id = fact.ticket.assignedAgentId ?? "";
    agentGroups.set(id, [...(agentGroups.get(id) ?? []), fact]);
  }
  const ratingsByAgent = groupRatings((ticket) => ticket.assignedAgentId);
  const agentRow = (
    id: string | null,
    name: string | null,
    rows: TicketFacts[],
    ratings: InsightRating[],
  ) => {
    const metrics = aggregate(rows, input.current);
    const shares = moodShares(ratings);
    return {
      id,
      name,
      resolved: metrics.resolved,
      resolutionSlaCompliance: metrics.resolutionSlaCompliance,
      firstResponseSlaCompliance: metrics.firstResponseSlaCompliance,
      firstContactResolutionRate: metrics.firstContactResolutionRate,
      averageResolutionMinutes: metrics.averageResolutionMinutes,
      averageFirstResponseMinutes: metrics.averageFirstResponseMinutes,
      averageReactionMinutes: metrics.averageReactionMinutes,
      responses: shares.responses,
      happyPercent: shares.happyPercent,
      neutralPercent: shares.neutralPercent,
      unhappyPercent: shares.unhappyPercent,
    };
  };
  const agents = [...agentGroups.entries()]
    .map(([id, rows]) =>
      agentRow(
        id || null,
        id ? (input.agentNames.get(id) ?? "Unbekannter Agent") : null,
        rows,
        ratingsByAgent.get(id) ?? [],
      ),
    )
    .filter(
      (row) =>
        row.resolved > 0 ||
        row.responses > 0 ||
        row.averageFirstResponseMinutes !== null ||
        row.averageReactionMinutes !== null,
    )
    .sort((a, b) => {
      if (a.id === null) return -1;
      if (b.id === null) return 1;
      return (a.name ?? "").localeCompare(b.name ?? "", "de-CH");
    });

  return {
    trends: {
      daily,
      byHour: byHour.map((counts, hour) => ({ hour, ...counts })),
    },
    overview,
    satisfaction,
    agents: {
      rows: agents,
      total: agentRow(null, "Gesamtsumme", allFacts, currentRatings),
    },
  };
}
