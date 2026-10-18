import { StyleSheet } from "react-native";

import { SchemeColors, type ColorScheme } from "@/constants/theme";
import { useThemeContext } from "@/lib/theme-provider";

/** All nextDesk colour roles for the active scheme (see theme.config.js). */
export type AppPalette = (typeof SchemeColors)[ColorScheme];

/**
 * Creates a hook that returns a StyleSheet built from the active colour scheme.
 * Each scheme is built once and cached, so components re-render cheaply when the
 * user switches between light and dark mode.
 *
 * Usage:
 *   const useStyles = makeThemedStyles((c) => ({ card: { backgroundColor: c.surface } }));
 *   function Card() { const styles = useStyles(); ... }
 */
export function makeThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: AppPalette, scheme: ColorScheme) => T,
): () => T {
  const cache: Partial<Record<ColorScheme, T>> = {};
  return function useThemedStyles(): T {
    const { colorScheme } = useThemeContext();
    const cached = cache[colorScheme];
    if (cached) return cached;
    const created = StyleSheet.create(
      factory(SchemeColors[colorScheme], colorScheme),
    );
    cache[colorScheme] = created;
    return created;
  };
}

/** Colour roles for inline values such as icon colours or placeholder text. */
export function useAppColors(): AppPalette {
  return useThemeContext().colors;
}

/** True when the dark scheme is active. */
export function useIsDarkScheme(): boolean {
  return useThemeContext().colorScheme === "dark";
}
