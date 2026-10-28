import { describe, expect, it } from "vitest";

import { ticketWatchPresentation } from "./ticket-watch-presentation";

describe("ticketWatchPresentation", () => {
  it("zeigt ohne Beobachtung ein durchgestrichenes Auge", () => {
    expect(ticketWatchPresentation(false)).toEqual({
      actionLabel: "Ticket beobachten",
      icon: "eye-off",
      label: "Beobachten",
    });
  });

  it("zeigt bei aktiver Beobachtung ein offenes Auge", () => {
    expect(ticketWatchPresentation(true)).toEqual({
      actionLabel: "Ticket nicht mehr beobachten",
      icon: "eye",
      label: "Nicht mehr beobachten",
    });
  });
});
