import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import { Platform } from "react-native";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === "web" ? 12 : Math.max(insets.bottom, 8);
  const tabBarHeight = 56 + bottomPadding;

  return (
    <Tabs
      initialRouteName="index"
      screenOptions={{
        tabBarActiveTintColor: "#4438CA",
        tabBarInactiveTintColor: "#68677A",
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          paddingTop: 8,
          paddingBottom: bottomPadding,
          height: tabBarHeight,
          backgroundColor: "#FFFFFF",
          borderTopColor: "#E4E3EE",
          borderTopWidth: 0.5,
          shadowColor: "#202136",
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
      <Tabs.Screen
        name="scan"
        options={{
          title: "Scan",
          tabBarIcon: ({ color }) => (
            <Ionicons color={color} name="scan-outline" size={23} />
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
          title: "Wissen",
          tabBarIcon: ({ color }) => (
            <Ionicons color={color} name="book-outline" size={23} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Einstellungen",
          tabBarIcon: ({ color }) => (
            <Ionicons color={color} name="settings-outline" size={23} />
          ),
        }}
      />
    </Tabs>
  );
}
