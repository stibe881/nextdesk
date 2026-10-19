import {
  AccessibilityInfo,
  Appearance,
  View,
  useColorScheme as useSystemColorScheme,
} from "react-native";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { colorScheme as nativewindColorScheme, vars } from "nativewind";

import { type ColorScheme, type SchemeColorPalette } from "@/constants/theme";
import { mobileSecureStorage } from "@/lib/mobile-secure-storage";
import type { TenantBrandColors } from "@/lib/tenant-branding";
import { resolveTenantPalette } from "@/lib/tenant-theme";

export type ThemePreference = "system" | ColorScheme;
export type MotionPreference = "system" | "reduced";
export type DensityPreference = "comfortable" | "compact";

type StoredPreferences = {
  density: DensityPreference;
  motion: MotionPreference;
  theme: ThemePreference;
};

type TenantBrandingBinding = {
  colors: TenantBrandColors;
  tenantId: string;
};

type TenantBrandingScopeValue = {
  checkingWorkspace: boolean;
  tenantId: string | null;
};

type ThemeContextValue = {
  colorScheme: ColorScheme;
  colors: SchemeColorPalette;
  density: DensityPreference;
  getColorsForScheme: (scheme: ColorScheme) => SchemeColorPalette;
  motionPreference: MotionPreference;
  preferencesReady: boolean;
  reducedMotion: boolean;
  setColorScheme: (scheme: ColorScheme) => void;
  setDensity: (density: DensityPreference) => void;
  setMotionPreference: (preference: MotionPreference) => void;
  setTenantBrandColors: (binding: TenantBrandingBinding | null) => void;
  setThemePreference: (preference: ThemePreference) => void;
  tenantBrandTenantId: string | null;
  themePreference: ThemePreference;
};

const THEME_PREFERENCES_KEY = "nextdesk:mobile:theme-preferences:v2";
// v1 stored "system" as the implicit default. nextDesk now starts in light mode,
// so an untouched v1 "system" value is migrated to light. An explicit dark choice
// is kept.
const LEGACY_THEME_PREFERENCES_KEY = "nextdesk:mobile:theme-preferences:v1";
const DEFAULT_PREFERENCES: StoredPreferences = {
  density: "comfortable",
  motion: "system",
  theme: "light",
};
const ThemeContext = createContext<ThemeContextValue | null>(null);
const TenantBrandingScopeContext =
  createContext<TenantBrandingScopeValue | null>(null);

function parsePreferences(
  value: string | null,
  legacy = false,
): StoredPreferences {
  if (!value) return DEFAULT_PREFERENCES;
  try {
    const candidate = JSON.parse(value) as Partial<StoredPreferences>;
    return {
      density: candidate.density === "compact" ? "compact" : "comfortable",
      motion: candidate.motion === "reduced" ? "reduced" : "system",
      theme:
        candidate.theme === "dark"
          ? "dark"
          : candidate.theme === "system" && !legacy
            ? "system"
            : "light",
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
  const [preferences, setPreferences] =
    useState<StoredPreferences>(DEFAULT_PREFERENCES);
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [tenantBranding, setTenantBranding] =
    useState<TenantBrandingBinding | null>(null);
  const {
    density,
    motion: motionPreference,
    theme: themePreference,
  } = preferences;

  const colorScheme: ColorScheme =
    themePreference === "system" ? systemScheme : themePreference;
  const reducedMotion = motionPreference === "reduced" || systemReducedMotion;
  const tenantBrandColors = tenantBranding?.colors ?? null;
  const getColorsForScheme = useCallback(
    (scheme: ColorScheme) => resolveTenantPalette(scheme, tenantBrandColors),
    [tenantBrandColors],
  );
  const colors = useMemo(
    () => getColorsForScheme(colorScheme),
    [colorScheme, getColorsForScheme],
  );

  const setThemePreference = useCallback((theme: ThemePreference) => {
    setPreferences((current) => ({ ...current, theme }));
  }, []);

  // Kept for existing consumers that intentionally choose an explicit scheme.
  const setColorScheme = useCallback(
    (scheme: ColorScheme) => setThemePreference(scheme),
    [setThemePreference],
  );

  const setMotionPreference = useCallback((motion: MotionPreference) => {
    setPreferences((current) => ({ ...current, motion }));
  }, []);

  const setDensity = useCallback((nextDensity: DensityPreference) => {
    setPreferences((current) => ({ ...current, density: nextDensity }));
  }, []);

  const setTenantBrandColors = useCallback(
    (nextBranding: TenantBrandingBinding | null) => {
      setTenantBranding(nextBranding);
    },
    [],
  );

  const applyScheme = useCallback(
    (
      preference: ThemePreference,
      scheme: ColorScheme,
      palette: SchemeColorPalette,
    ) => {
      nativewindColorScheme.set(scheme);
      // `unspecified` removes iOS' explicit UI override. Keeping an override
      // here would make useColorScheme read the app's own setting instead of
      // the device setting after a person selects «Wie iPhone».
      Appearance.setColorScheme?.(
        preference === "system" ? "unspecified" : scheme,
      );
      if (typeof document !== "undefined") {
        const root = document.documentElement;
        root.dataset.theme = scheme;
        root.classList.toggle("dark", scheme === "dark");
        Object.entries(palette).forEach(([token, value]) => {
          root.style.setProperty(`--color-${token}`, value);
        });
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const [stored, legacy, reduced] = await Promise.all([
        mobileSecureStorage.getItem(THEME_PREFERENCES_KEY).catch(() => null),
        mobileSecureStorage
          .getItem(LEGACY_THEME_PREFERENCES_KEY)
          .catch(() => null),
        AccessibilityInfo.isReduceMotionEnabled().catch(() => false),
      ]);
      if (!active) return;
      const preferences =
        stored !== null
          ? parsePreferences(stored)
          : parsePreferences(legacy, true);
      setPreferences(preferences);
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
    if (!preferencesReady) return;
    void mobileSecureStorage
      .setItem(THEME_PREFERENCES_KEY, JSON.stringify(preferences))
      // A presentation preference must never interrupt an authenticated session.
      .catch(() => undefined);
  }, [preferences, preferencesReady]);

  useEffect(() => {
    applyScheme(themePreference, colorScheme, colors);
  }, [applyScheme, colorScheme, colors, themePreference]);

  const themeVariables = useMemo(
    () =>
      vars(
        Object.fromEntries(
          Object.entries(colors).map(([token, value]) => [
            `color-${token}`,
            value,
          ]),
        ),
      ),
    [colors],
  );

  const value = useMemo(
    () => ({
      colorScheme,
      colors,
      density,
      getColorsForScheme,
      motionPreference,
      preferencesReady,
      reducedMotion,
      setColorScheme,
      setDensity,
      setMotionPreference,
      setTenantBrandColors,
      setThemePreference,
      tenantBrandTenantId: tenantBranding?.tenantId ?? null,
      themePreference,
    }),
    [
      colorScheme,
      colors,
      density,
      getColorsForScheme,
      motionPreference,
      preferencesReady,
      reducedMotion,
      setColorScheme,
      setDensity,
      setMotionPreference,
      setTenantBrandColors,
      setThemePreference,
      tenantBranding?.tenantId,
      themePreference,
    ],
  );

  return (
    <ThemeContext.Provider value={value}>
      <View style={[{ flex: 1 }, themeVariables]}>{children}</View>
    </ThemeContext.Provider>
  );
}

/**
 * Declares the workspace currently being validated. Descendants receive the
 * default palette immediately until their colour binding has the same tenant.
 */
export function TenantBrandingScope({
  checkingWorkspace,
  children,
  tenantId,
}: PropsWithChildren<TenantBrandingScopeValue>) {
  const value = useMemo(
    () => ({ checkingWorkspace, tenantId }),
    [checkingWorkspace, tenantId],
  );
  return (
    <TenantBrandingScopeContext.Provider value={value}>
      {children}
    </TenantBrandingScopeContext.Provider>
  );
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  const scope = useContext(TenantBrandingScopeContext);
  const defaultGetColorsForScheme = useCallback(
    (scheme: ColorScheme) => resolveTenantPalette(scheme, null),
    [],
  );
  const defaultColors = useMemo(
    () => defaultGetColorsForScheme(ctx?.colorScheme ?? "light"),
    [ctx?.colorScheme, defaultGetColorsForScheme],
  );
  if (!ctx) {
    throw new Error("useThemeContext must be used within ThemeProvider");
  }
  const currentTenantBranding =
    scope !== null &&
    !scope.checkingWorkspace &&
    Boolean(scope.tenantId) &&
    scope.tenantId === ctx.tenantBrandTenantId;
  if (!scope || currentTenantBranding) return ctx;
  return {
    ...ctx,
    colors: defaultColors,
    getColorsForScheme: defaultGetColorsForScheme,
  };
}
