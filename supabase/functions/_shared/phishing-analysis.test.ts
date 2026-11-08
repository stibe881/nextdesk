import {
  analyzeAttachment,
  analyzeHeaders,
  analyzeLink,
  analyzeMail,
  decodeEncodedWords,
  defang,
  detectLookalike,
  extractLinks,
  organizationalDomain,
  parseHeaderBlock,
  parseInlineForward,
  parseMime,
  parsePastedMail,
  punycodeDecode,
  riskScore,
  selectOriginal,
  skeleton,
  summaryText,
} from "./phishing-analysis.ts";
import { parseOutlookMsg } from "./outlook-msg.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function equal<T>(actual: T, expected: T, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}
const codes = (findings: { code: string }[]) => findings.map((entry) => entry.code);

const PHISHING_HEADERS = [
  "Received: from mail.example-bank.ch (mx1.contoso.ch [10.0.0.5])",
  "\tby mx2.contoso.ch with ESMTPS id 123; Mon, 2 Nov 2026 08:00:02 +0100",
  "Received: from evil-host.ru (unknown [185.220.101.7])",
  "\tby mail.example-bank.ch with SMTP; Mon, 2 Nov 2026 08:00:00 +0100",
  "Authentication-Results: mx2.contoso.ch; spf=fail (sender IP is 185.220.101.7)",
  " smtp.mailfrom=bounce.evil-host.ru; dkim=none (message not signed);",
  " dmarc=fail action=quarantine header.from=paypa1.com",
  "Authentication-Results: forged.example; spf=pass dkim=pass dmarc=pass",
  "Return-Path: <bounce@evil-host.ru>",
  'From: "PayPal Service <service@paypal.com>" <service@paypa1.com>',
  "Reply-To: collect@another-domain.net",
  "To: anna@contoso.ch",
  "Subject: =?utf-8?B?SWhyIEtvbnRvIHd1cmRlIGdlc3BlcnJ0?=",
  "Date: Mon, 2 Nov 2026 08:00:00 +0100",
  "Message-ID: <abc@paypa1.com>",
].join("\r\n");

Deno.test("Kopfzeilen werden entfaltet und RFC-2047 dekodiert", () => {
  const headers = parseHeaderBlock(PHISHING_HEADERS);
  equal(headers.filter((entry) => entry.name === "received").length, 2, "zwei Received");
  equal(headers.find((entry) => entry.name === "subject")?.value, "Ihr Konto wurde gesperrt", "Betreff");
  assert(
    headers.find((entry) => entry.name === "authentication-results")!.value.includes("dmarc=fail"),
    "Fortsetzungszeilen fehlen",
  );
  equal(decodeEncodedWords("=?iso-8859-1?Q?Gr=FCezi_Anna?="), "Grüezi Anna", "Q-Kodierung");
});

Deno.test("Kopfzeilenanalyse erkennt Return-Path, Reply-To, SPF/DKIM/DMARC und Sende-IP", () => {
  const analysis = analyzeHeaders(parseHeaderBlock(PHISHING_HEADERS), ["contoso.ch"]);
  equal(analysis.fromAddress, "service@paypa1.com", "From-Adresse");
  equal(analysis.returnPathDomain, "evil-host.ru", "Return-Path-Domain");
  equal(analysis.replyToDomain, "another-domain.net", "Reply-To-Domain");
  // The topmost result counts, not the forged lower header.
  equal(analysis.auth, { spf: "fail", dkim: "none", dmarc: "fail" }, "Auth-Ergebnisse");
  equal(analysis.sendingIp, "185.220.101.7", "Sende-IP");
  equal(analysis.received.length, 2, "Received-Kette");
  equal(analysis.received[1]!.ip, "185.220.101.7", "IP der äusseren Station");
  const found = codes(analysis.findings);
  for (const code of [
    "return_path_mismatch",
    "reply_to_mismatch",
    "display_name_spoof",
    "sender_lookalike",
    "spf_fail",
    "dkim_none",
    "dmarc_fail",
  ]) {
    assert(found.includes(code), `Befund ${code} fehlt (${found.join(", ")})`);
  }
});

Deno.test("Sende-IP fällt auf die erste öffentliche Received-Station zurück", () => {
  const analysis = analyzeHeaders(parseHeaderBlock([
    "Received: from internal (relay.local [192.168.1.4]) by mx.contoso.ch",
    "Received: from sender.example.org (sender.example.org [203.0.113.9]) by relay.local",
    "From: info@example.org",
    "Return-Path: <info@mail.example.org>",
  ].join("\n")));
  equal(analysis.sendingIp, "203.0.113.9", "öffentliche IP");
  assert(!codes(analysis.findings).includes("return_path_mismatch"), "Subdomain ist kein Mismatch");
  assert(codes(analysis.findings).includes("auth_results_missing"), "fehlende Auth-Ergebnisse");
});

Deno.test("Links: Anzeigetext ≠ Ziel, Punycode, Kurz-URL, IP und @-Trick", () => {
  const html = [
    '<p>Bitte bestätigen: <a href="https://login.micros0ft-secure.top/verify">https://login.microsoftonline.com</a></p>',
    '<a href="https://bit.ly/3abc">Rechnung ansehen</a>',
    '<a href="http://xn--pypal-4ve.com/login">PayPal</a>',
    '<a href="http://192.0.2.10/a">Konto</a>',
    '<a href="https://www.paypal.com@evil.example/">www.paypal.com</a>',
    '<a href="mailto:x@y.ch">Mail</a>',
    '<a href="https://contoso.ch/hilfe">contoso.ch/hilfe</a>',
  ].join("\n");
  const links = extractLinks(html, "Siehe auch www.example.org.", ["contoso.ch"]);
  const byHref = (part: string) => links.find((link) => link.href.includes(part))!;
  assert(codes(byHref("micros0ft").findings).includes("text_href_mismatch"), "Mismatch fehlt");
  assert(codes(byHref("micros0ft").findings).includes("suspicious_tld"), "TLD fehlt");
  assert(codes(byHref("bit.ly").findings).includes("url_shortener"), "Kurz-URL fehlt");
  assert(codes(byHref("xn--").findings).includes("punycode"), "Punycode fehlt");
  assert(codes(byHref("xn--").findings).includes("lookalike_domain"), "Lookalike (Homoglyph) fehlt");
  assert(codes(byHref("192.0.2.10").findings).includes("ip_host"), "IP-Host fehlt");
  assert(codes(byHref("@evil").findings).includes("userinfo_trick"), "@-Trick fehlt");
  assert(!links.some((link) => link.href.startsWith("mailto:")), "mailto ist kein Link");
  equal(byHref("contoso.ch/hilfe").findings, [], "eigene Domain ist unauffällig");
  assert(links.some((link) => link.href === "http://www.example.org"), "Text-URL fehlt");
  // Display texts are not reported as links of their own.
  assert(!links.some((link) => link.href === "https://login.microsoftonline.com"), "Anzeigetext als Link");
});

Deno.test("Gefährliche Schemata und unverschlüsselte Links", () => {
  assert(codes(analyzeLink("javascript:alert(1)", "Klick").findings).includes("dangerous_scheme"), "javascript:");
  assert(codes(analyzeLink("http://example.org/", null).findings).includes("insecure_http"), "http");
});

Deno.test("Lookalike-Erkennung: Homoglyphen, Tippfehler, Marke in Subdomain", () => {
  equal(punycodeDecode("pypal-4ve"), "pаypal", "Punycode-Dekodierung (kyrillisches a)");
  equal(skeleton("paypa1"), skeleton("paypal"), "1 ≙ l");
  equal(skeleton("rnicrosoft"), skeleton("microsoft"), "rn ≙ m");
  equal(detectLookalike("paypa1.com", ["paypal.com"])?.reason, "homoglyph", "paypa1");
  equal(detectLookalike("xn--pypal-4ve.com", ["paypal.com"])?.reason, "homoglyph", "kyrillisch");
  equal(detectLookalike("micorsoft.com", ["microsoft.com"])?.reason, "edit_distance", "Buchstabendreher");
  equal(detectLookalike("contosso.ch", ["contoso.ch"])?.reason, "edit_distance", "Tippfehler Mandant");
  equal(
    detectLookalike("microsoft.account-check.xyz", ["microsoft.com"])?.reason,
    "brand_in_subdomain",
    "Marke in Subdomain",
  );
  equal(detectLookalike("contoso.com", ["contoso.ch"], ["contoso.ch"])?.reason, "edit_distance", "eigene Marke, andere Endung");
  equal(detectLookalike("microsoft.com", ["microsoft.com"]), null, "Original");
  equal(detectLookalike("login.microsoft.com", ["microsoft.com"]), null, "Subdomain des Originals");
  equal(detectLookalike("microsoft.de", ["microsoft.com"]), null, "Länderdomain einer fremden Marke");
  equal(detectLookalike("admin.contoso.ch", ["admin.ch", "contoso.ch"]), null, "generisches Wort");
  equal(detectLookalike("example.org", ["paypal.com", "contoso.ch"]), null, "unbeteiligt");
  equal(organizationalDomain("a.b.example.co.uk"), "example.co.uk", "mehrteilige Endung");
});

Deno.test("Riskante Anhänge: ausführbar, doppelte Endung, RTL-Trick", () => {
  assert(codes(analyzeAttachment({ filename: "setup.exe", contentType: "application/x-msdownload", size: 1 }).findings)
    .includes("risky_extension"), "exe");
  const double = analyzeAttachment({ filename: "Rechnung.pdf.js", contentType: "text/javascript", size: 1 });
  assert(codes(double.findings).includes("double_extension"), "doppelte Endung");
  const rtl = analyzeAttachment({ filename: "Rechnung‮fdp.exe", contentType: "application/octet-stream", size: 1 });
  assert(codes(rtl.findings).includes("rtl_override"), "RTLO");
  equal(analyzeAttachment({ filename: "Bericht.pdf", contentType: "application/pdf", size: 1 }).findings, [], "PDF");
  assert(analyzeAttachment({ filename: "invoice.html", contentType: "text/html", size: 1 }).findings[0]?.severity === "medium", "HTML mittel");
});

const FORWARD_EML = [
  "From: Anna Muster <anna@contoso.ch>",
  "To: phishing@contoso.ch",
  "Subject: WG: Ihr Konto wurde gesperrt",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="outer"',
  "",
  "--outer",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Ist das echt?",
  "--outer",
  "Content-Type: message/rfc822",
  'Content-Disposition: attachment; filename="original.eml"',
  "",
  PHISHING_HEADERS,
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="inner"',
  "",
  "--inner",
  "Content-Type: text/html; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  '<a href=3D"https://paypa1.com/login">https://www.paypal.com/login</a> Gr=C3=BCezi',
  "--inner",
  'Content-Type: application/octet-stream; name="Rechnung.pdf.exe"',
  "Content-Disposition: attachment; filename*=utf-8''Rechnung.pdf.exe",
  "Content-Transfer-Encoding: base64",
  "",
  "TVqQAAMAAAAEAAAA",
  "--inner--",
  "--outer--",
  "",
].join("\r\n");

Deno.test("MIME: weitergeleitetes Original (.eml) wird gefunden und analysiert", () => {
  const outer = parseMime(FORWARD_EML);
  equal(outer.embedded.length, 1, "eingebettete Nachricht");
  assert(outer.text.includes("Ist das echt?"), "Text der Weiterleitung");
  const selected = selectOriginal(outer, "eml", { preferInline: true });
  equal(selected.source, "eml", "Quelle");
  assert(selected.mail.html.includes("Grüezi"), "Quoted-Printable/UTF-8");
  equal(selected.mail.attachments.map((item) => item.filename), ["Rechnung.pdf.exe"], "Anhang");
  equal(selected.mail.attachments[0]!.size, 12, "dekodierte Grösse");
  const analysis = analyzeMail(selected.mail, { source: selected.source, referenceDomains: ["contoso.ch"] });
  equal(analysis.level, "high", "Risikostufe");
  assert(analysis.score >= 60, "Risikowert");
  const text = summaryText(analysis, { previousReports: 2 });
  assert(text.includes("Risiko: hoch"), "Zusammenfassung Stufe");
  assert(text.includes("hxxps://paypa1[.]com/login"), "Links entschärft");
  assert(!text.includes("https://paypa1.com"), "kein klickbarer Link");
  assert(text.includes("bereits 2× gemeldet"), "Mehrfachmeldung");
});

Deno.test("Inline-Weiterleitung (Outlook, deutsch) wird erkannt", () => {
  const text = [
    "Hallo IT, ist das Phishing?",
    "",
    "________________________________",
    "Von: PayPal <service@paypa1.com>",
    "Gesendet: Montag, 2. November 2026 08:00",
    "An: Anna Muster <anna@contoso.ch>",
    "Betreff: Konto gesperrt",
    "",
    "Bitte melden Sie sich hier an: https://paypa1.com/login",
  ].join("\n");
  const inline = parseInlineForward(text)!;
  assert(inline, "nicht erkannt");
  equal(inline.headers.find((entry) => entry.name === "from")?.value, "PayPal <service@paypa1.com>", "Von");
  equal(inline.headers.find((entry) => entry.name === "subject")?.value, "Konto gesperrt", "Betreff");
  assert(inline.text.includes("https://paypa1.com/login"), "Text");
  const english = parseInlineForward(
    "---------- Forwarded message ---------\nFrom: X [mailto:x@evil.example]\nDate: today\nSubject: Hi\nTo: a@b.ch\n\nbody",
  )!;
  equal(english.headers[0]!.value, "X <x@evil.example>", "mailto-Schreibweise");
  equal(parseInlineForward("Ganz normaler Text ohne Weiterleitung"), null, "kein Forward");
});

Deno.test("Eingefügte Kopfzeilen und Texte werden unterschieden", () => {
  equal(parsePastedMail(PHISHING_HEADERS).source, "headers", "nur Kopfzeilen");
  equal(parsePastedMail(FORWARD_EML).source, "eml", "volle Quelle mit Anhang");
  equal(parsePastedMail("Schau mal: https://bit.ly/x").source, "text", "Text");
  const pasted = parsePastedMail("Hallo\n\n-----Original Message-----\nFrom: a@evil.example\nSubject: Test\n\nText");
  equal(pasted.source, "inline_forward", "Weiterleitung");
});

Deno.test("Risikowert zählt jeden Befundcode nur einmal", () => {
  const many = Array.from({ length: 10 }, () => ({ code: "url_shortener", severity: "medium" as const, message: "x" }));
  equal(riskScore(many), { score: 15, level: "low" }, "einmal gewertet");
  equal(riskScore([]).level, "low", "leer");
  equal(defang("https://a.b/c@d"), "hxxps://a[.]b/c[@]d", "entschärfen");
});

// --- Outlook .msg -----------------------------------------------------------

type CfbNode = { name: string; type: 1 | 2 | 5; data?: Uint8Array; children?: CfbNode[] };

function utf16(value: string): Uint8Array {
  const out = new Uint8Array(value.length * 2);
  for (let index = 0; index < value.length; index += 1) {
    out[index * 2] = value.charCodeAt(index) & 0xff;
    out[index * 2 + 1] = value.charCodeAt(index) >> 8;
  }
  return out;
}

/** Writes a minimal version-3 compound file (512-byte sectors, mini stream). */
function buildCfb(root: CfbNode): Uint8Array {
  const END = 0xfffffffe, FREE = 0xffffffff, NONE = 0xffffffff;
  type Flat = { node: CfbNode; child: number; right: number; start: number; size: number };
  const flat: Flat[] = [];
  const visit = (node: CfbNode): number => {
    const id = flat.length;
    flat.push({ node, child: NONE, right: NONE, start: END, size: node.data?.length ?? 0 });
    let previous = -1;
    for (const child of node.children ?? []) {
      const childId = visit(child);
      if (previous < 0) flat[id]!.child = childId;
      else flat[previous]!.right = childId;
      previous = childId;
    }
    return id;
  };
  visit(root);
  // Mini stream for small streams, regular sectors for large ones.
  const mini: number[] = [];
  const miniFat: number[] = [];
  const big: { id: number; data: Uint8Array }[] = [];
  for (const [id, entry] of flat.entries()) {
    const data = entry.node.data;
    if (entry.node.type !== 2 || !data || data.length === 0) continue;
    if (data.length >= 4096) {
      big.push({ id, data });
      continue;
    }
    const startSector = mini.length / 64;
    const sectors = Math.ceil(data.length / 64);
    for (let index = 0; index < sectors; index += 1) {
      miniFat.push(index === sectors - 1 ? END : startSector + index + 1);
    }
    mini.push(...data, ...new Array(sectors * 64 - data.length).fill(0));
    entry.start = startSector;
  }
  const sectors: Uint8Array[] = [new Uint8Array(512)]; // sector 0 = FAT
  const fat: number[] = [0xfffffffd];
  const alloc = (bytes: Uint8Array): number => {
    if (bytes.length === 0) return END;
    const start = sectors.length;
    const count = Math.ceil(bytes.length / 512);
    for (let index = 0; index < count; index += 1) {
      const sector = new Uint8Array(512);
      sector.set(bytes.subarray(index * 512, index * 512 + 512));
      sectors.push(sector);
      fat.push(index === count - 1 ? END : start + index + 1);
    }
    return start;
  };
  const dirBytes = new Uint8Array(Math.ceil(flat.length / 4) * 512);
  const miniFatBytes = new Uint8Array(Math.ceil((miniFat.length * 4) / 512) * 512).fill(0xff);
  new Uint8Array(miniFatBytes.buffer).set(new Uint8Array(new Uint32Array(miniFat).buffer));
  const firstMiniFat = alloc(miniFatBytes);
  flat[0]!.start = alloc(new Uint8Array(mini));
  flat[0]!.size = mini.length;
  for (const entry of big) flat[entry.id]!.start = alloc(entry.data);
  for (const [index, entry] of flat.entries()) {
    const offset = index * 128;
    const name = utf16(entry.node.name);
    dirBytes.set(name, offset);
    const view = new DataView(dirBytes.buffer, offset, 128);
    view.setUint16(0x40, name.length + 2, true);
    view.setUint8(0x42, entry.node.type);
    view.setUint8(0x43, 1);
    view.setUint32(0x44, NONE, true);
    view.setUint32(0x48, entry.right, true);
    view.setUint32(0x4c, entry.child, true);
    view.setUint32(0x74, entry.start, true);
    view.setUint32(0x78, entry.size, true);
  }
  for (let index = flat.length; index < dirBytes.length / 128; index += 1) {
    const view = new DataView(dirBytes.buffer, index * 128, 128);
    view.setUint32(0x44, NONE, true);
    view.setUint32(0x48, NONE, true);
    view.setUint32(0x4c, NONE, true);
  }
  const firstDir = alloc(dirBytes);
  const fatView = new DataView(sectors[0]!.buffer);
  for (let index = 0; index < 128; index += 1) {
    fatView.setUint32(index * 4, fat[index] ?? FREE, true);
  }
  const header = new Uint8Array(512);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const view = new DataView(header.buffer);
  view.setUint16(0x18, 0x3e, true);
  view.setUint16(0x1a, 3, true);
  view.setUint16(0x1c, 0xfffe, true);
  view.setUint16(0x1e, 9, true);
  view.setUint16(0x20, 6, true);
  view.setUint32(0x2c, 1, true);
  view.setUint32(0x30, firstDir, true);
  view.setUint32(0x38, 4096, true);
  view.setUint32(0x3c, firstMiniFat, true);
  view.setUint32(0x40, miniFatBytes.length / 512, true);
  view.setUint32(0x44, END, true);
  for (let index = 0; index < 109; index += 1) view.setUint32(0x4c + index * 4, index === 0 ? 0 : FREE, true);
  const out = new Uint8Array(512 * (sectors.length + 1));
  out.set(header);
  sectors.forEach((sector, index) => out.set(sector, (index + 1) * 512));
  return out;
}

Deno.test(".msg: Kopfzeilen, Betreff, HTML-Text und Anhänge werden gelesen", () => {
  const transport = `${PHISHING_HEADERS}\r\n`;
  const longHtml = `<a href="https://paypa1.com/x">https://www.paypal.com</a>${" ".repeat(5000)}`;
  const msg = buildCfb({
    name: "Root Entry",
    type: 5,
    children: [
      { name: "__substg1.0_007D001F", type: 2, data: utf16(transport) },
      { name: "__substg1.0_0037001F", type: 2, data: utf16("Konto gesperrt") },
      { name: "__substg1.0_1000001F", type: 2, data: utf16("Bitte anmelden") },
      { name: "__substg1.0_10130102", type: 2, data: new TextEncoder().encode(longHtml) },
      {
        name: "__attach_version1.0_#00000000",
        type: 1,
        children: [
          { name: "__substg1.0_3707001F", type: 2, data: utf16("Rechnung.pdf.exe") },
          { name: "__substg1.0_37010102", type: 2, data: new Uint8Array(300) },
        ],
      },
    ],
  });
  const parsed = parseOutlookMsg(msg);
  equal(parsed.headers.find((entry) => entry.name === "return-path")?.value, "<bounce@evil-host.ru>", "Return-Path");
  equal(parsed.text, "Bitte anmelden", "Text");
  assert(parsed.html.startsWith('<a href="https://paypa1.com/x">'), "HTML aus regulären Sektoren");
  equal(parsed.attachments, [{ filename: "Rechnung.pdf.exe", contentType: "application/octet-stream", size: 300 }], "Anhang");
  const analysis = analyzeMail(parsed, { source: "msg" });
  assert(codes(analysis.findings).includes("double_extension"), "Anhang analysiert");
  assert(codes(analysis.findings).includes("text_href_mismatch"), "Link analysiert");
});

Deno.test(".msg ohne Transport-Kopfzeilen nutzt Absender-Eigenschaften", () => {
  const msg = buildCfb({
    name: "Root Entry",
    type: 5,
    children: [
      { name: "__substg1.0_0C1A001F", type: 2, data: utf16("PayPal") },
      { name: "__substg1.0_5D01001F", type: 2, data: utf16("service@paypa1.com") },
      { name: "__substg1.0_0037001F", type: 2, data: utf16("Hallo") },
    ],
  });
  const parsed = parseOutlookMsg(msg);
  equal(parsed.headers, [
    { name: "from", value: "PayPal <service@paypa1.com>" },
    { name: "subject", value: "Hallo" },
  ], "synthetische Kopfzeilen");
  let threw = false;
  try {
    parseOutlookMsg(new Uint8Array(600));
  } catch {
    threw = true;
  }
  assert(threw, "keine Compound-Datei muss abgelehnt werden");
});
