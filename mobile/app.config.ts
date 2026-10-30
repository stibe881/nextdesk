// Load environment variables with proper priority (system > .env)
import "./scripts/load-env.js";
import type { ExpoConfig } from "expo/config";

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

const env = {
  // App branding - update these values directly (do not use env vars)
  appName: "nextDesk iOS",
  appSlug: "nextdeskios",
  logoUrl:
    "https://files.manuscdn.com/user_upload_by_module/session_file/310519663166174123/iJmIGyxNgxjtJGVS.png",
  scheme: schemeFromBundleId,
  iosBundleId: bundleId,
  // Google Play verlangt eine eigene Paket-ID; sie weicht bewusst von der iOS-Bundle-ID ab.
  androidPackage: "ch.nextdesk.grossict",
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
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
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
    permissions: ["POST_NOTIFICATIONS"],
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
      "expo-audio",
      {
        microphonePermission:
          "Allow $(PRODUCT_NAME) to access your microphone.",
      },
    ],
    [
      "expo-camera",
      {
        cameraPermission:
          "nextDesk verwendet die Kamera, um QR-Codes von Assets zu scannen und Fotos direkt als Anhang zu einem Ticket aufzunehmen.",
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission:
          "nextDesk benötigt den Fotozugriff nur, um einen Bildanhang zu einem Ticket hinzuzufügen.",
        cameraPermission:
          "nextDesk verwendet die Kamera, um QR-Codes von Assets zu scannen und Fotos direkt als Anhang zu einem Ticket aufzunehmen.",
      },
    ],
    [
      "expo-local-authentication",
      {
        faceIDPermission:
          "nextDesk verwendet Face ID nur, um Ihre bereits angemeldete Sitzung auf diesem Gerät zu schützen.",
      },
    ],
    [
      "expo-video",
      {
        supportsBackgroundPlayback: true,
        supportsPictureInPicture: true,
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

export default config;
