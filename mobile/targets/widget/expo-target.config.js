// iOS WidgetKit extension, linked into the Xcode project by
// @bacons/apple-targets during `expo prebuild`. The App Group entitlement is
// mirrored from ios.entitlements in app.config.ts; the app writes the widget
// snapshot there (lib/widget-publisher.ios.ts).

/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "NextDeskWidget",
  displayName: "nextDesk",
  bundleIdentifier: ".widget",
  deploymentTarget: "16.4",
  frameworks: ["SwiftUI", "WidgetKit"],
  // Colour roles from theme.config.js (light / dark).
  colors: {
    $accent: { light: "#4438CA", dark: "#ABA6FF" },
    $widgetBackground: { light: "#FFFFFF", dark: "#181A26" },
    WidgetSurface: { light: "#F7F7FB", dark: "#20232F" },
    WidgetForeground: { light: "#202136", dark: "#F3F3FA" },
    WidgetMuted: { light: "#6E6C84", dark: "#A4A3B8" },
    WidgetWarning: { light: "#8A5B0D", dark: "#F2C062" },
    WidgetDanger: { light: "#B42318", dark: "#FF9B91" },
  },
  entitlements: {
    "com.apple.security.application-groups":
      config.ios.entitlements["com.apple.security.application-groups"],
  },
});
