import {
  Command,
  LayoutPanelTop,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type IntroTipId = "arbeitsplatz" | "befehle" | "mein-portal";

type IntroTipDefinition = {
  actionLabel?: string;
  Icon: LucideIcon;
  text: string;
  title: string;
};

type StoredIntroTips = Partial<Record<IntroTipId, true>>;

const INTRO_TIPS: Record<IntroTipId, IntroTipDefinition> = {
  arbeitsplatz: {
    Icon: LayoutPanelTop,
    text: "Nutzen Sie den Arbeitsplatz für Makros, Erwähnungen und nachvollziehbare Arbeitsvorschläge. Vorschläge ändern kein Ticket automatisch.",
    title: "Neu: Arbeitsplatz",
  },
  befehle: {
    actionLabel: "Befehlspalette öffnen",
    Icon: Command,
    text: "Öffnen Sie die Befehlspalette mit Ctrl oder ⌘ K, um Bereiche, Tickets und häufige Aktionen schnell zu finden.",
    title: "Schneller mit Befehlen",
  },
  "mein-portal": {
    Icon: UserRound,
    text: "Im Portal finden Sie Ihre eigenen Tickets, Freigaben und Geräte. Verfügbare Bereiche richten sich nach Ihrem Mandanten.",
    title: "Neu: Mein Portal",
  },
};

function readStoredTips(storageKey: string): StoredIntroTips {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) =>
          (key === "arbeitsplatz" ||
            key === "befehle" ||
            key === "mein-portal") &&
          value === true,
      ),
    ) as StoredIntroTips;
  } catch {
    return {};
  }
}

export function IntroTip({
  onAction,
  tenantId,
  tip,
  userId,
}: {
  onAction?: () => void;
  tenantId: string;
  tip: IntroTipId;
  userId: string;
}) {
  const definition = INTRO_TIPS[tip];
  const storageKey = useMemo(
    () =>
      `nextdesk:intro-tips:${encodeURIComponent(tenantId)}:${encodeURIComponent(userId)}`,
    [tenantId, userId],
  );
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    const storedTips = readStoredTips(storageKey);
    setDismissed(storedTips[tip] === true);
  }, [storageKey, tip]);

  if (dismissed !== false) return null;

  const dismiss = () => {
    try {
      const storedTips = readStoredTips(storageKey);
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ ...storedTips, [tip]: true }),
      );
    } catch {
      // The current hint still closes if local storage is unavailable.
    }
    setDismissed(true);
  };

  return (
    <section aria-labelledby={`intro-tip-${tip}-heading`} className="intro-tip">
      <definition.Icon
        aria-hidden="true"
        className="intro-tip__icon"
        size={20}
      />
      <div className="intro-tip__copy">
        <h2 id={`intro-tip-${tip}-heading`}>{definition.title}</h2>
        <p>{definition.text}</p>
        {definition.actionLabel && onAction ? (
          <button
            className="intro-tip__action"
            onClick={onAction}
            type="button"
          >
            {definition.actionLabel}
          </button>
        ) : null}
      </div>
      <button
        aria-label={`${definition.title} ausblenden`}
        className="intro-tip__dismiss"
        onClick={dismiss}
        type="button"
      >
        <X aria-hidden="true" size={18} strokeWidth={1.8} />
      </button>
    </section>
  );
}
