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
    requireSource(operations, "update.assigned_agent_id = null");
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
