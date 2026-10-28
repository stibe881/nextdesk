import { describe, expect, it } from "vitest";

import { SUCCESS_NOTICE_DISMISSAL_MS } from "./use-transient-success-message";

describe("useTransientSuccessMessage", () => {
  it("defines the product requirement of a three-second success notice", () => {
    expect(SUCCESS_NOTICE_DISMISSAL_MS).toBe(3_000);
  });
});
