import { describe, expect, it } from "vitest";
import { timeOfDayGreeting } from "./greeting";

const at = (hour: number) => new Date(2026, 10, 3, hour, 30);

describe("timeOfDayGreeting", () => {
  it("greets by time of day", () => {
    expect(timeOfDayGreeting(at(7))).toBe("Guten Morgen");
    expect(timeOfDayGreeting(at(10))).toBe("Guten Morgen");
    expect(timeOfDayGreeting(at(11))).toBe("Guten Tag");
    expect(timeOfDayGreeting(at(17))).toBe("Guten Tag");
    expect(timeOfDayGreeting(at(18))).toBe("Guten Abend");
    expect(timeOfDayGreeting(at(2))).toBe("Guten Abend");
  });
});
