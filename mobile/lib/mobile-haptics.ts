import * as Haptics from "expo-haptics";

/**
 * Haptisches Feedback ist bewusst ergänzend: fehlende Unterstützung oder
 * eingeschränkte Systemeinstellungen dürfen eine Arbeitsaktion nie blockieren.
 */
export function hapticSelection(): void {
  void Haptics.selectionAsync().catch(() => undefined);
}

export function hapticSuccess(): void {
  void Haptics.notificationAsync(
    Haptics.NotificationFeedbackType.Success,
  ).catch(() => undefined);
}

export function hapticError(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
    () => undefined,
  );
}
