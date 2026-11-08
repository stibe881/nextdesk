import { isRatableStatus } from "./index.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test("requesters may rate resolved and closed tickets", () => {
  assert(
    isRatableStatus({ key: "resolved", is_closed: false }),
    "resolved must be ratable even when not flagged as closed",
  );
  assert(isRatableStatus({ key: "resolved", is_closed: true }), "resolved");
  assert(isRatableStatus({ key: "closed", is_closed: true }), "closed");
  assert(
    !isRatableStatus({ key: "waiting", is_closed: false }),
    "open statuses are not ratable",
  );
});
