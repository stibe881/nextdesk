import type { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";

import type { useMobileFeatures } from "@/components/mobile-feature-gate";

export type QuickCreate = {
  id: string;
  title: string;
  href: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  feature?: Parameters<ReturnType<typeof useMobileFeatures>["isEnabled"]>[0];
};

/**
 * Create actions behind a long press on the Home tab (and the app icon),
 * like the "+" menu of the web app. Keep the ids in sync with the static iOS
 * quick actions in app.config.ts.
 */
export const QUICK_CREATE: readonly QuickCreate[] = [
  {
    id: "follow-up",
    title: "Wiedervorlage erfassen",
    href: "/create/follow-up",
    icon: "alarm-outline",
    feature: "experience.workspace",
  },
  {
    id: "ticket",
    title: "Ticket erfassen",
    href: "/ticket/new",
    icon: "chatbox-ellipses-outline",
  },
  {
    id: "service-task",
    title: "Serviceaufgabe erfassen",
    href: "/create/service-task",
    icon: "checkbox-outline",
    feature: "service.tasks",
  },
  {
    id: "inventory-item",
    title: "Lagerartikel erfassen",
    href: "/create/inventory-item",
    icon: "cube-outline",
    feature: "inventory.management",
  },
];
