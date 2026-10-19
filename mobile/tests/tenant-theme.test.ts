import { describe, expect, it } from "vitest";

import type { TenantBrandColors } from "../lib/tenant-branding";
import { resolveTenantPalette } from "../lib/tenant-theme";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(left: string, right: string): number {
  const [lighter, darker] = [luminance(left), luminance(right)].sort(
    (first, second) => second - first,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

const brandings: (TenantBrandColors | null)[] = [
  null,
  {
    accentColor: "#FFFFFF",
    primaryColor: "#000000",
    secondaryColor: "#000000",
  },
  {
    accentColor: "#000000",
    primaryColor: "#FFFFFF",
    secondaryColor: "#FFFFFF",
  },
  {
    accentColor: "#939393",
    primaryColor: "#FFFFFF",
    secondaryColor: "#939393",
  },
];

describe("tenant palette contrast", () => {
  it.each(["light", "dark"] as const)(
    "keeps fallback and configurable brands readable in %s mode",
    (scheme) => {
      for (const branding of brandings) {
        const palette = resolveTenantPalette(scheme, branding);
        const surfaces = [
          palette.background,
          palette.surface,
          palette.primarySoft,
          palette.infoSoft,
        ];
        for (const token of ["primary", "primaryText", "info"] as const) {
          expect(
            Math.min(
              ...surfaces.map((surface) => contrast(palette[token], surface)),
            ),
          ).toBeGreaterThanOrEqual(4.5);
        }
        expect(
          contrast(palette.onPrimary, palette.primary),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(palette.onWarningStrong, palette.warningStrong),
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
