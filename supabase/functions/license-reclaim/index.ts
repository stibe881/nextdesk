import { withSupabase } from "@supabase/server";
import { isRecord, isUuid, json, noContent } from "../_shared/http.ts";
import { resolveUserFeatureStates } from "../_shared/tenant-features.ts";
import {
  type DepartmentScope,
  departmentVisible,
  loadDepartmentScope,
} from "../_shared/department-scope.ts";
import {
  EntraLicenseError,
  entraLicenseErrorMessage,
  fetchSignInActivity,
  removeUserLicense,
  savingsByCurrency,
} from "../_shared/entra-license-graph.ts";
import { softwareAccessToken } from "../shop/software.ts";
import {
  SoftwareDeployError,
  softwareDeployErrorMessage,
} from "../_shared/intune-software-graph.ts";
import { parseAction, type ReclaimAction } from "./actions.ts";

/**
 * License seats and license reclamation.
 *
 * License managers (contracts.manage, module "contracts.management") assign
 * seats of a license to people and see the «Rückgewinnung» list: seats of
 * people who left (membership inactive, Entra account disabled, exit done)
 * or have not signed in for N days. «Zurückgeben» frees the seat and can
 * optionally remove the Microsoft 365 license through Graph (assignLicense)
 * when the license has a SKU and the tenant allowed it.
 */

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

const SIGN_IN_CHUNK = 500;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const unavailable = (message: string) =>
  new HttpError(503, "license_reclaim_unavailable", message);

async function authorize(admin: Admin, actorId: string, tenantId: string) {
  const { data, error } = await admin.rpc(
    "has_contracts_management_permission",
    { p_tenant_id: tenantId, p_user_id: actorId },
  );
  if (error) throw unavailable("Die Berechtigung konnte nicht geprüft werden.");
  if (data !== true) {
    throw new HttpError(
      403,
      "licenses_manage_required",
      "Die Berechtigung für Lizenzen fehlt.",
    );
  }
  const feature = await resolveUserFeatureStates(admin, tenantId, actorId, [
    "contracts.management",
  ]);
  if (!feature) throw unavailable("Die Lizenzverwaltung ist nicht verfügbar.");
  if (!feature["contracts.management"]) {
    throw new HttpError(
      403,
      "licenses_feature_disabled",
      "Die Lizenzverwaltung ist für diesen Mandanten nicht aktiviert.",
    );
  }
  const scope = await loadDepartmentScope(
    admin,
    tenantId,
    actorId,
    "contracts.management",
  );
  if (!scope)
    throw unavailable("Die Abteilungen konnten nicht geprüft werden.");
  return scope;
}

type Settings = {
  inactivityDays: number;
  useEntraSignIn: boolean;
  allowM365Removal: boolean;
  signInsRefreshedAt: string | null;
  signInsError: string | null;
};

async function loadSettings(admin: Admin, tenantId: string): Promise<Settings> {
  const { data, error } = await admin
    .from("license_reclaim_settings")
    .select(
      "inactivity_days, use_entra_sign_in, allow_m365_removal, sign_ins_refreshed_at, sign_ins_error",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error)
    throw unavailable("Die Einstellungen konnten nicht geladen werden.");
  const row = (data ?? {}) as Row;
  return {
    inactivityDays:
      typeof row.inactivity_days === "number" ? row.inactivity_days : 60,
    useEntraSignIn: row.use_entra_sign_in !== false,
    allowM365Removal: row.allow_m365_removal === true,
    signInsRefreshedAt:
      typeof row.sign_ins_refreshed_at === "string"
        ? row.sign_ins_refreshed_at
        : null,
    signInsError:
      typeof row.sign_ins_error === "string" ? row.sign_ins_error : null,
  };
}

async function license(
  admin: Admin,
  tenantId: string,
  licenseId: string,
  scope: DepartmentScope,
): Promise<Row> {
  const { data, error } = await admin
    .from("licenses")
    .select("id, title, status, quantity, department_id, m365_sku_id")
    .eq("tenant_id", tenantId)
    .eq("id", licenseId)
    .maybeSingle();
  if (error) throw unavailable("Die Lizenz konnte nicht geladen werden.");
  if (!data || !departmentVisible(scope, (data as Row).department_id)) {
    throw new HttpError(
      404,
      "license_not_found",
      "Die Lizenz wurde nicht gefunden.",
    );
  }
  return data as Row;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function overview(
  admin: Admin,
  tenantId: string,
  scope: DepartmentScope,
) {
  const settings = await loadSettings(admin, tenantId);
  const { data, error } = await admin.rpc("license_reclaim_candidates", {
    p_tenant_id: tenantId,
    p_inactivity_days: settings.inactivityDays,
  });
  if (error)
    throw unavailable("Die Rückgewinnung konnte nicht berechnet werden.");
  const candidates = ((data ?? []) as Row[])
    .filter(
      (row) =>
        Array.isArray(row.reasons) &&
        row.reasons.length > 0 &&
        departmentVisible(scope, row.department_id),
    )
    .map((row) => ({
      assignmentId: String(row.assignment_id),
      licenseId: String(row.license_id),
      licenseTitle: String(row.license_title ?? ""),
      userId: isUuid(row.user_id) ? row.user_id : null,
      assigneeLabel: String(row.assignee_label ?? ""),
      assignedAt: row.assigned_at,
      reasons: (row.reasons as unknown[]).filter(
        (reason): reason is string => typeof reason === "string",
      ),
      lastSignInAt:
        typeof row.last_sign_in_at === "string" ? row.last_sign_in_at : null,
      signInSource:
        row.sign_in_source === "entra" || row.sign_in_source === "nextdesk"
          ? row.sign_in_source
          : null,
      monthlySaving: toNumber(row.monthly_saving),
      currency: typeof row.currency === "string" ? row.currency : "CHF",
      // M365 removal is offered when a SKU and an Entra account are known.
      m365Removable:
        settings.allowM365Removal &&
        isUuid(row.m365_sku_id) &&
        isUuid(row.entra_object_id),
    }))
    .sort(
      (left, right) =>
        (right.monthlySaving ?? 0) - (left.monthlySaving ?? 0) ||
        left.assigneeLabel.localeCompare(right.assigneeLabel, "de"),
    );
  return {
    settings,
    candidates,
    monthlySavings: savingsByCurrency(candidates),
  };
}

async function listAssignments(
  admin: Admin,
  tenantId: string,
  licenseId: string,
  scope: DepartmentScope,
) {
  const item = await license(admin, tenantId, licenseId, scope);
  const { data, error } = await admin
    .from("license_assignments")
    .select(
      "id, user_id, entra_object_id, assignee_label, note, assigned_at, released_at, release_reason, m365_removed_at",
    )
    .eq("tenant_id", tenantId)
    .eq("license_id", licenseId)
    .order("released_at", { ascending: false, nullsFirst: true })
    .order("assigned_at", { ascending: false })
    .limit(500);
  if (error) throw unavailable("Die Zuweisungen konnten nicht geladen werden.");
  const rows = (data ?? []) as Row[];
  const active = rows.filter((row) => row.released_at === null);
  return {
    quantity: toNumber(item.quantity),
    m365SkuId: isUuid(item.m365_sku_id) ? item.m365_sku_id : null,
    assignments: [
      ...active,
      ...rows.filter((row) => row.released_at !== null).slice(0, 20),
    ].map((row) => ({
      id: row.id,
      userId: row.user_id ?? null,
      entraObjectId: row.entra_object_id ?? null,
      assigneeLabel: row.assignee_label,
      note: row.note ?? null,
      assignedAt: row.assigned_at,
      releasedAt: row.released_at ?? null,
      releaseReason: row.release_reason ?? null,
      m365RemovedAt: row.m365_removed_at ?? null,
    })),
  };
}

async function listPeople(admin: Admin, tenantId: string) {
  const [{ data: members, error }, { data: directory }] = await Promise.all([
    admin
      .from("tenant_memberships")
      .select("user_id, user_profiles!inner(display_name)")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .limit(2000),
    admin
      .from("tenant_entra_directory_people")
      .select("entra_object_id, display_name, email, local_user_id")
      .eq("tenant_id", tenantId)
      .is("inactive_at", null)
      .limit(5000),
  ]);
  if (error) throw unavailable("Personen konnten nicht geladen werden.");
  const people = new Map<
    string,
    {
      userId: string | null;
      entraObjectId: string | null;
      label: string;
      email: string | null;
    }
  >();
  for (const member of (members ?? []) as Row[]) {
    const profile = member.user_profiles as Row | null;
    people.set(`u:${member.user_id}`, {
      userId: String(member.user_id),
      entraObjectId: null,
      label: String(profile?.display_name ?? "Unbekannte Person"),
      email: null,
    });
  }
  for (const person of (directory ?? []) as Row[]) {
    const linked = isUuid(person.local_user_id)
      ? people.get(`u:${person.local_user_id}`)
      : undefined;
    if (linked) {
      linked.entraObjectId = String(person.entra_object_id);
      linked.email = typeof person.email === "string" ? person.email : null;
      continue;
    }
    people.set(`e:${person.entra_object_id}`, {
      userId: null,
      entraObjectId: String(person.entra_object_id),
      label: String(person.display_name),
      email: typeof person.email === "string" ? person.email : null,
    });
  }
  return [...people.values()].sort((left, right) =>
    left.label.localeCompare(right.label, "de"),
  );
}

async function assign(
  admin: Admin,
  tenantId: string,
  actorId: string,
  action: Extract<ReclaimAction, { type: "assign" }>,
  scope: DepartmentScope,
) {
  const item = await license(admin, tenantId, action.licenseId, scope);
  if (item.status === "archived" || item.status === "terminated") {
    throw new HttpError(
      409,
      "license_inactive",
      "Einer beendeten oder archivierten Lizenz können keine Plätze zugewiesen werden.",
    );
  }
  let label: string | null = null;
  let entraObjectId = action.entraObjectId;
  if (action.userId) {
    const { data } = await admin
      .from("tenant_memberships")
      .select("user_id, user_profiles!inner(display_name)")
      .eq("tenant_id", tenantId)
      .eq("user_id", action.userId)
      .eq("status", "active")
      .maybeSingle();
    if (!data) {
      throw new HttpError(
        422,
        "assignee_invalid",
        "Die Person gehört nicht zum aktiven Mandanten.",
      );
    }
    label = String(
      (data as Row & { user_profiles: Row }).user_profiles.display_name,
    );
    if (!entraObjectId) {
      const { data: person } = await admin
        .from("tenant_entra_directory_people")
        .select("entra_object_id")
        .eq("tenant_id", tenantId)
        .eq("local_user_id", action.userId)
        .is("inactive_at", null)
        .limit(1)
        .maybeSingle();
      entraObjectId = isUuid(person?.entra_object_id)
        ? person.entra_object_id
        : null;
    }
  } else if (entraObjectId) {
    const { data: person } = await admin
      .from("tenant_entra_directory_people")
      .select("display_name")
      .eq("tenant_id", tenantId)
      .eq("entra_object_id", entraObjectId)
      .maybeSingle();
    if (!person) {
      throw new HttpError(
        422,
        "assignee_invalid",
        "Die Person wurde im Entra-Verzeichnis nicht gefunden.",
      );
    }
    label = String(person.display_name);
  }
  const quantity = toNumber(item.quantity);
  if (quantity !== null) {
    const { count } = await admin
      .from("license_assignments")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("license_id", action.licenseId)
      .is("released_at", null);
    if ((count ?? 0) >= quantity) {
      throw new HttpError(
        409,
        "license_full",
        `Alle ${quantity} Plätze dieser Lizenz sind vergeben.`,
      );
    }
  }
  const { data, error } = await admin
    .from("license_assignments")
    .insert({
      tenant_id: tenantId,
      license_id: action.licenseId,
      user_id: action.userId,
      entra_object_id: entraObjectId,
      assignee_label: (label ?? "Unbekannte Person").slice(0, 200),
      note: action.note,
      assigned_by: actorId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new HttpError(
        409,
        "already_assigned",
        "Die Person hat bereits einen Platz dieser Lizenz.",
      );
    }
    throw unavailable("Der Platz konnte nicht zugewiesen werden.");
  }
  return { id: data.id };
}

async function release(
  admin: Admin,
  tenantId: string,
  actorId: string,
  action: Extract<ReclaimAction, { type: "release" }>,
  scope: DepartmentScope,
) {
  const { data: seat, error } = await admin
    .from("license_assignments")
    .select("id, license_id, entra_object_id, released_at")
    .eq("tenant_id", tenantId)
    .eq("id", action.assignmentId)
    .maybeSingle();
  if (error) throw unavailable("Der Platz konnte nicht geladen werden.");
  if (!seat) {
    throw new HttpError(
      404,
      "assignment_not_found",
      "Der Platz wurde nicht gefunden.",
    );
  }
  const item = await license(admin, tenantId, String(seat.license_id), scope);
  if (seat.released_at !== null) return { released: true, m365Removed: false };

  let m365Removed = false;
  let m365Note: string | null = null;
  if (action.removeM365) {
    const settings = await loadSettings(admin, tenantId);
    if (!settings.allowM365Removal || !isUuid(item.m365_sku_id)) {
      throw new HttpError(
        409,
        "m365_removal_disabled",
        "Das Entfernen der Microsoft-365-Lizenz ist nicht eingerichtet.",
      );
    }
    if (!isUuid(seat.entra_object_id)) {
      throw new HttpError(
        409,
        "m365_user_unknown",
        "Für diese Person ist kein Entra-Konto bekannt.",
      );
    }
    try {
      const token = await softwareAccessToken(admin, tenantId);
      await removeUserLicense(token, seat.entra_object_id, item.m365_sku_id);
      m365Removed = true;
    } catch (graphError) {
      if (
        graphError instanceof EntraLicenseError &&
        graphError.code === "license_not_assigned"
      ) {
        m365Note = "Microsoft-365-Lizenz war nicht mehr zugewiesen.";
      } else if (graphError instanceof EntraLicenseError) {
        throw new HttpError(
          502,
          graphError.code,
          entraLicenseErrorMessage(graphError.code),
        );
      } else if (graphError instanceof SoftwareDeployError) {
        throw new HttpError(
          graphError.code === "provider_not_configured" ? 409 : 502,
          graphError.code,
          softwareDeployErrorMessage(graphError.code),
        );
      } else {
        throw graphError;
      }
    }
  }
  const reason = [action.reason, m365Note]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
  const now = new Date().toISOString();
  const { error: updateError } = await admin
    .from("license_assignments")
    .update({
      released_at: now,
      released_by: actorId,
      release_reason: reason || null,
      ...(m365Removed ? { m365_removed_at: now } : {}),
    })
    .eq("tenant_id", tenantId)
    .eq("id", action.assignmentId)
    .is("released_at", null);
  if (updateError)
    throw unavailable("Der Platz konnte nicht zurückgegeben werden.");
  const { error: auditError } = await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action: "license.seat_released",
    entity_type: "license_assignment",
    entity_id: action.assignmentId,
    severity: "info",
    metadata: { licenseId: seat.license_id, m365Removed },
  });
  if (auditError) console.error("License seat audit not written");
  return { released: true, m365Removed };
}

async function saveSettings(
  admin: Admin,
  tenantId: string,
  actorId: string,
  action: Extract<ReclaimAction, { type: "saveSettings" }>,
) {
  const { error } = await admin.from("license_reclaim_settings").upsert(
    {
      tenant_id: tenantId,
      inactivity_days: action.inactivityDays,
      use_entra_sign_in: action.useEntraSignIn,
      allow_m365_removal: action.allowM365Removal,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error)
    throw unavailable("Die Einstellungen konnten nicht gespeichert werden.");
  return await loadSettings(admin, tenantId);
}

async function refreshSignIns(admin: Admin, tenantId: string) {
  let updated = 0;
  let errorMessage: string | null = null;
  try {
    const token = await softwareAccessToken(admin, tenantId);
    const rows = await fetchSignInActivity(token);
    for (let index = 0; index < rows.length; index += SIGN_IN_CHUNK) {
      const { data, error } = await admin.rpc("apply_entra_sign_in_activity", {
        p_tenant_id: tenantId,
        p_rows: rows.slice(index, index + SIGN_IN_CHUNK),
      });
      if (error)
        throw unavailable("Die Anmeldedaten konnten nicht gespeichert werden.");
      updated += typeof data === "number" ? data : 0;
    }
  } catch (failure) {
    if (failure instanceof EntraLicenseError) {
      errorMessage = entraLicenseErrorMessage(failure.code);
    } else if (failure instanceof SoftwareDeployError) {
      errorMessage = softwareDeployErrorMessage(failure.code);
    } else {
      throw failure;
    }
  }
  await admin.from("license_reclaim_settings").upsert(
    {
      tenant_id: tenantId,
      ...(errorMessage
        ? {}
        : { sign_ins_refreshed_at: new Date().toISOString() }),
      sign_ins_error: errorMessage ? errorMessage.slice(0, 200) : null,
    },
    { onConflict: "tenant_id" },
  );
  return { updated, error: errorMessage };
}

async function handle(
  admin: Admin,
  actorId: string,
  action: ReclaimAction,
): Promise<Row> {
  const scope = await authorize(admin, actorId, action.tenantId);
  switch (action.type) {
    case "overview":
      return await overview(admin, action.tenantId, scope);
    case "listAssignments":
      return await listAssignments(
        admin,
        action.tenantId,
        action.licenseId,
        scope,
      );
    case "listPeople":
      return { people: await listPeople(admin, action.tenantId) };
    case "assign":
      return await assign(admin, action.tenantId, actorId, action, scope);
    case "release":
      return await release(admin, action.tenantId, actorId, action, scope);
    case "saveSettings":
      return {
        settings: await saveSettings(admin, action.tenantId, actorId, action),
      };
    case "refreshSignIns":
      return await refreshSignIns(admin, action.tenantId);
  }
}

const handler = withSupabase(
  { auth: "user", errors: { detailed: false } },
  async (request, context) => {
    try {
      if (request.method !== "POST") {
        return json(request, { error: { code: "method_not_allowed" } }, 405);
      }
      const actorId = context.userClaims?.id;
      if (!isUuid(actorId)) {
        return json(request, { error: { code: "unauthorized" } }, 401);
      }
      const body: unknown = await request.json().catch(() => null);
      const action = isRecord(body) ? parseAction(body) : null;
      if (!action) {
        return json(
          request,
          {
            error: {
              code: "invalid_request",
              message: "Die Anfrage ist ungültig.",
            },
          },
          400,
        );
      }
      const data = await handle(context.supabaseAdmin, actorId, action);
      return json(request, { data });
    } catch (error) {
      if (error instanceof HttpError) {
        return json(
          request,
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }
      console.error("license_reclaim_failed");
      return json(
        request,
        {
          error: {
            code: "license_reclaim_unavailable",
            message: "Die Lizenz-Rückgewinnung ist derzeit nicht verfügbar.",
          },
        },
        500,
      );
    }
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return noContent(request);
    return handler(request);
  },
};
