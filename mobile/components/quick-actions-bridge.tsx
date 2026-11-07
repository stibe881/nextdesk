import { useRouter, type Href } from "expo-router";
import * as QuickActions from "expo-quick-actions";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { useMobileFeatures } from "@/components/mobile-feature-gate";

type QuickCreate = {
  id: string;
  title: string;
  href: string;
  iosIcon: string;
  feature?: Parameters<ReturnType<typeof useMobileFeatures>["isEnabled"]>[0];
};

/** Long-press actions on the app icon, like the "+" menu of the web app. */
const QUICK_CREATE: readonly QuickCreate[] = [
  {
    id: "follow-up",
    title: "Wiedervorlage erfassen",
    href: "/create/follow-up",
    iosIcon: "symbol:calendar.badge.clock",
    feature: "experience.workspace",
  },
  {
    id: "ticket",
    title: "Ticket erfassen",
    href: "/ticket/new",
    iosIcon: "symbol:plus.bubble",
  },
  {
    id: "service-task",
    title: "Serviceaufgabe erfassen",
    href: "/create/service-task",
    iosIcon: "symbol:checklist",
    feature: "service.tasks",
  },
  {
    id: "inventory-item",
    title: "Lagerartikel erfassen",
    href: "/create/inventory-item",
    iosIcon: "symbol:shippingbox",
    feature: "inventory.management",
  },
];

/**
 * Publishes the quick actions for the active workspace and opens the chosen
 * form once the workspace is confirmed (the app may start cold).
 */
export function QuickActionsBridge() {
  const router = useRouter();
  const { isEnabled, loading, tenantId } = useMobileFeatures();
  const ready = !loading && Boolean(tenantId);
  const pending = useRef<string | null>(
    typeof QuickActions.initial?.params?.href === "string"
      ? QuickActions.initial.params.href
      : null,
  );

  useEffect(() => {
    if (Platform.OS === "web") return;
    const items = ready
      ? QUICK_CREATE.filter((item) => !item.feature || isEnabled(item.feature))
      : [];
    void QuickActions.setItems(
      items.map((item) => ({
        id: item.id,
        title: item.title,
        // Android has no SF Symbols; it shows the app icon instead.
        icon: Platform.OS === "ios" ? item.iosIcon : null,
        params: { href: item.href },
      })),
    ).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready,
    tenantId,
    isEnabled("experience.workspace"),
    isEnabled("service.tasks"),
    isEnabled("inventory.management"),
  ]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = QuickActions.addListener((action) => {
      if (typeof action.params?.href === "string") {
        pending.current = action.params.href;
        if (ready) {
          const href = pending.current;
          pending.current = null;
          router.push(href as Href);
        }
      }
    });
    return () => subscription.remove();
  }, [ready, router]);

  useEffect(() => {
    if (!ready || !pending.current) return;
    const href = pending.current;
    pending.current = null;
    router.push(href as Href);
  }, [ready, router]);

  return null;
}
