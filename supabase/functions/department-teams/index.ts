import { withSupabase } from "@supabase/server";

const ORIGIN = "https://app.nextdesk.ch";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME = /^.{2,120}$/u;
const uuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function json(request: Request, body: Record<string, unknown>, status = 200) {
  const origin = request.headers.get("origin");
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
      ...(origin === ORIGIN
        ? {
            "Access-Control-Allow-Origin": ORIGIN,
            "Access-Control-Allow-Headers":
              "authorization, apikey, content-type, x-client-info",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
          }
        : {}),
    },
  });
}

function parse(value: unknown):
  | { type: "list"; tenantId: string }
  | {
      type: "save";
      tenantId: string;
      id?: string;
      departmentId: string;
      name: string;
    }
  | { type: "archive"; tenantId: string; id: string }
  | {
      type: "replaceMembers";
      tenantId: string;
      teamId: string;
      userIds: string[];
    }
  | null {
  if (!record(value) || !uuid(value.tenantId) || typeof value.type !== "string")
    return null;
  if (
    value.type === "list" &&
    Object.keys(value).every((key) => ["type", "tenantId"].includes(key))
  )
    return { type: "list", tenantId: value.tenantId };
  if (
    value.type === "save" &&
    Object.keys(value).every((key) =>
      ["type", "tenantId", "id", "departmentId", "name"].includes(key),
    ) &&
    uuid(value.departmentId) &&
    (!Object.hasOwn(value, "id") || uuid(value.id)) &&
    typeof value.name === "string"
  ) {
    const name = value.name.trim();
    return NAME.test(name)
      ? {
          type: "save",
          tenantId: value.tenantId,
          departmentId: value.departmentId,
          name,
          ...(uuid(value.id) ? { id: value.id } : {}),
        }
      : null;
  }
  if (
    value.type === "archive" &&
    Object.keys(value).every((key) =>
      ["type", "tenantId", "id"].includes(key),
    ) &&
    uuid(value.id)
  )
    return { type: "archive", tenantId: value.tenantId, id: value.id };
  if (
    value.type === "replaceMembers" &&
    Object.keys(value).every((key) =>
      ["type", "tenantId", "teamId", "userIds"].includes(key),
    ) &&
    uuid(value.teamId) &&
    Array.isArray(value.userIds) &&
    value.userIds.length <= 200 &&
    value.userIds.every(uuid) &&
    new Set(value.userIds).size === value.userIds.length
  )
    return {
      type: "replaceMembers",
      tenantId: value.tenantId,
      teamId: value.teamId,
      userIds: value.userIds,
    };
  return null;
}

async function authorize(admin: any, actorId: string, tenantId: string) {
  const now = new Date().toISOString();
  const [membershipResult, tenantResult, rolesResult] = await Promise.all([
    admin
      .from("tenant_memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", actorId)
      .eq("status", "active")
      .maybeSingle(),
    admin
      .from("tenants")
      .select("id")
      .eq("id", tenantId)
      .eq("status", "active")
      .maybeSingle(),
    admin
      .from("user_role_assignments")
      .select(
        "role_id,roles!user_role_assignments_role_tenant_fk!inner(tenant_id,name,scope,active)",
      )
      .eq("tenant_id", tenantId)
      .eq("user_id", actorId)
      .lte("starts_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .limit(30),
  ]);
  if (membershipResult.error || tenantResult.error || rolesResult.error)
    return "error" as const;
  if (!membershipResult.data || !tenantResult.data) return "forbidden" as const;
  return (rolesResult.data ?? []).some((assignment: any) => {
    const role = Array.isArray(assignment.roles)
      ? assignment.roles[0]
      : assignment.roles;
    return (
      role?.tenant_id === tenantId &&
      role?.scope === "tenant" &&
      role?.active === true &&
      role?.name === "Tenant administrator"
    );
  })
    ? ("allowed" as const)
    : ("forbidden" as const);
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  const action = parse(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || !uuid(actorId))
    return json(request, { error: { code: "invalid_request" } }, 422);
  const access = await authorize(
    context.supabaseAdmin,
    actorId,
    action.tenantId,
  );
  if (access === "error")
    return json(
      request,
      { error: { code: "authorization_check_failed" } },
      500,
    );
  if (access !== "allowed")
    return json(request, { error: { code: "tenant_admin_required" } }, 403);

  if (action.type === "list") {
    const [
      { data: departments, error: departmentsError },
      { data: teams, error: teamsError },
      { data: members, error: membersError },
      { data: candidates, error: candidatesError },
      { data: candidateDepartments, error: candidateDepartmentsError },
    ] = await Promise.all([
      context.supabaseAdmin
        .from("departments")
        .select("id,name,active")
        .eq("tenant_id", action.tenantId)
        .order("name")
        .limit(200),
      context.supabaseAdmin
        .from("teams")
        .select("id,department_id,name,active")
        .eq("tenant_id", action.tenantId)
        .order("name")
        .limit(300),
      context.supabaseAdmin
        .from("team_memberships")
        .select(
          "team_id,user_id,user_profiles!team_memberships_user_id_fkey(id,display_name)",
        )
        .eq("tenant_id", action.tenantId)
        .limit(2000),
      context.supabaseAdmin
        .from("tenant_memberships")
        .select(
          "user_id,user_profiles!tenant_memberships_user_id_fkey(id,display_name)",
        )
        .eq("tenant_id", action.tenantId)
        .eq("status", "active")
        .limit(500),
      context.supabaseAdmin
        .from("department_memberships")
        .select("user_id,department_id")
        .eq("tenant_id", action.tenantId)
        .eq("status", "active")
        .limit(2000),
    ]);
    if (
      departmentsError ||
      teamsError ||
      membersError ||
      candidatesError ||
      candidateDepartmentsError
    )
      return json(request, { error: { code: "team_list_failed" } }, 500);
    const candidateDepartmentIds = new Map<string, string[]>();
    for (const row of candidateDepartments ?? []) {
      if (
        typeof row.user_id !== "string" ||
        typeof row.department_id !== "string"
      )
        continue;
      candidateDepartmentIds.set(row.user_id, [
        ...(candidateDepartmentIds.get(row.user_id) ?? []),
        row.department_id,
      ]);
    }
    const safeCandidates = (candidates ?? [])
      .flatMap((row: any) => {
        const profile = Array.isArray(row.user_profiles)
          ? row.user_profiles[0]
          : row.user_profiles;
        const departmentIds = candidateDepartmentIds.get(row.user_id) ?? [];
        return typeof row.user_id === "string" &&
          typeof profile?.display_name === "string" &&
          departmentIds.length > 0
          ? [
              {
                id: row.user_id,
                displayName: profile.display_name.trim() || "Aktive Person",
                departmentIds: [...new Set(departmentIds)].sort(),
              },
            ]
          : [];
      })
      .sort((a: any, b: any) =>
        a.displayName.localeCompare(b.displayName, "de-CH"),
      );
    const memberByTeam = new Map<
      string,
      { userId: string; displayName: string }[]
    >();
    for (const row of members ?? []) {
      const profile = Array.isArray((row as any).user_profiles)
        ? (row as any).user_profiles[0]
        : (row as any).user_profiles;
      if (
        typeof row.team_id === "string" &&
        typeof row.user_id === "string" &&
        typeof profile?.display_name === "string"
      ) {
        memberByTeam.set(row.team_id, [
          ...(memberByTeam.get(row.team_id) ?? []),
          {
            userId: row.user_id,
            displayName: profile.display_name.trim() || "Aktive Person",
          },
        ]);
      }
    }
    return json(request, {
      data: {
        departments: departments ?? [],
        teams: (teams ?? []).flatMap((team: any) =>
          typeof team.id === "string" &&
          typeof team.department_id === "string" &&
          typeof team.name === "string" &&
          typeof team.active === "boolean"
            ? [
                {
                  id: team.id,
                  departmentId: team.department_id,
                  name: team.name,
                  active: team.active,
                  members: memberByTeam.get(team.id) ?? [],
                },
              ]
            : [],
        ),
        candidates: safeCandidates,
      },
    });
  }

  if (action.type === "save") {
    const { data: department, error: departmentError } =
      await context.supabaseAdmin
        .from("departments")
        .select("id")
        .eq("id", action.departmentId)
        .eq("tenant_id", action.tenantId)
        .eq("active", true)
        .maybeSingle();
    if (departmentError || !department)
      return json(request, { error: { code: "team_department_invalid" } }, 422);
    if (action.id) {
      const { data: existingTeam, error: existingTeamError } =
        await context.supabaseAdmin
          .from("teams")
          .select("id,department_id")
          .eq("id", action.id)
          .eq("tenant_id", action.tenantId)
          .maybeSingle();
      if (existingTeamError || !existingTeam)
        return json(request, { error: { code: "team_not_available" } }, 422);

      if (existingTeam.department_id !== action.departmentId) {
        const { data: existingMembers, error: existingMembersError } =
          await context.supabaseAdmin
            .from("team_memberships")
            .select("user_id")
            .eq("tenant_id", action.tenantId)
            .eq("team_id", action.id)
            .limit(200);
        if (existingMembersError)
          return json(
            request,
            { error: { code: "team_membership_read_failed" } },
            500,
          );
        const userIds = (existingMembers ?? []).flatMap((member: any) =>
          uuid(member.user_id) ? [member.user_id] : [],
        );
        if (userIds.length > 0) {
          const { data: targetMemberships, error: targetMembershipsError } =
            await context.supabaseAdmin
              .from("department_memberships")
              .select("user_id")
              .eq("tenant_id", action.tenantId)
              .eq("department_id", action.departmentId)
              .eq("status", "active")
              .in("user_id", userIds);
          if (
            targetMembershipsError ||
            (targetMemberships ?? []).length !== userIds.length
          )
            return json(
              request,
              { error: { code: "team_department_members_required" } },
              422,
            );
        }
      }
    }
    const query = action.id
      ? context.supabaseAdmin
          .from("teams")
          .update({ name: action.name, department_id: action.departmentId })
          .eq("id", action.id)
          .eq("tenant_id", action.tenantId)
      : context.supabaseAdmin.from("teams").insert({
          tenant_id: action.tenantId,
          department_id: action.departmentId,
          name: action.name,
          active: true,
        });
    const { data, error } = await query
      .select("id,department_id,name,active")
      .maybeSingle();
    if (error || !data)
      return json(request, { error: { code: "team_save_failed" } }, 422);
    await context.supabaseAdmin.from("audit_logs").insert({
      tenant_id: action.tenantId,
      actor_id: actorId,
      action: action.id ? "team.updated" : "team.created",
      entity_type: "team",
      entity_id: data.id,
      metadata: { department_id: data.department_id },
    });
    return json(request, {
      data: {
        team: {
          id: data.id,
          departmentId: data.department_id,
          name: data.name,
          active: data.active,
          members: [],
        },
      },
    });
  }

  if (action.type === "archive") {
    const { data, error } = await context.supabaseAdmin.rpc(
      "archive_team_if_no_open_tickets",
      {
        p_tenant_id: action.tenantId,
        p_team_id: action.id,
      },
    );
    if (error)
      return json(request, { error: { code: "team_archive_failed" } }, 500);
    if (data === "team_has_open_tickets")
      return json(request, { error: { code: "team_has_open_tickets" } }, 409);
    if (data !== "archived")
      return json(request, { error: { code: "team_archive_failed" } }, 422);
    await context.supabaseAdmin.from("audit_logs").insert({
      tenant_id: action.tenantId,
      actor_id: actorId,
      action: "team.archived",
      entity_type: "team",
      entity_id: action.id,
      metadata: {},
    });
    return json(request, { data: { archived: true } });
  }

  const { data, error } = await context.supabaseAdmin.rpc(
    "replace_team_memberships",
    {
      p_tenant_id: action.tenantId,
      p_team_id: action.teamId,
      p_user_ids: action.userIds,
    },
  );
  if (error)
    return json(request, { error: { code: "team_membership_failed" } }, 500);
  if (
    data !== "updated" &&
    data !== "team_not_available" &&
    data !== "team_member_invalid" &&
    data !== "team_department_members_required"
  )
    return json(request, { error: { code: "team_membership_failed" } }, 500);
  if (data !== "updated") return json(request, { error: { code: data } }, 422);
  await context.supabaseAdmin.from("audit_logs").insert({
    tenant_id: action.tenantId,
    actor_id: actorId,
    action: "team.members_replaced",
    entity_type: "team",
    entity_id: action.teamId,
    metadata: { member_count: action.userIds.length },
  });
  return json(request, { data: { updated: true } });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS")
      return request.headers.get("origin") === ORIGIN
        ? new Response(null, {
            status: 204,
            headers: {
              "Access-Control-Allow-Origin": ORIGIN,
              "Access-Control-Allow-Headers":
                "authorization, apikey, content-type, x-client-info",
              "Access-Control-Allow-Methods": "POST, OPTIONS",
              Vary: "Origin",
            },
          })
        : json(request, { error: { code: "origin_not_allowed" } }, 403);
    return handler(request);
  },
};
