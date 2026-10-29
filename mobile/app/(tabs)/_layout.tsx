import { Tabs } from "expo-router";

import { useMobileFeatures } from "@/components/mobile-feature-gate";
import {
  NextDeskTabBar,
  type NextDeskTabItem,
} from "@/components/nextdesk-tab-bar";
import { PushCheckInPrompt } from "@/components/push-checkin-prompt";

export default function TabLayout() {
  const { isEnabled, loading } = useMobileFeatures();
  const knowledgeVisible = !loading && isEnabled("knowledge.base");
  const scanVisible = !loading && isEnabled("assets.management");

  // Fachliche Reihenfolge ohne Home: Tickets, Services | Home | Wissen, Scan.
  // Die Leiste verteilt die sichtbaren Einträge gleichmässig um das zentrierte Home.
  const tabItems: NextDeskTabItem[] = [
    {
      name: "tickets",
      label: "Tickets",
      icon: "ticket-outline",
      activeIcon: "ticket",
    },
    {
      name: "services",
      label: "Services",
      icon: "cube-outline",
      activeIcon: "cube",
    },
  ];
  if (knowledgeVisible) {
    tabItems.push({
      name: "knowledge",
      label: "Wissen",
      icon: "book-outline",
      activeIcon: "book",
    });
  }
  if (scanVisible) {
    tabItems.push({
      name: "scan",
      label: "Scan",
      icon: "scan-outline",
      activeIcon: "scan",
    });
  }

  return (
    <>
      <Tabs
        initialRouteName="index"
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <NextDeskTabBar {...props} items={tabItems} />}
      >
        <Tabs.Screen name="tickets" options={{ title: "Tickets" }} />
        <Tabs.Screen name="services" options={{ title: "Services" }} />
        <Tabs.Screen name="assets" options={{ href: null }} />
        <Tabs.Screen name="inventory" options={{ href: null }} />
        <Tabs.Screen name="index" options={{ title: "Home" }} />
        <Tabs.Screen
          name="knowledge"
          options={{
            href: knowledgeVisible ? undefined : null,
            title: "Wissen",
          }}
        />
        <Tabs.Screen name="knowledge/[id]" options={{ href: null }} />
        <Tabs.Screen
          name="scan"
          options={{ href: scanVisible ? undefined : null, title: "Scan" }}
        />
        <Tabs.Screen name="settings" options={{ href: null }} />
      </Tabs>
      <PushCheckInPrompt />
    </>
  );
}
