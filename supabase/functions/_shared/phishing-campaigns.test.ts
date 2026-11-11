import { assertEquals } from "jsr:@std/assert@1";
import {
  campaignKeys,
  extractIndicators,
  iocHitNote,
  networkCandidates,
  normalizeSubject,
  normalizeUrl,
  parseCampaignAssignment,
  parseIocHits,
  urlHost,
} from "./phishing-campaigns.ts";

const analysis = {
  headers: {
    fromAddress: "Service@Rechnung-Post.example",
    fromDomain: "rechnung-post.example",
    replyToDomain: "gmail.com",
    subject: "WG: [EXTERN] Ihre Rechnung 48213 ist fällig!",
    sendingIp: "203.0.113.25",
    received: [{ from: "mx", by: "mx2", ip: "10.20.30.40" }],
  },
  links: [
    { href: "https://login.evil-portal.example/pay?id=7#top", host: "login.evil-portal.example" },
    { href: "https://www.microsoft.com/de-ch", host: "www.microsoft.com" },
    { href: "http://198.51.100.7/a", host: "198.51.100.7" },
    { href: "mailto:someone@example.ch" },
    { href: "https://intranet.musterschule.ch/news" },
  ],
};

Deno.test("Kampagnen: Betreff wird normalisiert", () => {
  assertEquals(
    normalizeSubject("WG: [EXTERN] Ihre Rechnung 48213 ist fällig!"),
    "ihre rechnung # ist fällig",
  );
  assertEquals(normalizeSubject("AW: Re: FW: ihre RECHNUNG 9 ist fällig"), "ihre rechnung # ist fällig");
  assertEquals(normalizeSubject("*** EXTERN *** Paket 123-456"), "paket #");
  assertEquals(normalizeSubject("Re: 12"), null);
  assertEquals(normalizeSubject(null), null);
});

Deno.test("Kampagnen: Schlüssel ohne verbreitete und eigene Domains", () => {
  const keys = campaignKeys(analysis, ["musterschule.ch"]);
  assertEquals(keys.senderDomain, "rechnung-post.example");
  assertEquals(keys.subjectKey, "ihre rechnung # ist fällig");
  assertEquals(keys.linkDomains, ["198.51.100.7", "evil-portal.example"]);
  assertEquals(
    campaignKeys({ headers: { fromAddress: "x@gmail.com", subject: "Hallo Welt" } }).senderDomain,
    null,
  );
});

Deno.test("IOC: Indikatoren einer Meldung", () => {
  const indicators = extractIndicators(analysis, ["musterschule.ch"]);
  assertEquals(indicators.map((entry) => `${entry.kind}:${entry.value}`), [
    "sender:service@rechnung-post.example",
    "domain:rechnung-post.example",
    "ip:203.0.113.25",
    "domain:login.evil-portal.example",
    "url:https://login.evil-portal.example/pay?id=7",
    "ip:198.51.100.7",
    "url:http://198.51.100.7/a",
  ]);
  // Private sending IP and the tenant's own sender are no indicators.
  const own = extractIndicators({
    headers: { fromAddress: "it@musterschule.ch", sendingIp: "192.168.1.5" },
  }, ["musterschule.ch"]);
  assertEquals(own, []);
});

Deno.test("Netzwerk: IPs und Hosts für den IPAM-Abgleich", () => {
  const candidates = networkCandidates(analysis);
  assertEquals(candidates.ips, ["203.0.113.25", "10.20.30.40", "198.51.100.7"]);
  assertEquals(candidates.hosts.includes("intranet.musterschule.ch"), true);
  assertEquals(candidates.hosts.includes("rechnung-post.example"), true);
});

Deno.test("URL-Hilfen", () => {
  assertEquals(urlHost("https://WWW.Example.ch/x"), "example.ch");
  assertEquals(urlHost("javascript:alert(1)"), null);
  assertEquals(normalizeUrl("HTTPS://Example.ch/a#frag"), "https://example.ch/a");
});

Deno.test("Antworten der Datenbank werden geprüft", () => {
  const assignment = parseCampaignAssignment({
    campaignId: "c1",
    created: true,
    reporters: 3,
    cases: "x",
  });
  assertEquals(assignment.campaignId, "c1");
  assertEquals(assignment.reporters, 3);
  assertEquals(assignment.cases, 0);
  const hits = parseIocHits([
    { id: "a", kind: "domain", value: "evil.example", verdict: "phishing", caseCount: 2 },
    { id: "b", kind: "virus", value: "x" },
    "kaputt",
  ]);
  assertEquals(hits.length, 1);
  assertEquals(iocHitNote(hits).includes("Domain: evil.example"), true);
});
