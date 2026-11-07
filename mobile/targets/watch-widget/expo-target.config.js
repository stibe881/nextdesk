// Komplikation (Zifferblatt) der nextDesk-Watch-App. Zeigt die Werte, die die
// Watch-App zuletzt geladen hat; Tippen öffnet die Watch-App.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "watch-widget",
  name: "nextDeskComplication",
  displayName: "nextDesk",
  bundleIdentifier: ".watchkitapp.complication",
  deploymentTarget: "10.0",
  colors: {
    $accent: { color: "#ABA6FF", darkColor: "#ABA6FF" },
    $widgetBackground: { color: "#000000" },
  },
  entitlements: {
    "com.apple.security.application-groups": [
      `group.${config.ios.bundleIdentifier}.watch`,
    ],
  },
});
