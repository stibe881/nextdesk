import { requestWidgetUpdate } from "react-native-android-widget";

import type { WidgetSnapshot } from "@/lib/widget-snapshot";
import {
  ANDROID_WIDGET_NAMES,
  renderNextDeskWidget,
} from "@/widgets/android/nextdesk-widgets";

export async function publishWidgetSnapshot(
  snapshot: WidgetSnapshot | null,
): Promise<void> {
  await Promise.all(
    ANDROID_WIDGET_NAMES.map((widgetName) =>
      requestWidgetUpdate({
        widgetName,
        renderWidget: () =>
          renderNextDeskWidget(widgetName, snapshot, new Date()),
      }),
    ),
  );
}
