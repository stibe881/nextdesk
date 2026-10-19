import { useMemo } from "react";

import type {
  ColorScheme,
  SchemeColorPalette,
  ThemeColorPalette,
} from "@/constants/theme";
import { useThemeContext } from "@/lib/theme-provider";

function withRuntimeAliases(palette: SchemeColorPalette): ThemeColorPalette {
  return {
    ...palette,
    text: palette.foreground,
    background: palette.background,
    tint: palette.primary,
    icon: palette.muted,
    tabIconDefault: palette.muted,
    tabIconSelected: palette.primary,
    border: palette.border,
  };
}

/**
 * Returns the current tenant-aware colour palette. An explicit scheme remains
 * supported for development previews and uses the same tenant design values.
 */
export function useColors(
  colorSchemeOverride?: ColorScheme,
): ThemeColorPalette {
  const { colorScheme, colors, getColorsForScheme } = useThemeContext();
  const palette =
    colorSchemeOverride && colorSchemeOverride !== colorScheme
      ? getColorsForScheme(colorSchemeOverride)
      : colors;
  return useMemo(() => withRuntimeAliases(palette), [palette]);
}
