export type KnowledgeArticleSaveRequest = {
  type: "saveArticle";
  tenantId: string;
  articleId?: string;
  title: string;
  bodyMarkdown: string;
  visibility: "internal" | "external";
};

type KnowledgeArticleSaveInput = Omit<KnowledgeArticleSaveRequest, "type">;

export function buildKnowledgeArticleSaveRequest({
  articleId,
  bodyMarkdown,
  tenantId,
  title,
  visibility,
}: KnowledgeArticleSaveInput): KnowledgeArticleSaveRequest {
  return {
    type: "saveArticle",
    tenantId,
    ...(articleId ? { articleId } : {}),
    title,
    bodyMarkdown,
    visibility,
  };
}
