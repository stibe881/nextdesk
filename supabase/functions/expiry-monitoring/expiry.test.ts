import { assert, assertEquals } from "jsr:@std/assert@1";

import {
  certificateFromPeer,
  classifyExpiry,
  DAY_MS,
  decideExpiryAction,
  expiryTicketDescription,
  expiryTicketSubject,
  nameCoversHost,
  parseCertificateTarget,
  parseDomainTarget,
  parseOpensslDate,
  parseRdapDomain,
  pickTransparencyCertificate,
} from "./expiry.ts";
import { parseSettingsInput, parseTargetInput } from "./index.ts";

const NOW = Date.parse("2026-11-07T08:00:00Z");
const inDays = (days: number) => new Date(NOW + days * DAY_MS).toISOString();

Deno.test("certificate targets accept host, host:port and URLs", () => {
  assertEquals(parseCertificateTarget("Mail.Example.CH"), { host: "mail.example.ch", port: 443 });
  assertEquals(parseCertificateTarget("vpn.example.ch:8443"), { host: "vpn.example.ch", port: 8443 });
  assertEquals(parseCertificateTarget("https://portal.example.ch:9443/login"), {
    host: "portal.example.ch",
    port: 9443,
  });
  assertEquals(parseCertificateTarget("example.ch", 636), { host: "example.ch", port: 636 });
  assertEquals(parseCertificateTarget("example.ch:70000"), null);
  assertEquals(parseCertificateTarget("10.0.0.1"), null);
  assertEquals(parseCertificateTarget("localhost"), null);
  assertEquals(parseCertificateTarget("*.example.ch"), null);
  assertEquals(parseDomainTarget("https://www.Example.com/path"), "www.example.com");
  assertEquals(parseDomainTarget("bad_domain.ch"), null);
});

Deno.test("RDAP expiration, registrar and status are parsed", () => {
  const info = parseRdapDomain({
    objectClassName: "domain",
    ldhName: "EXAMPLE.COM",
    status: ["client transfer prohibited", "active"],
    events: [
      { eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" },
      { eventAction: "expiration", eventDate: "2027-08-13T04:00:00Z" },
      { eventAction: "last update of RDAP database", eventDate: "2026-11-06T12:00:00Z" },
    ],
    entities: [
      { roles: ["registrant"], handle: "X" },
      {
        roles: ["registrar"],
        handle: "376",
        vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "RESERVED-Internet Assigned Numbers Authority"]]],
      },
    ],
  });
  assertEquals(info?.expiresAt, "2027-08-13T04:00:00.000Z");
  assertEquals(info?.registrar, "RESERVED-Internet Assigned Numbers Authority");
  assertEquals(info?.statuses, ["client transfer prohibited", "active"]);
  assertEquals(info?.ldhName, "example.com");

  // .ch at SWITCH: no expiration event.
  const swiss = parseRdapDomain({
    objectClassName: "domain",
    ldhName: "example.ch",
    events: [{ eventAction: "registration", eventDate: "2000-01-01T00:00:00Z" }],
  });
  assertEquals(swiss?.expiresAt, null);
  assertEquals(parseRdapDomain({ objectClassName: "entity" }), null);
  assertEquals(parseRdapDomain("nope"), null);
});

Deno.test("node:tls peer certificates are converted", () => {
  assertEquals(parseOpensslDate("Dec  6 00:48:51 2026 GMT"), "2026-12-06T00:48:51.000Z");
  const cert = certificateFromPeer({
    subject: { CN: "example.com" },
    issuer: { C: "US", O: "DigiCert Inc", CN: "DigiCert Global G3 TLS ECC SHA384 2020 CA1" },
    valid_from: "Jan 15 00:00:00 2026 GMT",
    valid_to: "Jan 15 23:59:59 2027 GMT",
    subjectaltname: "DNS:example.com, DNS:*.example.com, IP Address:1.2.3.4",
    serialNumber: "0AD893BAFA68B0B7FB7A404F06ECAF9A",
  });
  assertEquals(cert?.expiresAt, "2027-01-15T23:59:59.000Z");
  assertEquals(cert?.san, ["example.com", "*.example.com"]);
  assertEquals(cert?.issuer, "CN=DigiCert Global G3 TLS ECC SHA384 2020 CA1, O=DigiCert Inc, C=US");
  assertEquals(certificateFromPeer({}), null);
  assertEquals(certificateFromPeer(undefined), null);
});

Deno.test("certificate transparency picks the newest valid certificate", () => {
  assert(nameCoversHost("*.example.ch", "mail.example.ch"));
  assert(!nameCoversHost("*.example.ch", "a.b.example.ch"));
  assert(!nameCoversHost("*.example.ch", "example.ch"));
  const entries = [
    {
      issuer_name: "C=US, O=Let's Encrypt, CN=R10",
      common_name: "mail.example.ch",
      name_value: "mail.example.ch",
      not_before: "2026-06-01T00:00:00",
      not_after: "2026-08-30T00:00:00",
      serial_number: "old",
    },
    {
      issuer_name: "C=US, O=Let's Encrypt, CN=R11",
      common_name: "mail.example.ch",
      name_value: "mail.example.ch\nautodiscover.example.ch",
      not_before: "2026-10-01T00:00:00",
      not_after: "2026-12-30T00:00:00",
      serial_number: "current",
    },
    {
      issuer_name: "C=US, O=Let's Encrypt, CN=R11",
      common_name: "other.example.ch",
      name_value: "other.example.ch",
      not_before: "2026-11-01T00:00:00",
      not_after: "2027-01-30T00:00:00",
      serial_number: "unrelated",
    },
  ];
  const picked = pickTransparencyCertificate(entries, "mail.example.ch", NOW);
  assertEquals(picked?.serial, "current");
  assertEquals(picked?.expiresAt, "2026-12-30T00:00:00.000Z");
  assertEquals(picked?.san, ["mail.example.ch", "autodiscover.example.ch"]);
  // Nothing valid: the one that expired last.
  const expired = pickTransparencyCertificate(entries.slice(0, 1), "mail.example.ch", NOW);
  assertEquals(expired?.serial, "old");
  assertEquals(pickTransparencyCertificate([], "mail.example.ch", NOW), null);
});

Deno.test("expiry status chips", () => {
  assertEquals(classifyExpiry(inDays(90), NOW, 30), "valid");
  assertEquals(classifyExpiry(inDays(30), NOW, 30), "expiring");
  assertEquals(classifyExpiry(inDays(-1), NOW, 30), "expired");
  assertEquals(classifyExpiry(null, NOW, 30), "error");
});

Deno.test("ticket decisions: warn once, remind once, resolve on renewal", () => {
  const none = { open: false, stage: null, expiresAt: null };
  const base = { now: NOW, warnDays: 30, reminderDays: 7 };
  const expiry = inDays(25);
  assertEquals(decideExpiryAction({ ...base, expiresAt: inDays(45), ticket: none }), { type: "none" });
  assertEquals(decideExpiryAction({ ...base, expiresAt: expiry, ticket: none }), {
    type: "create",
    stage: "warned",
  });
  const warned = { open: true, stage: "warned" as const, expiresAt: expiry };
  assertEquals(decideExpiryAction({ ...base, expiresAt: expiry, ticket: warned }), { type: "none" });
  // Closed manually without renewal: no second ticket inside the warn window.
  assertEquals(
    decideExpiryAction({ ...base, expiresAt: expiry, ticket: { ...warned, open: false } }),
    { type: "none" },
  );
  const soon = inDays(6);
  const warnedSoon = { open: true, stage: "warned" as const, expiresAt: soon };
  assertEquals(decideExpiryAction({ ...base, expiresAt: soon, ticket: warnedSoon }), { type: "remind" });
  assertEquals(
    decideExpiryAction({ ...base, expiresAt: soon, ticket: { ...warnedSoon, stage: "reminded" } }),
    { type: "none" },
  );
  // Warn ticket closed without renewal: a reminder ticket at 7 days.
  assertEquals(
    decideExpiryAction({ ...base, expiresAt: soon, ticket: { ...warnedSoon, open: false } }),
    { type: "create", stage: "reminded" },
  );
  // First seen inside the reminder window.
  assertEquals(decideExpiryAction({ ...base, expiresAt: soon, ticket: none }), {
    type: "create",
    stage: "reminded",
  });
  // Renewed: later expiry than the ticketed one.
  assertEquals(decideExpiryAction({ ...base, expiresAt: inDays(95), ticket: warnedSoon }), {
    type: "renewed",
  });
  // A few hours difference (re-issued same day) is not a renewal.
  assertEquals(
    decideExpiryAction({
      ...base,
      expiresAt: new Date(Date.parse(soon) + 3_600_000).toISOString(),
      ticket: warnedSoon,
    }),
    { type: "remind" },
  );
  assertEquals(decideExpiryAction({ ...base, expiresAt: null, ticket: warned }), { type: "none" });
});

Deno.test("ticket texts mention issuer, SANs and renewal steps", () => {
  const target = {
    kind: "certificate" as const,
    host: "vpn.example.ch",
    port: 8443,
    label: "VPN",
    assetName: "FW-01",
    serviceName: null,
  };
  const subject = expiryTicketSubject(target, inDays(29.5), NOW);
  assertEquals(subject, "Zertifikat läuft ab (in 30 Tagen): vpn.example.ch:8443");
  const text = expiryTicketDescription(
    target,
    {
      expiresAt: inDays(29.5),
      issuer: "CN=R11, O=Let's Encrypt",
      subject: "CN=vpn.example.ch",
      san: ["vpn.example.ch", "remote.example.ch"],
      serial: "abc",
      registrar: null,
      statuses: [],
      method: "tls",
    },
    NOW,
    "warned",
  );
  assert(text.includes("Aussteller: CN=R11, O=Let's Encrypt"));
  assert(text.includes("vpn.example.ch, remote.example.ch"));
  assert(text.includes("Erneuerung:"));
  assert(text.includes("Verknüpftes Asset: FW-01"));
  assertEquals(
    expiryTicketSubject({ ...target, kind: "domain", host: "example.com", port: null }, inDays(-2), NOW),
    "Domain abgelaufen: example.com",
  );
});

Deno.test("admin input validation", () => {
  assertEquals(
    parseSettingsInput({
      enabled: true,
      autoResolve: true,
      warnDays: 30,
      reminderDays: 7,
      departmentId: "",
      priorityKey: null,
      reminderPriorityKey: "urgent",
    })?.reminderPriorityKey,
    "urgent",
  );
  assertEquals(
    parseSettingsInput({ enabled: true, autoResolve: true, warnDays: 7, reminderDays: 7 }),
    null,
  );
  const target = parseTargetInput({ kind: "certificate", host: "mail.example.ch:993" });
  assertEquals(target?.port, 993);
  assertEquals(target?.active, true);
  assertEquals(parseTargetInput({ kind: "domain", host: "example.ch" })?.port, null);
  assertEquals(parseTargetInput({ kind: "domain", host: "example.ch", assetId: "nope" }), null);
  assertEquals(parseTargetInput({ kind: "ftp", host: "example.ch" }), null);
});
