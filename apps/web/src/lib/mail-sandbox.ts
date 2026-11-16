// Reported (possibly malicious) e-mail shown as the recipient saw it: the
// HTML runs in an iframe with sandbox="" (no scripts, no same origin), a CSP
// that forbids every external resource, links without targets and external
// images removed. DOMParser never executes anything.

/** «https://evil.example/x» → «hxxps://evil[.]example/x» (not clickable). */
export function defangUrl(url: string): string {
  return url.trim().replace(/^http/i, "hxxp").replace(/\./g, "[.]");
}

const REMOVED =
  "script,iframe,frame,frameset,object,embed,applet,form,base,link,meta,noscript,portal";
const URL_ATTRIBUTES = new Set([
  "srcset",
  "action",
  "formaction",
  "background",
  "ping",
  "poster",
  "xlink:href",
]);

/** Removes @import and url(...) that do not point to data: in CSS text. */
export function stripExternalCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(['"]?)(?!data:)[^)]*?\1\s*\)/gi, "none")
    .replace(/image-set\([^)]*\)/gi, "none");
}

export const MAIL_SANDBOX_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";

/** Complete srcdoc document for the sandboxed iframe. */
export function sandboxedMailDocument(html: string, text = ""): string {
  const parser = new DOMParser();
  const doc = html.trim()
    ? parser.parseFromString(html, "text/html")
    : parser.parseFromString(
        "<!doctype html><html><head></head><body></body></html>",
        "text/html",
      );
  if (!html.trim()) {
    const pre = doc.createElement("pre");
    pre.textContent = text;
    pre.setAttribute(
      "style",
      "white-space:pre-wrap;font:13px/1.5 system-ui,sans-serif;margin:0",
    );
    doc.body.append(pre);
  }
  doc.querySelectorAll(REMOVED).forEach((node) => node.remove());
  doc.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || URL_ATTRIBUTES.has(name)) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  // CSS may load external resources (url(), @import): only data: stays.
  doc.querySelectorAll("[style]").forEach((element) => {
    element.setAttribute(
      "style",
      stripExternalCss(element.getAttribute("style") ?? ""),
    );
  });
  doc.querySelectorAll("style").forEach((element) => {
    element.textContent = stripExternalCss(element.textContent ?? "");
  });
  doc.querySelectorAll("a[href], area[href]").forEach((link) => {
    const href = link.getAttribute("href") ?? "";
    link.removeAttribute("href");
    link.removeAttribute("target");
    link.setAttribute("data-defanged-link", "");
    link.setAttribute("title", `Link (entschärft): ${defangUrl(href)}`);
  });
  doc.querySelectorAll("img, image, svg use").forEach((image) => {
    const src = image.getAttribute("src") ?? image.getAttribute("href") ?? "";
    if (!/^data:image\//i.test(src)) {
      image.removeAttribute("src");
      image.removeAttribute("href");
      image.setAttribute("alt", "[Bild blockiert]");
      image.setAttribute("data-blocked-image", "");
    }
  });
  const meta = doc.createElement("meta");
  meta.setAttribute("http-equiv", "Content-Security-Policy");
  meta.setAttribute("content", MAIL_SANDBOX_CSP);
  const charset = doc.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  const style = doc.createElement("style");
  style.textContent =
    "html,body{margin:0;padding:8px;background:#fff;color:#111}" +
    "[data-defanged-link]{color:#1d4ed8;text-decoration:underline dotted;cursor:help}" +
    "[data-blocked-image]{display:inline-block;min-width:24px;min-height:16px;outline:1px dashed #aab;color:#667;font:11px sans-serif}";
  doc.head.prepend(charset, meta, style);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
