import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  extractEmailSignatureHtml,
  sanitizeCss,
} from "./email-signature-html.ts";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

const OUTLOOK_HTML = `<html><head><style>p{color:red}</style></head><body>
<div><p>Hallo zusammen</p>
<p>Ich möchte euch bitten, mir den VPN Client zu installieren.</p>
<p>Liebe Grüsse</p>
<p>Stefan Gross</p>
<table style="border-collapse:collapse;background:url(https://evil.example/x.png)" onclick="alert(1)">
  <tr><td style="padding-right:16px"><img src="cid:logo123" width="120" alt="Logo"></td>
  <td style="border-left:3px solid #e8b44d;color:#7f7f7f;font-family:Calibri">
    <p style="font-weight:bold;position:fixed">Inhaber</p>
    <p><img src="https://images.example.com/phone.png" width="20"> T: +41 41 563 88 10</p>
    <p><a href="mailto:stefan.gross@gross-ict.ch">stefan.gross@gross-ict.ch</a></p>
    <p><a href="javascript:alert(1)">www.gross-ict.ch</a></p>
    <script>alert("x")</script>
    <img src="https://127.0.0.1/tracker.png">
  </td></tr>
</table></div></body></html>`;

Deno.test(
  "cuts the signature, embeds images and strips unsafe markup",
  async () => {
    const requested: string[] = [];
    const html = await extractEmailSignatureHtml({
      html: OUTLOOK_HTML,
      inlineImages: [
        { contentId: "<logo123>", contentType: "image/png", bytes: PNG },
      ],
      fetcher: ((url: string) => {
        requested.push(url);
        return Promise.resolve(
          new Response(PNG, { headers: { "content-type": "image/png" } }),
        );
      }) as unknown as typeof fetch,
    });
    assert(html);
    // The message itself stays out of the signature.
    assert(!html.includes("VPN Client"));
    assert(!html.includes("Liebe Grüsse"));
    // Signature content, layout and both images are kept.
    assert(html.includes("Inhaber"));
    assert(html.includes("+41 41 563 88 10"));
    assert(html.includes("border-left:3px solid #e8b44d"));
    assertEquals(html.match(/src="data:image\/png;base64,/gu)?.length, 2);
    assert(html.includes('href="mailto:stefan.gross@gross-ict.ch"'));
    // Unsafe parts are gone; private addresses are never fetched.
    for (const unsafe of [
      "<script",
      "onclick",
      "javascript:",
      "url(",
      "position",
      "127.0.0.1",
      "cid:",
    ]) {
      assert(!html.includes(unsafe), unsafe);
    }
    assertEquals(requested, ["https://images.example.com/phone.png"]);
  },
);

Deno.test(
  "keeps the logo cell when the signature repeats the name",
  async () => {
    const html = await extractEmailSignatureHtml({
      html: `<p>Hallo</p><p>Bitte VPN installieren.</p><p>Liebe Grüsse</p><p>Stefan Gross</p>
<table><tr><td><img src="cid:logo"></td><td><p>Stefan Gross</p><p>Inhaber</p>
<p>T: +41 41 563 88 10</p><p>stefan.gross@gross-ict.ch</p></td></tr></table>`,
      inlineImages: [
        { contentId: "logo", contentType: "image/png", bytes: PNG },
      ],
    });
    assert(html);
    assert(html.startsWith("<table"));
    assert(html.includes("data:image/png;base64,"));
    assert(!html.includes("VPN"));
  },
);

Deno.test("returns null when the mail has no corporate signature", async () => {
  assertEquals(
    await extractEmailSignatureHtml({
      html: "<p>Hallo</p><p>Bitte Drucker prüfen.</p><p>Danke</p>",
    }),
    null,
  );
});

Deno.test("sanitizeCss keeps layout properties only", () => {
  assertEquals(
    sanitizeCss(
      "color:#333; position:absolute; background-image:url(x); font-size:13px; width:expression(1)",
    ),
    "color:#333;font-size:13px",
  );
});
