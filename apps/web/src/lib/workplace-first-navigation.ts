type NavigationSection = { label: string };

/**
 * Arbeitsplatz bündelt die tägliche Agentenarbeit und steht deshalb vor der
 * allgemeinen Übersicht. Nicht verfügbare Bereiche werden anschliessend wie
 * bisher durch die bestehende Feature- und Rechtefilterung ausgeblendet.
 */
export function workplaceFirstNavigation<T extends NavigationSection>(
  sections: readonly T[],
): T[] {
  const workplace = sections.find(
    (section) => section.label === "Arbeitsplatz",
  );
  if (!workplace) return [...sections];

  return [
    workplace,
    ...sections.filter((section) => section.label !== "Arbeitsplatz"),
  ];
}

/**
 * Der Arbeitsplatz ist eine primäre Aktion direkt unter der Marke. Die
 * restlichen Arbeitsbereiche beginnen erst unter ihrer Überschrift.
 */
export function splitWorkplaceNavigation<T extends NavigationSection>(
  sections: readonly T[],
): {
  workplaceNavigationItem: T | null;
  remainingNavigationSections: T[];
} {
  const workplaceNavigationItem =
    sections.find((section) => section.label === "Arbeitsplatz") ?? null;

  return {
    workplaceNavigationItem,
    remainingNavigationSections: sections.filter(
      (section) => section.label !== "Arbeitsplatz",
    ),
  };
}
