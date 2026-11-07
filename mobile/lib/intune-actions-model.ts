// Intune-Aktionen im Assetdetail (Funktion intune-actions). Neustart,
// Sperren, Code zurücksetzen und LAPS-Rotation brauchen eine Bestätigung.

export const MOBILE_INTUNE_ACTIONS = [
  "syncDevice",
  "rebootNow",
  "remoteLock",
  "resetPasscode",
  "rotateLocalAdminPassword",
  "windowsDefenderScan",
] as const;

export type MobileIntuneAction = (typeof MOBILE_INTUNE_ACTIONS)[number];

export type MobileIntuneDevice = {
  assetId: string;
  name: string;
  actions: MobileIntuneAction[];
  connectionReady: boolean;
};

const LABELS: Record<MobileIntuneAction, string> = {
  syncDevice: "Synchronisieren",
  rebootNow: "Neu starten",
  remoteLock: "Sperren",
  resetPasscode: "Passwort zurücksetzen",
  rotateLocalAdminPassword: "Lokales Admin-Passwort rotieren",
  windowsDefenderScan: "Defender-Schnellscan",
};

const CONFIRMED: readonly MobileIntuneAction[] = [
  "rebootNow",
  "remoteLock",
  "resetPasscode",
  "rotateLocalAdminPassword",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMobileIntuneAction(
  value: unknown,
): value is MobileIntuneAction {
  return (
    typeof value === "string" &&
    (MOBILE_INTUNE_ACTIONS as readonly string[]).includes(value)
  );
}

export function mobileIntuneActionLabel(action: MobileIntuneAction): string {
  return LABELS[action];
}

export function mobileIntuneNeedsConfirmation(
  action: MobileIntuneAction,
): boolean {
  return CONFIRMED.includes(action);
}

export function mobileIntuneConfirmationText(
  action: MobileIntuneAction,
  deviceName: string,
): string {
  switch (action) {
    case "rebootNow":
      return `«${deviceName}» wird sofort neu gestartet. Nicht gespeicherte Arbeit geht verloren.`;
    case "remoteLock":
      return `«${deviceName}» wird gesperrt und muss mit dem Gerätecode entsperrt werden.`;
    case "resetPasscode":
      return `Der Gerätecode von «${deviceName}» wird zurückgesetzt.`;
    case "rotateLocalAdminPassword":
      return `Das lokale Admin-Passwort von «${deviceName}» wird neu erzeugt.`;
    default:
      return `«${LABELS[action]}» wird für «${deviceName}» ausgeführt.`;
  }
}

/** Parses the listAssetActions response for one asset. */
export function parseMobileIntuneDevice(
  value: unknown,
  assetId: string,
): MobileIntuneDevice | null {
  const data = isRecord(value) && isRecord(value.data) ? value.data : null;
  if (!data || !Array.isArray(data.devices)) return null;
  for (const item of data.devices) {
    if (
      isRecord(item) &&
      item.assetId === assetId &&
      typeof item.name === "string" &&
      Array.isArray(item.actions)
    ) {
      const actions = item.actions.filter(isMobileIntuneAction);
      if (actions.length === 0) return null;
      return {
        assetId,
        name: item.name,
        actions,
        connectionReady: data.connectionReady === true,
      };
    }
  }
  return null;
}
