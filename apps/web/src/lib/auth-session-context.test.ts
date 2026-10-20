import { describe, expect, test } from "vitest";
import { requiresWorkspaceContextReset } from "./auth-session-context";

describe("requiresWorkspaceContextReset", () => {
  test("lässt erneute Sitzungsereignisse derselben Person ohne Kontextreload passieren", () => {
    for (const event of ["TOKEN_REFRESHED", "SIGNED_IN", "USER_UPDATED"]) {
      expect(
        requiresWorkspaceContextReset({
          event,
          currentUserId: "user-1",
          nextUserId: "user-1",
        }),
      ).toBe(false);
    }
  });

  test("initialisiert einen noch unbekannten Sitzungszustand einmal vollständig", () => {
    expect(
      requiresWorkspaceContextReset({
        event: "INITIAL_SESSION",
        currentUserId: undefined,
        nextUserId: "user-1",
      }),
    ).toBe(true);
  });

  test("baut den Kontext bei Abmeldung oder Benutzerwechsel sicher neu auf", () => {
    expect(
      requiresWorkspaceContextReset({
        event: "SIGNED_OUT",
        currentUserId: "user-1",
        nextUserId: null,
      }),
    ).toBe(true);
    expect(
      requiresWorkspaceContextReset({
        event: "SIGNED_IN",
        currentUserId: "user-1",
        nextUserId: "user-2",
      }),
    ).toBe(true);
  });
});
