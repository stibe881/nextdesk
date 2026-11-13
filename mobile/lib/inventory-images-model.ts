// Article pictures in the stock list – pure logic, testable without network.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads `{ data: { itemId, signedUrl } }` from the inventory function. */
export function parseInventoryImageUrl(
  value: unknown,
  itemId: string,
): string | null {
  const data = isRecord(value) ? value.data : null;
  return isRecord(data) &&
    data.itemId === itemId &&
    typeof data.signedUrl === "string" &&
    /^https:\/\//.test(data.signedUrl)
    ? data.signedUrl
    : null;
}

/**
 * Picture per article, like the web list: the article's own private photo,
 * otherwise the photo of the linked shop article. Missing pictures are simply
 * left out (the list then shows the box icon).
 */
export function pickInventoryImages(input: {
  ownImages: ReadonlyMap<string, string>;
  shopImages: ReadonlyMap<string, string>;
  itemIds: readonly string[];
}): Map<string, string> {
  const result = new Map<string, string>();
  for (const id of input.itemIds) {
    const url = input.ownImages.get(id) ?? input.shopImages.get(id);
    if (url) result.set(id, url);
  }
  return result;
}
