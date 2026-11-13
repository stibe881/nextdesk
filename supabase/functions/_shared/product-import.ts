// Artikel-Import aus einer Produktseite (z. B. Brack): liest die strukturierten
// Produktdaten (schema.org JSON-LD) und die Open-Graph-Angaben der Seite.

export type ImportedProduct = {
  name: string;
  description: string;
  articleNumber: string;
  supplierUrl: string;
  category: string;
  brand: string;
  price: string;
  imageUrl: string;
  specifications: Record<string, string>;
};

/** Nur diese Shops dürfen abgerufen werden (verhindert Abrufe interner Adressen). */
const ALLOWED_HOSTS = ["brack.ch"];

export function isAllowedProductUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  const host = url.hostname.toLowerCase();
  const allowed = ALLOWED_HOSTS.some(
    (entry) => host === entry || host.endsWith(`.${entry}`),
  );
  return allowed ? url : null;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const value =
        code[1]?.toLowerCase() === "x"
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value < 0x110000
        ? String.fromCodePoint(value)
        : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function clean(value: unknown, max: number): string {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return "";
  return decodeEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonLdNodes(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    for (const entry of asArray(value)) {
      if (!isRecord(entry)) continue;
      nodes.push(entry);
      if (entry["@graph"]) visit(entry["@graph"]);
    }
  };
  const pattern =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      visit(JSON.parse(match[1]!.trim()));
    } catch {
      // ungültiges JSON-LD ignorieren
    }
  }
  return nodes;
}

function metaContent(html: string, key: string): string {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const name = /(?:property|name|itemprop)=["']([^"']+)["']/i.exec(tag)?.[1];
    if (name?.toLowerCase() !== key) continue;
    const content = /content=["']([^"']*)["']/i.exec(tag)?.[1];
    if (content) return clean(content, 4000);
  }
  return "";
}

function typeOf(node: Record<string, unknown>): string[] {
  return asArray(node["@type"]).map((entry) => String(entry).toLowerCase());
}

function nameOf(value: unknown): string {
  if (isRecord(value)) return clean(value.name, 120);
  return clean(value, 120);
}

function priceOf(offers: unknown): string {
  for (const offer of asArray(offers)) {
    if (!isRecord(offer)) continue;
    const price =
      offer.price ??
      (isRecord(offer.priceSpecification)
        ? offer.priceSpecification.price
        : undefined);
    const text = clean(price, 40);
    if (text) {
      const currency = clean(offer.priceCurrency, 8);
      return currency ? `${text} ${currency}` : text;
    }
    const nested = priceOf(offer.offers);
    if (nested) return nested;
  }
  return "";
}

function imageOf(value: unknown, base: URL): string {
  for (const entry of asArray(value)) {
    const raw = isRecord(entry) ? entry.url : entry;
    if (typeof raw !== "string" || !raw.trim()) continue;
    try {
      const url = new URL(raw.trim(), base);
      if (url.protocol === "https:") return url.toString();
    } catch {
      // nächstes Bild
    }
  }
  return "";
}

function breadcrumbCategory(nodes: Record<string, unknown>[]): string {
  for (const node of nodes) {
    if (!typeOf(node).includes("breadcrumblist")) continue;
    const names = asArray(node.itemListElement)
      .filter(isRecord)
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
      .map((entry) =>
        isRecord(entry.item) ? nameOf(entry.item) : nameOf(entry.name),
      )
      .filter(Boolean);
    // Letzter Eintrag ist das Produkt selbst, davor die Kategorie.
    if (names.length >= 2) return names[names.length - 2]!;
  }
  return "";
}

/** Liest Produktangaben aus dem HTML einer Produktseite; null, wenn nichts gefunden. */
export function parseProductPage(
  html: string,
  pageUrl: URL,
): ImportedProduct | null {
  const nodes = jsonLdNodes(html);
  const product = nodes.find((node) => typeOf(node).includes("product"));

  const name = clean(product?.name, 160) || metaContent(html, "og:title");
  if (!name) return null;

  const description =
    clean(product?.description, 2000) ||
    metaContent(html, "og:description") ||
    metaContent(html, "description");
  const articleNumber =
    clean(product?.sku, 80) ||
    clean(product?.mpn, 80) ||
    clean(product?.productID, 80) ||
    clean(product?.gtin13, 80);
  const brand = nameOf(product?.brand);
  const image =
    imageOf(product?.image, pageUrl) ||
    imageOf(metaContent(html, "og:image"), pageUrl);

  const specifications: Record<string, string> = {};
  const properties: string[] = [];
  for (const entry of asArray(product?.additionalProperty)) {
    if (!isRecord(entry)) continue;
    const key = clean(entry.name, 80);
    const value = clean(entry.value, 200);
    if (key && value) properties.push(`${key}: ${value}`);
  }
  if (brand) properties.unshift(`Hersteller: ${brand}`);
  if (properties.length > 0) {
    specifications.properties = properties.join("\n").slice(0, 2000);
  }

  return {
    name,
    description,
    articleNumber,
    supplierUrl: pageUrl.toString().slice(0, 1000),
    category: breadcrumbCategory(nodes),
    brand,
    price: priceOf(product?.offers),
    imageUrl: image,
    specifications,
  };
}

const MAX_PAGE_BYTES = 3_000_000;
const MAX_IMAGE_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 15_000;
const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (compatible; nextDesk-Artikelimport/1.0; +https://nextdesk.ch)",
  "accept-language": "de-CH,de;q=0.9",
};

export type ProductImportErrorCode =
  "invalid_url" | "blocked" | "unreachable" | "no_product";

export class ProductImportError extends Error {
  constructor(readonly code: ProductImportErrorCode) {
    super(code);
  }
}

async function readLimited(
  response: Response,
  limit: number,
): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** GET mit Weiterleitungen, die erlaubte Hosts nie verlassen. */
async function safeGet(
  start: URL,
  accept: string,
  fetcher: typeof fetch,
): Promise<{ response: Response; url: URL }> {
  let url = start;
  for (let hop = 0; hop < 4; hop += 1) {
    const response = await fetcher(url, {
      headers: { ...HEADERS, accept },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      const next = location
        ? isAllowedProductUrl(new URL(location, url).toString())
        : null;
      if (!next) throw new ProductImportError("blocked");
      url = next;
      continue;
    }
    return { response, url };
  }
  throw new ProductImportError("unreachable");
}

export async function importProductFromUrl(
  rawUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<
  ImportedProduct & { image: { type: string; base64: string } | null }
> {
  const start = isAllowedProductUrl(rawUrl);
  if (!start) throw new ProductImportError("invalid_url");
  let page: { response: Response; url: URL };
  try {
    page = await safeGet(start, "text/html,application/xhtml+xml", fetcher);
  } catch (error) {
    if (error instanceof ProductImportError) throw error;
    throw new ProductImportError("unreachable");
  }
  if (page.response.status === 401 || page.response.status === 403) {
    await page.response.body?.cancel();
    throw new ProductImportError("blocked");
  }
  if (!page.response.ok) {
    await page.response.body?.cancel();
    throw new ProductImportError("unreachable");
  }
  const bytes = await readLimited(page.response, MAX_PAGE_BYTES);
  if (!bytes) throw new ProductImportError("unreachable");
  const product = parseProductPage(
    new TextDecoder("utf-8").decode(bytes),
    page.url,
  );
  if (!product) throw new ProductImportError("no_product");

  let image: { type: string; base64: string } | null = null;
  const imageUrl = product.imageUrl
    ? isAllowedProductUrl(product.imageUrl)
    : null;
  if (imageUrl) {
    try {
      const result = await safeGet(imageUrl, "image/*", fetcher);
      const type = result.response.headers.get("content-type") ?? "";
      if (result.response.ok && /^image\/(jpeg|png|webp)/i.test(type)) {
        const data = await readLimited(result.response, MAX_IMAGE_BYTES);
        if (data) {
          let binary = "";
          for (let index = 0; index < data.length; index += 8192) {
            binary += String.fromCharCode(
              ...data.subarray(index, index + 8192),
            );
          }
          image = {
            type: type.split(";")[0]!.toLowerCase(),
            base64: btoa(binary),
          };
        }
      } else {
        await result.response.body?.cancel();
      }
    } catch {
      image = null;
    }
  }
  return { ...product, image };
}
