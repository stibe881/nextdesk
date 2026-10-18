export const themeColors: {
  primary: { light: string; dark: string };
  onPrimary: { light: string; dark: string };
  primaryText: { light: string; dark: string };
  primarySoft: { light: string; dark: string };
  primarySoftBorder: { light: string; dark: string };
  background: { light: string; dark: string };
  surface: { light: string; dark: string };
  surfaceSubtle: { light: string; dark: string };
  foreground: { light: string; dark: string };
  text: { light: string; dark: string };
  muted: { light: string; dark: string };
  subtle: { light: string; dark: string };
  border: { light: string; dark: string };
  borderStrong: { light: string; dark: string };
  info: { light: string; dark: string };
  infoSoft: { light: string; dark: string };
  success: { light: string; dark: string };
  successSoft: { light: string; dark: string };
  successBorder: { light: string; dark: string };
  warning: { light: string; dark: string };
  warningSoft: { light: string; dark: string };
  warningBorder: { light: string; dark: string };
  warningStrong: { light: string; dark: string };
  error: { light: string; dark: string };
  errorSoft: { light: string; dark: string };
  errorBorder: { light: string; dark: string };
  overlay: { light: string; dark: string };
  shadow: { light: string; dark: string };
};

declare const themeConfig: {
  themeColors: typeof themeColors;
};

export default themeConfig;
