import { assertEquals, assertThrows } from "jsr:@std/assert@1";

import {
  parseAppleStatus,
  parseGoogleDashboard,
  parseInit7,
  parseMicrosoftIssues,
  parseStatuspage,
} from "./providers.ts";

Deno.test("Statuspage: nur ungelöste Vorfälle, Schweregrad aus impact", () => {
  const issues = parseStatuspage({
    incidents: [
      {
        id: "abc",
        name: "Elevated errors on Claude.ai",
        status: "investigating",
        impact: "major",
        shortlink: "https://stspg.io/x",
        started_at: "2026-11-12T10:00:00Z",
        incident_updates: [{ body: "We are **investigating**." }],
      },
      { id: "old", name: "Fixed", status: "resolved", impact: "minor" },
      { id: "min", name: "Slow Actions", status: "monitoring", impact: "minor" },
    ],
  }, "https://status.claude.com");
  assertEquals(issues.map((issue) => [issue.id, issue.severity]), [["abc", "down"], ["min", "warning"]]);
  assertEquals(issues[0]!.message, "We are investigating.");
  assertThrows(() => parseStatuspage([], "x"));
});

Deno.test("Google-Dashboard: laufend ohne end, Produktfilter, Information weggelassen", () => {
  const issues = parseGoogleDashboard([
    {
      id: "g1",
      begin: "2026-11-12T08:00:00+00:00",
      end: null,
      external_desc: "**Summary:**\nGemini is unavailable for some users. Description: more",
      most_recent_update: { text: "Mitigation underway." },
      status_impact: "SERVICE_OUTAGE",
      affected_products: [{ title: "Gemini" }],
      uri: "incidents/g1",
    },
    { id: "g2", end: null, status_impact: "SERVICE_DISRUPTION", affected_products: [{ title: "Gmail" }] },
    { id: "g3", end: null, status_impact: "SERVICE_INFORMATION", affected_products: [{ title: "Gemini" }] },
    { id: "g4", end: "2026-11-01T00:00:00Z", affected_products: [{ title: "Gemini" }] },
  ], "https://www.google.com/appsstatus/dashboard/", (title) => /gemini/i.test(title));
  assertEquals(issues.length, 1);
  assertEquals(issues[0]!.title, "Gemini: Gemini is unavailable for some users.");
  assertEquals(issues[0]!.severity, "down");
  assertEquals(issues[0]!.url, "https://www.google.com/appsstatus/dashboard/incidents/g1");
});

Deno.test("Apple: laufende Ereignisse der gewählten Dienste, auch mit jsonCallback", () => {
  const body = `jsonCallback(${JSON.stringify({
    services: [
      {
        serviceName: "App Store",
        events: [
          { messageId: "1", statusType: "Outage", eventStatus: "ongoing", message: "Einige Benutzer", epochStartDate: 1794350940000 },
          { messageId: "2", statusType: "Issue", eventStatus: "resolved" },
        ],
      },
      { serviceName: "Fotos", events: [{ messageId: "3", statusType: "Outage", eventStatus: "ongoing" }] },
    ],
  })});`;
  const issues = parseAppleStatus(body, ["App Store", "Mac App Store"], "https://apple");
  assertEquals(issues.map((issue) => [issue.id, issue.title, issue.severity]), [["1", "App Store: Ausfall", "down"]]);
});

Deno.test("Init7: «no outage» ergibt nichts, sonst Tickets mit Titel aus dem RSS", () => {
  assertEquals(
    parseInit7("<h3>Current Issues</h3> At the moment we record no outage. <h3>Planned Maintenance</h3> #42474056", null, "u"),
    [],
  );
  const rss = "<item><title>#42473721 (11.11.26): Outage BGP process r1zrh5.core</title></item>";
  const issues = parseInit7(
    "<h3>Current Issues</h3><a>42473721</a> Outage BGP <h3>Planned Maintenance</h3> #42474056",
    rss,
    "u",
  );
  assertEquals(issues.map((issue) => [issue.id, issue.title]), [["42473721", "Init7: Outage BGP process r1zrh5.core"]]);
});

Deno.test("Microsoft 365: nur ungelöste Vorfälle (keine Hinweise)", () => {
  const issues = parseMicrosoftIssues({
    value: [
      { id: "TM123", service: "Microsoft Teams", title: "Users can't join meetings", classification: "incident", isResolved: false, impactDescription: "Users may be unable to join." },
      { id: "EX9", service: "Exchange Online", title: "Delays", classification: "advisory", isResolved: false },
      { id: "SP1", service: "SharePoint Online", title: "Old", classification: "incident", isResolved: true },
    ],
  });
  assertEquals(issues.map((issue) => [issue.id, issue.title]), [["TM123", "Microsoft Teams: Users can't join meetings"]]);
});
