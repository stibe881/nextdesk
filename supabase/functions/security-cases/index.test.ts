import { parseAction } from "./index.ts";
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
