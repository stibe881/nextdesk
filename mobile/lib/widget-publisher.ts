import type { WidgetSnapshot } from "@/lib/widget-snapshot";

/**
 * Hands the snapshot to the native widgets. The platform files implement it:
 * widget-publisher.ios.ts (App Group UserDefaults) and
 * widget-publisher.android.tsx (re-render via react-native-android-widget).
 * Web has no widgets.
 */
export async function publishWidgetSnapshot(
  snapshot: WidgetSnapshot | null,
): Promise<void> {
  void snapshot;
}
