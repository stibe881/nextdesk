import { useCallback, useEffect, useRef, useState } from "react";

const SIGNATURE_MARKER = "\n\nE-Mail-Signatur\n";

/**
 * Splits a ticket description into the message and the plain-text signature
 * section that the mail worker appends under "E-Mail-Signatur".
 */
export function splitPlainTextSignature(description: string): {
  message: string;
  hasPlainSignature: boolean;
} {
  const index = description.indexOf(SIGNATURE_MARKER);
  if (index < 0) return { message: description, hasPlainSignature: false };
  return {
    message: description.slice(0, index).trimEnd(),
    hasPlainSignature: true,
  };
}

/** Full document for the sandboxed frame; scripts and remote loads are blocked. */
export function signatureDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<base target="_blank">
<style>html,body{margin:0;background:#ffffff;color:#333333}body{padding:14px 16px;font-family:Calibri,Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;overflow:hidden}img{max-width:100%;height:auto}table{max-width:100%}p{margin:0 0 4px}a{color:#1f5fbf}</style>
</head><body>${html}</body></html>`;
}

/**
 * Shows the sanitised HTML signature in its own design. The iframe has no
 * script permission (sandbox without allow-scripts) and a CSP that only
 * allows embedded data: images, so nothing is fetched from remote servers.
 */
export function EmailSignatureFrame({ html }: { html: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  const measure = useCallback(() => {
    const body = frameRef.current?.contentDocument?.body;
    if (!body) return;
    const next = Math.min(900, Math.max(40, body.scrollHeight));
    setHeight((current) => (current === next ? current : next));
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onLoad = () => {
      measure();
      const body = frame.contentDocument?.body;
      if (!body || typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(measure);
      observer.observe(body);
      frame.addEventListener("unload", () => observer.disconnect(), {
        once: true,
      });
      // Images decode after load; measure once more when they are done.
      for (const image of Array.from(body.querySelectorAll("img"))) {
        image.addEventListener("load", measure, { once: true });
      }
    };
    frame.addEventListener("load", onLoad);
    return () => frame.removeEventListener("load", onLoad);
  }, [html, measure]);

  return (
    <div className="ticket-email-signature">
      <p className="ticket-email-signature__label">E-Mail-Signatur</p>
      <iframe
        className="ticket-email-signature__frame"
        ref={frameRef}
        referrerPolicy="no-referrer"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={signatureDocument(html)}
        style={{ height }}
        title="E-Mail-Signatur"
      />
    </div>
  );
}
