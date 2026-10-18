import { invokeNextDesk } from "@/lib/nextdesk-client";

export type MobileKnowledgeArticle = {
  id: string;
  title: string;
  visibility: "internal" | "external";
  updatedAt: string;
  summary: string;
};

export type MobileKnowledgeArticleDetail = MobileKnowledgeArticle & {
  body: string;
  revision: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function dataEnvelope(value: unknown): Record<string, unknown> {
  const envelope = record(value);
  const data = record(envelope?.data);
  if (!data) throw new Error("Die Wissensantwort ist unvollständig.");
  return data;
}

function article(value: unknown): MobileKnowledgeArticle | null {
  const item = record(value);
  const revision = record(item?.revision);
  if (
    !item ||
    typeof item.id !== "string" ||
    typeof item.title !== "string" ||
    typeof item.updated_at !== "string" ||
    (item.visibility !== "internal" && item.visibility !== "external")
  ) {
    return null;
  }
  return {
    id: item.id,
    title: item.title.trim(),
    visibility: item.visibility,
    updatedAt: item.updated_at,
    summary:
      typeof revision?.summary === "string" ? revision.summary.trim() : "",
  };
}

export async function searchMobileKnowledge(input: {
  tenantId: string;
  query?: string;
}): Promise<MobileKnowledgeArticle[]> {
  const response = dataEnvelope(
    await invokeNextDesk<unknown>("knowledge-base", {
      type: "listArticles",
      tenantId: input.tenantId,
      ...(input.query?.trim()
        ? { query: input.query.trim().slice(0, 120) }
        : {}),
    }),
  );
  if (!Array.isArray(response.articles)) {
    throw new Error("Die Wissensliste ist unvollständig.");
  }
  const articles = response.articles.map(article);
  if (
    !articles.every((item): item is MobileKnowledgeArticle => item !== null)
  ) {
    throw new Error("Ein Wissensartikel hat ein ungültiges Format.");
  }
  return articles;
}

export async function loadMobileKnowledgeArticle(input: {
  tenantId: string;
  articleId: string;
}): Promise<MobileKnowledgeArticleDetail> {
  const response = dataEnvelope(
    await invokeNextDesk<unknown>("knowledge-base", {
      type: "getArticle",
      tenantId: input.tenantId,
      articleId: input.articleId,
    }),
  );
  const basic = article(response.article);
  const revision = record(response.revision);
  if (
    !basic ||
    !revision ||
    typeof revision.body !== "string" ||
    typeof revision.revision !== "number" ||
    !Number.isSafeInteger(revision.revision)
  ) {
    throw new Error("Der Wissensartikel ist unvollständig.");
  }
  return { ...basic, body: revision.body, revision: revision.revision };
}
