const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test(
  "knowledge article search is server-side full text and retains scopes",
  () => {
    const articleSelect = source.match(
      /const ARTICLE_SELECT =\s*\n\s*"([^"]+)"/,
    )?.[1];
    const revisionSelect = source.match(
      /const REVISION_SELECT =\s*\n\s*"([^"]+)"/,
    )?.[1];
    assert(
      source.includes('rpc(\n          "search_knowledge_article_ids"'),
      "Article search must use the server-side full-text RPC.",
    );
    assert(
      source.includes("p_can_read_internal: canReadInternal") &&
        source.includes("p_customer_organization_ids: organizationIds"),
      "Full-text search must receive the already verified reader scope.",
    );
    assert(
      !source.includes('ilike("title"'),
      "Article search must not fall back to title-only matching.",
    );
    assert(
      source.includes('query.in("id", matchingArticleIds)') &&
        source.includes("applyExternalArticleScope(query, organizationIds)"),
      "Full-text result identifiers must be intersected with the normal article scope.",
    );
    assert(
      source.includes('error: { code: "article_search_failed" }'),
      "A search failure must return a stable, non-technical error code.",
    );
    assert(
      articleSelect !== undefined &&
        !articleSelect.includes("created_by") &&
        !articleSelect.includes("customer_organization_id") &&
        revisionSelect !== undefined &&
        !revisionSelect.includes("author_id"),
      "Knowledge responses must not expose creator, author or organisation identifiers.",
    );
    assert(
      source.includes("function revisionResponse") &&
        source.includes("title_snapshot: _titleSnapshot") &&
        source.includes("function articleResponse"),
      "Public responses must remove revision snapshots and render the published title.",
    );
    assert(
      source.includes(
        "customerOrganizationIds(admin, actorId, action.tenantId)",
      ) &&
        source.includes('eq("customer_organizations.active", true)') &&
        source.includes('eq("customer_organizations.tenant_id", tenantId)'),
      "External scopes must contain only active organisations from the requested tenant.",
    );
  },
);
