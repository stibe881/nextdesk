import { assertEquals } from "jsr:@std/assert@1";
import { deflectionArticleFilter } from "./deflections.ts";

const DEPARTMENT_A = "00000000-0000-4000-8000-0000000000a1";
const DEPARTMENT_B = "00000000-0000-4000-8000-0000000000b2";

Deno.test("deflections without departments only count shared articles", () => {
  assertEquals(deflectionArticleFilter([]), "department_id.is.null");
});

Deno.test("deflections count articles of the caller's departments", () => {
  assertEquals(
    deflectionArticleFilter([DEPARTMENT_B, DEPARTMENT_A.toUpperCase(), "x"]),
    `department_id.is.null,department_id.in.(${DEPARTMENT_A},${DEPARTMENT_B})`,
  );
});
