// Abarbeitung der Teams-Bestellungen: anlegen, Kanäle/Tabs/Gäste ergänzen,
// Owner erinnern, nach dem Ende archivieren. Wird von teams-lifecycle (Cron)
// und direkt nach der Bestellung (teams-provisioning) aufgerufen; jeder Schritt
// ist wiederholbar.

import {
  archiveTeam,
  createTeam,
  finishTeam,
  teamCreationStatus,
  TeamsGraphError,
  type TeamsGraphErrorCode,
} from "./teams-graph.ts";
import {
  daysBetween,
  dueReminder,
  remindersCoveredBy,
  type ReminderDay,
  type TeamChannel,
} from "./teams-model.ts";
import { teamsGraphToken } from "./teams-token.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

const MAX_ATTEMPTS = 5;
const POLL_STEP_MS = 4_000;
const POLL_INLINE_MS = 60_000;

export type TeamRequestRow = {
  id: string;
  tenant_id: string;
  requested_by: string;
  name: string;
  description: string | null;
  visibility: "public" | "private";
  allow_guests: boolean;
  channels: TeamChannel[];
  owner_ids: string[];
  member_ids: string[];
  guest_emails: string[];
  start_date: string;
  end_date: string;
  status: string;
  graph_team_id: string | null;
  graph_operation: string | null;
  attempts: number;
  next_attempt_at: string;
  reminded_14_at: string | null;
  reminded_7_at: string | null;
  reminded_1_at: string | null;
};

export const REQUEST_COLUMNS =
  "id, tenant_id, requested_by, name, description, visibility, allow_guests, channels, owner_ids, member_ids, guest_emails, start_date, end_date, status, graph_team_id, graph_operation, attempts, next_attempt_at, reminded_14_at, reminded_7_at, reminded_1_at";

/** Heutiges Datum (YYYY-MM-DD) in der Zeitzone des Betriebs. */
export function zurichToday(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(
    now,
  );
}

function errorCode(error: unknown): TeamsGraphErrorCode {
  return error instanceof TeamsGraphError ? error.code : "unavailable";
}

/** Verständliche Ursache für die Person, die bestellt hat. */
export function failureReason(code: string): string {
  switch (code) {
    case "consent_missing":
      return "Microsoft verweigert den Zugriff: Die Berechtigung für Teams fehlt. Bitte den Support informieren.";
    case "token_failed":
      return "Die Anmeldung der Microsoft-App ist fehlgeschlagen (Geheimnis falsch oder abgelaufen). Bitte den Support informieren.";
    case "invalid":
      return "Microsoft hat die Angaben abgelehnt (z. B. Name oder Personen). Bitte den Support informieren.";
    case "conflict":
      return "Ein Team mit diesem Namen oder dieser Gruppe besteht bereits.";
    default:
      return "Microsoft Teams ist gerade nicht erreichbar. Bitte den Support informieren.";
  }
}

/** Personen, die Mitteilungen zum Team erhalten: Bestellende und Owner mit Konto. */
export async function teamRecipients(
  admin: Admin,
  row: Pick<TeamRequestRow, "tenant_id" | "requested_by" | "owner_ids">,
): Promise<string[]> {
  const recipients = new Set<string>([row.requested_by]);
  const { data } = await admin
    .from("tenant_entra_directory_people")
    .select("local_user_id")
    .eq("tenant_id", row.tenant_id)
    .in("entra_object_id", row.owner_ids);
  for (const person of (data ?? []) as Row[]) {
    if (typeof person.local_user_id === "string") {
      recipients.add(person.local_user_id);
    }
  }
  return [...recipients];
}

async function notify(
  admin: Admin,
  row: TeamRequestRow,
  kind: string,
  extra: Record<string, unknown>,
  onlyRequester = false,
) {
  const users = onlyRequester
    ? [row.requested_by]
    : await teamRecipients(admin, row);
  for (const userId of users) {
    await admin.rpc("teams_notify", {
      p_tenant_id: row.tenant_id,
      p_user_id: userId,
      p_kind: kind,
      p_request_id: row.id,
      p_extra: { teamName: row.name, endDate: row.end_date, ...extra },
    });
  }
}

async function audit(
  admin: Admin,
  row: TeamRequestRow,
  action: string,
  metadata: Record<string, unknown>,
) {
  await admin.from("audit_logs").insert({
    tenant_id: row.tenant_id,
    actor_id: null,
    action,
    entity_type: "teams_request",
    entity_id: row.id,
    severity: "info",
    before_data: null,
    after_data: null,
    metadata: { teamName: row.name, ...metadata },
  });
}

async function markFailed(
  admin: Admin,
  row: TeamRequestRow,
  code: string,
) {
  await admin
    .from("teams_requests")
    .update({ status: "failed", last_error: code })
    .eq("id", row.id);
  await audit(admin, row, "teams.request.failed", { reason: code });
  await notify(
    admin,
    row,
    "shop.order.team_failed",
    { reason: failureReason(code) },
    true,
  );
}

/** Fehler eines Schritts: dauerhaft → fehlgeschlagen, sonst später erneut. */
async function handleStepError(
  admin: Admin,
  row: TeamRequestRow,
  error: unknown,
) {
  const code = errorCode(error);
  const permanent =
    code === "consent_missing" || code === "token_failed" || code === "invalid";
  if (permanent || row.attempts + 1 >= MAX_ATTEMPTS) {
    await markFailed(admin, row, code);
    return;
  }
  const delayMinutes = Math.min(60, 2 ** (row.attempts + 1));
  await admin
    .from("teams_requests")
    .update({
      attempts: row.attempts + 1,
      last_error: code,
      next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
    })
    .eq("id", row.id);
}

async function finish(
  admin: Admin,
  token: string,
  row: TeamRequestRow,
  teamId: string,
) {
  const warnings = await finishTeam(token, teamId, {
    channels: row.channels,
    owners: row.owner_ids,
    members: row.member_ids,
    guests: row.guest_emails,
    allowGuests: row.allow_guests,
  });
  await admin
    .from("teams_requests")
    .update({
      status: "ready",
      ready_at: new Date().toISOString(),
      last_error: null,
      warnings,
    })
    .eq("id", row.id);
  await audit(admin, row, "teams.request.ready", { warnings: warnings.length });
  await notify(
    admin,
    row,
    "shop.order.team_ready",
    { warnings: warnings.length },
    true,
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Bringt eine Bestellung im Status queued/provisioning einen Schritt weiter.
 * Mit `inline` wartet der Aufruf bis zu einer Minute auf Microsoft, damit das
 * Team direkt nach dem Bestellen bereit ist; sonst übernimmt der Cron.
 */
export async function advanceRequest(
  admin: Admin,
  row: TeamRequestRow,
  options: { inline?: boolean } = {},
): Promise<void> {
  // Kurzer Mietvertrag auf die Zeile: Cron und Sofortlauf legen kein Team doppelt an.
  const { data: claimed } = await admin
    .from("teams_requests")
    .update({
      next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    })
    .eq("id", row.id)
    .eq("next_attempt_at", row.next_attempt_at)
    .in("status", ["queued", "provisioning"])
    .select("id")
    .maybeSingle();
  if (!claimed) return;
  try {
    const token = await teamsGraphToken(admin, row.tenant_id);
    let teamId = row.graph_team_id;
    let operation = row.graph_operation;
    if (!teamId) {
      const created = await createTeam(token, {
        name: row.name,
        description: row.description,
        visibility: row.visibility,
        owners: row.owner_ids,
        members: row.member_ids,
      });
      teamId = created.teamId;
      operation = created.operation;
      await admin
        .from("teams_requests")
        .update({
          status: "provisioning",
          graph_team_id: teamId,
          graph_operation: operation,
          next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
        })
        .eq("id", row.id);
    }
    const deadline = Date.now() + (options.inline ? POLL_INLINE_MS : 0);
    for (;;) {
      const state = await teamCreationStatus(token, teamId, operation);
      if (state === "succeeded") {
        await finish(admin, token, row, teamId);
        return;
      }
      if (state === "failed") {
        await markFailed(admin, row, "invalid");
        return;
      }
      if (Date.now() >= deadline) return;
      await sleep(POLL_STEP_MS);
    }
  } catch (error) {
    await handleStepError(admin, row, error);
  }
}

async function remindOrArchive(
  admin: Admin,
  row: TeamRequestRow,
  today: string,
): Promise<"reminded" | "archived" | "none"> {
  const daysLeft = daysBetween(today, row.end_date);
  if (daysLeft === null) return "none";
  if (daysLeft < 0) {
    if (!row.graph_team_id) return "none";
    try {
      const token = await teamsGraphToken(admin, row.tenant_id);
      await archiveTeam(token, row.graph_team_id);
    } catch (error) {
      await admin
        .from("teams_requests")
        .update({ last_error: errorCode(error) })
        .eq("id", row.id);
      return "none";
    }
    await admin
      .from("teams_requests")
      .update({
        status: "archived",
        archived_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", row.id);
    await audit(admin, row, "teams.request.archived", { reason: "expired" });
    await notify(admin, row, "shop.order.team_archived", {});
    return "archived";
  }
  const sent: ReminderDay[] = [];
  if (row.reminded_14_at) sent.push(14);
  if (row.reminded_7_at) sent.push(7);
  if (row.reminded_1_at) sent.push(1);
  const due = dueReminder(daysLeft, sent);
  if (due === null) return "none";
  const stamp = new Date().toISOString();
  const update: Record<string, string> = {};
  for (const day of remindersCoveredBy(due)) {
    update[`reminded_${day}_at`] = stamp;
  }
  // Zuerst markieren: lieber eine Erinnerung zu wenig als doppelt.
  const { error } = await admin
    .from("teams_requests")
    .update(update)
    .eq("id", row.id)
    .eq("status", "ready")
    .is(`reminded_${due}_at`, null);
  if (error) return "none";
  await notify(admin, row, "shop.order.team_expiring", { daysLeft });
  await audit(admin, row, "teams.request.expiry_reminder", { daysLeft });
  return "reminded";
}

export type LifecycleSummary = {
  advanced: number;
  reminded: number;
  archived: number;
};

/** Ein Durchlauf des Crons über alle Mandanten. */
export async function runTeamsLifecycle(
  admin: Admin,
  now = new Date(),
): Promise<LifecycleSummary> {
  const today = zurichToday(now);
  const summary: LifecycleSummary = { advanced: 0, reminded: 0, archived: 0 };

  const { data: work } = await admin
    .from("teams_requests")
    .select(REQUEST_COLUMNS)
    .in("status", ["queued", "provisioning"])
    .lte("start_date", today)
    .lte("next_attempt_at", now.toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(20);
  for (const row of (work ?? []) as TeamRequestRow[]) {
    await advanceRequest(admin, row);
    summary.advanced += 1;
  }

  const horizon = new Date(now.getTime() + 15 * 86_400_000);
  const { data: running } = await admin
    .from("teams_requests")
    .select(REQUEST_COLUMNS)
    .eq("status", "ready")
    .lte("end_date", zurichToday(horizon))
    .limit(200);
  for (const row of (running ?? []) as TeamRequestRow[]) {
    const result = await remindOrArchive(admin, row, today);
    if (result === "reminded") summary.reminded += 1;
    if (result === "archived") summary.archived += 1;
  }
  return summary;
}
