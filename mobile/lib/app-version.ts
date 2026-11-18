import Constants from "expo-constants";

import { formatAppVersion } from "@/lib/app-version-model";

/** Version und Build der installierten App (aus dem Binär, nicht aus der Konfiguration). */
export function appVersionLabel(): string {
  return formatAppVersion(
    Constants.nativeAppVersion ?? Constants.expoConfig?.version,
    Constants.nativeBuildVersion ?? Constants.expoConfig?.ios?.buildNumber,
  );
}
