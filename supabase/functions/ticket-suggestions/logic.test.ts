import { assertEquals } from "jsr:@std/assert@1";
import {
  knowledgeSearchQuery,
  majorityVote,
  parseAction,
  plainExcerpt,
  subjectLongEnough,
} from "./logic.ts";

const TENANT = "0b6a1c1e-4f7a-4d2b-9c1e-2a3b4c5d6e7f";
const ARTICLE = "1c7b2d2f-5a8b-4e3c-8d2f-3b4c5d6e7f80";

Deno.test("suggest input is parsed strictly", () => {
  assertEquals(
    parseAction({
      type: "suggest",
      tenantId: TENANT.toUpperCase(),
      subject: "  Drucker druckt nicht ",
      mode: "requester",
    }),
    {
      type: "suggest",
      tenantId: TENANT,
      subject: "Drucker druckt nicht",
      description: "",
      mode: "requester",
    },
  );
  // Unknown keys, modes and oversized texts are rejected.
  assertEquals(
    parseAction({
      type: "suggest",
      tenantId: TENANT,
      subject: "x",
      mode: "agent",
      extra: 1,
    }),
    null,
  );
  assertEquals(
    parseAction({
      type: "suggest",
      tenantId: TENANT,
      subject: "x",
      mode: "admin",
    }),
    null,
  );
  assertEquals(
    parseAction({
      type: "suggest",
      tenantId: TENANT,
      subject: "x".repeat(241),
      mode: "agent",
    }),
    null,
  );
  assertEquals(
    parseAction({
      type: "suggest",
      tenantId: TENANT,
      subject: "a\u0000b",
      mode: "agent",
    }),
    null,
  );
  assertEquals(
    parseAction({
      type: "suggest",
      tenantId: "nope",
      subject: "abc",
      mode: "agent",
    }),
    null,
  );
});

Deno.test("recordOutcome input is parsed strictly", () => {
  assertEquals(
    parseAction({
      type: "recordOutcome",
      tenantId: TENANT,
      articleId: ARTICLE,
      kind: "deflected",
      queryText: " VPN ",
    }),
    {
      type: "recordOutcome",
      tenantId: TENANT,
      articleId: ARTICLE,
      kind: "deflected",
      queryText: "VPN",
    },
  );
  assertEquals(
    parseAction({
      type: "recordOutcome",
      tenantId: TENANT,
      articleId: ARTICLE,
      kind: "resolved",
    }),
    null,
  );
  assertEquals(
    parseAction({
      type: "recordOutcome",
      tenantId: TENANT,
      articleId: ARTICLE,
      kind: "not_helpful",
    }),
    {
      type: "recordOutcome",
      tenantId: TENANT,
      articleId: ARTICLE,
      kind: "not_helpful",
      queryText: null,
    },
  );
});

Deno.test("subject must have at least four characters", () => {
  assertEquals(subjectLongEnough(" VPN "), false);
  assertEquals(subjectLongEnough("WLAN"), true);
});

Deno.test("knowledge query combines significant words with or", () => {
  assertEquals(
    knowledgeSearchQuery('VPN "geht" nicht -mehr', "Seit heute VPN weg"),
    "VPN or geht or nicht or mehr or Seit or heute or weg",
  );
  assertEquals(knowledgeSearchQuery("ab", "c d"), null);
  const long = knowledgeSearchQuery(
    "Druckerwarteschlange ".repeat(1),
    "Netzwerkverbindungsproblem Zertifikatsablauf Bildschirmauflösung Tastaturbelegung Mehrfaktorauthentifizierung",
  );
  assertEquals((long ?? "").length <= 120, true);
});

Deno.test("excerpt removes markdown and images", () => {
  assertEquals(
    plainExcerpt(
      "# VPN einrichten\n\n![Schritt 1](kb-image:2d8c3e3a-6b9c-4f4d-9e3a-4c5d6e7f8091)\n\n1. Öffnen Sie **Einstellungen**\n- Klicken Sie auf [Verbinden](https://example.ch)\n\n```\ncode\n```",
    ),
    "VPN einrichten Öffnen Sie Einstellungen Klicken Sie auf Verbinden",
  );
  const excerpt = plainExcerpt("Wort ".repeat(100));
  assertEquals(excerpt.endsWith(" …"), true);
  assertEquals([...excerpt].length <= 202, true);
  assertEquals(plainExcerpt(null), "");
});

Deno.test("majority vote needs two agreeing tickets", () => {
  assertEquals(majorityVote(["a", "b", "a", null, "c"]), {
    id: "a",
    matches: 2,
  });
  assertEquals(majorityVote(["a", "b", "c"]), null);
  assertEquals(majorityVote([null, undefined]), null);
  // Ties go to the value of the higher ranked ticket.
  assertEquals(majorityVote(["b", "a", "a", "b"]), { id: "b", matches: 2 });
});
