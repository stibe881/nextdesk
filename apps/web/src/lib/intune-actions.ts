// Intune-Aktionen: labels, confirmation texts and response parsing for the
// intune-actions edge function.

export const INTUNE_ACTIONS = [
  "syncDevice",
  "rebootNow",
  "remoteLock",
  "resetPasscode",
  "rotateLocalAdminPassword",
  "windowsDefenderScan",
] as const;

export type IntuneAction = (typeof INTUNE_ACTIONS)[number];

export type IntuneDevice = {
  assetId: string;
  name: string;
  assetTag: string | null;
  operatingSystem: string | null;
  actions: IntuneAction[];
  confirmationRequired: IntuneAction[];
};

export type IntuneDeviceList = {
  devices: IntuneDevice[];
  connectionReady: boolean;
};

type Row = Record<string, unknown>;

function asRecord(value: unknown): Row | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Row)
    : null;
}

export function isIntuneAction(value: unknown): value is IntuneAction {
  return (
    typeof value === "string" &&
    (INTUNE_ACTIONS as readonly string[]).includes(value)
  );
}

const LABELS: Record<IntuneAction, string> = {
  syncDevice: "Synchronisieren",
  rebootNow: "Neu starten",
  remoteLock: "Sperren",
  resetPasscode: "Passwort zurücksetzen",
  rotateLocalAdminPassword: "Lokales Admin-Passwort rotieren",
  windowsDefenderScan: "Defender-Schnellscan",
};

export function intuneActionLabel(action: IntuneAction): string {
  return LABELS[action];
}

/** Text of the confirmation dialog for actions that change the device. */
export function intuneConfirmationText(
  action: IntuneAction,
  deviceName: string,
): string {
  switch (action) {
    case "rebootNow":
      return `«${deviceName}» wird sofort neu gestartet. Nicht gespeicherte Arbeit der Person geht verloren.`;
    case "remoteLock":
      return `«${deviceName}» wird gesperrt. Die Person muss das Gerät mit ihrem Code entsperren.`;
    case "resetPasscode":
      return `Der Gerätecode von «${deviceName}» wird zurückgesetzt. Die Person muss danach einen neuen Code festlegen.`;
    case "rotateLocalAdminPassword":
      return `Das lokale Administratorpasswort (LAPS) von «${deviceName}» wird neu erzeugt. Das bisherige Passwort ist danach ungültig.`;
    default:
      return `Die Aktion «${LABELS[action]}» wird für «${deviceName}» ausgeführt.`;
  }
}

export function intuneSuccessMessage(
  action: IntuneAction,
  deviceName: string,
): string {
  switch (action) {
    case "syncDevice":
      return `Synchronisierung für «${deviceName}» angestossen.`;
    case "rebootNow":
      return `Neustart für «${deviceName}» angestossen.`;
    case "remoteLock":
      return `«${deviceName}» wird gesperrt.`;
    case "resetPasscode":
      return `Der Gerätecode von «${deviceName}» wird zurückgesetzt.`;
    case "rotateLocalAdminPassword":
      return `Das lokale Admin-Passwort von «${deviceName}» wird rotiert.`;
    case "windowsDefenderScan":
      return `Defender-Schnellscan für «${deviceName}» gestartet.`;
  }
}

export function parseIntuneDeviceList(value: unknown): IntuneDeviceList | null {
  const data = asRecord(value);
  if (!data || !Array.isArray(data.devices)) return null;
  const devices: IntuneDevice[] = [];
  for (const item of data.devices) {
    const device = asRecord(item);
    if (
      !device ||
      typeof device.assetId !== "string" ||
      typeof device.name !== "string" ||
      !Array.isArray(device.actions)
    ) {
      continue;
    }
    const actions = device.actions.filter(isIntuneAction);
    const confirmationRequired = Array.isArray(device.confirmationRequired)
      ? device.confirmationRequired.filter(isIntuneAction)
      : [];
    devices.push({
      assetId: device.assetId,
      name: device.name,
      assetTag: typeof device.assetTag === "string" ? device.assetTag : null,
      operatingSystem:
        typeof device.operatingSystem === "string"
          ? device.operatingSystem
          : null,
      actions,
      confirmationRequired,
    });
  }
  return { devices, connectionReady: data.connectionReady === true };
}

/** Reboot, lock, passcode reset and LAPS rotation always need a confirmation. */
export function needsConfirmation(
  device: IntuneDevice,
  action: IntuneAction,
): boolean {
  return (
    device.confirmationRequired.includes(action) ||
    action === "rebootNow" ||
    action === "remoteLock" ||
    action === "resetPasscode" ||
    action === "rotateLocalAdminPassword"
  );
}

/** Ticket history label of an "asset.intune_action" event. */
export function intuneActionEventLabel(payload: Row | null): string {
  const action = payload?.action;
  const label = isIntuneAction(action) ? LABELS[action] : "Aktion";
  const device =
    typeof payload?.assetName === "string" && payload.assetName.trim()
      ? ` für «${payload.assetName.trim()}»`
      : "";
  const outcome =
    payload?.status === "succeeded"
      ? "ausgelöst"
      : payload?.status === "failed"
        ? "fehlgeschlagen"
        : "angefordert";
  return `Intune: ${label}${device} ${outcome}`;
}

/** German message from an error envelope { error: { code, message } }. */
export function intuneErrorMessage(body: unknown): string {
  const message = asRecord(asRecord(body)?.error)?.message;
  return typeof message === "string" && message.trim()
    ? message.trim()
    : "Die Intune-Aktion konnte nicht ausgeführt werden.";
}
