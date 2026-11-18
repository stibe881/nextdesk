import { describe, expect, it } from "vitest";

import { salutationForFirstName } from "./first-name-gender";
import { ticketReplyGreeting } from "./ticket-comment-composer";

describe("salutationForFirstName", () => {
  it("uses Liebe for female first names", () => {
    for (const name of ["Silvana", "Anna", "Sabrina", "Nadine", "Céline", "Jürgina", "Marie"]) {
      expect(salutationForFirstName(name)).toBe("Liebe");
    }
  });

  it("uses Lieber for male first names", () => {
    for (const name of ["Stefan", "Daniel", "Jürg", "André", "Luca", "Matthias"]) {
      expect(salutationForFirstName(name)).toBe("Lieber");
    }
  });

  it("decides compound names by their parts", () => {
    expect(salutationForFirstName("Anna-Lena")).toBe("Liebe");
    expect(salutationForFirstName("Hans-Peter")).toBe("Lieber");
  });

  it("stays neutral for ambiguous or unknown names", () => {
    for (const name of ["Andrea", "Kim", "Alex", "Xyzq", "", null, undefined]) {
      expect(salutationForFirstName(name)).toBe("Guten Tag");
    }
  });
});

describe("ticketReplyGreeting", () => {
  it("greets by gender and keeps the empty paragraph below", () => {
    expect(ticketReplyGreeting("Silvana Lurk")).toBe("Liebe Silvana\n\n");
    expect(ticketReplyGreeting("Stefan Gross")).toBe("Lieber Stefan\n\n");
    expect(ticketReplyGreeting("Lurk, Silvana")).toBe("Liebe Silvana\n\n");
    expect(ticketReplyGreeting("Kim Meier")).toBe("Guten Tag Kim\n\n");
    expect(ticketReplyGreeting(null)).toBeNull();
  });
});
