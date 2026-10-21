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

export type KnowledgeCollectionFilter = {
  categoryId: string;
  subcategoryId: string;
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
 * Matches only authorised, active category paths. A root category includes its
 * directly assigned articles and articles assigned to one of its known direct
 * children; a subcategory always requires an exact assignment.
 */
export function articleMatchesKnowledgeCollectionFilter(
  collectionIds: readonly string[],
  collections: readonly KnowledgeCollectionForPresentation[],
  filter: KnowledgeCollectionFilter,
): boolean {
  const categoryId = filter.categoryId.trim();
  const subcategoryId = filter.subcategoryId.trim();
  if (!categoryId && !subcategoryId) return true;

  const activeCollectionsById = new Map(
    collections
      .filter(
        (collection) =>
          collection.active &&
          collection.id.trim().length > 0 &&
          collection.name.trim().length > 0,
      )
      .map((collection) => [collection.id, collection]),
  );
  const assignedCollections = collectionIds
    .map((collectionId) => activeCollectionsById.get(collectionId))
    .filter(
      (collection): collection is KnowledgeCollectionForPresentation =>
        collection !== undefined,
    );

  if (subcategoryId) {
    const subcategory = activeCollectionsById.get(subcategoryId);
    const parent = subcategory?.parentId
      ? activeCollectionsById.get(subcategory.parentId)
      : undefined;
    if (!subcategory || !parent || parent.parentId !== null) return false;
    if (categoryId && parent.id !== categoryId) return false;
    return assignedCollections.some(
      (collection) => collection.id === subcategory.id,
    );
  }

  const category = activeCollectionsById.get(categoryId);
  if (!category || category.parentId !== null) return false;
  return assignedCollections.some(
    (collection) =>
      collection.id === category.id || collection.parentId === category.id,
  );
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
