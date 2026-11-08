import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import type { PriorityList } from "@/lib/my-priorities";
import { publishWidgetSnapshot } from "@/lib/widget-publisher";
import {
  mergeWidgetSnapshot,
  parseWidgetSnapshot,
  WIDGET_SNAPSHOT_STORAGE_KEY,
  type WidgetSnapshot,
  type WidgetSnapshotUpdate,
} from "@/lib/widget-snapshot";

/**
 * App side of the home-screen widgets: keeps the token-free snapshot in
 * AsyncStorage (the Android widget reads it there in its headless task) and
 * hands it to the platform publisher (iOS: App Group UserDefaults).
 */
const enabled = Platform.OS === "ios" || Platform.OS === "android";
let queue: Promise<void> = Promise.resolve();

/** Runs storage changes one after another so partial updates do not race. */
function enqueue(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task).catch(() => {
    // Widgets are best effort; the app must never fail because of them.
  });
  return queue;
}

export async function readWidgetSnapshot(): Promise<WidgetSnapshot | null> {
  try {
    return parseWidgetSnapshot(
      await AsyncStorage.getItem(WIDGET_SNAPSHOT_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

function update(change: WidgetSnapshotUpdate): Promise<void> {
  if (!enabled || !change.tenantId) return Promise.resolve();
  return enqueue(async () => {
    const next = mergeWidgetSnapshot(
      await readWidgetSnapshot(),
      change,
      new Date(),
    );
    await AsyncStorage.setItem(
      WIDGET_SNAPSHOT_STORAGE_KEY,
      JSON.stringify(next),
    );
    await publishWidgetSnapshot(next);
  });
}

/** Call whenever «Meine Prioritäten» was loaded or changed. */
export function recordWidgetPriorities(
  tenantId: string,
  list: PriorityList,
): Promise<void> {
  return update({ tenantId, priorities: list });
}

/** Call whenever the approval inbox was loaded or changed. */
export function recordWidgetApprovals(
  tenantId: string,
  count: number,
): Promise<void> {
  return update({ tenantId, approvals: count });
}

/** Pushes the stored snapshot to the widgets again (e.g. on app background). */
export function flushWidgetSnapshot(): Promise<void> {
  if (!enabled) return Promise.resolve();
  return enqueue(async () => {
    await publishWidgetSnapshot(await readWidgetSnapshot());
  });
}

/** Removes everything the widgets show, e.g. on sign-out. */
export function clearWidgetSnapshot(): Promise<void> {
  if (!enabled) return Promise.resolve();
  return enqueue(async () => {
    await AsyncStorage.removeItem(WIDGET_SNAPSHOT_STORAGE_KEY);
    await publishWidgetSnapshot(null);
  });
}
