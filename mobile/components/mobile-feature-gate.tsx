import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import {
  loadMobileFeatureFlags,
  type MobileFeatureFlags,
  type MobileFeatureKey,
} from "@/lib/mobile-features";
import {
  isNextDeskConfigured,
  loadCurrentTenant,
  nextDesk,
} from "@/lib/nextdesk-client";

type MobileFeatureState = {
  error: string | null;
  flags: MobileFeatureFlags | null;
  loading: boolean;
  refresh: () => Promise<void>;
  tenantId: string | null;
};

const MobileFeatureContext = createContext<MobileFeatureState>({
  error: null,
  flags: null,
  loading: true,
  refresh: async () => undefined,
  tenantId: null,
});

export function MobileFeatureProvider({ children }: PropsWithChildren) {
  const [flags, setFlags] = useState<MobileFeatureFlags | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isNextDeskConfigured || !nextDesk) {
      setFlags(null);
      setTenantId(null);
      setError("Die mobile nextDesk-Verbindung ist nicht konfiguriert.");
      setLoading(false);
      return;
    }

    const {
      data: { session },
    } = await nextDesk.auth.getSession();
    if (!session?.user.id) {
      setFlags(null);
      setTenantId(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const tenant = await loadCurrentTenant();
      const nextFlags = await loadMobileFeatureFlags(tenant.id);
      setTenantId(tenant.id);
      setFlags(nextFlags);
    } catch (nextError) {
      setFlags(null);
      setTenantId(null);
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Funktionsfreigaben konnten nicht geprüft werden.",
      );
    } finally {
      setLoading(false);
    }
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
        setFlags(null);
        setTenantId(null);
        setError(null);
        setLoading(false);
        return;
      }
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
        void refresh().catch(() => undefined);
      }
    });
    return () => {
      active = false;
      clearTimeout(refreshTimer);
      subscription.unsubscribe();
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ error, flags, loading, refresh, tenantId }),
    [error, flags, loading, refresh, tenantId],
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
  return (
    <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
      <View style={styles.centered}>
        <ActivityIndicator color="#4438CA" size="large" />
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
  const { error, refresh } = useMobileFeatures();
  const featureName =
    feature === "assets.management"
      ? "Asset-Management"
      : feature === "knowledge.base"
        ? "Wissensdatenbank"
        : "Ticketdetail";
  return (
    <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
      <View style={styles.centered}>
        <View style={styles.icon}>
          <Ionicons color="#4438CA" name="lock-closed-outline" size={26} />
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

const styles = StyleSheet.create({
  back: { alignItems: "center", minHeight: 38, paddingHorizontal: 12 },
  backText: { color: "#4438CA", fontSize: 13, fontWeight: "800" },
  centered: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 26,
  },
  copy: {
    color: "#626376",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    textAlign: "center",
  },
  icon: {
    alignItems: "center",
    backgroundColor: "#EEECFF",
    borderRadius: 22,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  loadingText: { color: "#77758C", fontSize: 13, marginTop: 12 },
  retry: {
    backgroundColor: "#4438CA",
    borderRadius: 14,
    marginTop: 21,
    minHeight: 45,
    justifyContent: "center",
    paddingHorizontal: 17,
  },
  retryText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  title: {
    color: "#202136",
    fontSize: 20,
    fontWeight: "900",
    marginTop: 16,
    textAlign: "center",
  },
});
