import { assertEquals } from "jsr:@std/assert@1";
import { canEditSnippet, parseAction, parseShortcut } from "./logic.ts";

const tenantId = "00000000-0000-4000-8000-000000000001";
const actor = "00000000-0000-4000-8000-0000000000aa";

Deno.test("shortcuts are normalised and validated", () => {
  assertEquals(parseShortcut("/Gruss"), "gruss");
  assertEquals(parseShortcut(""), null);
  assertEquals(parseShortcut(null), null);
  assertEquals(parseShortcut("mit leerzeichen"), undefined);
  assertEquals(parseShortcut("x".repeat(41)), undefined);
});

Deno.test("save needs name, body and the shared flag", () => {
  const base = { type: "save", tenantId, name: "Gruss", body: "Guten Tag {Vorname}", shared: false };
  assertEquals(parseAction(base)?.type, "save");
  assertEquals(parseAction({ ...base, body: "   " }), null);
  assertEquals(parseAction({ ...base, shared: "yes" }), null);
  assertEquals(parseAction({ ...base, departmentId: "nope" }), null);
  const parsed = parseAction({ ...base, shortcut: "/Hallo", departmentId: "" });
  assertEquals(parsed?.type === "save" && parsed.shortcut, "hallo");
  assertEquals(parsed?.type === "save" && parsed.departmentId, null);
});

Deno.test("only owners edit personal snippets, managers edit shared ones", () => {
  assertEquals(canEditSnippet({ owner_id: actor }, actor, false), true);
  assertEquals(canEditSnippet({ owner_id: tenantId }, actor, true), false);
  assertEquals(canEditSnippet({ owner_id: null }, actor, false), false);
  assertEquals(canEditSnippet({ owner_id: null }, actor, true), true);
});
