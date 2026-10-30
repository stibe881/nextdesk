import { Stack, useSegments } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useMobileFeatures } from "@/components/mobile-feature-gate";
import { ScreenContainer } from "@/components/screen-container";
import { useAppColors } from "@/lib/themed-styles";

function WorkspaceGate({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  const colors = useAppColors();

  return (
    <ScreenContainer
      containerClassName="bg-background"
      className="px-5"
      style={{ backgroundColor: colors.background }}
    >
      <View accessibilityLiveRegion="polite" style={styles.gateContent}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.gateText, { color: colors.muted }]}>
          {error
            ? "Der Arbeitsbereich konnte nicht sicher bestätigt werden."
            : "nextDesk wird geladen …"}
        </Text>
        {error ? (
          <Text style={[styles.gateDetail, { color: colors.subtle }]}>
            {error}
          </Text>
        ) : null}
        {error ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={[styles.retry, { borderColor: colors.primarySoftBorder }]}
          >
            <Text style={[styles.retryText, { color: colors.primaryText }]}>
              Erneut versuchen
            </Text>
          </Pressable>
        ) : null}
      </View>
    </ScreenContainer>
  );
}

function RouteStack({ routeKey }: { routeKey: string }) {
  return (
    <Stack key={routeKey} screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      {/* No transition for sign-in screens: a still-animating native screen
          can report stale tap positions on iOS. */}
      <Stack.Screen
        name="auth"
        options={{ animation: "none", gestureEnabled: false }}
      />
      <Stack.Screen
        name="auth/callback"
        options={{ animation: "none", gestureEnabled: false }}
      />
    </Stack>
  );
}

/**
 * Sperrt den gesamten Arbeitsbereich, bis Mandant und Funktionsfreigaben
 * gemeinsam bestätigt sind. Bei Wechsel auf einen anderen Mandanten erhält
 * der geschützte Routenbaum einen neuen Schlüssel. Bei Revalidierung desselben
 * Mandanten wird der Inhalt nur verdeckt, damit lokale Entwürfe erhalten bleiben.
 */
export function TenantBoundRouteStack() {
  const { error, lastConfirmedTenantId, loading, refresh, tenantId } =
    useMobileFeatures();
  const segments = useSegments();
  const isAuthRoute = segments[0] === "auth";
  const workspaceReady = !loading && Boolean(tenantId);
  const routeTenantId = tenantId ?? lastConfirmedTenantId;
  // Expo Router must retain a mounted navigator while the session navigator
  // redirects an unauthenticated launch to /auth. Returning only the gate
  // here removed that navigator and could make native navigation re-render
  // recursively. The workspace stays fail-closed through the overlay instead.
  const blocked = !isAuthRoute && (!workspaceReady || !routeTenantId);
  const routeKey = isAuthRoute
    ? "auth"
    : routeTenantId
      ? `tenant-${routeTenantId}`
      : "workspace-pending";
  return (
    <View style={styles.root}>
      <View
        accessibilityElementsHidden={blocked}
        importantForAccessibility={blocked ? "no-hide-descendants" : "auto"}
        pointerEvents={blocked ? "none" : "auto"}
        style={styles.workspace}
      >
        <RouteStack routeKey={routeKey} />
      </View>
      {blocked ? (
        <View style={styles.overlay}>
          <WorkspaceGate error={error} onRetry={() => void refresh()} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gateContent: {
    alignItems: "center",
    flex: 1,
    gap: 14,
    justifyContent: "center",
  },
  gateDetail: { fontSize: 12, textAlign: "center" },
  gateText: { fontSize: 14, textAlign: "center" },
  overlay: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 10,
  },
  retry: {
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 14,
  },
  retryText: { fontSize: 13, fontWeight: "800" },
  root: { flex: 1 },
  workspace: { flex: 1 },
});
