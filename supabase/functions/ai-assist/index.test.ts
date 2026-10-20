const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const queueMigration = await Deno.readTextFile(
  new URL(
    "../../migrations/0095_anthropic_knowledge_drafts.sql",
    import.meta.url,
  ),
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test(
  "Anthropic-Wissensentwürfe bleiben mandantenautorisiert und manuell",
  () => {
    assert(
      source.includes('type: "prepareKnowledgeArticle"') &&
        source.includes("sanitizeRawContent"),
      "The AI endpoint must accept only the explicit knowledge-draft action and bounded input.",
    );
    assert(
      source.includes("KNOWLEDGE_MANAGE_PERMISSION") &&
        source.includes("hasTenantPermission"),
      "Knowledge preparation must require the existing knowledge.manage permission.",
    );
    assert(
      source.includes("resolveAiGovernance") &&
        source.includes("ai_external_article_content_not_approved"),
      "Tenant approval and the separate external-content approval must be enforced.",
    );
    assert(
      source.includes("anthropicConfiguration") &&
        source.includes('Deno.env.get("ANTHROPIC_API_KEY")') &&
        source.includes('Deno.env.get("ANTHROPIC_MODEL")'),
      "Provider credentials and model selection must remain server-side and fail closed.",
    );
    assert(
      source.includes("queueMinimalAiDraftRequest") &&
        source.includes("knowledge.article.ai_draft_requested") &&
        !source.includes("metadata: { rawContent"),
      "Only metadata may be queued or audited; raw content must not be persisted.",
    );
    assert(
      source.includes("generateKnowledgeDraft") &&
        source.includes("return response(request, { data: draft })"),
      "The provider result must return as a draft and never as an article write.",
    );
    assert(
      source.includes(
        'externalArticleContent: action.visibility === "external"',
      ) &&
        queueMigration.includes(
          "select article.visibility into v_article_visibility",
        ) &&
        queueMigration.includes("for share") &&
        queueMigration.includes(
          "and not v_approval.allow_external_article_content then",
        ),
      "Existing article visibility must be read and locked server-side before an external provider call.",
    );
  },
);
