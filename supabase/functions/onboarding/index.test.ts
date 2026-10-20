import { assert, assertEquals } from "jsr:@std/assert@1";
import onboardingFunction from "./index.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const functionConfig = await Deno.readTextFile(
  new URL("../../config.toml", import.meta.url),
);

Deno.test(
  "onboarding keeps tickets explicit and all API mutations JWT protected",
  () => {
    assert(source.includes('auth: "user"'));
    assert(source.includes('type: "linkExceptionTicket"'));
    assert(source.includes("ticketNumber"));
    assert(source.includes('from("tickets")'));
    assert(source.includes("await client"));
    assert(source.includes("ticketNumbers.has(exception.ticket_id)"));
    assert(source.includes("onboarding.exception_ticket.linked"));
    assert(!source.includes("insert({ tenant_id: action.tenantId, subject"));
  },
);

Deno.test("onboarding only accepts the defined finite task status set", () => {
  const statuses = ["open", "in_progress", "blocked", "completed"];
  assertEquals(
    statuses.every((status) => source.includes(`"${status}"`)),
    true,
  );
  assert(source.includes("MAX_REQUEST_BYTES"));
  assert(source.includes("has_onboarding_permission"));
  assert(source.includes("focusEntryId"));
  assert(source.includes("focusedEntry.created_by === actorId"));
  assert(source.includes("ticketNumbers.has(exception.ticket_id)"));
  assert(
    source.includes('await client\n    .from("tickets")') ||
      source.includes('await client\n      .from("tickets")'),
  );
});

Deno.test(
  "onboarding answers only the allowed browser preflight before user auth",
  async () => {
    const allowedPreflight = await onboardingFunction.fetch(
      new Request("https://edge.invalid/functions/v1/onboarding", {
        headers: { Origin: "https://app.nextdesk.ch" },
        method: "OPTIONS",
      }),
    );
    assertEquals(allowedPreflight.status, 204);
    assertEquals(
      allowedPreflight.headers.get("Access-Control-Allow-Origin"),
      "https://app.nextdesk.ch",
    );
    assertEquals(
      allowedPreflight.headers.get("Access-Control-Allow-Methods"),
      "POST, OPTIONS",
    );

    const foreignPreflight = await onboardingFunction.fetch(
      new Request("https://edge.invalid/functions/v1/onboarding", {
        headers: { Origin: "https://untrusted.invalid" },
        method: "OPTIONS",
      }),
    );
    assertEquals(foreignPreflight.status, 204);
    assertEquals(
      foreignPreflight.headers.has("Access-Control-Allow-Origin"),
      false,
    );

    const anonymousPost = await onboardingFunction.fetch(
      new Request("https://edge.invalid/functions/v1/onboarding", {
        body: JSON.stringify({ type: "listWorkspace", tenantId: "invalid" }),
        headers: {
          "Content-Type": "application/json",
          Origin: "https://app.nextdesk.ch",
        },
        method: "POST",
      }),
    );
    assertEquals(anonymousPost.status, 401);
    assert(
      functionConfig.includes("[functions.onboarding]\nverify_jwt = false"),
    );
  },
);
