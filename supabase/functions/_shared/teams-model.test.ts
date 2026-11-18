import { assertEquals } from "jsr:@std/assert@1";

import {
  addMonths,
  daysBetween,
  dueReminder,
  remindersCoveredBy,
  validateTeamRequest,
} from "./teams-model.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";

function input(overrides: Record<string, unknown> = {}) {
  return {
    name: "Projekt Neubau",
    description: "",
    visibility: "private",
    allowGuests: false,
    channels: [],
    owners: [OWNER],
    members: [MEMBER, OWNER],
    guests: [],
    startDate: "2026-12-01",
    endDate: "2027-11-30",
    ...overrides,
  };
}

Deno.test("accepts a complete request and removes owners from the members", () => {
  const result = validateTeamRequest(input(), "2026-11-12");
  if (!result.ok) throw new Error(result.code);
  assertEquals(result.value.members, [MEMBER]);
  assertEquals(result.value.description, null);
});

Deno.test("requires owner, valid dates and a lifetime of at most 3 years", () => {
  const code = (overrides: Record<string, unknown>) => {
    const result = validateTeamRequest(input(overrides), "2026-11-12");
    return result.ok ? "ok" : result.code;
  };
  assertEquals(code({ owners: [] }), "owner_required");
  assertEquals(code({ endDate: "2026-12-01" }), "end_before_start");
  assertEquals(code({ endDate: "2026-02-31" }), "dates_invalid");
  assertEquals(code({ startDate: "2026-11-01" }), "start_in_past");
  assertEquals(code({ endDate: "2030-01-01" }), "lifetime_too_long");
  assertEquals(code({ name: "ab" }), "name_invalid");
  assertEquals(code({ visibility: "secret" }), "visibility_invalid");
});

Deno.test("guests need the guest switch and a valid address", () => {
  const code = (overrides: Record<string, unknown>) => {
    const result = validateTeamRequest(input(overrides), "2026-11-12");
    return result.ok ? "ok" : result.code;
  };
  assertEquals(code({ guests: ["a@b.ch"] }), "guests_not_allowed");
  assertEquals(code({ allowGuests: true, guests: ["kein-mail"] }), "guest_invalid");
  assertEquals(code({ allowGuests: true, guests: ["A@Extern.ch"] }), "ok");
});

Deno.test("channels: names, duplicates and https-only website tabs", () => {
  const code = (channels: unknown) => {
    const result = validateTeamRequest(input({ channels }), "2026-11-12");
    return result.ok ? "ok" : result.code;
  };
  assertEquals(code([{ name: "Planung", tabs: [] }]), "ok");
  assertEquals(code([{ name: "Allgemein" }]), "channel_duplicate");
  assertEquals(code([{ name: "Plan#ung" }]), "channel_invalid");
  assertEquals(
    code([{ name: "Kamera", tabs: [{ type: "website", title: "Live", url: "http://x.ch" }] }]),
    "channel_invalid",
  );
  assertEquals(
    code([{ name: "Kamera", isPrivate: true, tabs: [{ type: "website", title: "Live", url: "https://x.ch/cam" }] }]),
    "ok",
  );
});

Deno.test("addMonths clamps to the end of the month", () => {
  assertEquals(addMonths("2027-01-31", 1), "2027-02-28");
  assertEquals(addMonths("2027-11-30", 3), "2028-02-29");
  assertEquals(addMonths("2027-11-30", 12), "2028-11-30");
  assertEquals(daysBetween("2027-11-16", "2027-11-30"), 14);
  assertEquals(daysBetween("2027-11-30", "2027-11-29"), -1);
});

Deno.test("reminders: 14, 7 and 1 days, never three at once", () => {
  assertEquals(dueReminder(20, []), null);
  assertEquals(dueReminder(14, []), 14);
  assertEquals(dueReminder(14, [14]), null);
  assertEquals(dueReminder(7, [14]), 7);
  assertEquals(dueReminder(1, [14, 7]), 1);
  // Ordered with only 5 days left: one reminder (7), not 14 and 7.
  assertEquals(dueReminder(5, []), 7);
  assertEquals(dueReminder(5, [7]), null);
  assertEquals(remindersCoveredBy(7), [14, 7]);
  assertEquals(dueReminder(-1, []), null);
});

Deno.test("tenant settings: shorter maximum lifetime and guests switched off", () => {
  const short = validateTeamRequest(input({ endDate: "2027-11-30" }), "2026-11-12", {
    maxLifetimeMonths: 6,
  });
  assertEquals(short.ok ? "ok" : short.code, "lifetime_too_long");
  const noGuests = validateTeamRequest(
    input({ allowGuests: true, guests: ["a@extern.ch"] }),
    "2026-11-12",
    { allowGuests: false },
  );
  assertEquals(noGuests.ok ? "ok" : noGuests.code, "guests_not_allowed");
});
