import { customPeriodRange } from "../service-reporting/index.ts";

const source = async (path: string) => await Deno.readTextFile(path);

function requireSource(sourceText: string, expected: string) {
  if (!sourceText.includes(expected)) {
    throw new Error(`Expected team access fence is missing: ${expected}`);
  }
}

Deno.test(
  "team-sensitive ticket endpoints invoke the central team gate",
  async () => {
    for (const path of [
      "supabase/functions/ticket-department-change/index.ts",
      "supabase/functions/ticket-requesters/index.ts",
      "supabase/functions/ticket-custom-fields/index.ts",
      "supabase/functions/ticket-presence/index.ts",
      "supabase/functions/ticket-approvals/index.ts",
    ]) {
      requireSource(await source(path), "can_access_ticket_team");
    }
  },
);

Deno.test(
  "team membership requires an active matching department membership",
  async () => {
    const migration = await source(
      "supabase/migrations/0102_department_teams_ticket_visibility.sql",
    );
    requireSource(migration, "alter column department_id set not null");
    requireSource(migration, "teams_department_tenant_fk");
    requireSource(migration, "department_membership.status = 'active'");
    requireSource(migration, "can_access_ticket_team");
    if (migration.includes("if v_team.department_id is not null")) {
      throw new Error("A departmentless team membership bypass returned.");
    }
  },
);

Deno.test(
  "reporting receives only a caller's active teams or teamless tickets",
  async () => {
    const reporting = await source(
      "supabase/functions/service-reporting/index.ts",
    );
    requireSource(reporting, "readableTeamIds");
    requireSource(reporting, "canIncludeTeam");
    requireSource(reporting, "assigned_team_id");
  },
);

Deno.test(
  "reporting derives both comparison periods only after the team fence",
  async () => {
    const reporting = await source(
      "supabase/functions/service-reporting/index.ts",
    );
    requireSource(reporting, "periodRanges(action)");
    requireSource(reporting, "ranges.previous.startsAt");
    requireSource(reporting, "tickets.filter((ticket) =>");
    requireSource(reporting, "timeEntries.filter((entry) =>");
    requireSource(reporting, "comparison:");
  },
);

Deno.test(
  "workspace access exposes reports only for an effective tenant report role",
  async () => {
    const tenantUsers = await source(
      "supabase/functions/tenant-users/index.ts",
    );
    requireSource(tenantUsers, "canReadReports");
    requireSource(tenantUsers, 'permission.permission_code === "report.read"');
    requireSource(tenantUsers, "isEffectiveAssignment(assignment, now)");
    requireSource(tenantUsers, "assignment.department_id === null");
  },
);

Deno.test(
  "custom reporting dates use the full Europe/Zurich calendar day",
  () => {
    const range = customPeriodRange("2026-07-01", "2026-07-01");
    if (!range) throw new Error("Expected a valid reporting period.");
    if (range.current.startsAt !== "2026-06-30T22:00:00.000Z") {
      throw new Error("The summer start must be Zurich midnight.");
    }
    if (range.current.endsAt !== "2026-07-01T21:59:59.999Z") {
      throw new Error("The summer end must be the final Zurich millisecond.");
    }
    if (range.previous.endsAt !== "2026-06-30T21:59:59.999Z") {
      throw new Error(
        "The previous period must end immediately before the current period.",
      );
    }
  },
);

Deno.test(
  "custom reporting preserves full local comparison days across the Zurich DST change",
  () => {
    const range = customPeriodRange("2026-03-29", "2026-03-29");
    if (!range) throw new Error("Expected a valid DST reporting period.");
    if (range.current.startsAt !== "2026-03-28T23:00:00.000Z") {
      throw new Error("The DST day must start at Zurich midnight.");
    }
    if (range.current.endsAt !== "2026-03-29T21:59:59.999Z") {
      throw new Error("The DST day must end at the final Zurich millisecond.");
    }
    if (range.previous.startsAt !== "2026-03-27T23:00:00.000Z") {
      throw new Error("The prior day must start at its own Zurich midnight.");
    }
    if (range.previous.endsAt !== "2026-03-28T22:59:59.999Z") {
      throw new Error(
        "The prior day must retain its full pre-DST Zurich boundary.",
      );
    }
  },
);

Deno.test(
  "bulk, category, assignment and follow-up paths retain the team fence",
  async () => {
    const migration = await source(
      "supabase/migrations/0102_department_teams_ticket_visibility.sql",
    );
    requireSource(
      migration,
      "can_user_access_ticket_team(ticket.id, p_actor_id)",
    );
    requireSource(migration, "ticket_assigned_agent_team_invalid");
    requireSource(
      migration,
      "unassign_ticket_agent_after_team_membership_loss",
    );
    requireSource(migration, "experience_follow_ups_select_owner");
    requireSource(
      migration,
      "ticket_id is null or public.can_access_ticket_team(ticket_id)",
    );
    const operations = await source(
      "supabase/functions/ticket-operations/index.ts",
    );
    requireSource(
      operations,
      "activeDepartmentMemberIds.has(assignment.user_id)",
    );
    requireSource(operations, "assigned_agent_team_mismatch");
    if (operations.includes("update.assigned_agent_id = null")) {
      throw new Error(
        "Ein Teamwechsel darf eine bestehende Ticketzuweisung nicht stillschweigend aufheben.",
      );
    }
    const workbench = await source(
      "supabase/functions/agent-workbench/index.ts",
    );
    requireSource(workbench, "can_user_access_ticket_team");
  },
);

Deno.test(
  "service-role relation, export and notification paths do not bypass team RLS",
  async () => {
    const migration = await source(
      "supabase/migrations/0102_department_teams_ticket_visibility.sql",
    );
    requireSource(
      migration,
      "All team tables, RLS policies and RPC replacements apply atomically.",
    );
    if (migration.trim().split("\n").at(-1) !== "commit;") {
      throw new Error(
        "The team migration must commit only after every team fence.",
      );
    }

    const operations = await source(
      "supabase/functions/ticket-operations/index.ts",
    );
    requireSource(operations, "can_user_access_ticket_team");
    requireSource(operations, "assigned_team_id");

    const csv = await source("supabase/functions/ticket-csv-export/index.ts");
    requireSource(csv, "await context.supabase");
    if (csv.includes('await context.supabaseAdmin\n      .from("tickets")')) {
      throw new Error(
        "CSV export must not use a tenant-wide service-role ticket scan.",
      );
    }

    const notifications = await source(
      "supabase/functions/notification-center/index.ts",
    );
    requireSource(notifications, "membershipVisibleNotifications");
    requireSource(notifications, "visibleNotifications");
    requireSource(notifications, 'await client\n      .from("tickets")');
  },
);

Deno.test(
  "ticket notification creation and provider delivery re-authorize team recipients",
  async () => {
    const migration = await source(
      "supabase/migrations/0104_ticket_notification_recipient_authorization.sql",
    );
    requireSource(migration, "ticket_notification_recipient_authorized");
    requireSource(
      migration,
      "can_user_access_ticket_team(ticket.id, p_user_id)",
    );
    requireSource(
      migration,
      "ticket_notifications_authorize_recipient_trigger",
    );
    requireSource(migration, "push_skip_unauthorized_ticket_outbox");

    const operations = await source(
      "supabase/functions/ticket-operations/index.ts",
    );
    requireSource(operations, "ticketNotificationRecipientAuthorized");
    requireSource(operations, "ticket.escalation_opened");

    const questions = await source(
      "supabase/functions/department-questions/index.ts",
    );
    requireSource(questions, "ticket_notification_recipient_authorized");
    requireSource(questions, "emailQueued: false");

    const dispatch = await source("supabase/functions/push-dispatch/index.ts");
    requireSource(dispatch, "push_skip_unauthorized_ticket_outbox");
    requireSource(dispatch, "skipUnauthorizedRecipient");
    requireSource(dispatch, "ticketNotificationRecipientAuthorized");

    const mail = await source(
      "supabase/functions/_shared/exchange-mail-processing.ts",
    );
    requireSource(mail, "ticket_notification_recipient_authorized");
    requireSource(mail, "recipient_not_authorized");
  },
);
