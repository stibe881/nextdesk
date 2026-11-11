import { assertEquals } from "jsr:@std/assert@1";
import { parseAction } from "./index.ts";
import {
  licenseRevocationTaskTitle,
  loanReturnTaskTitle,
} from "./offboarding-extras.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ENTRY = "22222222-2222-4222-8222-222222222222";
const LINE = "33333333-3333-4333-8333-333333333333";
const SEAT = "44444444-4444-4444-8444-444444444444";
const LOCATION = "55555555-5555-4555-8555-555555555555";

Deno.test("offboarding: loans and licenses become return tasks", () => {
  assertEquals(
    parseAction({
      type: "createReturnTasks",
      tenantId: TENANT,
      entryId: ENTRY,
      assignmentIds: [],
      loanLineIds: [LINE, LINE.toUpperCase()],
      licenseAssignmentIds: [SEAT],
      returnLocationId: LOCATION,
    }),
    {
      type: "createReturnTasks",
      tenantId: TENANT,
      entryId: ENTRY,
      assignmentIds: [],
      loanLineIds: [LINE],
      licenseAssignmentIds: [SEAT],
      returnLocationId: LOCATION,
    },
  );
  // Nothing selected at all stays invalid.
  assertEquals(
    parseAction({
      type: "createReturnTasks",
      tenantId: TENANT,
      entryId: ENTRY,
      assignmentIds: [],
      loanLineIds: [],
    }),
    null,
  );
  assertEquals(
    parseAction({
      type: "createReturnTasks",
      tenantId: TENANT,
      entryId: ENTRY,
      assignmentIds: [],
      licenseAssignmentIds: ["kaputt"],
    }),
    null,
  );
  assertEquals(
    parseAction({
      type: "createReturnTasks",
      tenantId: TENANT,
      entryId: ENTRY,
      assignmentIds: [],
      loanLineIds: Array.from(
        { length: 51 },
        (_, index) =>
          `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
      ),
    }),
    null,
  );
});

Deno.test("offboarding: task titles for loans and licenses", () => {
  assertEquals(
    loanReturnTaskTitle(" Beamer  Epson ", "B-2026-000012"),
    "Rückgabe Ausleihe: Beamer Epson (B-2026-000012)",
  );
  assertEquals(loanReturnTaskTitle("", null), "Rückgabe Ausleihe: Artikel");
  assertEquals(
    licenseRevocationTaskTitle("Microsoft 365 E3"),
    "Lizenz entziehen: Microsoft 365 E3",
  );
  assertEquals(
    Array.from(licenseRevocationTaskTitle("x".repeat(400))).length,
    240,
  );
});
