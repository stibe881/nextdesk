import { assert, assertEquals } from "jsr:@std/assert@1";
import onboardingFunction, {
  namesMatch,
  parseAction,
  returnTaskTitle,
} from "./index.ts";

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

const TENANT = "10000000-0000-4000-8000-000000000001";
const ENTRY = "20000000-0000-4000-8000-000000000002";
const ASSIGNMENT_A = "30000000-0000-4000-8000-000000000003";
const ASSIGNMENT_B = "40000000-0000-4000-8000-000000000004";

Deno.test("offboardingAssets parses an optional requester", () => {
  assertEquals(
    parseAction({
      type: "offboardingAssets",
      tenantId: TENANT,
      entryId: ENTRY,
    }),
    {
      type: "offboardingAssets",
      tenantId: TENANT,
      entryId: ENTRY,
      requesterId: null,
    },
  );
  assertEquals(
    parseAction({
      type: "offboardingAssets",
      tenantId: TENANT.toUpperCase(),
      entryId: ENTRY,
      requesterId: ASSIGNMENT_A.toUpperCase(),
    }),
    {
      type: "offboardingAssets",
      tenantId: TENANT,
      entryId: ENTRY,
      requesterId: ASSIGNMENT_A,
    },
  );
  assertEquals(
    parseAction({
      type: "offboardingAssets",
      tenantId: TENANT,
      entryId: ENTRY,
      requesterId: "nicht-gueltig",
    }),
    null,
  );
  assertEquals(
    parseAction({
      type: "offboardingAssets",
      tenantId: TENANT,
      entryId: ENTRY,
      extra: true,
    }),
    null,
  );
});

Deno.test("createReturnTasks requires a bounded list of assignment ids", () => {
  assertEquals(
    parseAction({
      type: "createReturnTasks",
      tenantId: TENANT,
      entryId: ENTRY,
      assignmentIds: [ASSIGNMENT_A, ASSIGNMENT_B, ASSIGNMENT_A.toUpperCase()],
    }),
    {
      type: "createReturnTasks",
      tenantId: TENANT,
      entryId: ENTRY,
      assignmentIds: [ASSIGNMENT_A, ASSIGNMENT_B],
    },
  );
  for (const assignmentIds of [
    [],
    "nicht-liste",
    [ASSIGNMENT_A, "kaputt"],
    Array.from({ length: 51 }, () => ASSIGNMENT_A),
  ])
    assertEquals(
      parseAction({
        type: "createReturnTasks",
        tenantId: TENANT,
        entryId: ENTRY,
        assignmentIds,
      }),
      null,
    );
  assertEquals(
    parseAction({
      type: "createReturnTasks",
      tenantId: TENANT,
      entryId: ENTRY,
      assignmentIds: [ASSIGNMENT_A],
      requesterId: ASSIGNMENT_B,
    }),
    null,
  );
});

Deno.test("requester names match trimmed and case-insensitively", () => {
  assert(namesMatch("  Anna   Muster ", "anna muster"));
  assert(namesMatch("ÄRNI Müller", "ärni müller"));
  assert(!namesMatch("Anna Muster", "Anna Mustermann"));
  assert(!namesMatch("", ""));
  assert(!namesMatch(null, "Anna"));
});

Deno.test("return task titles name the device and its reference", () => {
  assertEquals(
    returnTaskTitle({
      name: "Notebook HP 840",
      inventoryNumber: "INV-1001",
      serialNumber: "SN-1",
    }),
    "Rückgabe: Notebook HP 840 (INV-1001)",
  );
  assertEquals(
    returnTaskTitle({
      name: "iPhone",
      inventoryNumber: " ",
      serialNumber: "F2X",
    }),
    "Rückgabe: iPhone (F2X)",
  );
  assertEquals(
    returnTaskTitle({
      name: "Monitor",
      inventoryNumber: null,
      serialNumber: null,
    }),
    "Rückgabe: Monitor",
  );
  const long = returnTaskTitle({
    name: "x".repeat(400),
    inventoryNumber: "INV-9",
    serialNumber: null,
  });
  assert(Array.from(long).length <= 240);
  assert(long.endsWith("… (INV-9)"));
});
