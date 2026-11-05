// Who may read which knowledge articles (shared by knowledge-base,
// ticket-knowledge and ticket-suggestions).
//
// - Internal readers (permission knowledge.read) see the articles of their
//   departments (userFeatureDepartments for knowledge.base) incl. internal ones.
// - Everybody else (requesters, customers) reads only published external
//   articles of every active department where the knowledge module is on,
//   limited to articles without a customer organisation or of their own
//   customer organisations.

import type { DepartmentScope } from "./department-scope.ts";
import { isUuid } from "./http.ts";

export const KNOWLEDGE_FEATURE = "knowledge.base";

// deno-lint-ignore no-explicit-any
type Admin = any;

/** Active customer organisations (company access) of the person. */
export async function customerOrganizationIds(
  admin: Admin,
  userId: string,
  tenantId: string,
): Promise<string[] | null> {
  const { data, error } = await admin
    .from("customer_memberships")
    .select("customer_organization_id, customer_organizations!inner(id)")
    .eq("user_id", userId)
    .eq("access", "company")
    .eq("customer_organizations.tenant_id", tenantId)
    .eq("customer_organizations.active", true);
  if (error) return null;
  return (data ?? [])
    .map(
      (membership: Record<string, unknown>) =>
        membership.customer_organization_id,
    )
    .filter(
      (id: unknown): id is string => typeof id === "string" && isUuid(id),
    );
}

/** Restricts a knowledge_articles query to published external articles. */
// deno-lint-ignore no-explicit-any
export function applyExternalArticleScope(
  query: any,
  organizationIds: string[],
): any {
  const scope = ["customer_organization_id.is.null"];
  if (organizationIds.length) {
    scope.push(`customer_organization_id.in.(${organizationIds.join(",")})`);
  }
  return query
    .eq("visibility", "external")
    .neq("status", "archived")
    .not("published_revision", "is", null)
    .or(scope.join(","));
}

/**
 * Departments whose published external articles requesters and customers may
 * read: every active department of the tenant where the knowledge module is
 * on. Requesters are not limited to their own departments (and customers have
 * none), so the portal keeps showing the help of all departments.
 */
export async function publishedKnowledgeScope(
  admin: Admin,
  tenantId: string,
): Promise<DepartmentScope | null> {
  const [departments, disabled] = await Promise.all([
    admin
      .from("departments")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("active", true),
    admin
      .from("department_feature_flags")
      .select("department_id")
      .eq("tenant_id", tenantId)
      .eq("feature_key", KNOWLEDGE_FEATURE)
      .eq("enabled", false),
  ]);
  if (departments.error || disabled.error) return null;
  const off = new Set(
    (disabled.data ?? []).map((row: Record<string, unknown>) =>
      String(row.department_id),
    ),
  );
  return {
    scoped: true,
    departments: (departments.data ?? [])
      .map((row: Record<string, unknown>) => String(row.id))
      .filter((id: string) => !off.has(id)),
  };
}
