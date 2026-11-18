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
  imageUrls: string[];
  specifications: Record<string, string>;
};

/** Nur diese Shops dürfen abgerufen werden (verhindert Abrufe interner Adressen). */
const ALLOWED_HOSTS = ["brack.ch"];
/** Produktbilder liegen bei Brack auf dem Bild-Server von Competec. */
const IMAGE_HOSTS = ["brack.ch", "competec.ch"];

export function isAllowedProductUrl(
  raw: string,
  hosts: readonly string[] = ALLOWED_HOSTS,
): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  const host = url.hostname.toLowerCase();
  const allowed = hosts.some(
    (entry) => host === entry || host.endsWith(`.${entry}`),
  );
  return allowed ? url : null;
}

export const isAllowedImageUrl = (raw: string) =>
  isAllowedProductUrl(raw, IMAGE_HOSTS);

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
    const raw = isRecord(entry) ? (entry.url ?? entry.contentUrl) : entry;
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

/** Produktbilder im HTML (Galerie), grosse Fassungen zuerst, ohne Vorschaubilder und Logos. */
function imagesFromHtml(html: string, base: URL): string[] {
  const found: string[] = [];
  const link =
    /<link\b[^>]*rel=["']image_src["'][^>]*href=["']([^"']+)["']/i.exec(
      html,
    )?.[1];
  if (link) {
    const resolved = imageOf(decodeEntities(link), base);
    if (resolved) found.push(resolved);
  }
  const pattern =
    /(?:src|data-src|data-zoom-image|data-large|href|content)=["']((?:https:)?\/\/[^"']*(?:brack|competec)\.ch[^"']*\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi;
  for (const match of html.matchAll(pattern)) {
    const url = decodeEntities(match[1]!);
    if (/logo|icon|sprite|payment|badge|banner|manufacturers\//i.test(url)) {
      continue;
    }
    if (/_(?:xxs|xs|s|m)\.(?:jpe?g|png|webp)/i.test(url)) continue;
    const resolved = imageOf(url.startsWith("//") ? `https:${url}` : url, base);
    if (resolved && !found.includes(resolved)) found.push(resolved);
  }
  // «_xxl3» ist dasselbe Bild in Vollgrösse: nur die «_xxl»-Fassung behalten.
  const seen = new Set<string>();
  return found
    .map((url) => url.replace(/_xxl3\./i, "_xxl."))
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .sort((a, b) => Number(/_xxl\./i.test(b)) - Number(/_xxl\./i.test(a)));
}

const SPEC_RULES: { field: string; pattern: RegExp }[] = [
  {
    field: "scope",
    pattern:
      /lieferumfang|inhalt der packung|packungsinhalt|zubehör inklusive/i,
  },
  { field: "usage", pattern: /anwendung|einsatz|verwendung|geeignet für/i },
  {
    field: "compatibility",
    pattern: /kompatibil|betriebssystem|unterstützte|system.?voraussetzung/i,
  },
  { field: "equipment", pattern: /ausstattung|funktionen|features|merkmale/i },
  {
    field: "connectivity",
    pattern:
      /konnektiv|anschl|schnittstelle|bluetooth|usb|wlan|wi-?fi|funk|verbindung|empfänger|hdmi|displayport|ethernet|lan\b/i,
  },
];

/** Diese Angaben stehen schon in eigenen Feldern oder sind für den Shop unnötig. */
const SKIPPED_KEYS =
  /^(artikelnummer|herst\.?-?\s*nr\.?|hersteller-?nummer|herstellerseite|verkauf seit|ean|gtin|lagerbestand|verfügbarkeit|preis|kategorie|menge|bewertung)/i;

/** Ab hier beginnen bei Brack Zubehör und Varianten anderer Artikel. */
const RELATED_SECTION_TAG =
  />\s*(?:Zubehör|Varianten\s*Verfügbarkeit|Ähnliche Artikel|Kunden kauften|Passende Artikel|Mehr von)/i;

/** Der Bereich der Seite, der zum Produkt selbst gehört (ab der Überschrift bis zum Zubehör). */
export function productRegion(html: string): string {
  const start = html.search(/<h1\b/i);
  const from = start >= 0 ? html.slice(start) : html;
  const body = from
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");
  const rest = body.search(RELATED_SECTION_TAG);
  return rest >= 0 ? body.slice(0, rest) : body;
}

/** Zeilen des Textes (Blockgrenzen werden zu Zeilenumbrüchen, Inline-Elemente bleiben in einer Zeile). */
function textLines(html: string): string[] {
  const text = html
    .replace(
      /<\/?(?:li|p|div|tr|br|ul|ol|section|table|tbody|h[1-6]|dt|dd|article|header|footer)\b[^>]*>/gi,
      "\n",
    )
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Schlüssel/Wert-Paare aus Tabellen, Definitionslisten und «Name: Wert»-Zeilen. */
export function extractSpecPairs(html: string): [string, string][] {
  const region = productRegion(html);
  const pairs: [string, string][] = [];
  const keys = new Set<string>();
  const add = (key: string, value: string) => {
    const k = clean(key, 80)
      .replace(/\s*[:：]\s*$/, "")
      .trim();
    const v = clean(value, 300);
    if (!k || !v || k.length > 40 || k.split(" ").length > 5) return;
    if (/^[\d\W]+$/.test(k) || /https?:/i.test(k)) return;
    const id = k.toLowerCase();
    if (keys.has(id)) return;
    keys.add(id);
    pairs.push([k, v]);
  };
  for (const line of textLines(region)) {
    const match = /^([A-ZÄÖÜ][^:]{1,38}?)\s*:\s+(\S.{0,299})$/.exec(line);
    if (match && !match[2]!.startsWith("//")) add(match[1]!, match[2]!);
  }
  for (const row of region.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1]!.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)];
    if (cells.length === 2) add(cells[0]![1]!, cells[1]![1]!);
  }
  for (const item of region.matchAll(
    /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi,
  )) {
    add(item[1]!, item[2]!);
  }
  return pairs.slice(0, 60);
}

/** Eine Angabe der Seite, z. B. die Artikelnummer, aus den Paaren holen. */
export function pairValue(pairs: [string, string][], pattern: RegExp): string {
  return pairs.find(([key]) => pattern.test(key))?.[1] ?? "";
}

/** Ordnet die Paare den Feldern des Artikels zu; der Rest kommt unter «Eigenschaften». */
export function mapSpecifications(
  pairs: [string, string][],
  extra: string[] = [],
): Record<string, string> {
  const groups: Record<string, string[]> = {};
  const rest: string[] = [...extra];
  for (const [key, value] of pairs) {
    if (SKIPPED_KEYS.test(key)) continue;
    const rule = SPEC_RULES.find((entry) => entry.pattern.test(key));
    const line = rule?.field === "scope" ? value : `${key}: ${value}`;
    if (rule) (groups[rule.field] ??= []).push(line);
    else rest.push(`${key}: ${value}`);
  }
  if (rest.length > 0) groups.properties = rest;
  const result: Record<string, string> = {};
  for (const [field, lines] of Object.entries(groups)) {
    result[field] = lines.join("\n").slice(0, 2000);
  }
  return result;
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

  const name =
    clean(product?.name, 160) ||
    metaContent(html, "og:title") ||
    clean(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1], 160);
  if (!name) return null;

  const description =
    clean(product?.description, 2000) ||
    metaContent(html, "og:description") ||
    metaContent(html, "description");
  const pairs = extractSpecPairs(html);
  const articleNumber =
    clean(product?.sku, 80) ||
    clean(product?.mpn, 80) ||
    clean(product?.productID, 80) ||
    clean(product?.gtin13, 80) ||
    clean(pairValue(pairs, /^artikelnummer$/i), 80) ||
    (/\/product\/(\d{4,12})|-(\d{4,12})\/?$/.exec(pageUrl.pathname)?.[1] ??
      /-(\d{4,12})\/?$/.exec(pageUrl.pathname)?.[1] ??
      "");
  const brand = nameOf(product?.brand);
  const images = [
    ...new Set(
      [
        ...asArray(product?.image).map((entry) => imageOf(entry, pageUrl)),
        imageOf(metaContent(html, "og:image"), pageUrl),
        ...imagesFromHtml(html, pageUrl),
      ].filter(Boolean),
    ),
  ].slice(0, 6);

  const extra: string[] = [];
  for (const entry of asArray(product?.additionalProperty)) {
    if (!isRecord(entry)) continue;
    const key = clean(entry.name, 80);
    const value = clean(entry.value, 200);
    if (key && value) extra.push(`${key}: ${value}`);
  }
  if (brand) extra.unshift(`Hersteller: ${brand}`);
  const specifications = mapSpecifications(pairs, extra);

  return {
    name,
    description,
    articleNumber,
    supplierUrl: pageUrl.toString().slice(0, 1000),
    category: breadcrumbCategory(nodes),
    brand,
    price: priceOf(product?.offers),
    imageUrl: images[0] ?? "",
    imageUrls: images,
    specifications,
  };
}

const MAX_PAGE_BYTES = 3_000_000;
const MAX_IMAGE_BYTES = 4_000_000;
const MAX_IMAGES = 3;
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
  allow: (raw: string) => URL | null = isAllowedProductUrl,
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
      const next = location ? allow(new URL(location, url).toString()) : null;
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
  ImportedProduct & {
    images: { type: string; base64: string }[];
    notes: string[];
  }
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

  const images: { type: string; base64: string }[] = [];
  const notes: string[] = [];
  if (product.imageUrls.length === 0) {
    notes.push("Auf der Seite wurde kein Foto gefunden.");
  }
  let skipped = "";
  for (const raw of product.imageUrls.slice(0, MAX_IMAGES)) {
    const imageUrl = isAllowedImageUrl(raw);
    if (!imageUrl) {
      skipped = "Ein Foto liegt nicht bei Brack und wurde nicht geladen.";
      continue;
    }
    try {
      const result = await safeGet(
        imageUrl,
        "image/*",
        fetcher,
        isAllowedImageUrl,
      );
      const header = (result.response.headers.get("content-type") ?? "")
        .split(";")[0]!
        .trim()
        .toLowerCase();
      const byExtension = /\.png(\?|$)/i.test(imageUrl.pathname)
        ? "image/png"
        : /\.webp(\?|$)/i.test(imageUrl.pathname)
          ? "image/webp"
          : "image/jpeg";
      const type = /^image\/(jpeg|png|webp)$/.test(header)
        ? header
        : header === "application/octet-stream" || header === ""
          ? byExtension
          : "";
      if (!result.response.ok || !type) {
        await result.response.body?.cancel();
        skipped = `Ein Foto konnte nicht geladen werden (${result.response.status}, ${header || "unbekannter Typ"}).`;
        continue;
      }
      const data = await readLimited(result.response, MAX_IMAGE_BYTES);
      if (!data) {
        skipped = "Ein Foto ist zu gross.";
        continue;
      }
      let binary = "";
      for (let index = 0; index < data.length; index += 8192) {
        binary += String.fromCharCode(...data.subarray(index, index + 8192));
      }
      images.push({ type, base64: btoa(binary) });
    } catch {
      skipped = "Ein Foto konnte nicht geladen werden.";
    }
  }
  if (
    skipped &&
    images.length < product.imageUrls.slice(0, MAX_IMAGES).length
  ) {
    notes.push(skipped);
  }
  if (Object.keys(product.specifications).length === 0) {
    notes.push("Auf der Seite wurden keine technischen Daten gefunden.");
  }
  return { ...product, images, notes };
}
