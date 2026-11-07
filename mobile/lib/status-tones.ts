/**
 * One mapping from ticket and device states to colour tones, used by the web
 * app (CSS tokens in status-tokens.css) and the mobile app (theme palette).
 */
export type Tone =
  | "danger"
  | "warning"
  | "success"
  | "info"
  | "neutral"
  | "accent";

export function priorityTone(label: string | null | undefined): Tone {
  const value = (label ?? "").toLowerCase();
  if (/(kritisch|critical|sehr hoch|urgent|dringend)/.test(value))
    return "danger";
  if (/(hoch|high)/.test(value)) return "warning";
  if (/(niedrig|tief|low|gering)/.test(value)) return "neutral";
  return "info";
}

/** SLA: breached, due within four hours, or on track. */
export function slaTone(
  dueAt: string | null | undefined,
  now = Date.now(),
  riskHours = 4,
): Tone {
  if (!dueAt) return "neutral";
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return "neutral";
  if (due < now) return "danger";
  if (due - now <= riskHours * 3_600_000) return "warning";
  return "success";
}

export function statusTone(key: string | null | undefined): Tone {
  const value = (key ?? "").toLowerCase();
  if (/^(resolved|closed|done|gel(ö|oe)st|geschlossen)/.test(value))
    return "success";
  if (/(waiting|wartend|pending)/.test(value)) return "warning";
  if (/^(new|neu)/.test(value)) return "accent";
  return "info";
}

export function lifecycleTone(state: string | null | undefined): Tone {
  switch (state) {
    case "active":
      return "success";
    case "repair":
      return "warning";
    case "ordered":
    case "stock":
      return "info";
    case "retired":
    case "disposed":
      return "neutral";
    default:
      return "neutral";
  }
}

type TonePalette = {
  error: string;
  errorSoft: string;
  warning: string;
  warningSoft: string;
  success: string;
  successSoft: string;
  info: string;
  infoSoft: string;
  muted: string;
  surfaceSubtle?: string;
  border: string;
  primaryText: string;
  primarySoft: string;
};

/** Foreground and background colour of a tone in the app theme. */
export function toneColors(
  tone: Tone,
  colors: TonePalette,
): { color: string; background: string } {
  switch (tone) {
    case "danger":
      return { color: colors.error, background: colors.errorSoft };
    case "warning":
      return { color: colors.warning, background: colors.warningSoft };
    case "success":
      return { color: colors.success, background: colors.successSoft };
    case "info":
      return { color: colors.info, background: colors.infoSoft };
    case "accent":
      return { color: colors.primaryText, background: colors.primarySoft };
    default:
      return {
        color: colors.muted,
        background: colors.surfaceSubtle ?? colors.border,
      };
  }
}
