import { withSupabase } from "@supabase/server";
import {
  encryptRefreshToken,
  exchangeAuthorizationCode,
  graphIdentityFromAccessToken,
  sha256Hex,
  validateMicrosoftIdToken,
} from "../_shared/exchange-delegated-oauth.ts";
import { ExchangeMailError } from "../_shared/exchange-graph.ts";

const RETURN_URL = "https://app.nextdesk.ch/?microsoft365=connected";

function html(title: string, message: string, success = false): Response {
  const safeTitle = title.replace(/[<>&"']/g, "");
  const safeMessage = message.replace(/[<>&"']/g, "");
  const body = `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title>${success ? `<meta http-equiv="refresh" content="4;url=${RETURN_URL}">` : ""}<style>body{margin:0;background:#f7f9fc;color:#17233c;font-family:Inter,system-ui,sans-serif}.page{max-width:580px;margin:10vh auto;padding:32px;background:white;border:1px solid #dbe3f0;border-radius:20px;box-shadow:0 16px 44px rgba(27,53,103,.08)}h1{font-size:24px;margin:0 0 12px}p{line-height:1.55;color:#52617a}a{display:inline-block;margin-top:8px;padding:12px 16px;border-radius:10px;background:#2563eb;color:white;text-decoration:none;font-weight:700}</style></head><body><main class="page"><h1>${safeTitle}</h1><p>${safeMessage}</p><a href="${RETURN_URL}">Zu nextDesk zurück</a></main></body></html>`;
  return new Response(body, {
    status: success ? 200 : 400,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}

function validOpaque(
  value: string | null,
  min: number,
  max: number,
): value is string {
  return Boolean(
    value &&
    value.length >= min &&
    value.length <= max &&
    /^[A-Za-z0-9._~-]+$/.test(value),
  );
}

async function consumeState(admin: any, rawState: string) {
  const result = await admin
    .schema("mail_private")
    .from("exchange_mail_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state_hash", await sha256Hex(rawState))
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("tenant_id, actor_id, code_verifier, nonce_hash")
    .maybeSingle();
  return result.error ? null : result.data;
}

async function remainsTenantAdministrator(
  admin: any,
  tenantId: string,
  actorId: string,
): Promise<boolean> {
  const membership = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .eq("status", "active")
    .maybeSingle();
  if (membership.error || !membership.data) return false;
  const permission = await admin.rpc("user_has_tenant_permission", {
    p_user_id: actorId,
    p_tenant_id: tenantId,
    p_permission_code: "tenant.settings.manage",
  });
  return !permission.error && permission.data === true;
}

const handler = withSupabase(
  { auth: "none", cors: "disabled", errors: { detailed: false } },
  async (request, context) => {
    if (request.method !== "GET") {
      return new Response(null, { status: 405, headers: { Allow: "GET" } });
    }
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    const providerError = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (!validOpaque(state, 32, 256))
      return html(
        "Microsoft-365-Verbindung abgebrochen",
        "Der Rücksprung konnte nicht geprüft werden. Bitte starten Sie die Verbindung in nextDesk erneut.",
      );
    const oauth = await consumeState(context.supabaseAdmin, state);
    if (!oauth)
      return html(
        "Microsoft-365-Verbindung abgebrochen",
        "Dieser Rücksprung ist abgelaufen oder wurde bereits verwendet. Bitte starten Sie die Verbindung in nextDesk erneut.",
      );
    if (providerError || !validOpaque(code, 8, 8192)) {
      await context.supabaseAdmin.from("audit_logs").insert({
        tenant_id: oauth.tenant_id,
        actor_id: oauth.actor_id,
        action: "exchange_mail.connection.cancelled",
        entity_type: "exchange_mail_connection",
        entity_id: null,
        severity: "security",
        metadata: { source: "microsoft_oauth" },
      });
      return html(
        "Microsoft-365-Verbindung abgebrochen",
        "Die Microsoft-Anmeldung wurde nicht abgeschlossen. Es wurde keine Postfachverbindung gespeichert.",
      );
    }
    if (
      !(await remainsTenantAdministrator(
        context.supabaseAdmin,
        oauth.tenant_id,
        oauth.actor_id,
      ))
    ) {
      await context.supabaseAdmin.from("audit_logs").insert({
        tenant_id: oauth.tenant_id,
        actor_id: oauth.actor_id,
        action: "exchange_mail.connection.rejected",
        entity_type: "exchange_mail_connection",
        entity_id: null,
        severity: "security",
        metadata: { reason: "tenant_admin_revoked" },
      });
      return html(
        "Microsoft-365-Verbindung nicht möglich",
        "Ihre Mandantenadministration ist nicht mehr aktiv. Eine aktive Mandantenadministration kann die Verbindung erneut starten.",
      );
    }
    try {
      const token = await exchangeAuthorizationCode(code, oauth.code_verifier);
      const identity = await validateMicrosoftIdToken(
        token.idToken,
        oauth.nonce_hash,
      );
      const graphIdentity = await graphIdentityFromAccessToken(
        token.accessToken,
      );
      if (graphIdentity.id !== identity.connectorObjectId) {
        throw new ExchangeMailError("exchange_unavailable", 503);
      }
      const now = new Date().toISOString();
      const connection = await context.supabaseAdmin
        .from("exchange_mail_connections")
        .upsert(
          {
            tenant_id: oauth.tenant_id,
            entra_tenant_id: identity.entraTenantId,
            connector_object_id: identity.connectorObjectId,
            connector_principal: graphIdentity.principal,
            granted_scopes: token.scopes,
            status: "connected",
            last_connected_at: now,
            last_error_code: null,
            last_error_message: null,
            created_by: oauth.actor_id,
            updated_by: oauth.actor_id,
            updated_at: now,
          },
          { onConflict: "tenant_id,entra_tenant_id,connector_object_id" },
        )
        .select("id, tenant_id")
        .single();
      if (connection.error || !connection.data)
        throw new ExchangeMailError("exchange_unavailable", 503);
      const credentials = await context.supabaseAdmin
        .schema("mail_private")
        .from("exchange_mail_connection_credentials")
        .upsert(
          {
            connection_id: connection.data.id,
            tenant_id: connection.data.tenant_id,
            refresh_token_ciphertext: await encryptRefreshToken(
              token.refreshToken,
            ),
            key_version: 1,
            updated_at: now,
          },
          { onConflict: "connection_id" },
        );
      if (credentials.error) {
        await context.supabaseAdmin
          .from("exchange_mail_connections")
          .update({
            status: "reauthorization_required",
            last_error_code: "exchange_reauthorization_required",
            last_error_message:
              "Microsoft 365 verlangt eine erneute Anmeldung.",
          })
          .eq("id", connection.data.id)
          .eq("tenant_id", oauth.tenant_id);
        throw new ExchangeMailError("exchange_unavailable", 503);
      }
      await context.supabaseAdmin.from("audit_logs").insert({
        tenant_id: oauth.tenant_id,
        actor_id: oauth.actor_id,
        action: "exchange_mail.connection.connected",
        entity_type: "exchange_mail_connection",
        entity_id: connection.data.id,
        severity: "security",
        metadata: { access_mode: "delegated" },
      });
      return html(
        "Microsoft 365 verbunden",
        "Die Connector-Anmeldung wurde sicher gespeichert. Sie werden zurück zu nextDesk geleitet und können danach Support-Postfächer hinzufügen.",
        true,
      );
    } catch (error) {
      const code =
        error instanceof ExchangeMailError
          ? error.code
          : "exchange_unavailable";
      await context.supabaseAdmin.from("audit_logs").insert({
        tenant_id: oauth.tenant_id,
        actor_id: oauth.actor_id,
        action: "exchange_mail.connection.failed",
        entity_type: "exchange_mail_connection",
        entity_id: null,
        severity: "security",
        metadata: { reason: code },
      });
      return html(
        "Microsoft-365-Verbindung nicht möglich",
        code === "exchange_access_denied"
          ? "Microsoft hat nicht alle notwendigen, delegierten Mailberechtigungen freigegeben. Bitte lassen Sie die Freigabe vollständig abschliessen und versuchen Sie es erneut."
          : "Die Verbindung konnte nicht sicher abgeschlossen werden. Es wurde kein verwendbarer Postfachzugriff aktiviert. Bitte starten Sie die Verbindung in nextDesk erneut.",
      );
    }
  },
);

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      return await handler(request);
    } catch {
      return html(
        "Microsoft-365-Verbindung nicht möglich",
        "Der Rücksprung konnte nicht verarbeitet werden. Es wurde kein Postfach aktiviert.",
      );
    }
  },
};
