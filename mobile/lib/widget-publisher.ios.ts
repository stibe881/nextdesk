import { ExtensionStorage } from "@bacons/apple-targets";

import type { WidgetSnapshot } from "@/lib/widget-snapshot";

/** Must match ios.entitlements in app.config.ts (mirrored into targets/widget). */
export const IOS_WIDGET_APP_GROUP = "group.ch.grossict.nextdesk";
/** UserDefaults key read by targets/widget/Snapshot.swift. */
const SNAPSHOT_KEY = "widgetSnapshot";

const storage = new ExtensionStorage(IOS_WIDGET_APP_GROUP);

export async function publishWidgetSnapshot(
  snapshot: WidgetSnapshot | null,
): Promise<void> {
  if (snapshot) storage.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
  else storage.remove(SNAPSHOT_KEY);
  // Without a name every widget kind of the app reloads its timeline.
  ExtensionStorage.reloadWidget();
}
