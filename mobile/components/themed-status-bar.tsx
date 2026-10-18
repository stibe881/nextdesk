import { StatusBar } from "expo-status-bar";

import { useThemeContext } from "@/lib/theme-provider";

/** Light status bar content on dark screens, dark content on light screens. */
export function ThemedStatusBar() {
  const { colorScheme } = useThemeContext();
  return <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />;
}
