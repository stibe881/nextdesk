import { Tabs } from "expo-router";
import { useEffect, useState } from "react";

import { CreateWorkspaceScreen } from "@/components/create-workspace-screen";
import { useMobileFeatures } from "@/components/mobile-feature-gate";
import {
  NextDeskTabBar,
  type NextDeskTabItem,
} from "@/components/nextdesk-tab-bar";
import { PushCheckInPrompt } from "@/components/push-checkin-prompt";
import { canWorkIncidents } from "@/lib/incidents";

export default function TabLayout() {
  const { isEnabled, loading, needsWorkspace, tenantId } = useMobileFeatures();
  // «Störungen» only for people who work on tickets (checked per tenant).
  const [incidentAccess, setIncidentAccess] = useState<{
    tenantId: string;
    allowed: boolean;
  } | null>(null);
  useEffect(() => {
    if (!tenantId) return;
    let active = true;
    void canWorkIncidents(tenantId).then((allowed) => {
      if (active) setIncidentAccess({ tenantId, allowed });
    });
    return () => {
      active = false;
    };
  }, [tenantId]);
  const incidentsVisible =
    Boolean(tenantId) &&
    incidentAccess?.tenantId === tenantId &&
    incidentAccess.allowed;
  const knowledgeVisible = !loading && isEnabled("knowledge.base");
  const scanVisible = !loading && isEnabled("assets.management");
  const shopVisible = !loading && isEnabled("self_service.shop");

  // Links vom Home: Tickets, Störungen, Phishing (Arbeit);
  // rechts: Shop, Wissen, Scan.
  const tabItems: NextDeskTabItem[] = [
    {
      name: "tickets",
      label: "Tickets",
      icon: "ticket-outline",
      activeIcon: "ticket",
      side: "left",
    },
  ];
  if (incidentsVisible) {
    tabItems.push(
      {
        name: "incidents",
        label: "Störungen",
        icon: "pulse-outline",
        activeIcon: "pulse",
        side: "left",
      },
      {
        name: "phishing",
        label: "Phishing",
        icon: "shield-outline",
        activeIcon: "shield",
        side: "left",
      },
    );
  }
  if (shopVisible) {
    tabItems.push({
      name: "shop",
      label: "Shop",
      icon: "bag-handle-outline",
      activeIcon: "bag-handle",
      side: "right",
    });
  }
  if (knowledgeVisible) {
    tabItems.push({
      name: "knowledge",
      label: "Wissen",
      icon: "book-outline",
      activeIcon: "book",
      side: "right",
    });
  }
  if (scanVisible) {
    tabItems.push({
      name: "scan",
      label: "Scan",
      icon: "scan-outline",
      activeIcon: "scan",
      side: "right",
    });
  }

  if (needsWorkspace) return <CreateWorkspaceScreen />;

  return (
    <>
      <Tabs
        initialRouteName="index"
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <NextDeskTabBar {...props} items={tabItems} />}
      >
        <Tabs.Screen name="tickets" options={{ title: "Tickets" }} />
        <Tabs.Screen
          name="incidents"
          options={{
            href: incidentsVisible ? undefined : null,
            title: "Störungen",
          }}
        />
        <Tabs.Screen
          name="phishing"
          options={{
            href: incidentsVisible ? undefined : null,
            title: "Phishing",
          }}
        />
        <Tabs.Screen name="services" options={{ href: null }} />
        <Tabs.Screen name="assets" options={{ href: null }} />
        <Tabs.Screen name="inventory" options={{ href: null }} />
        <Tabs.Screen name="infrastructure" options={{ href: null }} />
        <Tabs.Screen name="priorities" options={{ href: null }} />
        <Tabs.Screen
          name="shop"
          options={{ href: shopVisible ? undefined : null, title: "Shop" }}
        />
        <Tabs.Screen name="index" options={{ title: "Home" }} />
        <Tabs.Screen
          name="knowledge"
          options={{
            href: knowledgeVisible ? undefined : null,
            title: "Wissen",
          }}
        />
        <Tabs.Screen name="knowledge/[id]" options={{ href: null }} />
        <Tabs.Screen name="handbook/[id]" options={{ href: null }} />
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
