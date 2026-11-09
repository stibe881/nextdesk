export type KnowledgeArticleSaveRequest = {
  type: "saveArticle";
  tenantId: string;
  articleId?: string;
  title: string;
  bodyMarkdown: string;
  summary?: string;
  visibility: "internal" | "external";
  departmentId?: string;
};

type KnowledgeArticleSaveInput = Omit<KnowledgeArticleSaveRequest, "type">;

export function buildKnowledgeArticleSaveRequest({
  articleId,
  bodyMarkdown,
  departmentId,
  summary,
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
    ...(summary ? { summary } : {}),
    visibility,
    ...(departmentId ? { departmentId } : {}),
  };
}
