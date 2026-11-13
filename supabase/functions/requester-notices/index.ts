import { loadFormality, tone } from "../_shared/formality.ts";
import { withSupabase } from "@supabase/server";
import {
  type CustomerTicketEmailKind,
  normalizeCustomerTicketEmailBranding,
  renderCustomerTicketEmail,
} from "../_shared/customer-ticket-email-template.ts";
import {
  DEFAULT_FREQUENCY_DAYS,
  NOTICE_FEATURE,
  noticeState,
  validateNoticeInput,
  zurichToday,
} from "../_shared/requester-notices.ts";
import { resolveTenantFeatureStates } from "../_shared/tenant-features.ts";

/**
 * Hinweise für Anfragende: Pflege (Mandanten-Administration) und Auslieferung
 * an Portal und App. Aktionen (POST, JWT; Antwort {data} oder {error:{code}}):
 *   Anfragende:  active, track
 *   Administration: adminList, adminSave, adminSetStatus, adminDelete,
 *                   adminSettings, adminPreviewMail, adminArticles
 * Mails erhalten ihren Hinweis im Mailversand (_shared/requester-notices.ts).
 */

const APP_ORIGIN = "https://app.nextdesk.ch";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLACEMENTS: Record<string, string> = {
  portal_banner: "show_portal_banner",
  portal_bar: "show_portal_bar",
  app: "show_app",
};

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

async function isTenantAdministrator(
  admin: Admin,
  actorId: string,
  tenantId: string,
): Promise<boolean> {
  const { data: role } = await admin
    .from("roles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", "Tenant administrator")
    .eq("scope", "tenant")
    .eq("active", true)
    .maybeSingle();
  if (!role?.id) return false;
  const now = new Date().toISOString();
  const { data: assignment } = await admin
    .from("user_role_assignments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .eq("role_id", role.id)
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();
  return Boolean(assignment);
}

function publicView(row: Row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    buttonLabel: row.button_label,
    linkKind: row.link_kind,
    linkTarget: row.link_target ?? null,
    symbol: row.symbol ?? null,
    color: row.color,
    dismissible: row.dismissible === true,
  };
}

const NOTICE_COLUMNS =
  "id, title, body, button_label, link_kind, link_target, symbol, color, show_portal_banner, show_portal_bar, show_mail, show_app, dismissible, starts_on, ends_on, status, updated_at";

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") return fail(request, "method_not_allowed", 405);
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
  const today = zurichToday();

  const { data: membership } = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .eq("status", "active")
    .maybeSingle();
  if (!membership) return fail(request, "tenant_access_denied", 403);

  // ------------------------------------------------------------ Anfragende
  if (body.type === "active" || body.type === "track") {
    const features = await resolveTenantFeatureStates(admin, tenantId, [NOTICE_FEATURE]);
    if (!features) return fail(request, "unavailable", 503);
    if (features[NOTICE_FEATURE] !== true) {
      return body.type === "active"
        ? json(request, { data: { notices: [] } })
        : fail(request, "feature_disabled", 403);
    }

    if (body.type === "active") {
      const column = typeof body.placement === "string" ? PLACEMENTS[body.placement] : undefined;
      if (!column) return fail(request, "invalid_request", 400);
      const { data: rows } = await admin
        .from("requester_notices")
        .select(NOTICE_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .eq(column, true)
        .lte("starts_on", today)
        .gte("ends_on", today)
        .order("ends_on", { ascending: true })
        .limit(20);
      const list = (rows ?? []) as Row[];
      const { data: dismissed } = list.length
        ? await admin
            .from("requester_notice_dismissals")
            .select("notice_id")
            .eq("user_id", actorId)
            .in("notice_id", list.map((row) => row.id))
        : { data: [] };
      const hidden = new Set(((dismissed ?? []) as Row[]).map((row) => String(row.notice_id)));
      return json(request, {
        data: { notices: list.filter((row) => !hidden.has(String(row.id))).slice(0, 1).map(publicView) },
      });
    }

    const channel = body.channel === "portal" || body.channel === "app" ? body.channel : null;
    const event = ["view", "click", "dismiss"].includes(String(body.event)) ? String(body.event) : null;
    if (!isUuid(body.noticeId) || !channel || !event) return fail(request, "invalid_request", 400);
    const { data: notice } = await admin
      .from("requester_notices")
      .select("id, dismissible, status")
      .eq("id", body.noticeId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!notice || notice.status !== "active") return fail(request, "notice_not_found", 404);
    if (event === "dismiss" && notice.dismissible === true) {
      await admin
        .from("requester_notice_dismissals")
        .upsert({ notice_id: notice.id, user_id: actorId }, { onConflict: "notice_id,user_id" });
    }
    await admin.rpc("requester_notice_count", {
      p_notice_id: notice.id,
      p_channel: channel,
      p_event: event,
    });
    return json(request, { data: { ok: true } });
  }

  // -------------------------------------------------------- Administration
  if (!String(body.type).startsWith("admin")) return fail(request, "invalid_request", 400);
  if (!(await isTenantAdministrator(admin, actorId, tenantId))) {
    return fail(request, "tenant_admin_required", 403);
  }

  if (body.type === "adminList") {
    const [{ data: rows }, { data: settings }] = await Promise.all([
      admin
        .from("requester_notices")
        .select(NOTICE_COLUMNS)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(200),
      admin
        .from("requester_notice_settings")
        .select("frequency_days")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);
    const list = (rows ?? []) as Row[];
    const totals = new Map<string, Record<string, number>>();
    if (list.length) {
      const { data: stats } = await admin
        .from("requester_notice_stats")
        .select("notice_id, channel, views, clicks, dismissals")
        .in("notice_id", list.map((row) => row.id));
      for (const stat of (stats ?? []) as Row[]) {
        const entry = totals.get(String(stat.notice_id)) ?? {
          views: 0, clicks: 0, dismissals: 0, mailViews: 0, mailClicks: 0,
        };
        if (stat.channel === "mail") {
          entry.mailViews += Number(stat.views);
          entry.mailClicks += Number(stat.clicks);
        } else {
          entry.views += Number(stat.views);
          entry.clicks += Number(stat.clicks);
          entry.dismissals += Number(stat.dismissals);
        }
        totals.set(String(stat.notice_id), entry);
      }
    }
    return json(request, {
      data: {
        notices: list.map((row) => ({
          ...publicView(row),
          status: row.status,
          state: noticeState(
            { status: String(row.status), starts_on: String(row.starts_on), ends_on: String(row.ends_on) },
            today,
          ),
          showPortalBanner: row.show_portal_banner === true,
          showPortalBar: row.show_portal_bar === true,
          showMail: row.show_mail === true,
          showApp: row.show_app === true,
          startsOn: row.starts_on,
          endsOn: row.ends_on,
          stats: totals.get(String(row.id)) ?? {
            views: 0, clicks: 0, dismissals: 0, mailViews: 0, mailClicks: 0,
          },
          updatedAt: row.updated_at,
        })),
        settings: {
          frequencyDays: Number.isInteger(settings?.frequency_days)
            ? settings.frequency_days
            : DEFAULT_FREQUENCY_DAYS,
        },
      },
    });
  }

  if (body.type === "adminSave") {
    const parsed = validateNoticeInput(body.notice, today);
    if (!parsed.ok) return fail(request, parsed.code);
    const value = parsed.value;
    const noticeId = isRecord(body.notice) && isUuid(body.notice.id) ? body.notice.id.toLowerCase() : null;
    const status = body.publish === true ? "active" : "draft";
    const row = {
      title: value.title,
      body: value.body,
      button_label: value.buttonLabel,
      link_kind: value.linkKind,
      link_target: value.linkTarget,
      symbol: value.symbol,
      color: value.color,
      show_portal_banner: value.showPortalBanner,
      show_portal_bar: value.showPortalBar,
      show_mail: value.showMail,
      show_app: value.showApp,
      dismissible: value.dismissible,
      starts_on: value.startsOn,
      ends_on: value.endsOn,
      status,
    };
    if (noticeId) {
      const { data, error } = await admin
        .from("requester_notices")
        .update(row)
        .eq("id", noticeId)
        .eq("tenant_id", tenantId)
        .select("id")
        .maybeSingle();
      if (error) return fail(request, "save_failed", 500);
      if (!data) return fail(request, "notice_not_found", 404);
      return json(request, { data: { id: data.id, status } });
    }
    const { data, error } = await admin
      .from("requester_notices")
      .insert({ ...row, tenant_id: tenantId, created_by: actorId })
      .select("id")
      .single();
    if (error || !data) return fail(request, "save_failed", 500);
    await admin.from("audit_logs").insert({
      tenant_id: tenantId,
      actor_id: actorId,
      action: "notice.created",
      entity_type: "requester_notice",
      entity_id: data.id,
      severity: "info",
      before_data: null,
      after_data: { title: value.title, status },
      metadata: {},
    });
    return json(request, { data: { id: data.id, status } }, 201);
  }

  if (body.type === "adminSetStatus") {
    if (!isUuid(body.noticeId) || (body.status !== "active" && body.status !== "paused")) {
      return fail(request, "invalid_request", 400);
    }
    const { data } = await admin
      .from("requester_notices")
      .update({ status: body.status })
      .eq("id", body.noticeId)
      .eq("tenant_id", tenantId)
      .select("id")
      .maybeSingle();
    return data ? json(request, { data: { ok: true } }) : fail(request, "notice_not_found", 404);
  }

  if (body.type === "adminDelete") {
    if (!isUuid(body.noticeId)) return fail(request, "invalid_request", 400);
    const { data } = await admin
      .from("requester_notices")
      .delete()
      .eq("id", body.noticeId)
      .eq("tenant_id", tenantId)
      .select("id")
      .maybeSingle();
    return data ? json(request, { data: { ok: true } }) : fail(request, "notice_not_found", 404);
  }

  if (body.type === "adminSettings") {
    const days = body.frequencyDays;
    if (typeof days !== "number" || !Number.isInteger(days) || days < 0 || days > 30) {
      return fail(request, "invalid_request", 400);
    }
    const { error } = await admin.from("requester_notice_settings").upsert(
      { tenant_id: tenantId, frequency_days: days, updated_by: actorId, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id" },
    );
    return error ? fail(request, "save_failed", 500) : json(request, { data: { ok: true } });
  }

  if (body.type === "adminArticles") {
    const query = typeof body.query === "string" ? body.query.replace(/[%_\\,()]/g, " ").trim().slice(0, 80) : "";
    let select = admin
      .from("knowledge_articles")
      .select("id, title")
      .eq("tenant_id", tenantId)
      .eq("status", "published")
      .eq("visibility", "external")
      .order("title", { ascending: true })
      .limit(20);
    if (query) select = select.ilike("title", `%${query}%`);
    const { data } = await select;
    return json(request, {
      data: { articles: ((data ?? []) as Row[]).map((row) => ({ id: row.id, title: row.title })) },
    });
  }

  if (body.type === "adminPreviewMail") {
    const parsed = validateNoticeInput(body.notice, today);
    const kind = body.kind;
    if (kind !== "acknowledgement" && kind !== "agent_reply" && kind !== "resolution") {
      return fail(request, "invalid_request", 400);
    }
    const [{ data: branding }, { data: settings }] = await Promise.all([
      admin
        .from("tenant_branding")
        .select("primary_color, secondary_color, accent_color")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      admin.from("tenant_settings").select("portal_name").eq("tenant_id", tenantId).maybeSingle(),
    ]);
    const formality = await loadFormality(admin, tenantId);
    const samples: Record<string, { subject: string; text: string; label: string }> = {
      acknowledgement: {
        subject: "Drucker im 2. Stock druckt nicht",
        text: tone(
          formality,
          "Deine Anfrage ist bei uns eingegangen und wurde als Ticket erfasst. Wir melden uns, sobald jemand daran arbeitet.",
          "Ihre Anfrage ist bei uns eingegangen und wurde als Ticket erfasst. Wir melden uns, sobald jemand daran arbeitet.",
        ),
        label: "Ticket im Portal ansehen",
      },
      agent_reply: {
        subject: "Drucker im 2. Stock druckt nicht",
        text: tone(
          formality,
          "Guten Tag Lea, ich habe den Sensor des Druckers zurückgesetzt. Bitte versuche es noch einmal und gib mir kurz Bescheid.",
          "Guten Tag Lea, ich habe den Sensor des Druckers zurückgesetzt. Bitte versuchen Sie es noch einmal und geben Sie mir kurz Bescheid.",
        ),
        label: "Im Portal antworten",
      },
      resolution: {
        subject: "Drucker im 2. Stock druckt nicht",
        text: "Der Papiersensor war verschmutzt und wurde gereinigt. Der Drucker läuft wieder einwandfrei.",
        label: "Ticket im Portal ansehen",
      },
    };
    const sample = samples[kind]!;
    const html = renderCustomerTicketEmail({
      kind: kind as CustomerTicketEmailKind,
      subject: sample.subject,
      text: sample.text,
      ticketNumber: "ICT-2026-000412",
      attachmentNotice: false,
      formality,
      branding: normalizeCustomerTicketEmailBranding({
        accentColor: branding?.accent_color ?? "",
        displayName: settings?.portal_name || "Support",
        logoContentId: null,
        primaryColor: branding?.primary_color ?? "",
        secondaryColor: branding?.secondary_color ?? "",
      }),
      primaryAction: { label: sample.label, url: `${APP_ORIGIN}/` },
      ...(kind === "resolution"
        ? { ratingLinks: [1, 2, 3, 4, 5].map((score) => ({ score, url: `${APP_ORIGIN}/` })) }
        : {}),
      ...(parsed.ok
        ? {
            notice: {
              title: parsed.value.title,
              body: parsed.value.body,
              buttonLabel: parsed.value.buttonLabel,
              url: `${APP_ORIGIN}/`,
              symbol: parsed.value.symbol,
              color: parsed.value.color,
            },
          }
        : {}),
    });
    return json(request, { data: { html, subject: `[ICT-2026-000412] ${sample.subject}` } });
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
