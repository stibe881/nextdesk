#!/usr/bin/env node

/**
 * Checks the contrast contracts of nextDesk's semantic theme tokens. The dark
 * default primary/info values reflect the default tenant-brand fallback after
 * the color-mix declarations in styles.css are resolved.
 */
const palettes = {
  light: {
    canvas: "#f5f7fb",
    surface: "#ffffff",
    "surface-subtle": "#f8f9fc",
    ink: "#17233f",
    text: "#34435b",
    muted: "#59677c",
    primary: "#4338ca",
    "on-primary": "#ffffff",
    info: "#075985",
    "info-soft": "#eff8ff",
    success: "#11664e",
    "success-soft": "#edf8f3",
    warning: "#9a3412",
    "warning-soft": "#fff4ed",
    danger: "#b42335",
    "danger-soft": "#fff1f3",
  },
  dark: {
    canvas: "#111827",
    surface: "#182235",
    "surface-subtle": "#202c42",
    ink: "#f4f7ff",
    text: "#d8e1f0",
    muted: "#aebbd0",
    // Default #4338ca / #075985 brand fallbacks after their color-mix rules.
    primary: "#8e88df",
    "on-primary": "#111827",
    info: "#90b5c8",
    "info-soft": "#2f3d50",
    success: "#61d9ac",
    "success-soft": "#173d35",
    warning: "#ffbc7a",
    "warning-soft": "#4b2c16",
    danger: "#ff9aa8",
    "danger-soft": "#4d202c",
  },
};

function rgb(hex) {
  const value = hex.slice(1);
  return [0, 2, 4].map(
    (offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255,
  );
}

function linearChannel(channel) {
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const [red, green, blue] = rgb(hex).map(linearChannel);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

let failed = false;
for (const [theme, palette] of Object.entries(palettes)) {
  const pairs = [
    ...["ink", "text", "muted"].flatMap((foreground) =>
      ["canvas", "surface", "surface-subtle"].map((background) => [
        foreground,
        background,
      ]),
    ),
    ["on-primary", "primary"],
    ["info", "info-soft"],
    ["success", "success-soft"],
    ["warning", "warning-soft"],
    ["danger", "danger-soft"],
  ];

  for (const [foreground, background] of pairs) {
    const ratio = contrast(palette[foreground], palette[background]);
    const pass = ratio >= 4.5;
    console.log(
      `${pass ? "PASS" : "FAIL"} ${theme}: ${foreground} on ${background} = ${ratio.toFixed(2)}:1`,
    );
    if (!pass) failed = true;
  }
}

if (failed) process.exitCode = 1;
