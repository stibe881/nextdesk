import { useMemo } from "react";
import { StyleSheet } from "react-native";

import type { ColorScheme, SchemeColorPalette } from "@/constants/theme";
import { useThemeContext } from "@/lib/theme-provider";

/** All nextDesk colour roles for the active scheme (see theme.config.js). */
export type AppPalette = SchemeColorPalette;

/**
 * Creates a hook that returns a StyleSheet built from the active colour scheme
 * and the active tenant's permitted web design colours.
 *
 * Usage:
 *   const useStyles = makeThemedStyles((c) => ({ card: { backgroundColor: c.surface } }));
 *   function Card() { const styles = useStyles(); ... }
 */
export function makeThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: AppPalette, scheme: ColorScheme) => T,
): () => T {
  return function useThemedStyles(): T {
    const { colorScheme, colors } = useThemeContext();
    return useMemo(
      () => StyleSheet.create(factory(colors, colorScheme)),
      [colorScheme, colors],
    );
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
