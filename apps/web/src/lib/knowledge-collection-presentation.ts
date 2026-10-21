export type KnowledgeCollectionForPresentation = {
  active: boolean;
  id: string;
  name: string;
  parentId: string | null;
  slug: string;
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

const LEGACY_VISIBILITY_GROUPING_SLUGS = new Set([
  "legacy-root-ict-intern",
  "legacy-root-ict-oeffentlich",
]);

function isPositiveRevision(value: number | null): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isUsableCollection(
  collection: KnowledgeCollectionForPresentation,
): boolean {
  return (
    collection.active &&
    collection.id.trim().length > 0 &&
    collection.name.trim().length > 0 &&
    collection.slug.trim().length > 0
  );
}

function activeCollectionsById(
  collections: readonly KnowledgeCollectionForPresentation[],
): Map<string, KnowledgeCollectionForPresentation> {
  return new Map(
    collections
      .filter(isUsableCollection)
      .map((collection) => [collection.id, collection]),
  );
}

/**
 * The XML importer created these two stable roots exclusively as a technical
 * separation for internal versus public material. Their human-readable names
 * remain editable, so presentation must deliberately rely on their immutable
 * importer slugs rather than on a matching name.
 */
function isVisibilityGrouping(
  collection: KnowledgeCollectionForPresentation,
): boolean {
  return (
    collection.parentId === null &&
    LEGACY_VISIBILITY_GROUPING_SLUGS.has(collection.slug)
  );
}

/**
 * Returns the options that represent actual support topics. A direct child of
 * an imported visibility grouping is a category itself; an ordinary root stays
 * a category and may still expose real subcategories.
 */
export function knowledgeTopicCategories(
  collections: readonly KnowledgeCollectionForPresentation[],
): KnowledgeCollectionForPresentation[] {
  const collectionsById = activeCollectionsById(collections);
  return Array.from(collectionsById.values())
    .filter((collection) => {
      if (collection.parentId === null)
        return !isVisibilityGrouping(collection);
      const parent = collectionsById.get(collection.parentId);
      return parent !== undefined && isVisibilityGrouping(parent);
    })
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, "de-CH", { sensitivity: "base" }) ||
        left.id.localeCompare(right.id),
    );
}

/**
 * Only ordinary root categories can have user-facing subcategories. Children
 * below imported visibility groupings are already the actual topic category.
 */
export function knowledgeTopicSubcategories(
  collections: readonly KnowledgeCollectionForPresentation[],
  categoryId: string,
): KnowledgeCollectionForPresentation[] {
  const normalizedCategoryId = categoryId.trim();
  if (!normalizedCategoryId) return [];

  const collectionsById = activeCollectionsById(collections);
  const category = collectionsById.get(normalizedCategoryId);
  if (
    !category ||
    category.parentId !== null ||
    isVisibilityGrouping(category)
  ) {
    return [];
  }

  return Array.from(collectionsById.values())
    .filter((collection) => collection.parentId === category.id)
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, "de-CH", { sensitivity: "base" }) ||
        left.id.localeCompare(right.id),
    );
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
  const collectionsById = activeCollectionsById(collections);
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
      if (
        !isVisibilityGrouping(collection) &&
        !hasSelectedChild &&
        !addedPaths.has(collection.id)
      ) {
        paths.push(collection.name.trim());
        addedPaths.add(collection.id);
      }
      continue;
    }

    const parent = collectionsById.get(collection.parentId);
    if (!parent || parent.parentId !== null) continue;

    const pathKey = `${parent.id}:${collection.id}`;
    if (!addedPaths.has(pathKey)) {
      paths.push(
        isVisibilityGrouping(parent)
          ? collection.name.trim()
          : `${parent.name.trim()} · ${collection.name.trim()}`,
      );
      addedPaths.add(pathKey);
    }
  }

  return paths;
}

/**
 * Matches only authorised, active topic paths. Ordinary root categories include
 * their direct children; a topic beneath an imported visibility grouping is an
 * exact category match because its parent is not a user-facing topic.
 */
export function articleMatchesKnowledgeCollectionFilter(
  collectionIds: readonly string[],
  collections: readonly KnowledgeCollectionForPresentation[],
  filter: KnowledgeCollectionFilter,
): boolean {
  const categoryId = filter.categoryId.trim();
  const subcategoryId = filter.subcategoryId.trim();
  if (!categoryId && !subcategoryId) return true;

  const collectionsById = activeCollectionsById(collections);
  const assignedCollections = collectionIds
    .map((collectionId) => collectionsById.get(collectionId))
    .filter(
      (collection): collection is KnowledgeCollectionForPresentation =>
        collection !== undefined,
    );

  if (subcategoryId) {
    const subcategory = collectionsById.get(subcategoryId);
    const parent = subcategory?.parentId
      ? collectionsById.get(subcategory.parentId)
      : undefined;
    if (
      !subcategory ||
      !parent ||
      parent.parentId !== null ||
      isVisibilityGrouping(parent)
    ) {
      return false;
    }
    if (categoryId && parent.id !== categoryId) return false;
    return assignedCollections.some(
      (collection) => collection.id === subcategory.id,
    );
  }

  const category = collectionsById.get(categoryId);
  if (!category) return false;
  if (category.parentId !== null) {
    const parent = collectionsById.get(category.parentId);
    return (
      parent !== undefined &&
      isVisibilityGrouping(parent) &&
      assignedCollections.some((collection) => collection.id === category.id)
    );
  }
  if (isVisibilityGrouping(category)) return false;
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
