import { tn } from "./formality";
import { functionErrorMessage } from "./function-error";
import { supabase } from "./supabase";

// Eskalationsstufen (1st/2nd/3rd Level Support). The level of a ticket comes
// from its assigned team; the Edge Function ticket-support-levels checks all
// permissions and stores handovers.

export type SupportLevel = 1 | 2 | 3;
export type SupportLevelFilter = "all" | `${SupportLevel}`;
export type LevelChangeKind = "initial" | "escalated" | "returned" | "cleared";

export const SUPPORT_LEVELS: readonly SupportLevel[] = [1, 2, 3];
export const HANDOVER_NOTE_MIN = 10;
export const HANDOVER_NOTE_MAX = 4000;

export function isSupportLevel(value: unknown): value is SupportLevel {
  return value === 1 || value === 2 || value === 3;
}

export function supportLevelLabel(level: SupportLevel): string {
  return level === 1 ? "1st Level" : level === 2 ? "2nd Level" : "3rd Level";
}

/** Value of the team form select ("" = no level). */
export function supportLevelFromSelect(value: string): SupportLevel | null {
  const level = Number(value);
  return isSupportLevel(level) ? level : null;
}

export function supportLevelFilterValue(
  value: unknown,
): SupportLevelFilter | null {
  return value === "all" || value === "1" || value === "2" || value === "3"
    ? value
    : null;
}

/** Level of a queue filter, null for "all". */
export function supportLevelOfFilter(
  filter: SupportLevelFilter,
): SupportLevel | null {
  return filter === "all" ? null : (Number(filter) as SupportLevel);
}

/** Error text for the mandatory handover note, or null when valid. */
export function handoverNoteError(note: string): string | null {
  const length = Array.from(note.trim()).length;
  if (length < HANDOVER_NOTE_MIN)
    return tn(
      `Bitte beschreibe in mindestens ${HANDOVER_NOTE_MIN} Zeichen, was bereits versucht wurde und welche Erkenntnisse vorliegen.`,
      `Bitte beschreiben Sie in mindestens ${HANDOVER_NOTE_MIN} Zeichen, was bereits versucht wurde und welche Erkenntnisse vorliegen.`,
    );
  if (length > HANDOVER_NOTE_MAX)
    return `Die Übergabenotiz darf höchstens ${HANDOVER_NOTE_MAX} Zeichen lang sein.`;
  return null;
}

export function levelChangeText(entry: {
  kind: LevelChangeKind;
  fromLevel: SupportLevel | null;
  toLevel: SupportLevel | null;
  teamName: string | null;
}): string {
  const team = entry.teamName ? ` (${entry.teamName})` : "";
  if (entry.kind === "initial" && entry.toLevel)
    return `Eingang auf ${supportLevelLabel(entry.toLevel)}${team}`;
  if (entry.kind === "escalated" && entry.toLevel)
    return `Übergabe an ${supportLevelLabel(entry.toLevel)}${team}`;
  if (entry.kind === "returned" && entry.toLevel)
    return `Zurück an ${supportLevelLabel(entry.toLevel)}${team}`;
  return entry.fromLevel
    ? `${supportLevelLabel(entry.fromLevel)} verlassen${team}`
    : "Stufe entfernt";
}

/** "1 Std. 20 Min." style duration for report minutes. */
export function formatLevelMinutes(minutes: number | null): string {
  if (minutes === null) return "–";
  if (minutes < 60) return `${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest ? `${hours} Std. ${rest} Min.` : `${hours} Std.`;
  }
  const days = Math.round((minutes / 1440) * 10) / 10;
  return `${days.toLocaleString("de-CH")} Tage`;
}

export function formatRate(rate: number | null): string {
  return rate === null
    ? "–"
    : `${(Math.round(rate * 1000) / 10).toLocaleString("de-CH")} %`;
}

export type LevelTeamOption = { id: string; name: string };

export type TicketSupportLevelEntry = {
  id: string;
  kind: LevelChangeKind;
  fromLevel: SupportLevel | null;
  toLevel: SupportLevel | null;
  teamName: string | null;
  note: string | null;
  actorName: string | null;
  createdAt: string;
};

export type TicketSupportLevel = {
  levelsConfigured: boolean;
  currentLevel: SupportLevel | null;
  currentTeam: LevelTeamOption | null;
  ticketClosed: boolean;
  canHandover: boolean;
  targets: {
    next: { level: SupportLevel; teams: LevelTeamOption[] } | null;
    back: { level: SupportLevel; teams: LevelTeamOption[] }[];
  };
  currentHandover: TicketSupportLevelEntry | null;
  history: TicketSupportLevelEntry[];
  /** «Spam-/Phishing-Verdacht» (reply + handover to the 2nd level). */
  suspicion: {
    reported: boolean;
    canReport: boolean;
    targetTeam: LevelTeamOption | null;
  };
};

export type SuspicionReply =
  | "queued"
  | "no_requester_email"
  | "template_disabled"
  | "no_mail_channel"
  | "failed";

export type SuspicionResult = { teamName: string; moved: boolean; reply: SuspicionReply };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function levelOrNull(value: unknown): SupportLevel | null {
  return isSupportLevel(value) ? value : null;
}

function parseTeam(value: unknown): LevelTeamOption | null {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string"
    ? { id: value.id, name: value.name }
    : null;
}

function parseTeams(value: unknown): LevelTeamOption[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const team = parseTeam(item);
        return team ? [team] : [];
      })
    : [];
}

function parseEntry(value: unknown): TicketSupportLevelEntry | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.createdAt !== "string" ||
    !(
      value.kind === "initial" ||
      value.kind === "escalated" ||
      value.kind === "returned" ||
      value.kind === "cleared"
    )
  )
    return null;
  return {
    id: value.id,
    kind: value.kind,
    fromLevel: levelOrNull(value.fromLevel),
    toLevel: levelOrNull(value.toLevel),
    teamName: typeof value.teamName === "string" ? value.teamName : null,
    note: typeof value.note === "string" ? value.note : null,
    actorName: typeof value.actorName === "string" ? value.actorName : null,
    createdAt: value.createdAt,
  };
}

export function parseTicketSupportLevel(
  value: unknown,
): TicketSupportLevel | null {
  const data = isRecord(value) ? value.data : null;
  if (!isRecord(data) || !isRecord(data.targets)) return null;
  const next = isRecord(data.targets.next) ? data.targets.next : null;
  const nextLevel = next ? levelOrNull(next.level) : null;
  return {
    levelsConfigured: data.levelsConfigured === true,
    currentLevel: levelOrNull(data.currentLevel),
    currentTeam: parseTeam(data.currentTeam),
    ticketClosed: data.ticketClosed === true,
    canHandover: data.canHandover === true,
    targets: {
      next:
        next && nextLevel
          ? { level: nextLevel, teams: parseTeams(next.teams) }
          : null,
      back: Array.isArray(data.targets.back)
        ? data.targets.back.flatMap((item) => {
            if (!isRecord(item)) return [];
            const level = levelOrNull(item.level);
            const teams = parseTeams(item.teams);
            return level && teams.length > 0 ? [{ level, teams }] : [];
          })
        : [],
    },
    currentHandover: parseEntry(data.currentHandover),
    suspicion: {
      reported: isRecord(data.suspicion) && data.suspicion.reported === true,
      canReport: isRecord(data.suspicion) && data.suspicion.canReport === true,
      targetTeam: isRecord(data.suspicion) ? parseTeam(data.suspicion.targetTeam) : null,
    },
    history: Array.isArray(data.history)
      ? data.history.flatMap((item) => {
          const entry = parseEntry(item);
          return entry ? [entry] : [];
        })
      : [],
  };
}

export type SupportLevelReport = {
  levelsConfigured: boolean;
  firstLevelResolution: {
    resolvedTickets: number;
    resolvedAtFirstLevel: number;
    rate: number | null;
  };
  escalations: number;
  returns: number;
  escalationsByCategory: {
    categoryId: string | null;
    categoryName: string;
    escalations: number;
    tickets: number;
  }[];
  averageTimeByLevel: {
    level: SupportLevel;
    averageMinutes: number | null;
    tickets: number;
  }[];
};

const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

export function parseSupportLevelReport(
  value: unknown,
): SupportLevelReport | null {
  const data = isRecord(value) ? value.data : null;
  if (!isRecord(data) || !isRecord(data.firstLevelResolution)) return null;
  const flr = data.firstLevelResolution;
  return {
    levelsConfigured: data.levelsConfigured === true,
    firstLevelResolution: {
      resolvedTickets: count(flr.resolvedTickets),
      resolvedAtFirstLevel: count(flr.resolvedAtFirstLevel),
      rate:
        typeof flr.rate === "number" && flr.rate >= 0 && flr.rate <= 1
          ? flr.rate
          : null,
    },
    escalations: count(data.escalations),
    returns: count(data.returns),
    escalationsByCategory: Array.isArray(data.escalationsByCategory)
      ? data.escalationsByCategory.flatMap((item) =>
          isRecord(item) && typeof item.categoryName === "string"
            ? [
                {
                  categoryId:
                    typeof item.categoryId === "string"
                      ? item.categoryId
                      : null,
                  categoryName: item.categoryName,
                  escalations: count(item.escalations),
                  tickets: count(item.tickets),
                },
              ]
            : [],
        )
      : [],
    averageTimeByLevel: Array.isArray(data.averageTimeByLevel)
      ? data.averageTimeByLevel.flatMap((item) => {
          if (!isRecord(item)) return [];
          const level = levelOrNull(item.level);
          return level
            ? [
                {
                  level,
                  averageMinutes:
                    typeof item.averageMinutes === "number"
                      ? item.averageMinutes
                      : null,
                  tickets: count(item.tickets),
                },
              ]
            : [];
        })
      : [],
  };
}

export function parseQueueLevels(value: unknown): SupportLevel[] {
  const data = isRecord(value) ? value.data : null;
  if (!isRecord(data) || !Array.isArray(data.levels)) return [];
  return data.levels.flatMap((item) =>
    isRecord(item) && isSupportLevel(item.level) ? [item.level] : [],
  );
}

async function invoke(
  body: Record<string, unknown>,
  fallback: string,
): Promise<unknown> {
  if (!supabase)
    throw new Error("Die Verbindung zu nextDesk ist nicht konfiguriert.");
  const { data, error } = await supabase.functions.invoke<unknown>(
    "ticket-support-levels",
    { body },
  );
  if (error) throw new Error(await functionErrorMessage(error, fallback));
  return data;
}

export async function loadTicketSupportLevel(
  tenantId: string,
  ticketId: string,
): Promise<TicketSupportLevel> {
  const parsed = parseTicketSupportLevel(
    await invoke(
      { type: "getTicket", tenantId, ticketId },
      "Die Supportstufe konnte nicht geladen werden.",
    ),
  );
  if (!parsed)
    throw new Error(
      "Die Supportstufe hat keine verwertbare Antwort geliefert.",
    );
  return parsed;
}

export async function loadLevelTeamAgents(
  tenantId: string,
  ticketId: string,
  teamId: string,
): Promise<{ id: string; displayName: string }[]> {
  const data = await invoke(
    { type: "teamAgents", tenantId, ticketId, teamId },
    "Die Personen des Teams konnten nicht geladen werden.",
  );
  const agents =
    isRecord(data) && isRecord(data.data) && Array.isArray(data.data.agents)
      ? data.data.agents
      : [];
  return agents.flatMap((agent) =>
    isRecord(agent) &&
    typeof agent.id === "string" &&
    typeof agent.displayName === "string"
      ? [{ id: agent.id, displayName: agent.displayName }]
      : [],
  );
}

export async function handOverTicketLevel(input: {
  tenantId: string;
  ticketId: string;
  targetTeamId: string;
  targetAgentId: string | null;
  note: string;
  expectedLevel: SupportLevel;
}): Promise<void> {
  await invoke(
    { type: "handover", ...input, note: input.note.trim() },
    "Die Übergabe konnte nicht gespeichert werden.",
  );
}

export async function loadQueueLevels(
  tenantId: string,
): Promise<SupportLevel[]> {
  return parseQueueLevels(
    await invoke(
      { type: "queueLevels", tenantId },
      "Die Supportstufen konnten nicht geladen werden.",
    ),
  );
}

export async function loadSupportLevelReport(
  tenantId: string,
  range: { startsAt: string; endsAt: string },
): Promise<SupportLevelReport> {
  const parsed = parseSupportLevelReport(
    await invoke(
      { type: "report", tenantId, ...range },
      "Der Stufenbericht konnte nicht geladen werden.",
    ),
  );
  if (!parsed)
    throw new Error(
      "Der Stufenbericht hat keine verwertbare Antwort geliefert.",
    );
  return parsed;
}

const SUSPICION_REPLIES: readonly SuspicionReply[] = [
  "queued",
  "no_requester_email",
  "template_disabled",
  "no_mail_channel",
  "failed",
];

export function parseSuspicionResult(value: unknown): SuspicionResult | null {
  const data = isRecord(value) ? value.data : null;
  if (!isRecord(data) || typeof data.teamName !== "string") return null;
  const reply = SUSPICION_REPLIES.find((entry) => entry === data.reply) ?? "failed";
  return { teamName: data.teamName, moved: data.moved === true, reply };
}

/** Text after «Spam-/Phishing-Verdacht», incl. why no reply was sent. */
export function suspicionResultText(result: SuspicionResult): string {
  const handover = result.moved
    ? `Das Ticket wurde an den 2nd Level (${result.teamName}) übergeben.`
    : `Das Ticket liegt bereits beim 2nd Level (${result.teamName}).`;
  const reply: Record<SuspicionReply, string> = {
    queued: "Die Standardantwort an die anfragende Person ist unterwegs.",
    no_requester_email:
      "Die anfragende Person hat keine E-Mail-Adresse, darum wurde keine Antwort gesendet.",
    template_disabled:
      "Die Vorlage «Phishing-Meldung: Danke» oder «Phishing-Meldung: Gestaltung» ist ausgeschaltet, darum wurde keine Antwort gesendet.",
    no_mail_channel:
      "Es ist kein aktives Exchange-Postfach verbunden, darum wurde keine Antwort gesendet.",
    failed: "Die Standardantwort konnte nicht vorbereitet werden.",
  };
  return `Als Spam-/Phishing-Verdacht markiert. ${handover} ${reply[result.reply]}`;
}

export async function reportPhishingSuspicion(
  tenantId: string,
  ticketId: string,
): Promise<SuspicionResult> {
  const parsed = parseSuspicionResult(
    await invoke(
      { type: "reportSuspicion", tenantId, ticketId },
      "Das Ticket konnte nicht als Spam-/Phishing-Verdacht markiert werden.",
    ),
  );
  if (!parsed)
    throw new Error("Die Einstufung hat keine verwertbare Antwort geliefert.");
  return parsed;
}
