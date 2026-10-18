import "@/global.css";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { Platform } from "react-native";
import "@/lib/_core/nativewind-pressable";
import { ThemeProvider } from "@/lib/theme-provider";
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import type { EdgeInsets, Metrics, Rect } from "react-native-safe-area-context";

import { trpc, createTRPCClient } from "@/lib/trpc";
import { DeviceProtection } from "@/components/device-protection";
import {
  MobileNetworkStatusProvider,
  OfflineStatus,
} from "@/components/offline-status";
import {
  initManusRuntime,
  subscribeSafeAreaInsets,
} from "@/lib/_core/manus-runtime";
import {
  clearMobilePrivateState,
  prepareMobileUserContext,
} from "@/lib/mobile-private-state";
import {
  completeNextDeskAuth,
  isNextDeskAuthCallback,
  nextDesk,
  nextDeskAuthFailureCode,
} from "@/lib/nextdesk-client";

const DEFAULT_WEB_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_WEB_FRAME: Rect = { x: 0, y: 0, width: 0, height: 0 };

export const unstable_settings = {
  anchor: "(tabs)",
};

function NextDeskAuthDeepLinkHandler() {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    const handleUrl = (url: string | null) => {
      if (!url || !isNextDeskAuthCallback(url)) return;
      void completeNextDeskAuth(url).catch((error) => {
        if (active) {
          router.replace({
            pathname: "/auth",
            params: { authError: nextDeskAuthFailureCode(error) },
          });
        }
      });
    };
    const subscription = Linking.addEventListener("url", ({ url }) => {
      handleUrl(url);
    });
    void Linking.getInitialURL().then(handleUrl);
    return () => {
      active = false;
      subscription.remove();
    };
  }, [router]);

  return null;
}

function NextDeskSessionNavigator() {
  const router = useRouter();
  const segments = useSegments();
  const queryClient = useQueryClient();
  const topLevelRoute = segments[0] ?? "";

  useEffect(() => {
    let active = true;
    const leaveWorkspace = () => {
      queryClient.clear();
      void clearMobilePrivateState();
      if (topLevelRoute !== "auth") {
        router.replace("/auth");
      }
    };

    if (!nextDesk) {
      leaveWorkspace();
      return () => {
        active = false;
      };
    }

    const continueToWorkspace = (userId: string | undefined) => {
      if (!userId) return;
      void prepareMobileUserContext(userId);
      if (topLevelRoute === "auth") {
        // Route groups are an implementation detail on Expo Web. Navigating to
        // the public root keeps native and browser callbacks on one reliable
        // post-login destination.
        router.replace("/");
      }
    };

    void nextDesk.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        if (data.session?.user.id) continueToWorkspace(data.session.user.id);
        else leaveWorkspace();
      })
      .catch(() => {
        if (active) leaveWorkspace();
      });
    const {
      data: { subscription },
    } = nextDesk.auth.onAuthStateChange((event, session) => {
      if (
        session &&
        (event === "INITIAL_SESSION" ||
          event === "SIGNED_IN" ||
          event === "PASSWORD_RECOVERY")
      ) {
        continueToWorkspace(session.user.id);
      } else if (event === "SIGNED_OUT") {
        leaveWorkspace();
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [queryClient, router, topLevelRoute]);

  return null;
}

export default function RootLayout() {
  const initialInsets = initialWindowMetrics?.insets ?? DEFAULT_WEB_INSETS;
  const initialFrame = initialWindowMetrics?.frame ?? DEFAULT_WEB_FRAME;

  const [insets, setInsets] = useState<EdgeInsets>(initialInsets);
  const [frame, setFrame] = useState<Rect>(initialFrame);

  // Initialize Manus runtime for cookie injection from parent container
  useEffect(() => {
    initManusRuntime();
  }, []);

  const handleSafeAreaUpdate = useCallback((metrics: Metrics) => {
    setInsets(metrics.insets);
    setFrame(metrics.frame);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const unsubscribe = subscribeSafeAreaInsets(handleSafeAreaUpdate);
    return () => unsubscribe();
  }, [handleSafeAreaUpdate]);

  // Create clients once and reuse them
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Disable automatic refetching on window focus for mobile
            refetchOnWindowFocus: false,
            // Retry failed requests once
            retry: 1,
          },
        },
      }),
  );
  const [trpcClient] = useState(() => createTRPCClient());

  // Ensure minimum 8px padding for top and bottom on mobile
  const providerInitialMetrics = useMemo(() => {
    const metrics = initialWindowMetrics ?? {
      insets: initialInsets,
      frame: initialFrame,
    };
    return {
      ...metrics,
      insets: {
        ...metrics.insets,
        top: Math.max(metrics.insets.top, 16),
        bottom: Math.max(metrics.insets.bottom, 12),
      },
    };
  }, [initialInsets, initialFrame]);

  const content = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <MobileNetworkStatusProvider>
            {/* Default to hiding native headers so raw route segments don't appear (e.g. "(tabs)", "products/[id]"). */}
            {/* If a screen needs the native header, explicitly enable it and set a human title via Stack.Screen options. */}
            {/* in order for ios apps tab switching to work properly, use presentation: "fullScreenModal" for login page, whenever you decide to use presentation: "modal*/}
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="auth" />
              <Stack.Screen name="auth/callback" />
            </Stack>
            <NextDeskAuthDeepLinkHandler />
            <NextDeskSessionNavigator />
            <OfflineStatus />
            <DeviceProtection />
            <StatusBar style="auto" />
          </MobileNetworkStatusProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </GestureHandlerRootView>
  );

  const shouldOverrideSafeArea = Platform.OS === "web";

  if (shouldOverrideSafeArea) {
    return (
      <ThemeProvider>
        <SafeAreaProvider initialMetrics={providerInitialMetrics}>
          <SafeAreaFrameContext.Provider value={frame}>
            <SafeAreaInsetsContext.Provider value={insets}>
              {content}
            </SafeAreaInsetsContext.Provider>
          </SafeAreaFrameContext.Provider>
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <SafeAreaProvider initialMetrics={providerInitialMetrics}>
        {content}
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
