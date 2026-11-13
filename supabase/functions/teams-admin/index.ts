import { withSupabase } from "@supabase/server";
import { zurichToday } from "../_shared/teams-lifecycle.ts";
import {
  addTeamMember,
  archiveTeam,
  deleteTeam,
  listAllTeams,
  listTeamMembers,
  removeTeamMember,
  setTeamMemberOwner,
  teamDetails,
  teamMemberCounts,
  TeamsGraphError,
  unarchiveTeam,
} from "../_shared/teams-graph.ts";
import { addMonths, daysBetween, TEAM_LIMITS } from "../_shared/teams-model.ts";
import {
  teamsCredentialsConfigured,
  teamsEntraTenant,
  teamsGraphToken,
} from "../_shared/teams-token.ts";
import { TEAMS_FEATURE } from "../_shared/teams-settings.ts";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

/**
 * Menü «Teams»: alle Teams des Microsoft-Mandanten ansehen und verwalten.
 * Nur für Personen mit shop.manage. Aktionen (POST, JWT):
 *   getContext, sync, list, members, addMember, removeMember, setOwner,
 *   archive, unarchive, delete, setEnd, clearEnd
 */

const APP_ORIGIN = "https://app.nextdesk.ch";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHOP_FEATURE = "self_service.shop";
const SYNC_CONCURRENCY = 8;

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

function headers(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin === APP_ORIGIN ? APP_ORIGIN : "",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

const json = (request: Request, body: Row, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: headers(request),
  });

const fail = (request: Request, code: string, status = 422) =>
  json(request, { error: { code } }, status);

const isRecord = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

function graphFailure(request: Request, error: unknown) {
  const code = error instanceof TeamsGraphError ? error.code : "unavailable";
  return json(
    request,
    { error: { code: `graph_${code}` } },
    code === "consent_missing" ? 403 : code === "rate_limited" ? 429 : 502,
  );
}

async function allowed(admin: Admin, actorId: string, tenantId: string) {
  const { data, error } = await admin.rpc("shop_has_permission", {
    p_user_id: actorId,
    p_tenant_id: tenantId,
    p_permission_code: "shop.manage",
  });
  return !error && data === true;
}

async function audit(
  admin: Admin,
  tenantId: string,
  actorId: string,
  action: string,
  teamId: string,
  metadata: Row,
) {
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    entity_type: "teams_team",
    entity_id: null,
    severity: "info",
    before_data: null,
    after_data: null,
    metadata: { teamId, ...metadata },
  });
}

async function mapInChunks<T, R>(
  items: T[],
  size: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(
      ...(await Promise.all(items.slice(index, index + size).map(work))),
    );
  }
  return out;
}

async function syncDirectory(admin: Admin, tenantId: string, token: string) {
  const teams = await listAllTeams(token);
  const rows = await mapInChunks(teams, SYNC_CONCURRENCY, async (team) => {
    let details = {
      ownerIds: [] as string[],
      isArchived: false,
      webUrl: null as string | null,
    };
    let counts: { members: number; guests: number } | null = null;
    try {
      [details, counts] = await Promise.all([
        teamDetails(token, team.id),
        teamMemberCounts(token, team.id),
      ]);
    } catch {
      // Ein einzelnes Team ohne Zugriff stoppt den Abgleich nicht.
    }
    return {
      tenant_id: tenantId,
      graph_team_id: team.id,
      display_name: team.displayName.slice(0, 300),
      description: team.description,
      visibility: team.visibility,
      is_archived: details.isArchived,
      web_url: details.webUrl,
      owner_ids: details.ownerIds.filter((id) => UUID.test(id)),
      member_count: counts?.members ?? null,
      guest_count: counts?.guests ?? null,
      created_in_graph_at: team.createdAt,
      synced_at: new Date().toISOString(),
    };
  });
  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await admin
      .from("teams_directory")
      .upsert(rows.slice(index, index + 200), {
        onConflict: "tenant_id,graph_team_id",
      });
    if (error) throw new Error("directory_write_failed");
  }
  const seen = rows.map((row) => row.graph_team_id);
  const { data: known } = await admin
    .from("teams_directory")
    .select("graph_team_id")
    .eq("tenant_id", tenantId);
  const gone = ((known ?? []) as Row[])
    .map((row) => String(row.graph_team_id))
    .filter((id) => !seen.includes(id));
  if (gone.length > 0) {
    await admin
      .from("teams_directory")
      .delete()
      .eq("tenant_id", tenantId)
      .in("graph_team_id", gone);
  }
  return rows.length;
}

async function refreshOne(
  admin: Admin,
  tenantId: string,
  token: string,
  teamId: string,
) {
  const [details, counts] = await Promise.all([
    teamDetails(token, teamId),
    teamMemberCounts(token, teamId).catch(() => null),
  ]);
  await admin
    .from("teams_directory")
    .update({
      member_count: counts?.members ?? null,
      guest_count: counts?.guests ?? null,
      owner_ids: details.ownerIds.filter((id) => UUID.test(id)),
      is_archived: details.isArchived,
      web_url: details.webUrl,
      synced_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("graph_team_id", teamId);
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return fail(request, "method_not_allowed", 405);
  const body: unknown = await request.json().catch(() => null);
  const actorId = context.userClaims?.id;
  if (
    !isRecord(body) ||
    typeof body.type !== "string" ||
    !isUuid(body.tenantId) ||
    !isUuid(actorId)
  ) {
    return fail(request, "invalid_request", 400);
  }
  const admin = context.supabaseAdmin;
  const tenantId = body.tenantId.toLowerCase();

  const { data: membership } = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .eq("status", "active")
    .maybeSingle();
  if (!membership) return fail(request, "teams_tenant_access_denied", 403);
  const features = await resolveTenantFeatureStates(admin, tenantId, [
    SHOP_FEATURE,
    TEAMS_FEATURE,
  ]);
  if (!features) return fail(request, "teams_unavailable", 503);
  const canManage =
    features[SHOP_FEATURE] === true &&
    features[TEAMS_FEATURE] === true &&
    (await allowed(admin, actorId, tenantId));

  if (body.type === "getContext") {
    const configured =
      teamsCredentialsConfigured() &&
      (await teamsEntraTenant(admin, tenantId)) !== null;
    const { data: latest } = canManage
      ? await admin
          .from("teams_directory")
          .select("synced_at")
          .eq("tenant_id", tenantId)
          .order("synced_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };
    return json(request, {
      data: {
        canManage,
        configured,
        today: zurichToday(),
        syncedAt: latest?.synced_at ?? null,
      },
    });
  }
  if (!canManage) return fail(request, "teams_manage_denied", 403);

  if (body.type === "list") {
    const [{ data: teams }, { data: requests }] = await Promise.all([
      admin
        .from("teams_directory")
        .select(
          "graph_team_id, display_name, description, visibility, is_archived, web_url, owner_ids, member_count, guest_count, created_in_graph_at, synced_at",
        )
        .eq("tenant_id", tenantId)
        .order("display_name", { ascending: true })
        .limit(2000),
      admin
        .from("teams_requests")
        .select("id, graph_team_id, status, start_date, end_date, source")
        .eq("tenant_id", tenantId)
        .not("graph_team_id", "is", null)
        .limit(2000),
    ]);
    const byTeam = new Map(
      ((requests ?? []) as Row[]).map((row) => [
        String(row.graph_team_id),
        row,
      ]),
    );
    const ownerIds = [
      ...new Set(
        ((teams ?? []) as Row[]).flatMap(
          (row) => (row.owner_ids as string[]) ?? [],
        ),
      ),
    ];
    const names = new Map<string, string>();
    for (let index = 0; index < ownerIds.length; index += 200) {
      const { data: people } = await admin
        .from("tenant_entra_directory_people")
        .select("entra_object_id, display_name")
        .eq("tenant_id", tenantId)
        .in("entra_object_id", ownerIds.slice(index, index + 200));
      for (const person of (people ?? []) as Row[]) {
        names.set(
          String(person.entra_object_id),
          String(person.display_name ?? ""),
        );
      }
    }
    const today = zurichToday();
    return json(request, {
      data: {
        teams: ((teams ?? []) as Row[]).map((team) => {
          const request = byTeam.get(String(team.graph_team_id));
          const end =
            request && request.status === "ready"
              ? String(request.end_date)
              : null;
          return {
            teamId: team.graph_team_id,
            name: team.display_name,
            description: team.description ?? null,
            visibility: team.visibility ?? null,
            archived: team.is_archived === true,
            webUrl: team.web_url ?? null,
            owners: ((team.owner_ids as string[]) ?? []).map(
              (id) => names.get(id) ?? "Unbekannt",
            ),
            ownerCount: ((team.owner_ids as string[]) ?? []).length,
            source: request ? request.source : "existing",
            requestId: request?.id ?? null,
            requestStatus: request?.status ?? null,
            startDate: request ? request.start_date : null,
            endDate: end,
            daysLeft: end ? daysBetween(today, end) : null,
            createdAt: team.created_in_graph_at ?? null,
            memberCount: team.member_count ?? null,
            guestCount: team.guest_count ?? null,
          };
        }),
        syncedAt: ((teams ?? []) as Row[])[0]?.synced_at ?? null,
      },
    });
  }

  if (body.type === "history") {
    const teamId =
      typeof body.teamId === "string" && UUID.test(body.teamId)
        ? body.teamId.toLowerCase()
        : null;
    if (!teamId) return fail(request, "invalid_request", 400);
    const { data: linked } = await admin
      .from("teams_requests")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("graph_team_id", teamId)
      .maybeSingle();
    const columns =
      "action, actor_id, after_data, before_data, metadata, occurred_at";
    const [byTeam, byRequest] = await Promise.all([
      admin
        .from("audit_logs")
        .select(columns)
        .eq("tenant_id", tenantId)
        .eq("entity_type", "teams_team")
        .eq("metadata->>teamId", teamId)
        .order("occurred_at", { ascending: false })
        .limit(50),
      linked
        ? admin
            .from("audit_logs")
            .select(columns)
            .eq("tenant_id", tenantId)
            .eq("entity_type", "teams_request")
            .eq("entity_id", linked.id)
            .order("occurred_at", { ascending: false })
            .limit(50)
        : Promise.resolve({ data: [] }),
    ]);
    const rows = [
      ...((byTeam.data ?? []) as Row[]),
      ...((byRequest.data ?? []) as Row[]),
    ]
      .sort((a, b) =>
        String(b.occurred_at).localeCompare(String(a.occurred_at)),
      )
      .slice(0, 50);
    const actorIds = [
      ...new Set(rows.map((row) => row.actor_id).filter(isUuid)),
    ];
    const actors = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: profiles } = await admin
        .from("user_profiles")
        .select("id, display_name")
        .in("id", actorIds);
      for (const profile of (profiles ?? []) as Row[]) {
        actors.set(String(profile.id), String(profile.display_name ?? ""));
      }
    }
    return json(request, {
      data: {
        events: rows.map((row) => ({
          action: row.action,
          at: row.occurred_at,
          actor: isUuid(row.actor_id)
            ? (actors.get(row.actor_id) ?? null)
            : null,
          details: {
            ...(isRecord(row.metadata) ? row.metadata : {}),
            ...(isRecord(row.after_data) ? row.after_data : {}),
          },
        })),
      },
    });
  }

  let token: string;
  try {
    token = await teamsGraphToken(admin, tenantId);
  } catch (error) {
    return graphFailure(request, error);
  }

  if (body.type === "sync") {
    try {
      const count = await syncDirectory(admin, tenantId, token);
      await audit(admin, tenantId, actorId, "teams.directory.synced", "all", {
        count,
      });
      return json(request, { data: { count } });
    } catch (error) {
      return error instanceof TeamsGraphError
        ? graphFailure(request, error)
        : fail(request, "teams_sync_failed", 500);
    }
  }

  const teamId =
    typeof body.teamId === "string" && UUID.test(body.teamId)
      ? body.teamId.toLowerCase()
      : null;
  if (!teamId) return fail(request, "invalid_request", 400);
  const { data: team } = await admin
    .from("teams_directory")
    .select("graph_team_id, display_name, owner_ids")
    .eq("tenant_id", tenantId)
    .eq("graph_team_id", teamId)
    .maybeSingle();
  if (!team) return fail(request, "teams_team_not_found", 404);

  try {
    if (body.type === "members") {
      const members = await listTeamMembers(token, teamId);
      return json(request, { data: { members } });
    }

    if (body.type === "addMember") {
      if (!isUuid(body.userId)) return fail(request, "invalid_request", 400);
      const { data: person } = await admin
        .from("tenant_entra_directory_people")
        .select("entra_object_id")
        .eq("tenant_id", tenantId)
        .eq("entra_object_id", body.userId)
        .eq("account_enabled", true)
        .is("inactive_at", null)
        .maybeSingle();
      if (!person) return fail(request, "person_unknown");
      await addTeamMember(
        token,
        teamId,
        body.userId.toLowerCase(),
        body.owner === true,
      );
      await refreshOne(admin, tenantId, token, teamId);
      await audit(admin, tenantId, actorId, "teams.member.added", teamId, {
        owner: body.owner === true,
      });
      return json(request, { data: { ok: true } });
    }

    if (body.type === "removeMember" || body.type === "setOwner") {
      if (typeof body.membershipId !== "string" || !body.membershipId) {
        return fail(request, "invalid_request", 400);
      }
      const members = await listTeamMembers(token, teamId);
      const target = members.find(
        (member) => member.membershipId === body.membershipId,
      );
      if (!target) return fail(request, "teams_member_not_found", 404);
      const owners = members.filter((member) => member.isOwner);
      const losesOwner =
        target.isOwner && (body.type === "removeMember" || body.owner !== true);
      if (losesOwner && owners.length <= 1)
        return fail(request, "last_owner", 409);
      if (body.type === "removeMember") {
        await removeTeamMember(token, teamId, target.membershipId);
      } else {
        await setTeamMemberOwner(
          token,
          teamId,
          target.membershipId,
          body.owner === true,
        );
      }
      await refreshOne(admin, tenantId, token, teamId);
      await audit(
        admin,
        tenantId,
        actorId,
        body.type === "removeMember"
          ? "teams.member.removed"
          : "teams.member.role_changed",
        teamId,
        { owner: body.owner === true },
      );
      return json(request, { data: { ok: true } });
    }

    if (body.type === "delete") {
      // Sicherung: der Name des Teams muss mitgeschickt werden.
      if (
        typeof body.confirmName !== "string" ||
        body.confirmName.trim() !== String(team.display_name).trim()
      ) {
        return fail(request, "confirm_mismatch", 400);
      }
      await deleteTeam(token, teamId);
      await admin
        .from("teams_requests")
        .update({ status: "archived", archived_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("graph_team_id", teamId)
        .in("status", ["ready", "provisioning", "queued", "failed"]);
      await admin
        .from("teams_directory")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("graph_team_id", teamId);
      await audit(admin, tenantId, actorId, "teams.team.deleted", teamId, {
        name: String(team.display_name).slice(0, 120),
      });
      return json(request, { data: { ok: true } });
    }

    if (body.type === "archive" || body.type === "unarchive") {
      const archive = body.type === "archive";
      if (archive) await archiveTeam(token, teamId);
      else await unarchiveTeam(token, teamId);
      await admin
        .from("teams_directory")
        .update({ is_archived: archive })
        .eq("tenant_id", tenantId)
        .eq("graph_team_id", teamId);
      await admin
        .from("teams_requests")
        .update(
          archive
            ? { status: "archived", archived_at: new Date().toISOString() }
            : { status: "ready", archived_at: null },
        )
        .eq("tenant_id", tenantId)
        .eq("graph_team_id", teamId)
        .in("status", archive ? ["ready"] : ["archived"]);
      await audit(
        admin,
        tenantId,
        actorId,
        archive ? "teams.team.archived" : "teams.team.unarchived",
        teamId,
        {},
      );
      return json(request, { data: { ok: true } });
    }
  } catch (error) {
    return graphFailure(request, error);
  }

  if (body.type === "setEnd") {
    const today = zurichToday();
    const endDate = typeof body.endDate === "string" ? body.endDate : "";
    const limit = addMonths(today, TEAM_LIMITS.extensionHorizonMonths);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate <= today) {
      return fail(request, "dates_invalid");
    }
    if (!limit || endDate > limit) return fail(request, "lifetime_too_long");
    const { data: existing } = await admin
      .from("teams_requests")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .eq("graph_team_id", teamId)
      .maybeSingle();
    if (existing) {
      if (existing.status !== "ready")
        return fail(request, "teams_extend_not_possible", 409);
      await admin
        .from("teams_requests")
        .update({
          end_date: endDate,
          reminded_14_at: null,
          reminded_7_at: null,
          reminded_1_at: null,
        })
        .eq("id", existing.id);
    } else {
      const owners = ((team.owner_ids as string[]) ?? []).filter((id) =>
        UUID.test(id),
      );
      if (owners.length === 0) return fail(request, "no_owner");
      const { error } = await admin.from("teams_requests").insert({
        tenant_id: tenantId,
        requested_by: actorId,
        name: String(team.display_name).slice(0, 120).padEnd(3, " "),
        visibility: "private",
        owner_ids: owners.slice(0, 10),
        start_date: today,
        end_date: endDate,
        status: "ready",
        graph_team_id: teamId,
        ready_at: new Date().toISOString(),
        source: "import",
      });
      if (error) return fail(request, "teams_end_failed", 500);
    }
    await audit(admin, tenantId, actorId, "teams.team.end_set", teamId, {
      endDate,
    });
    return json(request, { data: { endDate } });
  }

  if (body.type === "clearEnd") {
    await admin
      .from("teams_requests")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("graph_team_id", teamId)
      .eq("source", "import")
      .eq("status", "ready");
    await audit(admin, tenantId, actorId, "teams.team.end_cleared", teamId, {});
    return json(request, { data: { ok: true } });
  }

  return fail(request, "invalid_request", 400);
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: headers(request) });
    }
    return handler(request);
  },
};
