import { assertEquals } from "jsr:@std/assert@1";
import { accessFor, swissToday } from "./logic.ts";

const none = { read: false, create: false, manage: false };

Deno.test("without a right or membership the project does not exist", () => {
  assertEquals(accessFor(none, false, null), null);
  assertEquals(accessFor({ ...none, create: true }, false, null), null);
});

Deno.test(
  "managers, leads and holders of project.manage run the project",
  () => {
    for (const result of [
      accessFor({ ...none, manage: true }, false, null),
      accessFor(none, true, null),
      accessFor(none, false, "manager"),
    ]) {
      assertEquals(result?.role, "manager");
      assertEquals(result?.canAdmin, true);
    }
  },
);

Deno.test("members edit, readers only look and comment", () => {
  const member = accessFor(none, false, "member")!;
  assertEquals(
    [member.canAdmin, member.canEdit, member.isGuest],
    [false, true, false],
  );
  const viewer = accessFor({ ...none, read: true }, false, null)!;
  assertEquals(
    [viewer.role, viewer.canEdit, viewer.canComment],
    ["viewer", false, true],
  );
});

Deno.test("guests never edit and only the commenting guest may write", () => {
  const reading = accessFor(none, false, "guest_read")!;
  assertEquals(
    [reading.isGuest, reading.canEdit, reading.canComment],
    [true, false, false],
  );
  const commenting = accessFor(none, false, "guest_comment")!;
  assertEquals(
    [commenting.isGuest, commenting.canEdit, commenting.canComment],
    [true, false, true],
  );
  // Someone who may read all projects anyway is not narrowed to a guest.
  assertEquals(
    accessFor({ ...none, read: true }, false, "guest_read")?.isGuest,
    false,
  );
});

Deno.test("the day follows Swiss time", () => {
  assertEquals(swissToday(new Date("2026-12-31T23:30:00Z")), "2027-01-01");
});
