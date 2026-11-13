import { assertEquals } from "jsr:@std/assert@1";
import { parseAudience } from "./push-audience.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

Deno.test("parseAudience akzeptiert alle, Rollen und Abteilungen", () => {
  assertEquals(parseAudience({ kind: "all" }), { kind: "all", ids: [] });
  assertEquals(parseAudience({ kind: "roles", ids: [A, A.toUpperCase(), B] }), {
    kind: "roles",
    ids: [A, B],
  });
  assertEquals(
    parseAudience({ kind: "departments", ids: [B] })?.kind,
    "departments",
  );
});

Deno.test("parseAudience verwirft ungültige Zielgruppen", () => {
  assertEquals(parseAudience(null), null);
  assertEquals(parseAudience({ kind: "roles", ids: [] }), null);
  assertEquals(parseAudience({ kind: "roles", ids: ["x"] }), null);
  assertEquals(parseAudience({ kind: "teams", ids: [A] }), null);
  assertEquals(parseAudience({ kind: "departments" }), null);
});
