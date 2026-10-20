import { describe, expect, it } from "vitest";
import {
  resolveTicketFieldDropPosition,
  ticketFieldDropInsertionIndex,
} from "./ticket-form-builder-dnd";

describe("Ticketformular-Drag-and-Drop", () => {
  it("verschiebt innerhalb eines Abschnitts nach unten hinter das Ziel", () => {
    expect(resolveTicketFieldDropPosition("a", 0, "a", 2)).toBe(1);
    expect(resolveTicketFieldDropPosition("a", 1, "a", 3)).toBe(2);
  });

  it("bewahrt Einfügepositionen zwischen Abschnitten und nach oben", () => {
    expect(resolveTicketFieldDropPosition("a", 2, "a", 1)).toBe(1);
    expect(resolveTicketFieldDropPosition("a", 0, "b", 1)).toBe(1);
  });

  it("unterscheidet sichtbare Zielhälften für vor und nach einer Karte", () => {
    expect(ticketFieldDropInsertionIndex(110, 100, 40, 2)).toBe(2);
    expect(ticketFieldDropInsertionIndex(130, 100, 40, 2)).toBe(3);
  });
});
