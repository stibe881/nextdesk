import {
  AccessibilityInfo,
  Appearance,
  View,
  useColorScheme as useSystemColorScheme,
} from "react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { colorScheme as nativewindColorScheme, vars } from "nativewind";

import { SchemeColors, type ColorScheme } from "@/constants/theme";
import { mobileSecureStorage } from "@/lib/mobile-secure-storage";

export type ThemePreference = "system" | ColorScheme;
export type MotionPreference = "system" | "reduced";
export type DensityPreference = "comfortable" | "compact";

type StoredPreferences = {
  density: DensityPreference;
  motion: MotionPreference;
  theme: ThemePreference;
};

type ThemeContextValue = {
  colorScheme: ColorScheme;
  colors: (typeof SchemeColors)[ColorScheme];
  density: DensityPreference;
  motionPreference: MotionPreference;
  preferencesReady: boolean;
  reducedMotion: boolean;
  setColorScheme: (scheme: ColorScheme) => void;
  setDensity: (density: DensityPreference) => void;
  setMotionPreference: (preference: MotionPreference) => void;
  setThemePreference: (preference: ThemePreference) => void;
  themePreference: ThemePreference;
};

const THEME_PREFERENCES_KEY = "nextdesk:mobile:theme-preferences:v1";
const DEFAULT_PREFERENCES: StoredPreferences = {
  density: "comfortable",
  motion: "system",
  theme: "system",
};
const ThemeContext = createContext<ThemeContextValue | null>(null);

function parsePreferences(value: string | null): StoredPreferences {
  if (!value) return DEFAULT_PREFERENCES;
  try {
    const candidate = JSON.parse(value) as Partial<StoredPreferences>;
    return {
      density: candidate.density === "compact" ? "compact" : "comfortable",
      motion: candidate.motion === "reduced" ? "reduced" : "system",
      theme:
        candidate.theme === "light" || candidate.theme === "dark"
          ? candidate.theme
          : "system",
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/**
 * Presentation preferences are device-local only. On native platforms the shared
 * storage wrapper maps this record to the iOS Keychain with device-only access.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useSystemColorScheme() === "dark" ? "dark" : "light";
  const [themePreference, setThemePreferenceState] =
    useState<ThemePreference>("system");
  const [motionPreference, setMotionPreferenceState] =
    useState<MotionPreference>("system");
  const [density, setDensityState] = useState<DensityPreference>("comfortable");
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const preferencesRef = useRef<StoredPreferences>(DEFAULT_PREFERENCES);

  const colorScheme: ColorScheme =
    themePreference === "system" ? systemScheme : themePreference;
  const reducedMotion =
    motionPreference === "reduced" || systemReducedMotion;

  const persist = useCallback((next: StoredPreferences) => {
    preferencesRef.current = next;
    void mobileSecureStorage
      .setItem(THEME_PREFERENCES_KEY, JSON.stringify(next))
      // A presentation preference must never interrupt an authenticated session.
      .catch(() => undefined);
  }, []);

  const setThemePreference = useCallback(
    (theme: ThemePreference) => {
      setThemePreferenceState(theme);
      persist({ ...preferencesRef.current, theme });
    },
    [persist],
  );

  // Kept for existing consumers that intentionally choose an explicit scheme.
  const setColorScheme = useCallback(
    (scheme: ColorScheme) => setThemePreference(scheme),
    [setThemePreference],
  );

  const setMotionPreference = useCallback(
    (motion: MotionPreference) => {
      setMotionPreferenceState(motion);
      persist({ ...preferencesRef.current, motion });
    },
    [persist],
  );

  const setDensity = useCallback(
    (nextDensity: DensityPreference) => {
      setDensityState(nextDensity);
      persist({ ...preferencesRef.current, density: nextDensity });
    },
    [persist],
  );

  const applyScheme = useCallback((scheme: ColorScheme) => {
    nativewindColorScheme.set(scheme);
    Appearance.setColorScheme?.(scheme);
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.dataset.theme = scheme;
      root.classList.toggle("dark", scheme === "dark");
      const palette = SchemeColors[scheme];
      Object.entries(palette).forEach(([token, value]) => {
        root.style.setProperty(`--color-${token}`, value);
      });
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [stored, reduced] = await Promise.all([
        mobileSecureStorage.getItem(THEME_PREFERENCES_KEY).catch(() => null),
        AccessibilityInfo.isReduceMotionEnabled().catch(() => false),
      ]);
      if (!active) return;
      const preferences = parsePreferences(stored);
      preferencesRef.current = preferences;
      setThemePreferenceState(preferences.theme);
      setMotionPreferenceState(preferences.motion);
      setDensityState(preferences.density);
      setSystemReducedMotion(reduced);
      setPreferencesReady(true);
    })();

    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setSystemReducedMotion,
    );
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);

  useEffect(() => {
    applyScheme(colorScheme);
  }, [applyScheme, colorScheme]);

  const themeVariables = useMemo(
    () =>
      vars({
        "color-primary": SchemeColors[colorScheme].primary,
        "color-background": SchemeColors[colorScheme].background,
        "color-surface": SchemeColors[colorScheme].surface,
        "color-foreground": SchemeColors[colorScheme].foreground,
        "color-muted": SchemeColors[colorScheme].muted,
        "color-border": SchemeColors[colorScheme].border,
        "color-success": SchemeColors[colorScheme].success,
        "color-warning": SchemeColors[colorScheme].warning,
        "color-error": SchemeColors[colorScheme].error,
      }),
    [colorScheme],
  );

  const value = useMemo(
    () => ({
      colorScheme,
      colors: SchemeColors[colorScheme],
      density,
      motionPreference,
      preferencesReady,
      reducedMotion,
      setColorScheme,
      setDensity,
      setMotionPreference,
      setThemePreference,
      themePreference,
    }),
    [
      colorScheme,
      density,
      motionPreference,
      preferencesReady,
      reducedMotion,
      setColorScheme,
      setDensity,
      setMotionPreference,
      setThemePreference,
      themePreference,
    ],
  );

  return (
    <ThemeContext.Provider value={value}>
      <View style={[{ flex: 1 }, themeVariables]}>{children}</View>
    </ThemeContext.Provider>
  );
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useThemeContext must be used within ThemeProvider");
  }
  return ctx;
}
