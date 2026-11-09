import { describe, expect, it } from "vitest";
import {
  isValidSubscriberEmail,
  readStatusSubscriptionAction,
  statusSubscriptionMessage,
  withoutStatusSubscriptionParams,
} from "./status-subscription";

const token = "5f5f9f71-c72d-4f40-aa29-cd1522e31d8e";

describe("Statusseite: E-Mail-Abo", () => {
  it("liest Bestätigungs- und Abmeldelinks", () => {
    expect(
      readStatusSubscriptionAction(
        `?system-status=x&status-subscription=${token}&status-action=confirm`,
      ),
    ).toEqual({ token, kind: "confirm" });
    expect(
      readStatusSubscriptionAction(
        `?status-subscription=${token}&status-action=unsubscribe`,
      )?.kind,
    ).toBe("unsubscribe");
    expect(
      readStatusSubscriptionAction(
        "?status-subscription=abc&status-action=confirm",
      ),
    ).toBeNull();
    expect(
      readStatusSubscriptionAction(
        `?status-subscription=${token}&status-action=x`,
      ),
    ).toBeNull();
  });

  it("entfernt die Abo-Parameter aus der Adresse", () => {
    expect(
      withoutStatusSubscriptionParams(
        `https://app.nextdesk.ch/?system-status=a&status-subscription=${token}&status-action=confirm`,
      ),
    ).toBe("https://app.nextdesk.ch/?system-status=a");
  });

  it("prüft E-Mail-Adressen und liefert verständliche Meldungen", () => {
    expect(isValidSubscriberEmail("anna@example.ch")).toBe(true);
    expect(isValidSubscriberEmail("anna")).toBe(false);
    expect(statusSubscriptionMessage("subscribe", null).tone).toBe("success");
    expect(
      statusSubscriptionMessage("confirm", "status_subscription_not_found")
        .tone,
    ).toBe("error");
  });
});
