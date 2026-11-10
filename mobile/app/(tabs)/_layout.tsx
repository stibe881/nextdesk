import { Tabs } from "expo-router";
import { useEffect, useState } from "react";

import { CreateWorkspaceScreen } from "@/components/create-workspace-screen";
import { useMobileFeatures } from "@/components/mobile-feature-gate";
import {
  NextDeskTabBar,
  type NextDeskTabItem,
} from "@/components/nextdesk-tab-bar";
import { PushCheckInPrompt } from "@/components/push-checkin-prompt";
import { canWorkIncidents, canWorkSecurityCases } from "@/lib/incidents";

export default function TabLayout() {
  const { isEnabled, loading, needsWorkspace, tenantId } = useMobileFeatures();
  // «Störungen» and «Phishing» only for the responsible team (per tenant).
  const [moduleAccess, setModuleAccess] = useState<{
    tenantId: string;
    incidents: boolean;
    phishing: boolean;
  } | null>(null);
  useEffect(() => {
    if (!tenantId) return;
    let active = true;
    void Promise.all([
      canWorkIncidents(tenantId),
      canWorkSecurityCases(tenantId),
    ]).then(([incidents, phishing]) => {
      if (active) setModuleAccess({ tenantId, incidents, phishing });
    });
    return () => {
      active = false;
    };
  }, [tenantId]);
  const currentAccess =
    tenantId && moduleAccess?.tenantId === tenantId ? moduleAccess : null;
  const incidentsVisible = currentAccess?.incidents === true;
  const phishingVisible = currentAccess?.phishing === true;
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
    tabItems.push({
      name: "incidents",
      label: "Störungen",
      icon: "pulse-outline",
      activeIcon: "pulse",
      side: "left",
    });
  }
  if (phishingVisible) {
    tabItems.push({
      name: "phishing",
      label: "Phishing",
      icon: "shield-outline",
      activeIcon: "shield",
      side: "left",
    });
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
            href: phishingVisible ? undefined : null,
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
