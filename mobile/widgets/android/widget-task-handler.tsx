"use no memo";

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { WidgetTaskHandlerProps } from "react-native-android-widget";

import {
  parseWidgetSnapshot,
  WIDGET_SNAPSHOT_STORAGE_KEY,
} from "@/lib/widget-snapshot";
import { renderNextDeskWidget } from "@/widgets/android/nextdesk-widgets";

/**
 * Headless task of react-native-android-widget. It runs without the UI and
 * without a user session, so it only renders the snapshot that the app wrote
 * into AsyncStorage. Clicks use OPEN_URI and never reach this handler.
 */
export async function widgetTaskHandler(
  props: WidgetTaskHandlerProps,
): Promise<void> {
  switch (props.widgetAction) {
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED": {
      let raw: string | null = null;
      try {
        raw = await AsyncStorage.getItem(WIDGET_SNAPSHOT_STORAGE_KEY);
      } catch {
        raw = null;
      }
      props.renderWidget(
        renderNextDeskWidget(
          props.widgetInfo.widgetName,
          parseWidgetSnapshot(raw),
          new Date(),
        ),
      );
      break;
    }
    default:
      break;
  }
}
