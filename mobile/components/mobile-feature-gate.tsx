import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  Text,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { acceptPendingInvitations, hasActiveMembership } from "@/lib/account";
import {
  loadMobileFeatureFlags,
  type MobileFeatureFlags,
  type MobileFeatureKey,
} from "@/lib/mobile-features";
import {
  isNextDeskConfigured,
  loadCurrentTenant,
  MobileTenantSelectionChangedError,
  nextDesk,
  selectMobileTenant,
  subscribeMobileTenantContextInvalidation,
  type MobileTenant,
} from "@/lib/nextdesk-client";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

type MobileFeatureState = {
  error: string | null;
  flags: MobileFeatureFlags | null;
  lastConfirmedTenantId: string | null;
  loading: boolean;
  /** Signed in, but not yet a member of any workspace. */
  needsWorkspace: boolean;
  refresh: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<MobileTenant>;
  switchingTenant: boolean;
  tenantId: string | null;
};

const MobileFeatureContext = createContext<MobileFeatureState>({
  error: null,
  flags: null,
  lastConfirmedTenantId: null,
  loading: true,
  needsWorkspace: false,
  refresh: async () => undefined,
  switchTenant: async () => {
    throw new Error("Der Arbeitsbereich kann derzeit nicht gewechselt werden.");
  },
  switchingTenant: false,
  tenantId: null,
});

export function MobileFeatureProvider({ children }: PropsWithChildren) {
  const [flags, setFlags] = useState<MobileFeatureFlags | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [lastConfirmedTenantId, setLastConfirmedTenantId] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switchingTenant, setSwitchingTenant] = useState(false);
  const [needsWorkspace, setNeedsWorkspace] = useState(false);
  const refreshRequest = useRef(0);
  // Zuletzt vollständig bestätigter Arbeitsbereich, für stille Aktualisierungen.
  const confirmedTenant = useRef<{ at: number; id: string } | null>(null);
  const tenantSwitchInFlight = useRef(false);

  /**
   * Aktualisiert Mandant und Freigaben. Eine stille Aktualisierung (z. B. beim
   * Zurückkehren in die App) lässt den zuletzt bestätigten Stand sichtbar, bis
   * die neue Antwort vorliegt. Weicht sie ab oder schlägt sie fehl, wird der
   * Arbeitsbereich wie bisher sofort gesperrt.
   */
  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    const silent =
      options?.silent === true &&
      confirmedTenant.current !== null &&
      Date.now() - confirmedTenant.current.at < 10 * 60 * 1000;
    if (tenantSwitchInFlight.current) return;
    const requestId = refreshRequest.current + 1;
    refreshRequest.current = requestId;
    const stillCurrent = () => refreshRequest.current === requestId;
    if (!isNextDeskConfigured || !nextDesk) {
      if (!stillCurrent()) return;
      setFlags(null);
      setTenantId(null);
      setError("Die mobile nextDesk-Verbindung ist nicht konfiguriert.");
      setLoading(false);
      return;
    }

    // Ohne eine frisch bestätigte Kombination aus Mandant und Freigaben darf
    // kein zuvor geladener Mandantenkontext sichtbar bleiben – auch nicht,
    // während die Session noch abgefragt wird.
    if (!stillCurrent()) return;
    if (!silent) {
      setLoading(true);
      setFlags(null);
      setTenantId(null);
      setError(null);
    }
    try {
      const {
        data: { session },
      } = await nextDesk.auth.getSession();
      if (!stillCurrent()) return;
      if (!session?.user.id) return;
      // Self-registered people start without a workspace. Open invitations are
      // activated first; otherwise the app offers to create a workspace.
      if (!(await hasActiveMembership())) {
        const accepted = await acceptPendingInvitations();
        if (!stillCurrent()) return;
        if (accepted === 0 || !(await hasActiveMembership())) {
          if (!stillCurrent()) return;
          confirmedTenant.current = null;
          setFlags(null);
          setTenantId(null);
          setError(null);
          setNeedsWorkspace(true);
          return;
        }
      }
      if (!stillCurrent()) return;
      setNeedsWorkspace(false);
      let tenant: MobileTenant | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          tenant = await loadCurrentTenant({ allowInitialSelection: true });
          break;
        } catch (nextError) {
          if (
            nextError instanceof MobileTenantSelectionChangedError &&
            attempt === 0 &&
            stillCurrent()
          ) {
            continue;
          }
          throw nextError;
        }
      }
      if (!tenant) {
        throw new Error("Der Arbeitsbereich konnte nicht bestätigt werden.");
      }
      if (!stillCurrent()) return;
      const nextFlags = await loadMobileFeatureFlags(tenant.id);
      if (!stillCurrent()) return;
      if (silent && confirmedTenant.current?.id !== tenant.id) {
        // Anderer Arbeitsbereich als bisher: erst nach neuer Bestätigung zeigen.
        setFlags(null);
        setTenantId(null);
      }
      confirmedTenant.current = { at: Date.now(), id: tenant.id };
      setTenantId(tenant.id);
      setFlags(nextFlags);
      setLastConfirmedTenantId(tenant.id);
    } catch (nextError) {
      if (!stillCurrent()) return;
      confirmedTenant.current = null;
      setFlags(null);
      setTenantId(null);
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Der Arbeitsbereich konnte nicht geprüft werden.",
      );
    } finally {
      if (stillCurrent()) setLoading(false);
    }
  }, []);

  const switchTenant = useCallback(async (targetTenantId: string) => {
    if (tenantSwitchInFlight.current) {
      throw new Error("Ein Arbeitsbereichswechsel wird bereits verarbeitet.");
    }
    tenantSwitchInFlight.current = true;
    setSwitchingTenant(true);
    const requestId = refreshRequest.current + 1;
    refreshRequest.current = requestId;
    const stillCurrent = () => refreshRequest.current === requestId;

    // Bereits vor dem Schreiben der Auswahl wird der bisherige Kontext
    // verborgen. Nur der vollständig bestätigte neue Mandant wird danach
    // freigegeben.
    setLoading(true);
    setFlags(null);
    setTenantId(null);
    setError(null);
    try {
      const tenant = await selectMobileTenant(targetTenantId);
      if (!stillCurrent())
        throw new Error("Der Arbeitsbereichswechsel wurde abgebrochen.");
      const nextFlags = await loadMobileFeatureFlags(tenant.id);
      if (!stillCurrent())
        throw new Error("Der Arbeitsbereichswechsel wurde abgebrochen.");
      confirmedTenant.current = { at: Date.now(), id: tenant.id };
      setTenantId(tenant.id);
      setFlags(nextFlags);
      setLastConfirmedTenantId(tenant.id);
      return tenant;
    } catch (nextError) {
      if (stillCurrent()) {
        setFlags(null);
        setTenantId(null);
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Der Arbeitsbereich konnte nicht gewechselt werden.",
        );
      }
      throw nextError;
    } finally {
      if (stillCurrent()) setLoading(false);
      tenantSwitchInFlight.current = false;
      setSwitchingTenant(false);
    }
  }, []);

  useEffect(() => {
    return subscribeMobileTenantContextInvalidation((message) => {
      // Eine Datenabfrage hat eine nicht mehr zulässige gespeicherte Auswahl
      // erkannt. Der gesamte Arbeitsbereich wird sofort fail-closed gesperrt.
      refreshRequest.current += 1;
      confirmedTenant.current = null;
      setFlags(null);
      setTenantId(null);
      setError(message);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    let active = true;
    const refreshTimer = setTimeout(() => {
      if (active) void refresh().catch(() => undefined);
    }, 0);
    if (!nextDesk) {
      return () => {
        active = false;
        clearTimeout(refreshTimer);
      };
    }
    const {
      data: { subscription },
    } = nextDesk.auth.onAuthStateChange((event) => {
      if (!active) return;
      if (event === "SIGNED_OUT") {
        refreshRequest.current += 1;
        setNeedsWorkspace(false);
        setFlags(null);
        setTenantId(null);
        setLastConfirmedTenantId(null);
        confirmedTenant.current = null;
        setError(null);
        setLoading(false);
        return;
      }
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
        void refresh().catch(() => undefined);
      }
    });
    const appStateSubscription = AppState.addEventListener(
      "change",
      (state) => {
        if (active && state === "active") {
          void refresh({ silent: true }).catch(() => undefined);
        }
      },
    );
    return () => {
      active = false;
      clearTimeout(refreshTimer);
      subscription.unsubscribe();
      appStateSubscription.remove();
    };
  }, [refresh]);

  const value = useMemo(
    () => ({
      error,
      flags,
      lastConfirmedTenantId,
      loading,
      needsWorkspace,
      refresh,
      switchTenant,
      switchingTenant,
      tenantId,
    }),
    [
      error,
      flags,
      lastConfirmedTenantId,
      loading,
      needsWorkspace,
      refresh,
      switchTenant,
      switchingTenant,
      tenantId,
    ],
  );
  return (
    <MobileFeatureContext.Provider value={value}>
      {children}
    </MobileFeatureContext.Provider>
  );
}

export function useMobileFeatures() {
  const state = useContext(MobileFeatureContext);
  return {
    ...state,
    isEnabled: (feature: MobileFeatureKey) => state.flags?.[feature] === true,
  };
}

export function MobileFeatureLoadingScreen() {
  const styles = useStyles();
  const colors = useAppColors();

  return (
    <ScreenContainer className="px-5">
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingText}>
          Funktionsfreigaben werden geprüft …
        </Text>
      </View>
    </ScreenContainer>
  );
}

export function MobileFeatureUnavailableScreen({
  feature,
  title,
}: {
  feature: MobileFeatureKey;
  title: string;
}) {
  const router = useRouter();
  const styles = useStyles();
  const colors = useAppColors();
  const { error, refresh } = useMobileFeatures();
  const featureName =
    feature === "assets.management"
      ? "Asset-Management"
      : feature === "knowledge.base"
        ? "Wissensdatenbank"
        : "Ticketdetail";
  return (
    <ScreenContainer className="px-5">
      <View style={styles.centered}>
        <View style={styles.icon}>
          <Ionicons
            color={colors.primaryText}
            name="lock-closed-outline"
            size={26}
          />
        </View>
        <Text style={styles.title}>{title} ist nicht verfügbar</Text>
        <Text style={styles.copy}>
          {error
            ? "Die Freigabe konnte nicht bestätigt werden. Der Zugriff bleibt vorsorglich gesperrt."
            : `${featureName} ist für diesen Mandanten derzeit nicht freigeschaltet.`}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void refresh()}
          style={styles.retry}
        >
          <Text style={styles.retryText}>Freigabe erneut prüfen</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/")}
          style={styles.back}
        >
          <Text style={styles.backText}>Zur Übersicht</Text>
        </Pressable>
      </View>
    </ScreenContainer>
  );
}

const useStyles = makeThemedStyles((c) => ({
  back: { alignItems: "center", minHeight: 38, paddingHorizontal: 12 },
  backText: { color: c.primaryText, fontSize: 13, fontWeight: "800" },
  centered: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 26,
  },
  copy: {
    color: c.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    textAlign: "center",
  },
  icon: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 22,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  loadingText: { color: c.muted, fontSize: 13, marginTop: 12 },
  retry: {
    backgroundColor: c.primary,
    borderRadius: 14,
    marginTop: 21,
    minHeight: 45,
    justifyContent: "center",
    paddingHorizontal: 17,
  },
  retryText: { color: c.onPrimary, fontSize: 13, fontWeight: "900" },
  title: {
    color: c.foreground,
    fontSize: 20,
    fontWeight: "900",
    marginTop: 16,
    textAlign: "center",
  },
}));
