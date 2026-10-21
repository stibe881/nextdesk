export type KnowledgeCollectionForPresentation = {
  active: boolean;
  id: string;
  name: string;
  parentId: string | null;
};

export type KnowledgeArticleForPresentation = {
  collectionIds: string[];
  currentRevision: number | null;
  publishedRevision: number | null;
  visibility: "internal" | "external";
};

export type KnowledgeRevisionForPresentation = {
  revision: number;
};

function isPositiveRevision(value: number | null): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Resolves article assignments using only the already authorised collection list.
 * Invalid, inactive, unknown and structurally incomplete paths intentionally stay
 * hidden instead of guessing labels from IDs.
 */
export function formatKnowledgeCollectionPaths(
  collectionIds: readonly string[],
  collections: readonly KnowledgeCollectionForPresentation[],
): string[] {
  const collectionsById = new Map(
    collections
      .filter(
        (collection) =>
          collection.active &&
          collection.id.length > 0 &&
          collection.name.trim().length > 0,
      )
      .map((collection) => [collection.id, collection]),
  );
  const selectedIds = new Set(
    collectionIds.filter((collectionId) => collectionId.trim().length > 0),
  );
  const paths: string[] = [];
  const addedPaths = new Set<string>();

  for (const collectionId of selectedIds) {
    const collection = collectionsById.get(collectionId);
    if (!collection) continue;

    if (collection.parentId === null) {
      const hasSelectedChild = Array.from(selectedIds).some(
        (selectedId) =>
          collectionsById.get(selectedId)?.parentId === collection.id,
      );
      if (!hasSelectedChild && !addedPaths.has(collection.id)) {
        paths.push(collection.name.trim());
        addedPaths.add(collection.id);
      }
      continue;
    }

    const parent = collectionsById.get(collection.parentId);
    if (!parent || parent.parentId !== null) continue;

    const pathKey = `${parent.id}:${collection.id}`;
    if (!addedPaths.has(pathKey)) {
      paths.push(`${parent.name.trim()} · ${collection.name.trim()}`);
      addedPaths.add(pathKey);
    }
  }

  return paths;
}

/**
 * Returns the revision that the current response actually exposes. A server-sent
 * revision always wins; otherwise external articles may only fall back to their
 * published revision, while internal articles use their current revision.
 */
export function visibleKnowledgeArticleRevision(
  article: KnowledgeArticleForPresentation,
  revision: KnowledgeRevisionForPresentation | null | undefined,
): number | null {
  if (revision && isPositiveRevision(revision.revision))
    return revision.revision;

  const fallback =
    article.visibility === "external"
      ? article.publishedRevision
      : article.currentRevision;
  return isPositiveRevision(fallback) ? fallback : null;
}
