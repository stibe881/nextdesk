import { useEffect } from "react";
import { AppState } from "react-native";

import { flushWidgetSnapshot } from "@/lib/widget-sync";

/**
 * Pushes the latest widget snapshot to the home-screen widgets whenever the
 * app goes to the background, so they show the state the user just saw.
 * The snapshot itself is written where priorities and approvals load.
 */
export function WidgetSnapshotBridge() {
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") void flushWidgetSnapshot();
    });
    return () => subscription.remove();
  }, []);
  return null;
}
