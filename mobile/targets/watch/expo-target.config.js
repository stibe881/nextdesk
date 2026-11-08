// Apple-Watch-App von nextDesk (SwiftUI). Wird von @bacons/apple-targets beim
// Prebuild als watchOS-Ziel in das Xcode-Projekt eingebunden.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "watch",
  name: "nextDeskWatch",
  displayName: "nextDesk",
  bundleIdentifier: ".watch",
  deploymentTarget: "10.0",
  icon: "../../assets/images/icon.png",
  // Die Watch ist immer dunkel: Akzent wie primaryText im dunklen App-Thema.
  colors: { $accent: { color: "#ABA6FF", darkColor: "#ABA6FF" } },
  frameworks: ["SwiftUI", "WatchConnectivity", "WidgetKit"],
  entitlements: {
    // Gemeinsamer Speicher mit der Komplikation (nur Anzeigewerte, kein Token).
    "com.apple.security.application-groups": [
      `group.${config.ios.bundleIdentifier}.watch`,
    ],
  },
});
