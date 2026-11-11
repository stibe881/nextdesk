import { parseAction } from "./index.ts";
import { uniquePeople } from "./intel.ts";
import { decisionDueAt, isSecurityVerdict } from "../_shared/security-cases.ts";

const tenantId = "d119bcc1-89e6-4c73-b1c1-c14ea71a88c3";
const ticketId = "fbc3ecd4-a48c-4990-8011-b296a4e6f107";

Deno.test("Sicherheitsfälle: Aktionen werden streng geprüft", () => {
  if (parseAction({ type: "list", tenantId })?.type !== "list") throw new Error("list");
  if (parseAction({ type: "list", tenantId, state: "x" }) !== null) throw new Error("state");
  if (parseAction({ type: "setVerdict", tenantId, ticketId, verdict: "phishing" })?.type !== "setVerdict") {
    throw new Error("verdict");
  }
  if (parseAction({ type: "setVerdict", tenantId, ticketId, verdict: "virus" }) !== null) {
    throw new Error("unknown verdict");
  }
  const saved = parseAction({
    type: "saveTemplates",
    tenantId,
    templates: { harmless: [], spam: [" A "], phishing: ["B", ""], targeted: ["C"] },
  });
  if (saved?.type !== "saveTemplates" || saved.templates.spam[0] !== "A" || saved.templates.phishing.length !== 1) {
    throw new Error("templates");
  }
  if (parseAction({ type: "saveTemplates", tenantId, templates: { spam: [] } }) !== null) {
    throw new Error("missing verdict lists");
  }
});

Deno.test("Sicherheitsfälle: Frist bis zum Urteil nach Risiko", () => {
  const from = new Date("2026-11-09T10:00:00Z");
  if (decisionDueAt("high", from) !== "2026-11-09T10:30:00.000Z") throw new Error("high");
  if (decisionDueAt("medium", from) !== "2026-11-09T14:00:00.000Z") throw new Error("medium");
  if (decisionDueAt("low", from) !== "2026-11-10T10:00:00.000Z") throw new Error("low");
  if (!isSecurityVerdict("targeted") || isSecurityVerdict("other")) throw new Error("verdicts");
});

Deno.test("Sicherheitsfälle: Massnahmen, Ersatzgerät und IOC-Aktionen", () => {
  const assetId = "4b1e3f0a-8f0e-4c55-9a52-2b8f6a0d1c11";
  const measure = parseAction({
    type: "runMeasure",
    tenantId,
    ticketId,
    measure: "intune_sync",
    personKey: " Anna.Muster@Example.ch ",
    assetId,
    confirmed: true,
  });
  if (
    measure?.type !== "runMeasure" || measure.personKey !== "anna.muster@example.ch" ||
    !measure.confirmed
  ) {
    throw new Error("measure");
  }
  // Intune measures need a device, Entra measures ignore it.
  if (
    parseAction({
      type: "runMeasure",
      tenantId,
      ticketId,
      measure: "intune_defender_scan",
      personKey: ticketId,
    }) !== null
  ) {
    throw new Error("device missing");
  }
  const entra = parseAction({
    type: "runMeasure",
    tenantId,
    ticketId,
    measure: "entra_revoke_sessions",
    personKey: ticketId,
    assetId,
  });
  if (entra?.type !== "runMeasure" || entra.assetId !== null || entra.confirmed) {
    throw new Error("entra");
  }
  if (
    parseAction({ type: "runMeasure", tenantId, ticketId, measure: "isolate", personKey: ticketId }) !==
      null
  ) {
    throw new Error("unknown measure");
  }
  if (
    parseAction({
      type: "runMeasure",
      tenantId,
      ticketId,
      measure: "entra_revoke_sessions",
      personKey: "x",
    }) !== null
  ) {
    throw new Error("invalid person");
  }
  const order = parseAction({
    type: "orderReplacement",
    tenantId,
    ticketId,
    personKey: ticketId,
    catalogItemId: assetId,
    comment: "  ",
    confirmed: true,
  });
  if (order?.type !== "orderReplacement" || order.comment !== null) throw new Error("order");
  if (parseAction({ type: "listIocs", tenantId, status: "harmless", query: " evil " })?.type !== "listIocs") {
    throw new Error("iocs");
  }
  if (parseAction({ type: "listIocs", tenantId, status: "deleted" }) !== null) {
    throw new Error("ioc status");
  }
  if (
    parseAction({ type: "setIocStatus", tenantId, iocId: assetId, status: "harmless" })?.type !==
      "setIocStatus"
  ) {
    throw new Error("set ioc");
  }
  if (parseAction({ type: "context", tenantId, ticketId })?.type !== "context") {
    throw new Error("context");
  }
});

Deno.test("Sicherheitsfälle: jede meldende Person einmal", () => {
  const people = uniquePeople([
    { reporter_id: null, reporter_email: "Anna@Example.ch" },
    { reporter_id: null, reporter_email: "anna@example.ch" },
    { reporter_id: ticketId.toUpperCase(), reporter_email: null },
    { reporter_id: ticketId, reporter_email: null },
    { reporter_id: null, reporter_email: null },
  ]);
  if (people.length !== 2 || people[0]!.key !== "anna@example.ch" || people[1]!.key !== ticketId) {
    throw new Error(JSON.stringify(people));
  }
});
