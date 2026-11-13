import { withSupabase } from "@supabase/server";

import {
  allowedHandbookIds,
  handbookAccessFromAssignments,
  isHandbookId,
  type HandbookId,
  type HandbookRoleAssignment,
} from "../_shared/handbook-access.ts";
import { loadFormality, type Formality } from "../_shared/formality.ts";

const APP_ORIGIN = "https://app.nextdesk.ch";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Action =
  | { type: "list"; tenantId: string }
  | { type: "get"; tenantId: string; handbookId: HandbookId };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  const origin = request.headers.get("origin");
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin === APP_ORIGIN ? APP_ORIGIN : "",
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json; charset=utf-8",
      Vary: "Origin",
    },
  });
}

export function parseHandbookAction(value: unknown): Action | null {
  if (!isRecord(value) || !isUuid(value.tenantId)) return null;
  if (value.type === "list") return { type: "list", tenantId: value.tenantId };
  if (value.type === "get" && isHandbookId(value.handbookId)) {
    return {
      type: "get",
      tenantId: value.tenantId,
      handbookId: value.handbookId,
    };
  }
  return null;
}

type DocumentRow = {
  id: HandbookId;
  title: string;
  description: string;
  audience_label: string;
  updated_on: string;
  // Formal («Sie») wording (migration 0328); null until the next sync.
  title_sie?: string | null;
  description_sie?: string | null;
  audience_label_sie?: string | null;
};

type DocumentWithText = DocumentRow & {
  markdown: string;
  markdown_sie?: string | null;
};

/** Columns that are always read; the «Sie» wording is added per request. */
const SUMMARY_COLUMNS = "id, title, description, audience_label, updated_on";
const SUMMARY_COLUMNS_SIE =
  "title_sie, description_sie, audience_label_sie";

/** The wording in the tenant's form of address; «du» when no «Sie» text is stored. */
export function summaryOf(row: DocumentRow, formality: Formality = "du") {
  const sie = formality === "sie";
  return {
    id: row.id,
    title: (sie && row.title_sie) || row.title,
    description: (sie && row.description_sie) || row.description,
    audienceLabel: (sie && row.audience_label_sie) || row.audience_label,
    updatedAt: row.updated_on,
  };
}

export function markdownOf(
  row: { markdown: string; markdown_sie?: string | null },
  formality: Formality = "du",
): string {
  return (formality === "sie" && row.markdown_sie) || row.markdown;
}

export function referencedHandbookImages(markdown: string): string[] {
  return [
    ...new Set(
      [...markdown.matchAll(/\]\(images\/([A-Za-z0-9._-]+)\)/g)].map(
        (match) => match[1]!,
      ),
    ),
  ];
}

/** Replaces `](images/<name>)` references with embedded data URLs. */
export function inlineHandbookImages(
  markdown: string,
  images: Record<string, { mime: string; data: string }>,
): string {
  return markdown.replace(
    /\]\(images\/([A-Za-z0-9._-]+)\)/g,
    (match, name: string) => {
      const image = images[name];
      return image ? `](data:${image.mime};base64,${image.data})` : match;
    },
  );
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST") {
    return json(request, { error: { code: "method_not_allowed" } }, 405);
  }
  const actorId = context.userClaims?.id;
  if (typeof actorId !== "string") {
    return json(request, { error: { code: "invalid_request" } }, 400);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(request, { error: { code: "invalid_request" } }, 400);
  }
  const action = parseHandbookAction(body);
  if (!action)
    return json(request, { error: { code: "invalid_request" } }, 400);

  const { data: membership, error: membershipError } =
    await context.supabaseAdmin
      .from("tenant_memberships")
      .select("tenant_id")
      .eq("tenant_id", action.tenantId)
      .eq("user_id", actorId)
      .eq("status", "active")
      .maybeSingle();
  if (membershipError) {
    return json(request, { error: { code: "access_lookup_failed" } }, 500);
  }
  if (!membership) {
    return json(
      request,
      { error: { code: "tenant_membership_required" } },
      403,
    );
  }

  const now = new Date().toISOString();
  const { data: assignments, error: assignmentError } =
    await context.supabaseAdmin
      .from("user_role_assignments")
      .select(
        "starts_at, expires_at, roles!user_role_assignments_role_tenant_fk!inner(name, scope, active, role_permissions(permission_code))",
      )
      .eq("tenant_id", action.tenantId)
      .eq("user_id", actorId)
      .lte("starts_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .limit(50);
  if (assignmentError) {
    return json(request, { error: { code: "access_lookup_failed" } }, 500);
  }
  const allowed = allowedHandbookIds(
    handbookAccessFromAssignments(
      (assignments ?? []) as HandbookRoleAssignment[],
      now,
    ),
  );

  // The handbooks come in the tenant's form of address (du or Sie).
  const formality = await loadFormality(context.supabaseAdmin, action.tenantId);
  const sie = formality === "sie";

  // Content lives in public.handbook_documents / handbook_images (migrations
  // 0246, 0328), loaded from docs/handbooks/handbooks.bundle.json of a pinned
  // commit: the «du» wording in the plain columns, «Sie» in the *_sie columns.
  if (action.type === "list") {
    const { data: rows, error } = await context.supabaseAdmin
      .from("handbook_documents")
      .select(sie ? `${SUMMARY_COLUMNS}, ${SUMMARY_COLUMNS_SIE}` : SUMMARY_COLUMNS)
      .in("id", allowed)
      .order("sort_order", { ascending: true });
    if (error) {
      return json(request, { error: { code: "handbook_lookup_failed" } }, 500);
    }
    return json(request, {
      data: {
        // The column list depends on the form of address, so the client cannot
        // infer the row type from it.
        handbooks: ((rows ?? []) as unknown as DocumentRow[]).map((row) =>
          summaryOf(row, formality),
        ),
      },
    });
  }

  if (!allowed.includes(action.handbookId)) {
    return json(request, { error: { code: "handbook_forbidden" } }, 403);
  }
  const { data: row, error: documentError } = await context.supabaseAdmin
    .from("handbook_documents")
    .select(
      sie
        ? `${SUMMARY_COLUMNS}, ${SUMMARY_COLUMNS_SIE}, markdown, markdown_sie`
        : `${SUMMARY_COLUMNS}, markdown`,
    )
    .eq("id", action.handbookId)
    .maybeSingle();
  if (documentError) {
    return json(request, { error: { code: "handbook_lookup_failed" } }, 500);
  }
  if (!row) {
    return json(request, { error: { code: "handbook_not_found" } }, 404);
  }
  const document = row as unknown as DocumentWithText;
  const markdown = markdownOf(document, formality);
  const imageNames = referencedHandbookImages(markdown);
  const images: Record<string, { mime: string; data: string }> = {};
  if (imageNames.length) {
    const { data: imageRows, error: imageError } = await context.supabaseAdmin
      .from("handbook_images")
      .select("name, mime, data")
      .in("name", imageNames);
    if (imageError) {
      return json(request, { error: { code: "handbook_lookup_failed" } }, 500);
    }
    for (const image of (imageRows ?? []) as Array<{
      name: string;
      mime: string;
      data: string;
    }>) {
      images[image.name] = { mime: image.mime, data: image.data };
    }
  }
  return json(request, {
    data: {
      handbook: {
        ...summaryOf(document, formality),
        markdown: inlineHandbookImages(markdown, images),
      },
    },
  });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    if (request.method === "OPTIONS") return json(request, {}, 204);
    return handler(request);
  },
};
