/**
 * Home screen layout of the app: every person arranges the sections and hides
 * what they do not need. Stored on the device per signed-in person.
 */
export const HOME_SECTIONS = [
  {
    id: "search",
    label: "Suche",
    description: "Globale Suche in Tickets, Wissen und mehr",
  },
  {
    id: "focus",
    label: "Heute im Fokus",
    description: "Kennzahlen des Tages",
  },
  {
    id: "recent",
    label: "Zuletzt geöffnet",
    description: "Tickets und Artikel, die du zuletzt angesehen hast",
  },
  {
    id: "overview",
    label: "Übersicht",
    description: "Meine, offene und nicht zugewiesene Tickets",
  },
  {
    id: "tickets",
    label: "Ticketliste",
    description: "Die Tickets zur gewählten Übersicht",
  },
  {
    id: "inbox",
    label: "Freigaben für mich",
    description: "Anfragen, die deine Entscheidung brauchen",
  },
  {
    id: "onboarding",
    label: "Eintritte",
    description: "Aufgaben zu neuen Mitarbeitenden",
  },
  {
    id: "mentions",
    label: "Erwähnungen",
    description: "Wo du in Tickets erwähnt wurdest",
  },
  {
    id: "approvals",
    label: "Meine Freigabeanfragen",
    description: "Anfragen, die du gestellt hast",
  },
  {
    id: "devices",
    label: "Meine Geräte",
    description: "Dir zugeordnete Geräte",
  },
] as const;

export type HomeSectionId = (typeof HOME_SECTIONS)[number]["id"];

export type HomeLayout = {
  /** All sections in the order shown. */
  order: HomeSectionId[];
  /** Sections the person switched off. */
  hidden: HomeSectionId[];
};

const IDS: readonly HomeSectionId[] = HOME_SECTIONS.map(
  (section) => section.id,
);

export const DEFAULT_HOME_LAYOUT: HomeLayout = { order: [...IDS], hidden: [] };

function isSectionId(value: unknown): value is HomeSectionId {
  return (
    typeof value === "string" && (IDS as readonly string[]).includes(value)
  );
}

/**
 * Makes any stored value a valid layout: unknown sections are dropped, doubles
 * removed, and sections added in a newer app version are appended (visible).
 */
export function normalizeHomeLayout(value: unknown): HomeLayout {
  const source =
    typeof value === "object" && value !== null
      ? (value as { order?: unknown; hidden?: unknown })
      : {};
  const order: HomeSectionId[] = [];
  if (Array.isArray(source.order)) {
    for (const item of source.order) {
      if (isSectionId(item) && !order.includes(item)) order.push(item);
    }
  }
  for (const id of IDS) if (!order.includes(id)) order.push(id);
  const hidden: HomeSectionId[] = [];
  if (Array.isArray(source.hidden)) {
    for (const item of source.hidden) {
      if (isSectionId(item) && !hidden.includes(item)) hidden.push(item);
    }
  }
  return { order, hidden };
}

export function parseStoredHomeLayout(raw: string | null): HomeLayout {
  if (!raw) return DEFAULT_HOME_LAYOUT;
  try {
    return normalizeHomeLayout(JSON.parse(raw));
  } catch {
    return DEFAULT_HOME_LAYOUT;
  }
}

export function moveHomeSection(
  layout: HomeLayout,
  id: HomeSectionId,
  direction: -1 | 1,
): HomeLayout {
  const index = layout.order.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= layout.order.length) return layout;
  const order = [...layout.order];
  const [moved] = order.splice(index, 1);
  if (!moved) return layout;
  order.splice(target, 0, moved);
  return { ...layout, order };
}

export function toggleHomeSection(
  layout: HomeLayout,
  id: HomeSectionId,
): HomeLayout {
  return {
    ...layout,
    hidden: layout.hidden.includes(id)
      ? layout.hidden.filter((item) => item !== id)
      : [...layout.hidden, id],
  };
}

export function visibleHomeSections(layout: HomeLayout): HomeSectionId[] {
  return layout.order.filter((id) => !layout.hidden.includes(id));
}

export function isHomeLayoutDefault(layout: HomeLayout): boolean {
  return (
    layout.hidden.length === 0 &&
    layout.order.every((id, index) => id === IDS[index])
  );
}
