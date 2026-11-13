import { tn } from "./lib/formality";
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  LoaderCircle,
  Printer,
} from "lucide-react";
import {
  Children,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  handbookDateLabel,
  handbookUrlTransform,
  listHandbooks,
  loadHandbook,
  type Handbook,
  type HandbookId,
  type HandbookSummary,
} from "./lib/handbooks";
import "./knowledge-markdown.css";
import "./handbooks.css";

type LoadState = "loading" | "loaded" | "error";

function textOf(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      typeof child === "string" || typeof child === "number"
        ? String(child)
        : "",
    )
    .join("");
}

export function handbookHeadingId(text: string): string {
  return (
    "hb-" +
    text
      .toLocaleLowerCase("de-CH")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
  );
}

/** Lists the handbooks the signed-in person may open (decided server-side). */
export function HandbookCard({
  onOpen,
  tenantId,
}: {
  onOpen: (id: HandbookId) => void;
  tenantId?: string | undefined;
}) {
  const [state, setState] = useState<LoadState>("loading");
  const [handbooks, setHandbooks] = useState<HandbookSummary[]>([]);

  useEffect(() => {
    if (!tenantId) {
      setState("loaded");
      setHandbooks([]);
      return;
    }
    let mounted = true;
    setState("loading");
    listHandbooks(tenantId)
      .then((list) => {
        if (!mounted) return;
        setHandbooks(list);
        setState("loaded");
      })
      .catch(() => {
        if (mounted) setState("error");
      });
    return () => {
      mounted = false;
    };
  }, [tenantId]);

  return (
    <section
      aria-labelledby="personal-handbooks-heading"
      className="personal-settings__card handbook-card"
    >
      <div className="personal-settings__card-heading">
        <span className="personal-settings__icon" aria-hidden="true">
          <BookOpen size={19} strokeWidth={1.9} />
        </span>
        <div>
          <h3 id="personal-handbooks-heading">Handbücher</h3>
          <p>
            {tn(
              "Schritt-für-Schritt-Anleitungen mit Bildschirmfotos – passend zu deiner Rolle.",
              "Schritt-für-Schritt-Anleitungen mit Bildschirmfotos – passend zu Ihrer Rolle.",
            )}
          </p>
        </div>
      </div>
      {state === "loading" ? (
        <p className="personal-settings__hint" aria-live="polite">
          Handbücher werden geladen …
        </p>
      ) : null}
      {state === "error" ? (
        <p className="personal-settings__notice personal-settings__notice--error">
          Die Handbücher konnten nicht geladen werden. Bitte versuche es später
          erneut.
        </p>
      ) : null}
      {state === "loaded" && handbooks.length === 0 ? (
        <p className="personal-settings__hint">
          {tn(
            "Für dein Konto sind keine Handbücher verfügbar.",
            "Für Ihr Konto sind keine Handbücher verfügbar.",
          )}
        </p>
      ) : null}
      {handbooks.length ? (
        <ul className="handbook-card__list">
          {handbooks.map((handbook) => (
            <li key={handbook.id}>
              <button
                className="handbook-card__entry"
                onClick={() => onOpen(handbook.id)}
                type="button"
              >
                <span className="handbook-card__text">
                  <span className="handbook-card__audience">
                    {handbook.audienceLabel}
                  </span>
                  <strong>{handbook.title}</strong>
                  <small>{handbook.description}</small>
                </span>
                <ChevronRight aria-hidden="true" size={16} strokeWidth={1.9} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Scrolls within the app instead of changing the URL hash, which would
 * otherwise scroll every overflow container (and the app shell) sideways.
 */
function jumpToHeading(event: MouseEvent<HTMLAnchorElement>) {
  const id = event.currentTarget.getAttribute("href")?.slice(1);
  const target = id ? document.getElementById(id) : null;
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({
    behavior: "smooth",
    block: "start",
    inline: "nearest",
  });
}

function printHandbook() {
  document.body.classList.add("handbook-printing");
  const cleanup = () => {
    document.body.classList.remove("handbook-printing");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}

export function HandbookViewer({
  handbookId,
  onBack,
  tenantId,
}: {
  handbookId: HandbookId;
  onBack: () => void;
  tenantId: string;
}) {
  const [state, setState] = useState<LoadState>("loading");
  const [handbook, setHandbook] = useState<Handbook | null>(null);

  useEffect(() => {
    let mounted = true;
    setState("loading");
    setHandbook(null);
    loadHandbook(tenantId, handbookId)
      .then((loaded) => {
        if (!mounted) return;
        setHandbook(loaded);
        setState("loaded");
      })
      .catch(() => {
        if (mounted) setState("error");
      });
    return () => {
      mounted = false;
    };
  }, [handbookId, tenantId]);

  const contents = useMemo(
    () =>
      handbook
        ? [...handbook.markdown.matchAll(/^## (.+)$/gm)].map(([, title]) => ({
            id: handbookHeadingId(title!.trim()),
            title: title!.trim(),
          }))
        : [],
    [handbook],
  );

  return (
    <section aria-labelledby="handbook-title" className="handbook-viewer">
      <header className="handbook-viewer__header">
        <button className="secondary-button" onClick={onBack} type="button">
          <ArrowLeft aria-hidden="true" size={16} strokeWidth={1.8} />
          Zurück
        </button>
        {handbook ? (
          <button
            className="secondary-button"
            onClick={printHandbook}
            type="button"
          >
            <Printer aria-hidden="true" size={16} strokeWidth={1.8} />
            Drucken / PDF
          </button>
        ) : null}
      </header>

      {state === "loading" ? (
        <p className="handbook-viewer__status" aria-live="polite">
          <LoaderCircle aria-hidden="true" size={17} strokeWidth={1.9} />
          Handbuch wird geladen …
        </p>
      ) : null}
      {state === "error" ? (
        <p className="personal-settings__notice personal-settings__notice--error">
          {tn(
            "Dieses Handbuch ist für dein Konto nicht verfügbar oder konnte nicht geladen werden.",
            "Dieses Handbuch ist für Ihr Konto nicht verfügbar oder konnte nicht geladen werden.",
          )}
        </p>
      ) : null}

      {handbook ? (
        <div className="handbook-viewer__layout">
          <nav aria-label="Inhalt" className="handbook-viewer__toc">
            <span>Inhalt</span>
            <ol>
              {contents.map((entry) => (
                <li key={entry.id}>
                  <a href={`#${entry.id}`} onClick={jumpToHeading}>
                    {entry.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <article className="handbook-viewer__article">
            <p className="handbook-viewer__meta">
              <span className="handbook-card__audience">
                {handbook.audienceLabel}
              </span>
              Stand {handbookDateLabel(handbook.updatedAt)}
            </p>
            <h2 id="handbook-title">{handbook.title}</h2>
            <p className="handbook-viewer__lead">{handbook.description}</p>
            <div className="knowledge-markdown handbook-viewer__body">
              <ReactMarkdown
                components={{
                  h1: () => null,
                  h2: ({ children }) => (
                    <h2 id={handbookHeadingId(textOf(children))}>{children}</h2>
                  ),
                  img: ({ src, alt }) =>
                    typeof src === "string" && src ? (
                      <span className="handbook-viewer__figure">
                        <img alt={alt ?? ""} loading="lazy" src={src} />
                        {alt ? (
                          <span className="handbook-viewer__caption">
                            {alt}
                          </span>
                        ) : null}
                      </span>
                    ) : null,
                  a: ({ href, children }) =>
                    href?.startsWith("#") ? (
                      <a href={href} onClick={jumpToHeading}>
                        {children}
                      </a>
                    ) : (
                      <a href={href} rel="noreferrer" target="_blank">
                        {children}
                      </a>
                    ),
                }}
                remarkPlugins={[remarkGfm]}
                urlTransform={handbookUrlTransform}
              >
                {handbook.markdown}
              </ReactMarkdown>
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}
