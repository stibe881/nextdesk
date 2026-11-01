import { withSupabase } from "@supabase/server";
import {
  isRecord,
  isUuid,
  json,
  noContent,
  parseJsonObject,
} from "../_shared/http.ts";

/**
 * Self-service account endpoint used by the web app and the iOS app.
 *
 * - `getAccount`: summary for the signed-in person (own personal workspace).
 * - `createPersonalWorkspace`: creates the personal workspace of a freshly
 *   registered person who does not belong to any organisation yet.
 * - `deleteAccount`: deletes the account and the personal workspace it owns
 *   (App Store Review Guideline 5.1.1(v)).
 */

type Action =
  | { type: "getAccount" }
  | { type: "createPersonalWorkspace"; name: string }
  | { type: "deleteAccount"; confirmation: "LÖSCHEN" };

// Every bucket stores objects below `<tenantId>/…`.
const TENANT_BUCKETS = [
  "ticket-attachments",
  "record-attachments",
  "inventory-item-images",
  "tenant-branding",
];

function normalizedName(value: unknown): string | null {
  if (typeof value !== "string" || value.includes("\u0000")) return null;
  const name = value.trim().replace(/\s+/g, " ");
  const length = Array.from(name).length;
  return length >= 2 && length <= 160 ? name : null;
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "getAccount") return { type: "getAccount" };
  if (value.type === "createPersonalWorkspace") {
    const name = normalizedName(value.name);
    return name ? { type: "createPersonalWorkspace", name } : null;
  }
  if (value.type === "deleteAccount" && value.confirmation === "LÖSCHEN") {
    return { type: "deleteAccount", confirmation: "LÖSCHEN" };
  }
  return null;
}

type StorageClient = {
  storage: {
    from: (bucket: string) => {
      list: (
        path: string,
        options: { limit: number; offset: number },
      ) => PromiseLike<{
        data: Array<{ name: string; id: string | null }> | null;
        error: unknown;
      }>;
      remove: (paths: string[]) => PromiseLike<{ error: unknown }>;
    };
  };
};

/** Best-effort removal of all stored files of a deleted workspace. */
async function removeWorkspaceFiles(admin: StorageClient, tenantId: string) {
  for (const bucket of TENANT_BUCKETS) {
    const pending = [tenantId];
    let guard = 0;
    while (pending.length > 0 && guard < 5000) {
      guard += 1;
      const folder = pending.pop() as string;
      const { data, error } = await admin.storage
        .from(bucket)
        .list(folder, { limit: 1000, offset: 0 });
      if (error || !data || data.length === 0) continue;
      const files: string[] = [];
      for (const entry of data) {
        const path = `${folder}/${entry.name}`;
        // Folders are returned without an object id.
        if (entry.id === null) pending.push(path);
        else files.push(path);
      }
      if (files.length > 0) {
        const { error: removeError } = await admin.storage
          .from(bucket)
          .remove(files);
        if (removeError) {
          console.error("Workspace file removal failed", { bucket });
          continue;
        }
        // The folder may contain more than one page of files.
        if (data.length === 1000) pending.push(folder);
      }
    }
  }
}

function randomSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

const securedHandler = withSupabase(
  { auth: "user" },
  async (request, context) => {
    if (request.method !== "POST") {
      return json(request, { error: { code: "method_not_allowed" } }, 405);
    }
    const body = await parseJsonObject(request);
    const action = body ? parseAction(body) : null;
    const actorId = context.userClaims?.id;
    if (!action || !isUuid(actorId)) {
      return json(request, { error: { code: "invalid_request" } }, 400);
    }
    const admin = context.supabaseAdmin;

    if (action.type === "getAccount") {
      const { data: workspace, error } = await admin
        .from("tenants")
        .select("id, name")
        .eq("owner_user_id", actorId)
        .eq("workspace_kind", "personal")
        .maybeSingle();
      if (error) {
        return json(request, { error: { code: "account_lookup_failed" } }, 500);
      }
      let memberCount = 0;
      if (workspace) {
        const { count } = await admin
          .from("tenant_memberships")
          .select("user_id", { count: "exact", head: true })
          .eq("tenant_id", workspace.id)
          .eq("status", "active");
        memberCount = count ?? 0;
      }
      return json(request, {
        data: {
          personalWorkspace: workspace
            ? { id: workspace.id, name: workspace.name, memberCount }
            : null,
        },
      });
    }

    if (action.type === "createPersonalWorkspace") {
      const { data: user, error: userError } =
        await admin.auth.admin.getUserById(actorId);
      if (userError || !user.user?.email) {
        return json(
          request,
          { error: { code: "account_lookup_failed" } },
          500,
        );
      }
      const { data: tenantId, error } = await admin.rpc(
        "provision_personal_workspace",
        {
          p_user_id: actorId,
          p_email: user.user.email,
          p_name: action.name,
        },
      );
      if (error || !isUuid(tenantId)) {
        if (error?.code === "23505") {
          return json(
            request,
            {
              error: {
                code: "personal_workspace_exists",
                message: "Für dieses Konto besteht bereits ein Arbeitsbereich.",
              },
            },
            409,
          );
        }
        if (error?.code === "42501") {
          return json(
            request,
            {
              error: {
                code: "organisation_sso_required",
                message:
                  "Ihre E-Mail-Adresse gehört zu einer Organisation mit SSO. Bitte melden Sie sich mit SSO an.",
              },
            },
            403,
          );
        }
        console.error("Personal workspace provisioning failed", {
          code: error?.code,
        });
        return json(
          request,
          { error: { code: "personal_workspace_failed" } },
          422,
        );
      }
      return json(request, { data: { tenantId } }, 201);
    }

    // deleteAccount
    const { data: result, error: deleteError } = await admin.rpc(
      "delete_user_account",
      { p_user_id: actorId },
    );
    if (deleteError || !isRecord(result)) {
      console.error("Account deletion failed", { code: deleteError?.code });
      return json(request, { error: { code: "account_deletion_failed" } }, 500);
    }
    const purged = Array.isArray(result.purgedWorkspaceIds)
      ? result.purgedWorkspaceIds.filter(isUuid)
      : [];
    for (const tenantId of purged) {
      try {
        await removeWorkspaceFiles(
          admin as unknown as StorageClient,
          tenantId,
        );
      } catch {
        console.error("Workspace file removal failed");
      }
    }

    let authDeleted = false;
    if (result.profileDeleted === true) {
      const { error } = await admin.auth.admin.deleteUser(actorId);
      authDeleted = !error;
    }
    if (!authDeleted) {
      // Records of another organisation still reference this person. The
      // login is anonymised and permanently disabled instead.
      const { error } = await admin.auth.admin.updateUserById(actorId, {
        email: `deleted-${actorId}@deleted.nextdesk.ch`,
        email_confirm: true,
        password: randomSecret(),
        user_metadata: {},
        ban_duration: "876000h",
      });
      if (error) {
        console.error("Account anonymisation failed", { code: error.code });
        return json(
          request,
          { error: { code: "account_deletion_failed" } },
          500,
        );
      }
    }
    return json(request, { data: { deleted: true } });
  },
);

export default {
  fetch(request: Request): Response | Promise<Response> {
    return request.method === "OPTIONS"
      ? noContent(request)
      : securedHandler(request);
  },
};
