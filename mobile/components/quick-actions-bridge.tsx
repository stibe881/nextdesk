import { useRouter, type Href } from "expo-router";
import * as QuickActions from "expo-quick-actions";
import { useEffect, useRef } from "react";
import { Alert, Platform } from "react-native";

import { useMobileFeatures } from "@/components/mobile-feature-gate";
import { QUICK_CREATE, type QuickCreate } from "@/lib/quick-create-actions";

function actionFor(action: QuickActions.Action | null | undefined) {
  if (!action) return null;
  return (
    QUICK_CREATE.find((item) => item.id === action.id) ??
    QUICK_CREATE.find((item) => item.href === action.params?.href) ??
    null
  );
}

/**
 * Publishes the quick actions for the active workspace and opens the chosen
 * form once the workspace is confirmed (the app may start cold).
 *
 * iOS shows static actions from Info.plist (see app.config.ts), so they are
 * there from the first launch on; Android gets them dynamically.
 */
export function QuickActionsBridge() {
  const router = useRouter();
  const { isEnabled, loading, tenantId } = useMobileFeatures();
  const ready = !loading && Boolean(tenantId);
  const pending = useRef<QuickCreate | null>(actionFor(QuickActions.initial));

  const open = (item: QuickCreate) => {
    if (item.feature && !isEnabled(item.feature)) {
      Alert.alert(
        item.title,
        "Diese Funktion ist in deinem Arbeitsbereich nicht freigeschaltet.",
      );
      return;
    }
    router.push(item.href as Href);
  };
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    // Older versions set the iOS actions dynamically; drop them so only the
    // static ones remain.
    if (Platform.OS === "ios")
      void QuickActions.setItems([]).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const items = ready
      ? QUICK_CREATE.filter((item) => !item.feature || isEnabled(item.feature))
      : [];
    void QuickActions.setItems(
      items.map((item) => ({
        id: item.id,
        title: item.title,
        // Android has no SF Symbols; it shows the app icon instead.
        icon: null,
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
      const item = actionFor(action);
      if (!item) return;
      if (ready) openRef.current(item);
      else pending.current = item;
    });
    return () => subscription.remove();
  }, [ready]);

  useEffect(() => {
    if (!ready || !pending.current) return;
    const item = pending.current;
    pending.current = null;
    openRef.current(item);
  }, [ready]);

  return null;
}
