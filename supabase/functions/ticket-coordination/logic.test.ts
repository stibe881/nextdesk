import { assert, assertEquals } from "jsr:@std/assert@1";

import {
  MAX_SPLIT_CHILDREN,
  parseAction,
  parseSplitChildren,
  parseVendorInput,
  rpcErrorCode,
  splitChildErrors,
  timelineEventPayload,
} from "./logic.ts";

const tenantId = "00000000-0000-4000-8000-000000000001";
const ticketId = "00000000-0000-4000-8000-000000000002";
const departmentId = "00000000-0000-4000-8000-0000000000aa";
const teamId = "00000000-0000-4000-8000-0000000000bb";
const caseId = "00000000-0000-4000-8000-0000000000cc";

function child(overrides: Record<string, unknown> = {}) {
  return {
    subject: "Notebook bereitstellen",
    description: "Teil der Aufteilung",
    departmentId,
    ...overrides,
  };
}

Deno.test("split children: valid children are trimmed and normalised", () => {
  const parsed = parseSplitChildren([
    child({ subject: "  Badge erstellen  ", teamId, agentId: null }),
  ]);
  assertEquals(parsed, [{
    subject: "Badge erstellen",
    description: "Teil der Aufteilung",
    departmentId,
    teamId,
    agentId: null,
  }]);
});

Deno.test("split children: size limits and unknown keys are rejected", () => {
  assertEquals(parseSplitChildren([]), null);
  assertEquals(
    parseSplitChildren(
      Array.from({ length: MAX_SPLIT_CHILDREN + 1 }, () => child()),
    ),
    null,
  );
  assertEquals(parseSplitChildren([child({ statusId: ticketId })]), null);
  assertEquals(parseSplitChildren("nope"), null);
});

Deno.test("split children: each invalid field is reported", () => {
  assertEquals(splitChildErrors(child()), []);
  assertEquals(splitChildErrors(child({ subject: "ab" })), ["subject"]);
  assertEquals(splitChildErrors(child({ description: "   " })), [
    "description",
  ]);
  assertEquals(splitChildErrors(child({ departmentId: "x" })), ["department"]);
  assertEquals(splitChildErrors(child({ teamId: "x", agentId: 4 })), [
    "team",
    "agent",
  ]);
  assertEquals(splitChildErrors(child({ subject: "x".repeat(241) })), [
    "subject",
  ]);
});

Deno.test("actions: split, vendor case and overview requests parse", () => {
  assertEquals(
    parseAction({ type: "overview", tenantId, ticketId }),
    { type: "overview", tenantId, ticketId },
  );
  const split = parseAction({
    type: "split",
    tenantId,
    ticketId,
    children: [child(), child({ subject: "Zweiter Teil" })],
  });
  assert(split?.type === "split" && split.children.length === 2);
  assertEquals(
    parseAction({
      type: "openVendorCase",
      tenantId,
      ticketId,
      vendorId: teamId,
      externalCaseNumber: " SC-1 ",
      note: "",
    }),
    {
      type: "openVendorCase",
      tenantId,
      ticketId,
      vendorId: teamId,
      externalCaseNumber: "SC-1",
      note: null,
    },
  );
  assertEquals(
    parseAction({ type: "closeVendorCase", tenantId, ticketId, caseId }),
    { type: "closeVendorCase", tenantId, ticketId, caseId, note: null },
  );
  assertEquals(parseAction({ type: "overview", tenantId }), null);
  assertEquals(
    parseAction({ type: "overview", tenantId, ticketId, extra: 1 }),
    null,
  );
  assertEquals(
    parseAction({
      type: "recordVendorUpdate",
      tenantId,
      ticketId,
      caseId,
      note: "x".repeat(2001),
    }),
    null,
  );
});

Deno.test("vendors: defaults and validation", () => {
  assertEquals(parseVendorInput({ name: "Swisscom" }), {
    vendorId: null,
    name: "Swisscom",
    contactEmail: null,
    contactPhone: null,
    reminderAfterHours: 48,
    active: true,
  });
  assertEquals(parseVendorInput({ name: "S" }), null);
  assertEquals(
    parseVendorInput({ name: "Swisscom", contactEmail: "kein-mail" }),
    null,
  );
  assertEquals(
    parseVendorInput({ name: "Swisscom", reminderAfterHours: 0 }),
    null,
  );
  assertEquals(
    parseVendorInput({ name: "Swisscom", reminderAfterHours: 12.5 }),
    null,
  );
  assertEquals(
    parseAction({
      type: "saveVendor",
      tenantId,
      vendor: { name: "HP Support", reminderAfterHours: 24, active: false },
    }),
    {
      type: "saveVendor",
      tenantId,
      vendor: {
        vendorId: null,
        name: "HP Support",
        contactEmail: null,
        contactPhone: null,
        reminderAfterHours: 24,
        active: false,
      },
    },
  );
});

Deno.test("rpc errors map hints to stable codes", () => {
  assertEquals(
    rpcErrorCode({ code: "22023", hint: "ticket_split_parent_closed" }, "f"),
    { code: "ticket_split_parent_closed", status: 409 },
  );
  assertEquals(
    rpcErrorCode({ code: "23505", hint: "vendor_case_exists" }, "f"),
    { code: "vendor_case_exists", status: 409 },
  );
  assertEquals(rpcErrorCode({ code: "P0002" }, "f"), {
    code: "not_found",
    status: 404,
  });
  assertEquals(rpcErrorCode({ code: "XX000", hint: "secret" }, "f"), {
    code: "f",
    status: 500,
  });
});

Deno.test("timeline payload keeps only known, harmless fields", () => {
  assertEquals(
    timelineEventPayload({
      changedFields: ["status", 4],
      statusTransition: {
        fromStatusId: ticketId,
        toStatusKey: "resolved",
        isClosed: true,
        confirmed: true,
      },
      children: [{ id: ticketId, ticketNumber: "IT-2026-000001" }],
      secret: "x",
      note: "Techniker kommt",
    }),
    {
      changedFields: ["status"],
      statusTransition: { toStatusKey: "resolved", isClosed: true },
      children: ["IT-2026-000001"],
      note: "Techniker kommt",
    },
  );
  assertEquals(timelineEventPayload(null), {});
});
