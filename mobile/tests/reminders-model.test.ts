import { describe, expect, it } from "vitest";

import {
  formatReminderDue,
  formatReminderMoment,
  formatReminderResolved,
  groupOpenReminders,
  isReminderOverdue,
  openReminderCount,
  recentResolvedReminders,
  reminderGroupKey,
  reminderPriorityLabel,
  removeReminder,
  type Reminder,
  upsertReminder,
  withReminderResolvedAt,
} from "../lib/reminders-model";

// Lokale Zeit, damit die Tests unabhängig von der Zeitzone der Umgebung sind.
const now = new Date(2026, 10, 16, 12, 0);
const at = (day: number, hour: number, minute = 0, year = 2026, month = 10) =>
  new Date(year, month, day, hour, minute).toISOString();

function reminder(
  id: string,
  dueAt: string | null,
  extra: Partial<Reminder> = {},
): Reminder {
  return {
    id,
    ticketId: null,
    title: `Erinnerung ${id}`,
    description: null,
    dueAt,
    priority: "normal",
    resolvedAt: null,
    createdAt: at(1, 8),
    updatedAt: at(1, 8),
    ...extra,
  };
}

describe("reminderGroupKey", () => {
  it("ordnet nach Fälligkeit relativ zu jetzt", () => {
    expect(reminderGroupKey(reminder("a", at(15, 9)), now)).toBe("overdue");
    expect(reminderGroupKey(reminder("b", at(16, 9)), now)).toBe("overdue");
    expect(reminderGroupKey(reminder("c", at(16, 14)), now)).toBe("today");
    expect(reminderGroupKey(reminder("d", at(17, 8)), now)).toBe("later");
    expect(reminderGroupKey(reminder("e", null), now)).toBe("none");
    expect(reminderGroupKey(reminder("f", "kein Datum"), now)).toBe("none");
  });

  it("erkennt nur offene Erinnerungen als überfällig", () => {
    expect(isReminderOverdue(reminder("a", at(15, 9)), now)).toBe(true);
    expect(
      isReminderOverdue(reminder("a", at(15, 9), { resolvedAt: at(15, 10) }), now),
    ).toBe(false);
  });
});

describe("groupOpenReminders", () => {
  it("bildet die Bereiche in fester Reihenfolge und sortiert nach Termin", () => {
    const groups = groupOpenReminders(
      [
        reminder("later-2", at(20, 8)),
        reminder("none-2", null, { createdAt: at(3, 8) }),
        reminder("today", at(16, 15)),
        reminder("overdue-2", at(16, 10)),
        reminder("later-1", at(17, 8)),
        reminder("none-1", null, { createdAt: at(2, 8) }),
        reminder("overdue-1", at(10, 9)),
        reminder("done", at(16, 15), { resolvedAt: at(16, 11) }),
      ],
      now,
    );
    expect(groups.map((group) => group.label)).toEqual([
      "Überfällig",
      "Heute",
      "Demnächst",
      "Ohne Fälligkeit",
    ]);
    expect(groups.map((group) => group.entries.map((entry) => entry.id))).toEqual([
      ["overdue-1", "overdue-2"],
      ["today"],
      ["later-1", "later-2"],
      ["none-1", "none-2"],
    ]);
  });

  it("lässt leere Bereiche weg", () => {
    expect(groupOpenReminders([reminder("x", null)], now)).toEqual([
      { key: "none", label: "Ohne Fälligkeit", entries: [reminder("x", null)] },
    ]);
    expect(groupOpenReminders([], now)).toEqual([]);
  });

  it("zählt nur offene Erinnerungen", () => {
    expect(
      openReminderCount([
        reminder("a", null),
        reminder("b", null, { resolvedAt: at(16, 9) }),
      ]),
    ).toBe(1);
  });
});

describe("Datumsdarstellung", () => {
  it("zeigt heute, morgen und gestern relativ", () => {
    expect(formatReminderDue(at(16, 14), now)).toBe("heute 14:00");
    expect(formatReminderDue(at(17, 8, 5), now)).toBe("morgen 08:05");
    expect(formatReminderDue(at(15, 16, 30), now)).toBe("gestern 16:30");
  });

  it("zeigt andere Tage mit Wochentag und Datum im Schweizer Format", () => {
    expect(formatReminderDue(at(18, 9), now)).toBe("Mi., 18.11., 09:00");
    expect(formatReminderDue(at(5, 7, 0, 2027, 0), now)).toBe(
      "Di., 05.01.2027, 07:00",
    );
  });

  it("behandelt fehlende und ungültige Termine", () => {
    expect(formatReminderDue(null, now)).toBe("Ohne Fälligkeit");
    expect(formatReminderDue("bald", now)).toBe("Termin nicht lesbar");
  });

  it("beschreibt den Erledigt-Zeitpunkt", () => {
    expect(formatReminderResolved(at(16, 10, 15), now)).toBe(
      "Erledigt heute 10:15",
    );
    expect(formatReminderResolved(null, now)).toBe("Erledigt");
  });

  it("rechnet über Monatsgrenzen in Kalendertagen", () => {
    const endOfMonth = new Date(2026, 10, 30, 23, 30);
    expect(
      formatReminderMoment(new Date(2026, 11, 1, 0, 15), endOfMonth),
    ).toBe("morgen 00:15");
  });
});

describe("reminderPriorityLabel", () => {
  it("verwendet dieselben Bezeichnungen wie das Erfassungsformular", () => {
    expect(reminderPriorityLabel("high")).toBe("Hoch");
    expect(reminderPriorityLabel("normal")).toBe("Normal");
    expect(reminderPriorityLabel("low")).toBe("Tief");
  });
});

describe("recentResolvedReminders", () => {
  it("liefert die zuletzt erledigten zuerst und begrenzt die Anzahl", () => {
    const list = [
      reminder("open", null),
      reminder("old", null, { resolvedAt: at(10, 9) }),
      reminder("new", null, { resolvedAt: at(16, 9) }),
      reminder("mid", null, { resolvedAt: at(12, 9) }),
    ];
    expect(recentResolvedReminders(list).map((entry) => entry.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
    expect(recentResolvedReminders(list, 2).map((entry) => entry.id)).toEqual([
      "new",
      "mid",
    ]);
  });
});

describe("optimistische Aktualisierung", () => {
  it("setzt und entfernt den Erledigt-Zeitpunkt ohne andere Einträge zu ändern", () => {
    const list = [reminder("a", null), reminder("b", null)];
    const resolved = withReminderResolvedAt(list, "a", at(16, 12));
    expect(resolved[0]?.resolvedAt).toBe(at(16, 12));
    expect(resolved[1]).toBe(list[1]);
    expect(list[0]?.resolvedAt).toBeNull();
    expect(withReminderResolvedAt(resolved, "a", null)[0]?.resolvedAt).toBeNull();
  });

  it("ersetzt vorhandene Einträge oder fügt neue vorne an", () => {
    const list = [reminder("a", null)];
    const updated = upsertReminder(list, reminder("a", null, { title: "Neu" }));
    expect(updated).toHaveLength(1);
    expect(updated[0]?.title).toBe("Neu");
    expect(upsertReminder(list, reminder("b", null)).map((r) => r.id)).toEqual([
      "b",
      "a",
    ]);
    expect(removeReminder(updated, "a")).toEqual([]);
  });
});
