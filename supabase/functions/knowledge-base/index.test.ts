const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const atomicMigration = await Deno.readTextFile(
  new URL(
    "../../migrations/0103_knowledge_collection_atomic_mutations.sql",
    import.meta.url,
  ),
);
const taxonomySearchMigration = await Deno.readTextFile(
  new URL(
    "../../migrations/0105_knowledge_taxonomy_fulltext_search.sql",
    import.meta.url,
  ),
);

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

Deno.test(
  "knowledge collections stay tenant-scoped, audited and server-authorized",
  () => {
    assert(
      source.includes('type: "updateCollection"') &&
        source.includes('if (value.type === "updateCollection")') &&
        source.includes("collectionId: value.collectionId"),
      "Collection renames must be parsed as a strict server action.",
    );
    assert(
      source.includes('action.type === "updateCollection"') &&
        source.includes('rpc("rename_knowledge_collection"') &&
        source.includes("p_tenant_id: action.tenantId") &&
        source.includes("p_collection_id: action.collectionId"),
      "Collection renames must remain scoped to the requested tenant and collection.",
    );
    assert(
      atomicMigration.includes("'knowledge_collection'") &&
        atomicMigration.includes("'knowledge.collection.created'") &&
        atomicMigration.includes("'knowledge.collection.updated'"),
      "Atomic collection creation and rename must write correctly typed audit records.",
    );
    assert(
      source.includes("KNOWLEDGE_READ_PERMISSION") &&
        source.includes("KNOWLEDGE_MANAGE_PERMISSION") &&
        source.includes("canReadInternal !== true && canManage !== true"),
      "The category list must be allowed only to internal readers or server-authorized knowledge managers.",
    );
    assert(
      source.includes('action.type === "setArticleCollections"') &&
        source.includes(
          "new Set(value.collectionIds).size !== value.collectionIds.length",
        ) &&
        source.includes('"replace_knowledge_article_collections"'),
      "Article collection assignments must stay UUID-limited, de-duplicated and atomic on the server.",
    );
    assert(
      atomicMigration.includes(
        "create or replace function public.replace_knowledge_article_collections",
      ) &&
        atomicMigration.includes(
          "delete from public.knowledge_article_collections",
        ) &&
        atomicMigration.includes(
          "insert into public.knowledge_article_collections",
        ) &&
        atomicMigration.includes("'knowledge.article.collections_updated'"),
      "Replacing article collection assignments and its audit record must share one transaction.",
    );
  },
);

Deno.test(
  "knowledge taxonomy search stays internal, tenant-scoped and hierarchy-safe",
  () => {
    assert(
      taxonomySearchMigration.includes(
        "create index if not exists knowledge_collections_active_name_search_document_idx",
      ) && taxonomySearchMigration.includes("where active;"),
      "Category full-text indexing must exclude inactive taxonomy nodes.",
    );
    assert(
      taxonomySearchMigration.includes("where p_can_read_internal") &&
        taxonomySearchMigration.includes(
          "from public.knowledge_article_collections as assignment",
        ) &&
        taxonomySearchMigration.includes(
          "assignment.tenant_id = article.tenant_id",
        ),
      "Taxonomy matches must stay internal and tied to the article tenant.",
    );
    assert(
      taxonomySearchMigration.includes(
        "collection.parent_id is null\n        or (parent.active and parent.parent_id is null)",
      ) &&
        taxonomySearchMigration.includes("child.parent_id = parent.id") &&
        taxonomySearchMigration.includes("child.active"),
      "Only active, complete root and direct-child category paths may match.",
    );
    assert(
      taxonomySearchMigration.includes(
        "or taxonomy.taxonomy_rank is not null",
      ) &&
        taxonomySearchMigration.includes(
          "or to_tsvector('german'::regconfig, revision.title_snapshot) @@ v_query",
        ),
      "Taxonomy matches must extend, rather than replace, revision and title search.",
    );
  },
);
