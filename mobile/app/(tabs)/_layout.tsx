import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import { useMobileFeatures } from "@/components/mobile-feature-gate";
import { PushCheckInPrompt } from "@/components/push-checkin-prompt";
import { useAppColors } from "@/lib/themed-styles";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const colors = useAppColors();
  const { isEnabled, loading } = useMobileFeatures();
  const bottomPadding = Platform.OS === "web" ? 12 : Math.max(insets.bottom, 8);
  const tabBarHeight = 56 + bottomPadding;

  return (
    <>
      <Tabs
        initialRouteName="index"
        screenOptions={{
          tabBarActiveTintColor: colors.primaryText,
          tabBarInactiveTintColor: colors.muted,
          headerShown: false,
          tabBarButton: HapticTab,
          tabBarStyle: {
            paddingTop: 8,
            paddingBottom: bottomPadding,
            height: tabBarHeight,
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            borderTopWidth: 0.5,
            shadowColor: colors.shadow,
            shadowOffset: { width: 0, height: -3 },
            shadowOpacity: 0.07,
            shadowRadius: 12,
            elevation: 10,
          },
          tabBarItemStyle: { paddingHorizontal: 0 },
          tabBarLabelStyle: { fontSize: 10, fontWeight: "800", marginTop: 1 },
        }}
      >
        <Tabs.Screen
          name="tickets"
          options={{
            title: "Tickets",
            tabBarIcon: ({ color }) => (
              <Ionicons color={color} name="ticket-outline" size={23} />
            ),
          }}
        />
        <Tabs.Screen
          name="services"
          options={{
            title: "Services",
            tabBarIcon: ({ color }) => (
              <Ionicons color={color} name="cube-outline" size={23} />
            ),
          }}
        />
        <Tabs.Screen name="assets" options={{ href: null }} />
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            tabBarIcon: ({ color }) => (
              <Ionicons color={color} name="home-outline" size={23} />
            ),
          }}
        />
        <Tabs.Screen
          name="knowledge"
          options={{
            href: loading || !isEnabled("knowledge.base") ? null : undefined,
            title: "Wissen",
            tabBarIcon: ({ color }) => (
              <Ionicons color={color} name="book-outline" size={23} />
            ),
          }}
        />
        <Tabs.Screen name="knowledge/[id]" options={{ href: null }} />
        <Tabs.Screen
          name="scan"
          options={{
            href: loading || !isEnabled("assets.management") ? null : undefined,
            title: "Scan",
            tabBarIcon: ({ color }) => (
              <Ionicons color={color} name="scan-outline" size={23} />
            ),
          }}
        />
        <Tabs.Screen name="settings" options={{ href: null }} />
      </Tabs>
      <PushCheckInPrompt />
    </>
  );
}
