// Load environment variables with proper priority (system > .env)
import "./scripts/load-env.js";
import { existsSync } from "node:fs";
import type { ExpoConfig } from "expo/config";
import { withAndroidManifest, type ConfigPlugin } from "expo/config-plugins";
import type { WithAndroidWidgetsParams } from "react-native-android-widget";

// Bundle ID format: space.manus.<project_name_dots>.<timestamp>
// e.g., "my-app" created at 2024-01-15 10:30:45 -> "space.manus.my.app.t20240115103045"
// Bundle ID can only contain letters, numbers, and dots
// Android requires each dot-separated segment to start with a letter
const rawBundleId = "ch.grossict.nextdesk";
const bundleId =
  rawBundleId
    .replace(/[-_]/g, ".") // Replace hyphens/underscores with dots
    .replace(/[^a-zA-Z0-9.]/g, "") // Remove invalid chars
    .replace(/\.+/g, ".") // Collapse consecutive dots
    .replace(/^\.+|\.+$/g, "") // Trim leading/trailing dots
    .toLowerCase()
    .split(".")
    .map((segment) => {
      // Android requires each segment to start with a letter
      // Prefix with 'x' if segment starts with a digit
      return /^[a-zA-Z]/.test(segment) ? segment : "x" + segment;
    })
    .join(".") || "space.manus.app";
// Use the bundle identifier as the one canonical OAuth callback scheme.  It is
// unique to the production app and matches the redirect URI registered in
// Supabase, avoiding a redirect to a different or older development scheme.
const schemeFromBundleId = "ch.grossict.nextdesk";

// Android-Push über Expo braucht die Firebase-Datei google-services.json: als
// EAS-Datei-Variable GOOGLE_SERVICES_JSON oder als Datei im Projektordner.
// Fehlt sie, baut die App ohne Push-Zugangsdaten (Mitteilungen bleiben aus).
const googleServicesFile =
  process.env.GOOGLE_SERVICES_JSON ??
  (existsSync("./google-services.json") ? "./google-services.json" : undefined);

// Purpose strings for the iOS permission dialogs (App Review 5.1.1(ii): they
// must clearly and completely describe the use). Several plugins write the
// same key; each one gets the same German text, otherwise the last plugin
// replaces it with its generic English default.
const MICROPHONE_USAGE =
  "nextDesk nutzt das Mikrofon nur, damit du Antworten in Tickets diktieren kannst."; // formality-ok: Text steht zur Build-Zeit fest (Systemdialog, Widget)
const CAMERA_USAGE =
  "nextDesk verwendet die Kamera, um QR-Codes von Assets zu scannen und Fotos direkt als Anhang zu einem Ticket aufzunehmen.";
const PHOTOS_USAGE =
  "nextDesk benötigt den Fotozugriff nur, um ausgewählte Bilder als Anhang zu einem Ticket hinzuzufügen.";

// The camera is optional: tickets can be created without it and photos can
// come from the system photo picker. Without this declaration the CAMERA
// permission implies a required camera and Google Play hides the app on
// devices without one (e.g. some tablets and Chromebooks).
const withOptionalCamera: ConfigPlugin = (config) =>
  withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    const features = (manifest["uses-feature"] ??= []);
    for (const name of [
      "android.hardware.camera",
      "android.hardware.camera.any",
      "android.hardware.camera.autofocus",
    ]) {
      const existing = features.find((item) => item.$["android:name"] === name);
      if (existing) existing.$["android:required"] = "false";
      else
        features.push({
          $: { "android:name": name, "android:required": "false" },
        });
    }
    return mod;
  });

const env = {
  // App branding - update these values directly (do not use env vars)
  appName: "nextDesk",
  appSlug: "nextdeskios",
  logoUrl:
    "https://files.manuscdn.com/user_upload_by_module/session_file/310519663166174123/iJmIGyxNgxjtJGVS.png",
  scheme: schemeFromBundleId,
  iosBundleId: bundleId,
  // Google Play verlangt eine eigene Paket-ID; sie weicht bewusst von der iOS-Bundle-ID ab.
  androidPackage: "ch.nextdesk.grossict",
  // Keep in sync with lib/widget-publisher.ios.ts and targets/widget/Snapshot.swift.
  iosWidgetAppGroup: `group.${bundleId}`,
};

// Expo serializes this browser-safe subset into native and web bundles. The server-only
// MANUS_API_KEY and MANUS_JWT_SECRET must never enter this object.
const publicRuntime = {
  oauthPortalUrl:
    process.env.MANUS_OAUTH_PORTAL_URL ??
    process.env.VITE_OAUTH_PORTAL_URL ??
    process.env.EXPO_PUBLIC_OAUTH_PORTAL_URL ??
    "",
  oauthServerUrl:
    process.env.MANUS_OAUTH_API_URL ??
    process.env.OAUTH_SERVER_URL ??
    process.env.EXPO_PUBLIC_OAUTH_SERVER_URL ??
    "",
  appId:
    process.env.MANUS_PROJECT_ID ??
    process.env.VITE_APP_ID ??
    process.env.EXPO_PUBLIC_APP_ID ??
    "",
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
  nextDeskSupabaseUrl: process.env.EXPO_PUBLIC_NEXTDESK_SUPABASE_URL ?? "",
  nextDeskSupabasePublishableKey:
    process.env.EXPO_PUBLIC_NEXTDESK_SUPABASE_PUBLISHABLE_KEY ?? "",
  eas: {
    projectId: "78754839-056e-427d-86b1-12d048d401aa",
  },
};

const config: ExpoConfig = {
  name: env.appName,
  slug: env.appSlug,
  version: "1.0.0",
  extra: publicRuntime,
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: env.scheme,
  userInterfaceStyle: "automatic",
  ios: {
    supportsTablet: true,
    bundleIdentifier: env.iosBundleId,
    // Apple Developer Team (needed for the widget extension and App Group).
    appleTeamId: "QF59FHQ44R",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
    // Shared with the WidgetKit extension in targets/widget, which reads the
    // token-free widget snapshot (lib/widget-publisher.ios.ts).
    entitlements: {
      "com.apple.security.application-groups": [env.iosWidgetAppGroup],
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    package: env.androidPackage,
    ...(googleServicesFile ? { googleServicesFile } : {}),
    permissions: ["POST_NOTIFICATIONS"],
    // Google Play «Photo and Video Permissions»: photos are only picked now
    // and then for a ticket, so the system photo picker is used and broad
    // media access must not end up in the manifest through any library.
    blockedPermissions: [
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
      "android.permission.ACCESS_MEDIA_LOCATION",
    ],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: env.scheme,
            host: "*",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-asset",
    "expo-router",
    "@react-native-community/datetimepicker",
    ["expo-notifications", { mode: "production" }],
    [
      "expo-speech-recognition",
      {
        microphonePermission: MICROPHONE_USAGE,
        speechRecognitionPermission:
          "nextDesk wandelt dein Diktat in Text um, damit du Antworten nicht tippen musst.", // formality-ok: Text steht zur Build-Zeit fest (Systemdialog, Widget)
        androidSpeechServicePackages: [
          "com.google.android.googlequicksearchbox",
        ],
      },
    ],
    [
      "expo-audio",
      {
        microphonePermission: MICROPHONE_USAGE,
        // Standardmässig trägt das Plugin «audio» in UIBackgroundModes ein
        // (Hintergrund-Wiedergabe). Die App spielt nichts im Hintergrund ab
        // und nimmt nicht im Hintergrund auf: Apple lehnt sonst ab (2.5.4).
        enableBackgroundPlayback: false,
        enableBackgroundRecording: false,
      },
    ],
    [
      "expo-camera",
      {
        cameraPermission: CAMERA_USAGE,
        microphonePermission: MICROPHONE_USAGE,
        // The scanner never records video; RECORD_AUDIO comes only from
        // dictation (expo-speech-recognition).
        recordAudioAndroid: false,
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission: PHOTOS_USAGE,
        cameraPermission: CAMERA_USAGE,
        // Only still images are taken; `false` would remove the dictation
        // permission as well, so the shared text is passed instead.
        microphonePermission: MICROPHONE_USAGE,
      },
    ],
    [
      "expo-local-authentication",
      {
        faceIDPermission:
          "nextDesk verwendet Face ID nur, um deine bereits angemeldete Sitzung auf diesem Gerät zu schützen.", // formality-ok: Text steht zur Build-Zeit fest (Systemdialog, Widget)
      },
    ],
    [
      "expo-video",
      {
        // Die App spielt keine Medien im Hintergrund: das Plugin würde sonst
        // «audio» in UIBackgroundModes eintragen (Apple 2.5.4).
        supportsBackgroundPlayback: false,
        supportsPictureInPicture: false,
      },
    ],
    // Static home-screen quick actions on iOS: they show on long-press of the
    // app icon from the first launch on, without waiting for JavaScript.
    // Keep ids in sync with components/quick-actions-bridge.tsx.
    [
      "expo-quick-actions",
      {
        iosActions: [
          {
            id: "follow-up",
            title: "Wiedervorlage erfassen",
            icon: "symbol:calendar.badge.clock",
          },
          {
            id: "ticket",
            title: "Ticket erfassen",
            icon: "symbol:plus.bubble",
          },
          {
            id: "service-task",
            title: "Serviceaufgabe erfassen",
            icon: "symbol:checklist",
          },
          {
            id: "inventory-item",
            title: "Lagerartikel erfassen",
            icon: "symbol:shippingbox",
          },
        ],
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          backgroundColor: "#000000",
        },
      },
    ],
    // Home-screen widgets. iOS: WidgetKit extension from targets/widget
    // (Swift); dazu Apple-Watch-App (targets/watch) und Komplikation
    // (targets/watch-widget). Android: react-native-android-widget renders
    // widgets/android/nextdesk-widgets.tsx in a headless JS task.
    "@bacons/apple-targets",
    [
      "react-native-android-widget",
      {
        widgets: [
          {
            // Keep names in sync with widgets/android/nextdesk-widgets.tsx.
            name: "NextDeskPriorities",
            label: "Meine Prioritäten",
            description:
              "Deine drei wichtigsten Tickets mit SLA-Warnungen und offenen Freigaben.", // formality-ok: Text steht zur Build-Zeit fest (Systemdialog, Widget)
            minWidth: "250dp",
            minHeight: "180dp",
            targetCellWidth: 4,
            targetCellHeight: 3,
            resizeMode: "horizontal|vertical",
            updatePeriodMillis: 1_800_000,
          },
          {
            name: "NextDeskCounters",
            label: "SLA & Freigaben",
            description:
              "Deine SLA-Warnungen (fällig in unter 4 Stunden) und offenen Freigaben.", // formality-ok: Text steht zur Build-Zeit fest (Systemdialog, Widget)
            minWidth: "180dp",
            minHeight: "110dp",
            targetCellWidth: 3,
            targetCellHeight: 2,
            resizeMode: "horizontal|vertical",
            updatePeriodMillis: 1_800_000,
          },
        ],
      } satisfies WithAndroidWidgetsParams,
    ],
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["armeabi-v7a", "arm64-v8a"],
          minSdkVersion: 24,
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default withOptionalCamera(config);
