import { parseHTML } from "npm:linkedom@0.18.12";
import { corporateSignatureAnchors } from "./exchange-inbound-text.ts";

/**
 * Cuts the corporate signature out of an inbound e-mail body and returns it as
 * strictly allowlisted HTML. Images are embedded as data: URIs (inline CID
 * attachments or downloaded once from https URLs), so displaying the result
 * never contacts a remote server. Everything not explicitly allowed is
 * dropped: scripts, event handlers, forms, remote CSS, unknown URL schemes.
 */

export type SignatureInlineImage = {
  contentId: string;
  contentType: string;
  bytes: Uint8Array;
};

type Fetcher = typeof fetch;

const MAX_OUTPUT_CHARS = 1_400_000;
const MAX_IMAGES = 15;
const MAX_IMAGE_BYTES = 300_000;
const MAX_TOTAL_IMAGE_BYTES = 900_000;
const IMAGE_FETCH_TIMEOUT_MS = 4_000;
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);
const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "br",
  "center",
  "div",
  "em",
  "font",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);
const DROPPED_TAGS = new Set([
  "applet",
  "audio",
  "base",
  "button",
  "canvas",
  "embed",
  "form",
  "frame",
  "frameset",
  "head",
  "iframe",
  "input",
  "link",
  "math",
  "meta",
  "noscript",
  "object",
  "option",
  "script",
  "select",
  "style",
  "svg",
  "template",
  "textarea",
  "title",
  "video",
  "xml",
]);
const VOID_TAGS = new Set(["br", "hr", "img"]);
const SIMPLE_ATTRIBUTES = new Set([
  "align",
  "alt",
  "bgcolor",
  "border",
  "cellpadding",
  "cellspacing",
  "color",
  "colspan",
  "face",
  "height",
  "rowspan",
  "size",
  "title",
  "valign",
  "width",
]);
const CSS_PROPERTIES = new Set([
  "background-color",
  "border",
  "border-bottom",
  "border-collapse",
  "border-color",
  "border-left",
  "border-radius",
  "border-right",
  "border-spacing",
  "border-style",
  "border-top",
  "border-width",
  "color",
  "display",
  "font",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "height",
  "letter-spacing",
  "line-height",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-height",
  "max-width",
  "min-width",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "text-align",
  "text-decoration",
  "text-transform",
  "vertical-align",
  "white-space",
  "width",
]);
const UNSAFE_CSS_VALUE =
  /url\s*\(|expression|javascript:|@import|behavior|-moz-binding|[<>\\]/iu;
const SAFE_ATTRIBUTE_VALUE = /^[^<>"`]{0,200}$/u;

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}

export function sanitizeCss(value: string): string {
  return value
    .split(";")
    .map((declaration) => {
      const separator = declaration.indexOf(":");
      if (separator < 1) return null;
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const propertyValue = declaration.slice(separator + 1).trim();
      if (
        !CSS_PROPERTIES.has(property) ||
        !propertyValue ||
        propertyValue.length > 200 ||
        UNSAFE_CSS_VALUE.test(propertyValue)
      ) {
        return null;
      }
      if (
        property === "display" &&
        !/^(?:inline|block|inline-block|table|table-row|table-cell|none)$/iu.test(
          propertyValue,
        )
      ) {
        return null;
      }
      return `${property}:${propertyValue}`;
    })
    .filter((entry): entry is string => entry !== null)
    .join(";");
}

function safeHref(value: string): string | null {
  const href = value.trim();
  if (/^(?:https?:\/\/|mailto:|tel:)/iu.test(href) && href.length <= 2_000) {
    return href;
  }
  return null;
}

function isPublicImageUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (
    !host.includes(".") ||
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^[\d.]+$/u.test(host) ||
    host.includes(":")
  ) {
    return null;
  }
  return url;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/** Image type from the file signature; servers often send octet-stream. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return "image/png";
  }
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

async function downloadImage(
  url: URL,
  fetcher: Fetcher,
): Promise<{ contentType: string; bytes: Uint8Array } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "image/*" },
    });
    if (!response.ok || (response.url && !isPublicImageUrl(response.url))) {
      return null;
    }
    const declaredType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (
      declaredType &&
      !IMAGE_TYPES.has(declaredType) &&
      declaredType !== "application/octet-stream" &&
      declaredType !== "binary/octet-stream"
    ) {
      return null;
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_IMAGE_BYTES) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 1 || bytes.length > MAX_IMAGE_BYTES) return null;
    // The embedded type always comes from the bytes, never from the header.
    const contentType = sniffImageType(bytes);
    return contentType ? { contentType, bytes } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

type DomNode = {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  parentNode: DomNode | null;
  nextSibling: DomNode | null;
  childNodes: ArrayLike<DomNode>;
  attributes?: ArrayLike<{ name: string; value: string }>;
  getAttribute?: (name: string) => string | null;
};

/** Smallest element that contains the first signature line. */
function findAnchor(root: DomNode, firstLine: string): DomNode | null {
  const needle = normalizeText(firstLine);
  let best: DomNode | null = null;
  const visit = (node: DomNode) => {
    if (node.nodeType !== 1) return;
    if (!normalizeText(node.textContent ?? "").includes(needle)) return;
    best = node;
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  visit(root);
  return best;
}

/**
 * Starting at the anchor, climbs while the ancestor still belongs to the
 * signature (does not yet contain the farewell text), then collects
 * that block and everything after it in document order.
 */
function signatureNodes(
  body: DomNode,
  anchor: DomNode,
  farewellLine: string,
): DomNode[] {
  const closing = normalizeText(farewellLine);
  let block = anchor;
  while (
    block.parentNode &&
    block.parentNode !== body &&
    !normalizeText(block.parentNode.textContent ?? "").includes(closing)
  ) {
    block = block.parentNode;
  }
  // The block itself, its following siblings, and then the following
  // siblings of every ancestor up to <body> – i.e. the rest of the mail.
  const nodes: DomNode[] = [];
  let level: DomNode | null = block;
  let first = true;
  while (level && level !== body) {
    let sibling: DomNode | null = first ? level : level.nextSibling;
    while (sibling) {
      nodes.push(sibling);
      sibling = sibling.nextSibling;
    }
    first = false;
    level = level.parentNode;
  }
  return nodes;
}

type ImageResolver = (src: string) => Promise<string | null>;

async function serialize(
  node: DomNode,
  resolveImage: ImageResolver,
  depth = 0,
): Promise<string> {
  if (depth > 60) return "";
  if (node.nodeType === 3) return escapeHtml(node.textContent ?? "");
  if (node.nodeType !== 1) return "";
  const tag = node.nodeName.toLowerCase();
  if (DROPPED_TAGS.has(tag)) return "";
  let inner = "";
  for (const child of Array.from(node.childNodes)) {
    inner += await serialize(child, resolveImage, depth + 1);
  }
  if (!ALLOWED_TAGS.has(tag)) return inner;

  const attributes: string[] = [];
  for (const attribute of Array.from(node.attributes ?? [])) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value ?? "";
    if (name === "style") {
      const css = sanitizeCss(value);
      if (css) attributes.push(`style="${escapeHtml(css)}"`);
    } else if (name === "href" && tag === "a") {
      const href = safeHref(value);
      if (href) {
        attributes.push(
          `href="${escapeHtml(href)}"`,
          'target="_blank"',
          'rel="noopener noreferrer"',
        );
      }
    } else if (
      SIMPLE_ATTRIBUTES.has(name) &&
      SAFE_ATTRIBUTE_VALUE.test(value)
    ) {
      attributes.push(`${name}="${escapeHtml(value)}"`);
    }
  }
  if (tag === "img") {
    const src = node.getAttribute?.("src") ?? "";
    const dataUri = await resolveImage(src);
    if (!dataUri) return "";
    attributes.push(`src="${dataUri}"`);
  }
  const open = `<${tag}${attributes.length ? ` ${attributes.join(" ")}` : ""}>`;
  return VOID_TAGS.has(tag) ? open : `${open}${inner}</${tag}>`;
}

export async function extractEmailSignatureHtml(input: {
  html: string | null | undefined;
  /** Plain-text body (as used for the ticket); best source for detection. */
  text?: string | null;
  inlineImages?: SignatureInlineImage[];
  fetcher?: Fetcher;
}): Promise<string | null> {
  const html = typeof input.html === "string" ? input.html : "";
  if (!html.trim() || html.length > 2_000_000) return null;
  const anchors =
    (typeof input.text === "string" && input.text.trim()
      ? corporateSignatureAnchors(input.text)
      : null) ?? corporateSignatureAnchors(html);
  if (!anchors) return null;

  // linkedom types its result as a browser window; only the DOM is used.
  // deno-lint-ignore no-explicit-any
  const { document } = parseHTML(
    /<html[\s>]/iu.test(html) ? html : `<html><body>${html}</body></html>`,
  ) as unknown as { document: any };
  const body = (document.body ??
    document.documentElement) as unknown as DomNode | null;
  if (!body) return null;
  const anchor = findAnchor(body, anchors.firstLine);
  if (!anchor) return null;
  const nodes = signatureNodes(body, anchor, anchors.farewellLine);
  if (!nodes.length) return null;

  const inline = new Map(
    (input.inlineImages ?? []).map((image) => [
      image.contentId.replace(/^<|>$/gu, "").toLowerCase(),
      image,
    ]),
  );
  const cache = new Map<string, string | null>();
  let imageCount = 0;
  let imageBytes = 0;
  const resolveImage: ImageResolver = async (rawSrc) => {
    const src = rawSrc.trim();
    if (cache.has(src)) return cache.get(src) ?? null;
    let result: string | null = null;
    if (imageCount < MAX_IMAGES) {
      let image: { contentType: string; bytes: Uint8Array } | null = null;
      if (/^cid:/iu.test(src)) {
        const attachment = inline.get(src.slice(4).toLowerCase()) ?? null;
        const type = attachment ? sniffImageType(attachment.bytes) : null;
        image =
          attachment && type
            ? { contentType: type, bytes: attachment.bytes }
            : null;
      } else {
        const url = isPublicImageUrl(src);
        if (url) image = await downloadImage(url, input.fetcher ?? fetch);
      }
      if (
        image &&
        image.bytes.length <= MAX_IMAGE_BYTES &&
        imageBytes + image.bytes.length <= MAX_TOTAL_IMAGE_BYTES
      ) {
        imageCount += 1;
        imageBytes += image.bytes.length;
        const type =
          image.contentType.toLowerCase() === "image/jpg"
            ? "image/jpeg"
            : image.contentType.toLowerCase();
        result = `data:${type};base64,${toBase64(image.bytes)}`;
      }
    }
    cache.set(src, result);
    return result;
  };

  let output = "";
  for (const node of nodes) output += await serialize(node, resolveImage);
  output = output.trim();
  const visibleText = output.replace(/<[^>]*>/gu, "").trim();
  if (!output || (!visibleText && !output.includes("<img"))) return null;
  return output.length <= MAX_OUTPUT_CHARS ? output : null;
}
