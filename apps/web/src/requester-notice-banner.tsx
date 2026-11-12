import { X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  noticeApi,
  noticeColors,
  resolveNoticeLink,
  type NoticeLink,
  type NoticeView,
} from "./lib/requester-notices";
import "./requester-notice-banner.css";

/** Hinweise der ICT im Portal: grosses Banner und schmale Hinweisleiste. */

type NoticeProps = {
  notice: NoticeView;
  /** Ohne Handler zeigt die Schaltfläche nur (Vorschau). */
  onAction?: () => void;
  onDismiss?: () => void;
};

export function NoticeBanner({ notice, onAction, onDismiss }: NoticeProps) {
  const colors = noticeColors(notice.color);
  const style = {
    "--notice-from": colors.from,
    "--notice-to": colors.to,
  } as CSSProperties;
  return (
    <section
      aria-label="Hinweis der ICT"
      className="notice-banner"
      style={style}
    >
      {notice.symbol ? (
        <span aria-hidden="true" className="notice-banner__symbol">
          {notice.symbol}
        </span>
      ) : null}
      <div className="notice-banner__text">
        <small>Neu bei der ICT</small>
        <h3>{notice.title}</h3>
        <p>{notice.body}</p>
      </div>
      <button
        className="notice-banner__action"
        onClick={onAction}
        type="button"
      >
        {notice.buttonLabel}
      </button>
      {notice.dismissible ? (
        <button
          aria-label="Hinweis ausblenden"
          className="notice-banner__close"
          onClick={onDismiss}
          type="button"
        >
          <X aria-hidden="true" size={16} />
        </button>
      ) : null}
    </section>
  );
}

export function NoticeBar({ notice, onAction, onDismiss }: NoticeProps) {
  const colors = noticeColors(notice.color);
  const style = {
    "--notice-bg": colors.barBackground,
    "--notice-fg": colors.barText,
    "--notice-border": colors.barBorder,
  } as CSSProperties;
  return (
    <section aria-label="Hinweis der ICT" className="notice-bar" style={style}>
      {notice.symbol ? (
        <span aria-hidden="true" className="notice-bar__symbol">
          {notice.symbol}
        </span>
      ) : null}
      <span className="notice-bar__text">
        <strong>{notice.title}</strong> {notice.body}
      </span>
      <button className="notice-bar__action" onClick={onAction} type="button">
        {notice.buttonLabel}
      </button>
      {notice.dismissible ? (
        <button
          aria-label="Hinweis ausblenden"
          className="notice-bar__close"
          onClick={onDismiss}
          type="button"
        >
          <X aria-hidden="true" size={14} />
        </button>
      ) : null}
    </section>
  );
}

/**
 * Lädt die aktiven Hinweise (Banner und Leiste) und meldet Ansicht, Klick und
 * Wegklicken. Fehler werden still ignoriert: dann erscheint nichts.
 */
export function RequesterNotices({
  tenantId,
  onNavigate,
}: {
  tenantId: string;
  onNavigate: (link: NoticeLink) => void;
}) {
  const [banner, setBanner] = useState<NoticeView | null>(null);
  const [bar, setBar] = useState<NoticeView | null>(null);
  const viewed = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    setBanner(null);
    setBar(null);
    viewed.current = new Set();
    const track = (notice: NoticeView) => {
      if (viewed.current.has(notice.id)) return;
      viewed.current.add(notice.id);
      void noticeApi.track(tenantId, notice.id, "view").catch(() => undefined);
    };
    void (async () => {
      try {
        const [banners, bars] = await Promise.all([
          noticeApi.active(tenantId, "portal_banner").catch(() => []),
          noticeApi.active(tenantId, "portal_bar").catch(() => []),
        ]);
        if (!active) return;
        const nextBanner = banners[0] ?? null;
        const nextBar = bars.find((item) => item.id !== nextBanner?.id) ?? null;
        setBanner(nextBanner);
        setBar(nextBar);
        if (nextBanner) track(nextBanner);
        if (nextBar) track(nextBar);
      } catch {
        // Hinweise sind optional: bei Fehlern nichts anzeigen.
      }
    })();
    return () => {
      active = false;
    };
  }, [tenantId]);

  const open = useCallback(
    (notice: NoticeView) => {
      void noticeApi.track(tenantId, notice.id, "click").catch(() => undefined);
      const link = resolveNoticeLink(notice);
      if (link) onNavigate(link);
    },
    [onNavigate, tenantId],
  );

  const dismiss = useCallback(
    (notice: NoticeView, clear: () => void) => {
      clear();
      void noticeApi
        .track(tenantId, notice.id, "dismiss")
        .catch(() => undefined);
    },
    [tenantId],
  );

  if (!banner && !bar) return null;
  return (
    <div className="requester-notices">
      {banner ? (
        <NoticeBanner
          notice={banner}
          onAction={() => open(banner)}
          onDismiss={() => dismiss(banner, () => setBanner(null))}
        />
      ) : null}
      {bar ? (
        <NoticeBar
          notice={bar}
          onAction={() => open(bar)}
          onDismiss={() => dismiss(bar, () => setBar(null))}
        />
      ) : null}
    </div>
  );
}
