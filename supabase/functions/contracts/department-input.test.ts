import { assertEquals } from "jsr:@std/assert@1";
import { departmentForSave, parseDepartmentInput } from "./department-input.ts";

const ICT = "11111111-1111-4111-8111-111111111111";
const HR = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

Deno.test("department input is optional, nullable or a UUID", () => {
  assertEquals(parseDepartmentInput({}), undefined);
  assertEquals(parseDepartmentInput({ departmentId: null }), null);
  assertEquals(parseDepartmentInput({ departmentId: "" }), null);
  assertEquals(parseDepartmentInput({ departmentId: ICT.toUpperCase() }), ICT);
  assertEquals(parseDepartmentInput({ departmentId: "ict" }), false);
  assertEquals(parseDepartmentInput({ departmentId: 3 }), false);
});

Deno.test("new records get a department from the caller's scope", () => {
  const single = { departments: [ICT], scoped: true };
  const several = { departments: [ICT, HR], scoped: true };
  const none = { departments: [], scoped: true };
  assertEquals(departmentForSave(single, undefined), { departmentId: ICT });
  assertEquals(departmentForSave(none, null), { departmentId: null });
  assertEquals(departmentForSave(several, HR), { departmentId: HR });
  assertEquals(departmentForSave(several, null), {
    error: "Bitte wählen Sie eine Abteilung.",
  });
  assertEquals(departmentForSave(several, OTHER), {
    error: "Die Abteilung ist ungültig.",
  });
});

Deno.test("edits keep or move the department within the scope", () => {
  const several = { departments: [ICT, HR], scoped: true };
  assertEquals(departmentForSave(several, undefined, ICT), { keep: true });
  assertEquals(departmentForSave(several, null, null), { keep: true });
  assertEquals(departmentForSave(several, ICT, ICT), { keep: true });
  assertEquals(departmentForSave(several, HR, ICT), { departmentId: HR });
  assertEquals(departmentForSave(several, OTHER, ICT), {
    error: "Die Abteilung ist ungültig.",
  });
});
