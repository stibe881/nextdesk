// Scope of the "Vermiedene Tickets (Wissensdatenbank)" count.
//
// A deflection belongs to the department of its knowledge article
// (knowledge_articles.department_id, migration 0177). Like the ticket KPIs of
// the report, which only include tickets of the caller's readable teams (and
// tickets without team), the count only includes deflections of articles in
// the departments of those teams plus articles without department, which are
// shared by all departments.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PostgREST `or` filter on the embedded knowledge_articles row of a
 * knowledge_article_outcomes query.
 */
export function deflectionArticleFilter(
  departmentIds: Iterable<string>,
): string {
  const ids = [
    ...new Set(
      [...departmentIds]
        .filter((id) => UUID.test(id))
        .map((id) => id.toLowerCase()),
    ),
  ].sort();
  return ids.length === 0
    ? "department_id.is.null"
    : `department_id.is.null,department_id.in.(${ids.join(",")})`;
}
