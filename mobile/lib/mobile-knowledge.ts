import { invokeNextDesk } from "@/lib/nextdesk-client";

export type MobileKnowledgeCollection = {
  id: string;
  name: string;
};

export type MobileKnowledgeArticle = {
  id: string;
  title: string;
  visibility: "internal" | "external";
  updatedAt: string;
  summary: string;
  revision: number | null;
  collections: MobileKnowledgeCollection[];
};

export type MobileKnowledgeArticleDetail = MobileKnowledgeArticle & {
  body: string;
  revision: number;
};

type ParsedMobileKnowledgeArticle = MobileKnowledgeArticle & {
  collectionIds: string[];
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

function collection(value: unknown): MobileKnowledgeCollection | null {
  const item = record(value);
  if (
    !item ||
    typeof item.id !== "string" ||
    !item.id ||
    typeof item.name !== "string" ||
    !item.name.trim()
  ) {
    return null;
  }
  return { id: item.id, name: item.name.trim() };
}

function collectionIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return [];
  if (
    !value.every((item) => typeof item === "string" && item.trim().length > 0)
  ) {
    return null;
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function article(value: unknown): ParsedMobileKnowledgeArticle | null {
  const item = record(value);
  const revision = record(item?.revision);
  if (
    !item ||
    typeof item.id !== "string" ||
    !item.id ||
    typeof item.title !== "string" ||
    !item.title.trim() ||
    typeof item.updated_at !== "string" ||
    !Number.isFinite(Date.parse(item.updated_at)) ||
    (item.visibility !== "internal" && item.visibility !== "external")
  ) {
    return null;
  }

  const parsedCollectionIds = collectionIds(item.collection_ids);
  const rawCollections = item.collections;
  const collections = Array.isArray(rawCollections)
    ? rawCollections.map(collection)
    : [];
  if (
    parsedCollectionIds === null ||
    !collections.every(
      (item): item is MobileKnowledgeCollection => item !== null,
    )
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
    revision:
      typeof revision?.revision === "number" &&
      Number.isSafeInteger(revision.revision) &&
      revision.revision > 0
        ? revision.revision
        : null,
    collections,
    collectionIds: parsedCollectionIds,
  };
}

async function loadAuthorizedCollections(
  tenantId: string,
): Promise<Map<string, MobileKnowledgeCollection>> {
  const response = dataEnvelope(
    await invokeNextDesk<unknown>("knowledge-base", {
      type: "listCollections",
      tenantId,
    }),
  );
  if (!Array.isArray(response.collections)) {
    throw new Error("Die Wissenssammlungen sind unvollständig.");
  }

  const collections = response.collections.map(collection);
  if (
    !collections.every(
      (item): item is MobileKnowledgeCollection => item !== null,
    )
  ) {
    throw new Error("Eine Wissenssammlung hat ein ungültiges Format.");
  }
  return new Map(collections.map((item) => [item.id, item]));
}

async function attachAuthorizedCollections(
  tenantId: string,
  articles: ParsedMobileKnowledgeArticle[],
): Promise<MobileKnowledgeArticle[]> {
  const needsCollectionNames = articles.some(
    (article) =>
      article.visibility === "internal" &&
      article.collectionIds.length > 0 &&
      article.collections.length === 0,
  );
  if (!needsCollectionNames) {
    return articles.map(
      ({ collectionIds: _collectionIds, ...article }) => article,
    );
  }

  // This action itself requires knowledge.read. It is only called when listArticles
  // has already returned an internal article and never for external readers.
  const collectionById = await loadAuthorizedCollections(tenantId);
  return articles.map(({ collectionIds, ...article }) => ({
    ...article,
    collections:
      article.collections.length > 0
        ? article.collections
        : collectionIds.flatMap((id) => {
            const collection = collectionById.get(id);
            return collection ? [collection] : [];
          }),
  }));
}

export function formatMobileKnowledgeUpdatedAt(value: string): string {
  const updatedAt = new Date(value);
  if (Number.isNaN(updatedAt.getTime())) return "Aktualisiert vor Kurzem";
  return `Aktualisiert ${new Intl.DateTimeFormat("de-CH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(updatedAt)}`;
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
    !articles.every(
      (item): item is ParsedMobileKnowledgeArticle => item !== null,
    )
  ) {
    throw new Error("Ein Wissensartikel hat ein ungültiges Format.");
  }
  return attachAuthorizedCollections(input.tenantId, articles);
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
    !Number.isSafeInteger(revision.revision) ||
    revision.revision < 1
  ) {
    throw new Error("Der Wissensartikel ist unvollständig.");
  }

  const [withCollections] = await attachAuthorizedCollections(input.tenantId, [
    basic,
  ]);
  return {
    ...withCollections,
    body: revision.body,
    revision: revision.revision,
  };
}
