import { describe, expect, it } from "vitest";

import {
  entryDone,
  activeEntryDateFilters,
  assignOptions,
  emptyEntryDateFilter,
  type EntryDateFilter,
  filterEntries,
  groupTasks,
  relativeDays,
} from "./onboarding";

const today = new Date("2026-11-19T10:00:00Z");
const task = (id: string, dueOn: string, status = "open") => ({
  id,
  title: id,
  dueOn,
  responsibleName: "Mara Keller",
  status: status as "open" | "completed",
  canUpdate: true,
  exception: null,
});

describe("Eintritte: Aufgaben nach Fälligkeit", () => {
  it("gruppiert offene Aufgaben und stellt erledigte ans Ende", () => {
    const groups = groupTasks(
      [
        task("später", "2026-12-01"),
        task("überfällig", "2026-11-18"),
        task("heute", "2026-11-19"),
        task("erledigt", "2026-11-10", "completed"),
        task("in einer Woche", "2026-11-26"),
      ],
      today,
    );
    expect(
      groups.map((group) => [group.key, group.tasks.map((t) => t.id)]),
    ).toEqual([
      ["overdue", ["überfällig"]],
      ["soon", ["heute", "in einer Woche"]],
      ["later", ["später"]],
      ["done", ["erledigt"]],
    ]);
  });

  it("lässt leere Gruppen weg", () => {
    expect(
      groupTasks([task("a", "2026-12-24")], today).map((g) => g.key),
    ).toEqual(["later"]);
  });

  it("beschreibt Abstände in Tagen", () => {
    expect(relativeDays(0)).toBe("heute");
    expect(relativeDays(1)).toBe("morgen");
    expect(relativeDays(12)).toBe("in 12 Tagen");
    expect(relativeDays(-3)).toBe("vor 3 Tagen");
  });
});

describe("Eintritte filtern und suchen", () => {
  const entry = (
    name: string,
    statuses: string[],
    extra: Record<string, unknown> = {},
  ) => ({
    employeeName: name,
    organisationUnit: "ZD_GASTRO",
    location: "Baar (Weststrasse)",
    managerName: "Ronald Junkert",
    ictResponsibleName: "Stefan",
    sourceTicketNumber: null as string | null,
    tasks: statuses.map((status) => ({ status })),
    ...extra,
  });
  const list = [
    entry("Luca Horvat", ["open", "completed"]),
    entry("Ennio Valente", ["completed", "completed"]),
    entry("Ohne Aufgaben", []),
    entry("Marie-Louise Veraguth", ["completed"], {
      sourceTicketNumber: "ICT-2026-000095",
    }),
  ];

  it("unterscheidet offen und erledigt", () => {
    expect(entryDone([])).toBe(false);
    expect(filterEntries(list, "open", "").map((e) => e.employeeName)).toEqual([
      "Luca Horvat",
      "Ohne Aufgaben",
    ]);
    expect(filterEntries(list, "done", "").map((e) => e.employeeName)).toEqual([
      "Ennio Valente",
      "Marie-Louise Veraguth",
    ]);
    expect(filterEntries(list, "all", "")).toHaveLength(4);
  });

  it("sucht über Name, Führung und Ticketnummer", () => {
    expect(
      filterEntries(list, "all", "valente").map((e) => e.employeeName),
    ).toEqual(["Ennio Valente"]);
    expect(
      filterEntries(list, "all", "000095").map((e) => e.employeeName),
    ).toEqual(["Marie-Louise Veraguth"]);
    expect(filterEntries(list, "done", "horvat")).toHaveLength(0);
    expect(filterEntries(list, "all", "junkert gastro")).toHaveLength(4);
  });

  it("filtert nach Eintrittsdatum und Eingang der Meldung", () => {
    const dated = [
      entry("Früh", ["open"], {
        startsOn: "2026-12-01",
        createdAt: "2026-11-10T08:00:00Z",
      }),
      entry("Spät", ["open"], {
        startsOn: "2027-08-01",
        // 23:30 UTC ist in Zürich bereits der 21. November.
        createdAt: "2026-11-20T23:30:00Z",
      }),
      entry("Ohne Meldedatum", ["open"], { startsOn: "2027-01-01" }),
    ];
    const names = (dates: Partial<EntryDateFilter>) =>
      filterEntries(dated, "all", "", {
        ...emptyEntryDateFilter,
        ...dates,
      }).map((e) => e.employeeName);
    expect(names({ startsFrom: "2027-01-01" })).toEqual([
      "Spät",
      "Ohne Meldedatum",
    ]);
    expect(names({ startsTo: "2026-12-01" })).toEqual(["Früh"]);
    expect(names({ reportedFrom: "2026-11-21" })).toEqual(["Spät"]);
    expect(names({ reportedTo: "2026-11-20" })).toEqual(["Früh"]);
    expect(
      activeEntryDateFilters({
        ...emptyEntryDateFilter,
        startsTo: "2027-01-01",
      }),
    ).toBe(1);
  });
});

describe("Eintritte zuweisen", () => {
  const agents = [
    { id: "a", displayName: "Anna" },
    { id: "b", displayName: "Ben" },
    { id: "c", displayName: "Cem" },
  ];
  it("zeigt «Nicht zugewiesen» und nur die Agenten der Abteilung", () => {
    expect(
      assignOptions(agents, ["a", "b"], null, "").map((p) => p.id),
    ).toEqual(["", "a", "b"]);
  });
  it("behält eine bisherige Person ausserhalb der Abteilung", () => {
    expect(
      assignOptions(agents, ["a"], "x", "Xaver").map((p) => p.displayName),
    ).toEqual(["Nicht zugewiesen", "Xaver", "Anna"]);
  });

  it("filtert nach Art des Vorgangs", () => {
    const mixed = [
      {
        employeeName: "A",
        organisationUnit: null,
        location: null,
        managerName: "",
        ictResponsibleName: "",
        kind: "onboarding",
        tasks: [],
      },
      {
        employeeName: "B",
        organisationUnit: null,
        location: null,
        managerName: "",
        ictResponsibleName: "",
        kind: "offboarding",
        tasks: [],
      },
      {
        employeeName: "C",
        organisationUnit: null,
        location: null,
        managerName: "",
        ictResponsibleName: "",
        tasks: [],
      },
    ];
    expect(
      filterEntries(mixed, "all", "", undefined, "offboarding").map(
        (e) => e.employeeName,
      ),
    ).toEqual(["B"]);
    expect(
      filterEntries(mixed, "all", "", undefined, "onboarding").map(
        (e) => e.employeeName,
      ),
    ).toEqual(["A", "C"]);
  });
});
