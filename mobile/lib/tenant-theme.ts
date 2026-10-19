import type { ColorScheme, SchemeColorPalette } from "../constants/theme";
import themeConfig from "../theme.config";
import type { TenantBrandColors } from "./tenant-branding";

type Rgb = { blue: number; green: number; red: number };

const HEX_COLOR = /^#[0-9A-F]{6}$/i;
const BLACK = "#101114";
const WHITE = "#FFFFFF";
const SchemeColors = {
  dark: Object.fromEntries(
    Object.entries(themeConfig.themeColors).map(([token, swatch]) => [
      token,
      swatch.dark,
    ]),
  ) as SchemeColorPalette,
  light: Object.fromEntries(
    Object.entries(themeConfig.themeColors).map(([token, swatch]) => [
      token,
      swatch.light,
    ]),
  ) as SchemeColorPalette,
} satisfies Record<ColorScheme, SchemeColorPalette>;

function normalizeHex(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return HEX_COLOR.test(normalized) ? normalized : null;
}

function rgb(value: string): Rgb {
  return {
    red: Number.parseInt(value.slice(1, 3), 16),
    green: Number.parseInt(value.slice(3, 5), 16),
    blue: Number.parseInt(value.slice(5, 7), 16),
  };
}

function hex(value: Rgb): string {
  const channel = (number: number) =>
    Math.round(Math.min(255, Math.max(0, number)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(value.red)}${channel(value.green)}${channel(value.blue)}`.toUpperCase();
}

function blend(
  foreground: string,
  background: string,
  foregroundRatio: number,
): string {
  const source = rgb(foreground);
  const target = rgb(background);
  const ratio = Math.min(1, Math.max(0, foregroundRatio));
  return hex({
    red: source.red * ratio + target.red * (1 - ratio),
    green: source.green * ratio + target.green * (1 - ratio),
    blue: source.blue * ratio + target.blue * (1 - ratio),
  });
}

function relativeLuminance(value: string): number {
  const { blue, green, red } = rgb(value);
  const linear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return linear(red) * 0.2126 + linear(green) * 0.7152 + linear(blue) * 0.0722;
}

function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [
    relativeLuminance(foreground),
    relativeLuminance(background),
  ].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

function minimumContrast(color: string, surfaces: readonly string[]): number {
  return Math.min(...surfaces.map((surface) => contrastRatio(color, surface)));
}

function readableOnSurfaces(
  color: string,
  surfaces: readonly string[],
  minimum = 4.5,
): string {
  if (minimumContrast(color, surfaces) >= minimum) return color;
  const averageSurfaceLuminance =
    surfaces.reduce((total, surface) => total + relativeLuminance(surface), 0) /
    surfaces.length;
  const target = averageSurfaceLuminance > 0.5 ? BLACK : WHITE;
  for (let step = 1; step <= 16; step += 1) {
    const adjusted = blend(color, target, 1 - step / 16);
    if (minimumContrast(adjusted, surfaces) >= minimum) return adjusted;
  }
  return minimumContrast(BLACK, surfaces) >= minimumContrast(WHITE, surfaces)
    ? BLACK
    : WHITE;
}

function contentOnFill(fill: string): string {
  return contrastRatio(WHITE, fill) >= contrastRatio(BLACK, fill)
    ? WHITE
    : BLACK;
}

/**
 * Maps all web design colours to the mobile colour roles. Primary controls filled
 * actions, secondary controls links/icons on surfaces, and accent controls the
 * informational accent. Soft variants are derived per colour scheme so that the
 * user's local light/dark preference remains readable.
 */
export function resolveTenantPalette(
  scheme: ColorScheme,
  branding: TenantBrandColors | null,
): SchemeColorPalette {
  const base = SchemeColors[scheme];

  const configuredPrimary =
    normalizeHex(branding?.primaryColor) ?? base.primary;
  const configuredSecondary =
    normalizeHex(branding?.secondaryColor) ?? configuredPrimary;
  const configuredAccent = normalizeHex(branding?.accentColor) ?? base.info;
  const primarySoftRatio = scheme === "light" ? 0.12 : 0.24;
  const primaryBorderRatio = scheme === "light" ? 0.28 : 0.46;
  const accentSoftRatio = scheme === "light" ? 0.12 : 0.23;
  let primary = readableOnSurfaces(configuredPrimary, [
    base.background,
    base.surface,
  ]);
  let accent = readableOnSurfaces(configuredAccent, [
    base.background,
    base.surface,
  ]);

  // Primary and accent influence each other's soft surfaces. Iterate to a
  // stable, readable pair instead of checking the two colours in isolation.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const primarySoft = blend(primary, base.surface, primarySoftRatio);
    const infoSoft = blend(accent, base.surface, accentSoftRatio);
    const surfaces = [base.background, base.surface, primarySoft, infoSoft];
    const nextPrimary = readableOnSurfaces(configuredPrimary, surfaces);
    const nextAccent = readableOnSurfaces(configuredAccent, surfaces);
    if (nextPrimary === primary && nextAccent === accent) break;
    primary = nextPrimary;
    accent = nextAccent;
  }

  const primarySoft = blend(primary, base.surface, primarySoftRatio);
  const infoSoft = blend(accent, base.surface, accentSoftRatio);
  const brandSurfaces = [base.background, base.surface, primarySoft, infoSoft];
  const primaryText = readableOnSurfaces(configuredSecondary, [
    ...brandSurfaces,
  ]);
  const info = readableOnSurfaces(accent, brandSurfaces);

  return {
    ...base,
    primary,
    onPrimary: contentOnFill(primary),
    primaryText,
    primarySoft,
    primarySoftBorder: blend(primary, base.border, primaryBorderRatio),
    info,
    infoSoft,
    onWarningStrong: contentOnFill(base.warningStrong),
  };
}
