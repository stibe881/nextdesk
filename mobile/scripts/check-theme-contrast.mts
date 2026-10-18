// WCAG 2.2 contrast check for the nextDesk colour roles in light and dark mode.
// Text pairs require 4.5:1, large or non-text UI pairs 3:1.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { themeColors } = require("../theme.config.js") as {
  themeColors: Record<string, { light: string; dark: string }>;
};

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((index) => {
    const channel = parseInt(value.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left,
  );
  return (light + 0.05) / (dark + 0.05);
}

const textPairs: [string, string][] = [
  ["foreground", "background"],
  ["foreground", "surface"],
  ["foreground", "surfaceSubtle"],
  ["text", "surface"],
  ["text", "surfaceSubtle"],
  ["text", "background"],
  ["muted", "surface"],
  ["muted", "background"],
  ["muted", "surfaceSubtle"],
  ["primaryText", "surface"],
  ["primaryText", "background"],
  ["primaryText", "primarySoft"],
  ["onPrimary", "primary"],
  ["onPrimary", "warningStrong"],
  ["info", "infoSoft"],
  ["info", "surface"],
  ["success", "successSoft"],
  ["success", "surface"],
  ["warning", "warningSoft"],
  ["warning", "surface"],
  ["error", "errorSoft"],
  ["error", "surface"],
];
const uiPairs: [string, string][] = [
  ["subtle", "surface"],
  ["subtle", "surfaceSubtle"],
  ["primary", "surface"],
];

let failures = 0;
for (const scheme of ["light", "dark"] as const) {
  for (const [pairs, minimum] of [
    [textPairs, 4.5],
    [uiPairs, 3],
  ] as const) {
    for (const [foreground, background] of pairs) {
      const ratio = contrast(
        themeColors[foreground][scheme],
        themeColors[background][scheme],
      );
      if (ratio < minimum) {
        failures += 1;
        console.error(
          `FAIL ${scheme} ${foreground} on ${background}: ${ratio.toFixed(2)} < ${minimum}`,
        );
      }
    }
  }
}
if (failures > 0) process.exit(1);
console.log(
  `Kontrastprüfung bestanden: ${(textPairs.length + uiPairs.length) * 2} Farbpaare in Hell und Dunkel.`,
);
