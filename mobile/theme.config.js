/**
 * nextDesk colour roles. Every screen must use these roles instead of fixed
 * colour values so that light and dark mode stay consistent.
 *
 * Light values keep the established nextDesk look. Dark values are tuned for
 * WCAG AA contrast on the dark surfaces (see scripts/check-theme-contrast.mts).
 *
 * Roles:
 * - background: screen canvas; surface: cards and sheets; surfaceSubtle: inputs
 *   and inner areas inside cards.
 * - foreground: headings; text: body copy; muted: secondary copy; subtle:
 *   placeholders and decorative icons.
 * - primary: filled buttons and active fills (use onPrimary for content on it);
 *   primaryText: links, accent text and icons on surfaces; primarySoft /
 *   primarySoftBorder: chips, icon wells and selected rows.
 * - info / success / warning / error: status text and icons on surfaces;
 *   *Soft: status backgrounds; *Border: status outlines; warningStrong: filled
 *   internal-note buttons with onWarningStrong content.
 */
/** @type {const} */
const themeColors = {
  primary: { light: "#4438CA", dark: "#5B50E6" },
  onPrimary: { light: "#FFFFFF", dark: "#FFFFFF" },
  primaryText: { light: "#4438CA", dark: "#ABA6FF" },
  primarySoft: { light: "#EEECFF", dark: "#26244A" },
  primarySoftBorder: { light: "#DCD8FF", dark: "#3B3873" },
  background: { light: "#F6F7FB", dark: "#0E1018" },
  surface: { light: "#FFFFFF", dark: "#181A26" },
  surfaceSubtle: { light: "#F7F7FB", dark: "#20232F" },
  foreground: { light: "#202136", dark: "#F3F3FA" },
  text: { light: "#303145", dark: "#D6D6E4" },
  muted: { light: "#6E6C84", dark: "#A4A3B8" },
  subtle: { light: "#858398", dark: "#7D7C92" },
  border: { light: "#E5E5EF", dark: "#2A2D3D" },
  borderStrong: { light: "#D9D8E6", dark: "#3A3E53" },
  info: { light: "#07738D", dark: "#67D3EA" },
  infoSoft: { light: "#E5F7FA", dark: "#0F3140" },
  success: { light: "#166534", dark: "#6BDB97" },
  successSoft: { light: "#E9F8EE", dark: "#11301F" },
  successBorder: { light: "#BBF7D0", dark: "#1F5236" },
  warning: { light: "#8A5B0D", dark: "#F2C062" },
  warningSoft: { light: "#FFF4DB", dark: "#33260C" },
  warningBorder: { light: "#F0D59E", dark: "#5E4618" },
  warningStrong: { light: "#9A6812", dark: "#8F6114" },
  onWarningStrong: { light: "#FFFFFF", dark: "#FFFFFF" },
  error: { light: "#B42318", dark: "#FF9B91" },
  errorSoft: { light: "#FFF1F0", dark: "#3A1716" },
  errorBorder: { light: "#F1CCC7", dark: "#6A2A27" },
  overlay: { light: "rgba(20, 21, 38, 0.45)", dark: "rgba(0, 0, 0, 0.62)" },
  shadow: { light: "#202136", dark: "#000000" },
};

module.exports = { themeColors };
