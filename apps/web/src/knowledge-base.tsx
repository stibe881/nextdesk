import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import { functionErrorMessage } from "./lib/function-error";
import {
  buildKnowledgeArticleSaveRequest,
  type KnowledgeArticleSaveRequest,
} from "./lib/knowledge-article-save";
import {
  knowledgeEditorDialogTabIndex,
  shouldCloseKnowledgeEditor,
} from "./lib/knowledge-editor-dialog";
import { supabase } from "./lib/supabase";

export type KnowledgeBaseProps = {
  createArticleRequestId?: number | undefined;
  focusArticleId?: string | undefined;
  onCreateArticleRequestConsumed?: ((requestId: number) => void) | undefined;
  tenantId: string;
};

type ArticleVisibility = "internal" | "external";
type ArticleStatus = "draft" | "review" | "published" | "archived";
type ArticleListFilter = "all" | ArticleVisibility | "draft";
type EditableArticleStatus = Exclude<ArticleStatus, "archived">;
type SaveState = "save" | "archive" | "review" | "decision" | null;

type KnowledgeArticle = {
  id: string;
  title: string;
  slug: string;
  visibility: ArticleVisibility;
  status: ArticleStatus;
  currentRevision: number | null;
  publishedRevision: number | null;
  reviewRequestedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type KnowledgeArticleRevision = {
  id: string;
  articleId: string;
  revision: number;
  body: string;
  summary: string | null;
  createdAt: string;
};

type ArticleListItem = {
  article: KnowledgeArticle;
  revision: KnowledgeArticleRevision | null;
};

type ArticleDetail = {
  article: KnowledgeArticle;
  revision: KnowledgeArticleRevision;
};

type ArticleDraft = {
  title: string;
  bodyMarkdown: string;
  visibility: ArticleVisibility;
  status: EditableArticleStatus;
};
type ReviewRequest = {
  type: "requestReview";
  tenantId: string;
  articleId: string;
};
type ReviewDecisionRequest = {
  type: "decideReview";
  tenantId: string;
  articleId: string;
  decision: "approved" | "rejected";
};

type ListArticlesRequest = {
  type: "listArticles";
  tenantId: string;
  query?: string;
};

type GetArticleRequest = {
  type: "getArticle";
  tenantId: string;
  articleId: string;
};

type ArchiveArticleRequest = {
  type: "archiveArticle";
  tenantId: string;
  articleId: string;
};

type KnowledgeBaseRequest =
  | KnowledgeArticleSaveRequest
  | ReviewRequest
  | ReviewDecisionRequest
  | ListArticlesRequest
  | GetArticleRequest
  | ArchiveArticleRequest;

type PrepareKnowledgeArticleRequest = {
  type: "prepareKnowledgeArticle";
  tenantId: string;
  articleId?: string;
  visibility: ArticleVisibility;
  rawContent: string;
};

type PreparedKnowledgeArticle = {
  title: string;
  bodyMarkdown: string;
};

const EMPTY_DRAFT: ArticleDraft = {
  title: "",
  bodyMarkdown: "",
  visibility: "internal",
  status: "draft",
};

const statusLabels: Record<ArticleStatus, string> = {
  draft: "Entwurf",
  review: "Prüfung",
  published: "Veröffentlicht",
  archived: "Archiviert",
};

const visibilityLabels: Record<ArticleVisibility, string> = {
  internal: "Intern",
  external: "Extern",
};

const articleListFilterLabels: Record<ArticleListFilter, string> = {
  all: "Alle Artikel",
  internal: "Intern",
  external: "Extern",
  draft: "Entwurf",
};

const knowledgeBaseStyles = `
  .knowledge-base {
    display: grid;
    gap: 18px;
  }
  .knowledge-base__toolbar,
  .knowledge-base__actions,
  .knowledge-base__form-actions,
  .knowledge-base__meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .knowledge-base__toolbar {
    justify-content: space-between;
    padding: 0 24px 18px;
    gap: 14px;
  }
  .knowledge-base__search {
    display: flex;
    flex: 1 1 280px;
    max-width: 560px;
    gap: 8px;
  }
  .knowledge-base__filters {
    display: flex;
    align-items: end;
    flex-wrap: wrap;
    gap: 8px;
  }
  .knowledge-base__filter {
    display: grid;
    gap: 4px;
    color: #49616d;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: .06em;
    text-transform: uppercase;
  }
  .knowledge-base__filter select {
    min-height: 44px;
    min-width: 150px;
    border: 1px solid #c9d8dd;
    border-radius: 5px;
    background: #fff;
    color: #173246;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    padding: 8px 28px 8px 10px;
  }
  .knowledge-base__search-help {
    flex: 1 0 100%;
    margin: -2px 0 0;
    color: #5d6f7a;
    font-size: 12px;
    line-height: 1.45;
  }
  .knowledge-base__search input,
  .knowledge-base__form input,
  .knowledge-base__form select,
  .knowledge-base__form textarea {
    width: 100%;
    border: 1px solid #c9d8dd;
    border-radius: 5px;
    background: #fff;
    color: #12283a;
    font: inherit;
    padding: 9px 10px;
  }
  .knowledge-base__button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    border: 1px solid #c9d8dd;
    border-radius: 5px;
    background: #fff;
    color: #245268;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    padding: 8px 11px;
  }
  .knowledge-base__button:hover:not(:disabled) {
    background: #f1f7f8;
  }
  .knowledge-base__button:disabled,
  .knowledge-base__save:disabled {
    cursor: wait;
    opacity: .62;
  }
  .knowledge-base__button--danger {
    border-color: #efc7bd;
    color: #a03422;
  }
  .knowledge-base__content,
  .knowledge-base__detail,
  .knowledge-base__form-panel {
    padding: 0 24px 24px;
  }
  .knowledge-base__grid {
    display: grid;
    grid-template-columns: minmax(230px, .85fr) minmax(0, 1.45fr);
    gap: 16px;
  }
  .knowledge-base__list {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .knowledge-base__article-button {
    width: 100%;
    border: 1px solid #dfe8ea;
    border-radius: 7px;
    background: #fff;
    color: inherit;
    padding: 13px;
    text-align: left;
  }
  .knowledge-base__article-button:hover:not(:disabled),
  .knowledge-base__article-button[aria-current="true"] {
    border-color: #8cb9c2;
    background: #f1f7f8;
  }
  .knowledge-base__article-button h3 {
    margin: 0;
    color: #173246;
    font-size: 14px;
    line-height: 1.3;
  }
  .knowledge-base__article-button p {
    margin: 7px 0 0;
    color: #687b84;
    font-size: 11px;
  }
  .knowledge-base__badge {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 3px 7px;
    background: #edf3f5;
    color: #49616d;
    font-size: 10px;
    font-weight: 800;
  }
  .knowledge-base__badge--published,
  .knowledge-base__badge--external {
    background: #e5f6f1;
    color: #177c69;
  }
  .knowledge-base__badge--review {
    background: #fff4dc;
    color: #95620e;
  }
  .knowledge-base__detail-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .knowledge-base__detail h3 {
    margin: 0;
    color: #173246;
    font-size: 18px;
  }
  .knowledge-base__meta {
    margin: 8px 0 0;
    color: #627780;
    font-size: 11px;
  }
  .knowledge-base__markdown {
    max-height: none;
    overflow: visible;
    margin: 16px 0 0;
    border: 1px solid #e0e8ea;
    border-radius: 6px;
    background: #f9fbfb;
    color: #294657;
    padding: 14px;
    font: 14px/1.7 var(--font-sans);
    overflow-wrap: anywhere;
  }
  .knowledge-base__markdown > :first-child { margin-top: 0; }
  .knowledge-base__markdown > :last-child { margin-bottom: 0; }
  .knowledge-base__markdown h1,
  .knowledge-base__markdown h2,
  .knowledge-base__markdown h3 { color: #173246; line-height: 1.25; }
  .knowledge-base__markdown p,
  .knowledge-base__markdown li { line-height: 1.7; }
  .knowledge-base__markdown code {
    border-radius: 4px;
    padding: 2px 4px;
    background: #edf3f5;
    font-family: var(--font-mono);
    font-size: .9em;
  }
  .knowledge-base__form {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }
  .knowledge-base__form label {
    display: grid;
    gap: 6px;
    color: #12283a;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: .06em;
    text-transform: uppercase;
  }
  .knowledge-base__form textarea {
    min-height: 230px;
    resize: vertical;
  }
  .knowledge-base__full-width {
    grid-column: 1 / -1;
  }
  .knowledge-base__ai-assist {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    border: 1px solid #cfe1f4;
    border-radius: 8px;
    padding: 14px;
    background: #f5f9ff;
  }
  .knowledge-base__ai-assist strong { color: #173246; font-size: 13px; }
  .knowledge-base__ai-assist p {
    max-width: 680px;
    margin: 4px 0 0;
    color: #4e6877;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: normal;
    line-height: 1.5;
    text-transform: none;
  }
  .knowledge-base__hint {
    margin: 0;
    color: #687b84;
    font-size: 12px;
    line-height: 1.45;
  }
  .knowledge-base__message {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    border-radius: 5px;
    padding: 11px 13px;
    font-size: 13px;
    line-height: 1.4;
  }
  .knowledge-base__message--error {
    border: 1px solid #f1c9c0;
    background: #fff5f2;
    color: #a03422;
  }
  .knowledge-base__message--success {
    border: 1px solid #bfe4db;
    background: #effaf7;
    color: #216c5e;
  }
  .knowledge-base__empty {
    margin: 0;
    color: #687b84;
    font-size: 13px;
    line-height: 1.5;
  }
  @media (max-width: 800px) {
    .knowledge-base__grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 640px) {
    .knowledge-base__toolbar,
    .knowledge-base__content,
    .knowledge-base__detail,
    .knowledge-base__form-panel { padding-left: 16px; padding-right: 16px; }
    .knowledge-base__search { max-width: none; }
    .knowledge-base__form { grid-template-columns: 1fr; }
    .knowledge-base__full-width { grid-column: auto; }
    .knowledge-base__ai-assist { align-items: flex-start; flex-direction: column; }
  }
`;

class KnowledgeBaseRequestError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "KnowledgeBaseRequestError";
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArticleVisibility(value: unknown): value is ArticleVisibility {
  return value === "internal" || value === "external";
}

function isArticleStatus(value: unknown): value is ArticleStatus {
  return (
    value === "draft" ||
    value === "review" ||
    value === "published" ||
    value === "archived"
  );
}

function articleMatchesListFilter(
  article: KnowledgeArticle,
  filter: ArticleListFilter,
): boolean {
  if (article.status === "archived") return false;
  if (filter === "all") return true;
  if (filter === "draft") return article.status === "draft";
  return article.visibility === filter;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseArticle(value: unknown): KnowledgeArticle | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.slug !== "string" ||
    !isArticleVisibility(value.visibility) ||
    !isArticleStatus(value.status) ||
    (typeof value.current_revision !== "number" &&
      value.current_revision !== null) ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    title: value.title,
    slug: value.slug,
    visibility: value.visibility,
    status: value.status,
    currentRevision: value.current_revision,
    publishedRevision:
      typeof value.published_revision === "number"
        ? value.published_revision
        : null,
    reviewRequestedAt: asNullableString(value.review_requested_at),
    publishedAt: asNullableString(value.published_at),
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

function parseRevision(value: unknown): KnowledgeArticleRevision | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.article_id !== "string" ||
    typeof value.revision !== "number" ||
    typeof value.body !== "string" ||
    typeof value.created_at !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    articleId: value.article_id,
    revision: value.revision,
    body: value.body,
    summary: asNullableString(value.summary),
    createdAt: value.created_at,
  };
}

function responseData(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new KnowledgeBaseRequestError(
      "Die Wissensdatenbank hat keine vollständigen Daten geliefert.",
    );
  }
  return value.data;
}

function parseArticleDetail(value: unknown): ArticleDetail {
  const data = responseData(value);
  const article = parseArticle(data.article);
  const revision = parseRevision(data.revision);
  if (!article || !revision) {
    throw new KnowledgeBaseRequestError(
      "Die Artikeldaten sind unvollständig oder ungültig.",
    );
  }
  return { article, revision };
}

function parseArticleList(value: unknown): ArticleListItem[] {
  const data = responseData(value);
  if (!Array.isArray(data.articles)) {
    throw new KnowledgeBaseRequestError(
      "Die Artikelliste ist unvollständig oder ungültig.",
    );
  }

  const articles: ArticleListItem[] = [];
  for (const item of data.articles) {
    if (!isRecord(item)) {
      throw new KnowledgeBaseRequestError(
        "Die Artikelliste enthält ungültige Daten.",
      );
    }
    const article = parseArticle(item);
    const revision =
      item.revision === null ? null : parseRevision(item.revision);
    if (!article || (item.revision !== null && !revision)) {
      throw new KnowledgeBaseRequestError(
        "Die Artikelliste enthält unvollständige Artikeldaten.",
      );
    }
    articles.push({ article, revision });
  }
  return articles;
}

function parseArchivedArticle(value: unknown): KnowledgeArticle {
  const article = parseArticle(responseData(value).article);
  if (!article) {
    throw new KnowledgeBaseRequestError(
      "Die Archivierungsantwort enthält keine gültigen Artikeldaten.",
    );
  }
  return article;
}

function parseReturnedArticle(value: unknown): KnowledgeArticle {
  const article = parseArticle(responseData(value).article);
  if (!article) {
    throw new KnowledgeBaseRequestError(
      "Die Artikelantwort ist unvollständig.",
    );
  }
  return article;
}

function parsePreparedKnowledgeArticle(
  value: unknown,
): PreparedKnowledgeArticle {
  const data = responseData(value);
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const bodyMarkdown =
    typeof data.bodyMarkdown === "string" ? data.bodyMarkdown.trim() : "";
  if (title.length < 3 || title.length > 240 || !bodyMarkdown) {
    throw new KnowledgeBaseRequestError(
      "Die KI-Aufbereitung enthält keinen verwendbaren Entwurf.",
    );
  }
  return { title, bodyMarkdown };
}

function statusFromError(error: unknown): number | null {
  if (!isRecord(error)) return null;
  if (typeof error.status === "number") return error.status;

  const context = error.context;
  if (context instanceof Response) return context.status;
  if (isRecord(context) && typeof context.status === "number") {
    return context.status;
  }
  return null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function invokeKnowledgeBase<T>(
  request: KnowledgeBaseRequest,
  parseResponse: (value: unknown) => T,
): Promise<T> {
  if (!supabase) {
    throw new KnowledgeBaseRequestError(
      "Die Verbindung zu Supabase ist nicht konfiguriert.",
    );
  }

  const { data, error } = await supabase.functions.invoke<unknown>(
    "knowledge-base",
    { body: request },
  );
  if (error) {
    throw new KnowledgeBaseRequestError(
      await functionErrorMessage(
        error,
        "Die Wissensdatenbank ist nicht erreichbar.",
      ),
      statusFromError(error),
    );
  }

  return parseResponse(data);
}

async function invokeAiAssist<T>(
  request: PrepareKnowledgeArticleRequest,
  parseResponse: (value: unknown) => T,
): Promise<T> {
  if (!supabase) {
    throw new KnowledgeBaseRequestError(
      "Die Verbindung zu Supabase ist nicht konfiguriert.",
    );
  }
  const { data, error } = await supabase.functions.invoke<unknown>(
    "ai-assist",
    {
      body: request,
    },
  );
  if (error) {
    throw new KnowledgeBaseRequestError(
      await functionErrorMessage(
        error,
        "Die KI-Aufbereitung ist derzeit nicht verfügbar.",
      ),
      statusFromError(error),
    );
  }
  return parseResponse(data);
}

function draftFromDetail(detail: ArticleDetail): ArticleDraft {
  return {
    title: detail.article.title,
    bodyMarkdown: detail.revision.body,
    visibility: detail.article.visibility,
    status:
      detail.article.status === "archived" ? "draft" : detail.article.status,
  };
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Nicht verfügbar";
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  }).format(date);
}

function shortBody(body: string | null): string {
  if (!body) return "Noch kein Inhalt";
  const normalized = body.replace(/\s+/g, " ").trim();
  return normalized.length > 118 ? `${normalized.slice(0, 115)}…` : normalized;
}

function writeErrorMessage(error: unknown, action: "save" | "archive"): string {
  if (error instanceof KnowledgeBaseRequestError && error.status === 403) {
    return action === "archive"
      ? "Sie dürfen diesen Artikel nicht archivieren. Bitte wenden Sie sich an eine zuständige Person mit Verwaltungsberechtigung."
      : "Sie dürfen Artikel nicht erstellen oder ändern. Bitte wenden Sie sich an eine zuständige Person mit Verwaltungsberechtigung.";
  }
  return action === "archive"
    ? "Der Artikel konnte nicht archiviert werden. Bitte versuchen Sie es erneut."
    : "Der Artikel konnte nicht gespeichert werden. Bitte prüfen Sie Ihre Eingaben und versuchen Sie es erneut.";
}

/**
 * Verwaltet Artikel einer Mandanten-Wissensdatenbank über die Edge Function
 * `knowledge-base`. Der Status wird von der vorhandenen Edge Function geliefert,
 * aber bei `saveArticle` nicht entgegengenommen; deshalb ist er im Formular
 * transparent als schreibgeschützte Workflow-Information dargestellt.
 */
export function KnowledgeBase({
  createArticleRequestId,
  focusArticleId,
  onCreateArticleRequestConsumed,
  tenantId,
}: KnowledgeBaseProps) {
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [articleListFilter, setArticleListFilter] =
    useState<ArticleListFilter>("all");
  const [selected, setSelected] = useState<ArticleDetail | null>(null);
  const [editingArticleId, setEditingArticleId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<ArticleDraft>(EMPTY_DRAFT);
  const [rawContent, setRawContent] = useState("");
  const [aiPreparing, setAiPreparing] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState<SaveState>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const listRequestVersion = useRef(0);
  const detailRequestVersion = useRef(0);
  const lastArticleCreateRequestId = useRef<number | undefined>(undefined);

  const isBusy = saving !== null || aiPreparing;
  const selectedArticleId = selected?.article.id ?? null;
  const editorPanelRef = useRef<HTMLElement | null>(null);
  const editorTitleInputRef = useRef<HTMLInputElement | null>(null);
  const editorReturnFocusRef = useRef<HTMLElement | null>(null);
  const editorWasBusyRef = useRef(false);

  const visibleArticles = useMemo(
    () =>
      articles.filter(({ article }) =>
        articleMatchesListFilter(article, articleListFilter),
      ),
    [articleListFilter, articles],
  );

  const loadArticles = useCallback(
    async (query: string) => {
      const requestVersion = listRequestVersion.current + 1;
      listRequestVersion.current = requestVersion;
      setLoadingList(true);
      setError("");

      try {
        const nextArticles = await invokeKnowledgeBase(
          {
            type: "listArticles",
            tenantId,
            ...(query.trim() ? { query: query.trim() } : {}),
          },
          parseArticleList,
        );
        if (listRequestVersion.current !== requestVersion) return;
        setArticles(nextArticles);
      } catch (nextError) {
        if (listRequestVersion.current === requestVersion) {
          setArticles([]);
          setError(
            errorMessage(
              nextError,
              "Die Wissensartikel konnten nicht geladen werden.",
            ),
          );
        }
      } finally {
        if (listRequestVersion.current === requestVersion) {
          setLoadingList(false);
        }
      }
    },
    [tenantId],
  );

  useEffect(() => {
    setSelected(null);
    setEditingArticleId(null);
    setDraft(EMPTY_DRAFT);
    setRawContent("");
    setAiPreparing(false);
    setEditorOpen(false);
    setActiveQuery("");
    setArticleListFilter("all");
    setSearchInput("");
    void loadArticles("");

    return () => {
      listRequestVersion.current += 1;
      detailRequestVersion.current += 1;
    };
  }, [loadArticles]);

  useEffect(() => {
    if (!editorOpen) {
      editorWasBusyRef.current = false;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      if (isBusy) {
        editorPanelRef.current?.focus({ preventScroll: true });
      } else if (!editorWasBusyRef.current) {
        editorTitleInputRef.current?.focus({ preventScroll: true });
      }
      editorWasBusyRef.current = isBusy;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editorOpen, isBusy]);

  const openArticle = useCallback(
    async (articleId: string) => {
      const requestVersion = detailRequestVersion.current + 1;
      detailRequestVersion.current = requestVersion;
      setLoadingDetail(true);
      setError("");
      setSuccess("");

      try {
        const detail = await invokeKnowledgeBase(
          { type: "getArticle", tenantId, articleId },
          parseArticleDetail,
        );
        if (detailRequestVersion.current !== requestVersion) return;
        setSelected(detail);
      } catch (nextError) {
        if (detailRequestVersion.current === requestVersion) {
          setSelected(null);
          setError(
            errorMessage(nextError, "Der Artikel konnte nicht geladen werden."),
          );
        }
      } finally {
        if (detailRequestVersion.current === requestVersion) {
          setLoadingDetail(false);
        }
      }
    },
    [tenantId],
  );

  useEffect(() => {
    if (!focusArticleId) return;
    void openArticle(focusArticleId);
  }, [focusArticleId, openArticle]);

  function beginNewArticle() {
    editorReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setEditingArticleId(null);
    setDraft(EMPTY_DRAFT);
    setRawContent("");
    setError("");
    setSuccess("");
    setEditorOpen(true);
  }

  useEffect(() => {
    if (
      createArticleRequestId === undefined ||
      lastArticleCreateRequestId.current === createArticleRequestId
    ) {
      return;
    }
    lastArticleCreateRequestId.current = createArticleRequestId;
    beginNewArticle();
    onCreateArticleRequestConsumed?.(createArticleRequestId);
  }, [createArticleRequestId, onCreateArticleRequestConsumed]);

  function beginEditArticle() {
    if (!selected) return;
    editorReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setEditingArticleId(selected.article.id);
    setDraft(draftFromDetail(selected));
    setRawContent("");
    setError("");
    setSuccess("");
    setEditorOpen(true);
  }

  function closeEditor() {
    if (isBusy) return;
    editorWasBusyRef.current = false;
    setEditingArticleId(null);
    setDraft(EMPTY_DRAFT);
    setRawContent("");
    setEditorOpen(false);
    window.requestAnimationFrame(() => {
      editorReturnFocusRef.current?.focus({ preventScroll: true });
      editorReturnFocusRef.current = null;
    });
  }

  function handleEditorDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (shouldCloseKnowledgeEditor(event.key, isBusy)) {
      event.preventDefault();
      closeEditor();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null);
    const firstFocusable = focusable[0];
    const lastFocusable = focusable[focusable.length - 1];
    if (!firstFocusable || !lastFocusable) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }

    const activeElement = document.activeElement;
    if (
      event.shiftKey &&
      (activeElement === firstFocusable ||
        activeElement === event.currentTarget)
    ) {
      event.preventDefault();
      lastFocusable.focus();
    } else if (
      !event.shiftKey &&
      (activeElement === lastFocusable || activeElement === event.currentTarget)
    ) {
      event.preventDefault();
      firstFocusable.focus();
    }
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchInput.trim();
    setActiveQuery(query);
    setSelected(null);
    await loadArticles(query);
  }

  async function clearSearch() {
    setSearchInput("");
    setActiveQuery("");
    setSelected(null);
    await loadArticles("");
  }

  function changeArticleListFilter(nextFilter: ArticleListFilter) {
    setArticleListFilter(nextFilter);
    setSelected((current) =>
      current && articleMatchesListFilter(current.article, nextFilter)
        ? current
        : null,
    );
  }

  async function prepareWithAi() {
    const normalizedRawContent = rawContent.trim();
    if (!normalizedRawContent) {
      setError(
        "Erfassen Sie zuerst den fachlichen Rohinhalt für die KI-Aufbereitung.",
      );
      setSuccess("");
      return;
    }
    setAiPreparing(true);
    setError("");
    setSuccess("");
    try {
      const prepared = await invokeAiAssist(
        {
          type: "prepareKnowledgeArticle",
          tenantId,
          ...(editingArticleId ? { articleId: editingArticleId } : {}),
          visibility: draft.visibility,
          rawContent: normalizedRawContent,
        },
        parsePreparedKnowledgeArticle,
      );
      setDraft((current) => ({
        ...current,
        title: prepared.title,
        bodyMarkdown: prepared.bodyMarkdown,
      }));
      setSuccess(
        "Der KI-Entwurf wurde eingesetzt. Prüfen und ändern Sie ihn bei Bedarf, bevor Sie den Artikel speichern.",
      );
    } catch (nextError) {
      const status =
        nextError instanceof KnowledgeBaseRequestError
          ? nextError.status
          : null;
      setError(
        status === 403
          ? "Die KI-Aufbereitung ist für diesen Mandanten oder diese Sichtbarkeit noch nicht freigegeben."
          : nextError instanceof KnowledgeBaseRequestError
            ? `${nextError.message} Der Artikelentwurf wurde nicht verändert.`
            : "Die KI-Aufbereitung ist derzeit nicht verfügbar. Der Artikelentwurf wurde nicht verändert.",
      );
    } finally {
      setAiPreparing(false);
    }
  }

  async function saveArticle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = draft.title.trim();
    if (title.length < 3 || title.length > 240) {
      setError("Der Titel muss zwischen 3 und 240 Zeichen lang sein.");
      setSuccess("");
      return;
    }
    if (draft.bodyMarkdown.length > 100_000) {
      setError("Der Markdown-Inhalt darf höchstens 100.000 Zeichen umfassen.");
      setSuccess("");
      return;
    }

    const isEditing = editingArticleId !== null;
    setSaving("save");
    setError("");
    setSuccess("");

    try {
      const detail = await invokeKnowledgeBase(
        buildKnowledgeArticleSaveRequest({
          tenantId,
          ...(editingArticleId ? { articleId: editingArticleId } : {}),
          title,
          bodyMarkdown: draft.bodyMarkdown,
          visibility: draft.visibility,
        }),
        parseArticleDetail,
      );
      const savedDetail = detail;
      setArticles((current) => {
        const withoutSaved = current.filter(
          ({ article }) => article.id !== savedDetail.article.id,
        );
        return [
          { article: savedDetail.article, revision: savedDetail.revision },
          ...withoutSaved,
        ];
      });
      setSelected(savedDetail);
      setEditingArticleId(null);
      setDraft(EMPTY_DRAFT);
      setRawContent("");
      setEditorOpen(false);
      setSuccess(
        isEditing
          ? "Der Wissensartikel wurde gespeichert."
          : "Der Wissensartikel wurde angelegt.",
      );
    } catch (nextError) {
      setError(writeErrorMessage(nextError, "save"));
    } finally {
      setSaving(null);
    }
  }

  async function archiveArticle() {
    if (!selected) return;
    const confirmed = window.confirm(
      `Möchten Sie den Artikel „${selected.article.title}“ wirklich archivieren?`,
    );
    if (!confirmed) return;

    const articleId = selected.article.id;
    setSaving("archive");
    setError("");
    setSuccess("");

    try {
      await invokeKnowledgeBase(
        { type: "archiveArticle", tenantId, articleId },
        parseArchivedArticle,
      );
      setArticles((current) =>
        current.filter(({ article }) => article.id !== articleId),
      );
      setSelected(null);
      if (editingArticleId === articleId) {
        setEditingArticleId(null);
        setDraft(EMPTY_DRAFT);
        setEditorOpen(false);
      }
      setSuccess("Der Wissensartikel wurde archiviert.");
    } catch (nextError) {
      setError(writeErrorMessage(nextError, "archive"));
    } finally {
      setSaving(null);
    }
  }

  async function requestReview() {
    if (!selected) return;
    setSaving("review");
    setError("");
    setSuccess("");
    try {
      const article = await invokeKnowledgeBase(
        { type: "requestReview", tenantId, articleId: selected.article.id },
        parseReturnedArticle,
      );
      setSelected((current) => (current ? { ...current, article } : current));
      setArticles((current) =>
        current.map((item) =>
          item.article.id === article.id ? { ...item, article } : item,
        ),
      );
      setSuccess("Der Artikel wurde zur Freigabe eingereicht.");
    } catch (nextError) {
      setError(
        errorMessage(
          nextError,
          "Der Artikel konnte nicht zur Freigabe eingereicht werden.",
        ),
      );
    } finally {
      setSaving(null);
    }
  }

  async function decideReview(decision: "approved" | "rejected") {
    if (!selected) return;
    setSaving("decision");
    setError("");
    setSuccess("");
    try {
      const article = await invokeKnowledgeBase(
        {
          type: "decideReview",
          tenantId,
          articleId: selected.article.id,
          decision,
        },
        parseReturnedArticle,
      );
      setSelected((current) => (current ? { ...current, article } : current));
      setArticles((current) =>
        current.map((item) =>
          item.article.id === article.id ? { ...item, article } : item,
        ),
      );
      setSuccess(
        decision === "approved"
          ? "Die aktuelle Revision ist veröffentlicht."
          : "Die Freigabe wurde abgelehnt; der Artikel bleibt ein Entwurf.",
      );
    } catch (nextError) {
      setError(
        errorMessage(
          nextError,
          "Die Freigabeentscheidung konnte nicht gespeichert werden.",
        ),
      );
    } finally {
      setSaving(null);
    }
  }

  const editorTitle = editingArticleId
    ? "Wissensartikel bearbeiten"
    : "Neuen Wissensartikel anlegen";
  const detailArticle = selected?.article;
  const articleCountLabel = `${visibleArticles.length} Artikel`;
  const isListFiltered = articleListFilter !== "all";
  const previewTitle = draft.title.trim() || "Titel des Artikels";

  return (
    <div className="knowledge-base">
      <style>{knowledgeBaseStyles}</style>

      <section
        className="panel knowledge-base__library"
        aria-labelledby="knowledge-base-heading"
      >
        <div className="knowledge-base__library-heading">
          <div>
            <p className="eyebrow">Wissensdatenbank</p>
            <h2 id="knowledge-base-heading">Wissen, das weiterhilft</h2>
            <p className="knowledge-base__intro">
              Anleitungen, Abläufe und Lösungen für den Arbeitsalltag.
            </p>
          </div>
          <div className="knowledge-base__library-summary">
            <span className="knowledge-base__count">
              {activeQuery || isListFiltered
                ? `${articleCountLabel} gefunden`
                : articleCountLabel}
            </span>
            <button
              className="knowledge-base__button"
              disabled={loadingList || isBusy}
              onClick={() => void loadArticles(activeQuery)}
              type="button"
            >
              {loadingList ? "Wird aktualisiert …" : "Aktualisieren"}
            </button>
          </div>
        </div>

        <div className="knowledge-base__toolbar">
          <form
            className="knowledge-base__search"
            onSubmit={(event) => void submitSearch(event)}
          >
            <input
              aria-describedby="knowledge-search-help"
              aria-label="Wissensdatenbank durchsuchen"
              disabled={loadingList || isBusy}
              maxLength={120}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Titel und Artikelinhalt durchsuchen"
              type="search"
              value={searchInput}
            />
            <button
              className="knowledge-base__button"
              disabled={loadingList || isBusy}
              type="submit"
            >
              Suchen
            </button>
            {activeQuery ? (
              <button
                className="knowledge-base__button"
                disabled={loadingList || isBusy}
                onClick={() => void clearSearch()}
                type="button"
              >
                Suche löschen
              </button>
            ) : null}
            <p
              className="knowledge-base__search-help"
              id="knowledge-search-help"
            >
              Durchsucht Titel, Zusammenfassung und Artikelinhalt.
            </p>
          </form>
          <div className="knowledge-base__filters">
            <label className="knowledge-base__filter">
              Anzeigen
              <select
                aria-label="Wissensartikel nach Sichtbarkeit oder Status filtern"
                disabled={loadingList || isBusy}
                onChange={(event) =>
                  changeArticleListFilter(
                    event.target.value as ArticleListFilter,
                  )
                }
                value={articleListFilter}
              >
                {(
                  Object.keys(articleListFilterLabels) as ArticleListFilter[]
                ).map((filter) => (
                  <option key={filter} value={filter}>
                    {articleListFilterLabels[filter]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="knowledge-base__toolbar-actions">
            <button
              className="primary-button knowledge-base__button knowledge-base__create-button"
              disabled={isBusy}
              onClick={beginNewArticle}
              type="button"
            >
              Neuer Artikel
            </button>
          </div>
        </div>

        <div className="knowledge-base__content">
          <div className="knowledge-base__grid">
            <div className="knowledge-base__list-column">
              <div className="knowledge-base__list-heading">
                <div>
                  <p className="eyebrow">Bibliothek</p>
                  <h3>Artikel</h3>
                </div>
                <span aria-hidden="true" className="knowledge-base__count">
                  {visibleArticles.length}
                </span>
              </div>
              {loadingList ? (
                <p className="knowledge-base__empty" aria-live="polite">
                  Wissensartikel werden geladen …
                </p>
              ) : visibleArticles.length === 0 ? (
                <p className="knowledge-base__empty">
                  {activeQuery || isListFiltered
                    ? "Für diese Suche und Filterauswahl wurden keine Artikel gefunden."
                    : "Es sind noch keine Wissensartikel vorhanden."}
                </p>
              ) : (
                <ul
                  className="knowledge-base__list"
                  aria-label="Wissensartikel"
                >
                  {visibleArticles.map(({ article, revision }) => (
                    <li key={article.id}>
                      <button
                        aria-current={
                          selectedArticleId === article.id || undefined
                        }
                        className="knowledge-base__article-button"
                        disabled={isBusy}
                        onClick={() => void openArticle(article.id)}
                        type="button"
                      >
                        <span className="knowledge-base__article-card-top">
                          <span
                            className={`knowledge-base__badge knowledge-base__badge--${article.status}`}
                          >
                            {statusLabels[article.status]}
                          </span>
                          <span
                            className={`knowledge-base__badge${article.visibility === "external" ? " knowledge-base__badge--external" : ""}`}
                          >
                            {visibilityLabels[article.visibility]}
                          </span>
                        </span>
                        <h3>{article.title}</h3>
                        <p className="knowledge-base__article-excerpt">
                          {shortBody(revision?.body ?? null)}
                        </p>
                        <span className="knowledge-base__article-link">
                          Artikel lesen <span aria-hidden="true">→</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <section
              className="knowledge-base__detail"
              aria-live="polite"
              aria-labelledby="knowledge-article-detail-heading"
            >
              {loadingDetail ? (
                <p className="knowledge-base__empty">Artikel wird geladen …</p>
              ) : detailArticle && selected ? (
                <>
                  <div className="knowledge-base__detail-header">
                    <div>
                      <p className="eyebrow">
                        Wissensdatenbank · Wissensartikel
                      </p>
                      <h3 id="knowledge-article-detail-heading">
                        {detailArticle.title}
                      </h3>
                      <p className="knowledge-base__meta">
                        <span
                          className={`knowledge-base__badge knowledge-base__badge--${detailArticle.status}`}
                        >
                          {statusLabels[detailArticle.status]}
                        </span>
                        <span
                          className={`knowledge-base__badge${detailArticle.visibility === "external" ? " knowledge-base__badge--external" : ""}`}
                        >
                          {visibilityLabels[detailArticle.visibility]}
                        </span>
                        <span>
                          Revision {selected.revision.revision} · Aktualisiert{" "}
                          {formatDate(detailArticle.updatedAt)}
                        </span>
                        {detailArticle.publishedRevision ? (
                          <span>
                            Veröffentlichte Revision{" "}
                            {detailArticle.publishedRevision}
                          </span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                  <article
                    className="knowledge-base__markdown"
                    aria-label="Artikelinhalt"
                  >
                    {selected.revision.body ? (
                      <ReactMarkdown>{selected.revision.body}</ReactMarkdown>
                    ) : (
                      "Dieser Artikel enthält noch keinen Inhalt."
                    )}
                  </article>
                  <div className="knowledge-base__actions knowledge-base__article-actions">
                    <button
                      className="knowledge-base__button"
                      disabled={isBusy}
                      onClick={beginEditArticle}
                      type="button"
                    >
                      Bearbeiten
                    </button>
                    {detailArticle.status === "draft" ? (
                      <button
                        className="knowledge-base__button"
                        disabled={isBusy}
                        onClick={() => void requestReview()}
                        type="button"
                      >
                        {saving === "review"
                          ? "Wird eingereicht …"
                          : "Zur Freigabe einreichen"}
                      </button>
                    ) : null}
                    {detailArticle.status === "review" ? (
                      <>
                        <button
                          className="knowledge-base__button"
                          disabled={isBusy}
                          onClick={() => void decideReview("approved")}
                          type="button"
                        >
                          {saving === "decision"
                            ? "Wird gespeichert …"
                            : "Freigeben"}
                        </button>
                        <button
                          className="knowledge-base__button knowledge-base__button--danger"
                          disabled={isBusy}
                          onClick={() => void decideReview("rejected")}
                          type="button"
                        >
                          Ablehnen
                        </button>
                      </>
                    ) : null}
                    <button
                      className="knowledge-base__button knowledge-base__button--danger"
                      disabled={isBusy}
                      onClick={() => void archiveArticle()}
                      type="button"
                    >
                      {saving === "archive"
                        ? "Wird archiviert …"
                        : "Archivieren"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="knowledge-base__reader-empty">
                  <p className="eyebrow">Artikelansicht</p>
                  <h3>Wählen Sie einen Artikel</h3>
                  <p>
                    Öffnen Sie einen Eintrag aus der Bibliothek, um ihn ruhig
                    und gut lesbar anzuzeigen.
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      </section>

      {editorOpen && (
        <div className="knowledge-base__editor-backdrop">
          <section
            aria-busy={isBusy}
            aria-labelledby="knowledge-article-form-heading"
            aria-modal="true"
            className="panel knowledge-base__editor-panel"
            onKeyDown={handleEditorDialogKeyDown}
            ref={editorPanelRef}
            role="dialog"
            tabIndex={knowledgeEditorDialogTabIndex(isBusy)}
          >
            <div className="knowledge-base__editor-heading">
              <div>
                <p className="eyebrow">
                  {editingArticleId ? "Artikel bearbeiten" : "Neuer Artikel"}
                </p>
                <h2 id="knowledge-article-form-heading">{editorTitle}</h2>
                <p className="knowledge-base__intro">
                  Schreiben Sie klar, strukturieren Sie mit Markdown und prüfen
                  Sie die Darstellung direkt in der Vorschau.
                </p>
              </div>
              <div className="knowledge-base__editor-heading-actions">
                <span
                  className={`knowledge-base__badge knowledge-base__badge--${draft.status}`}
                >
                  {statusLabels[draft.status]}
                </span>
                <button
                  className="knowledge-base__button knowledge-base__editor-close"
                  disabled={isBusy}
                  onClick={closeEditor}
                  type="button"
                >
                  Schliessen
                </button>
              </div>
            </div>

            {error ? (
              <p
                className="knowledge-base__message knowledge-base__message--error"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <form
              className="knowledge-base__form knowledge-base__form-panel"
              onSubmit={(event) => void saveArticle(event)}
            >
              <label>
                Titel
                <input
                  disabled={isBusy}
                  maxLength={240}
                  minLength={3}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="Zum Beispiel: VPN-Verbindung einrichten"
                  ref={editorTitleInputRef}
                  required
                  value={draft.title}
                />
              </label>

              <label>
                Sichtbarkeit
                <select
                  disabled={isBusy}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      visibility: event.target.value as ArticleVisibility,
                    }))
                  }
                  value={draft.visibility}
                >
                  <option value="internal">Intern</option>
                  <option value="external">Extern</option>
                </select>
              </label>

              <p className="knowledge-base__hint">
                Speichern erstellt immer einen Entwurf; für externe Artikel
                bleibt die letzte freigegebene Revision sichtbar, bis die neue
                Revision erneut freigegeben wird.
              </p>

              <label className="knowledge-base__full-width">
                Rohinhalt für die KI-Aufbereitung
                <textarea
                  disabled={isBusy}
                  maxLength={1200}
                  onChange={(event) => setRawContent(event.target.value)}
                  placeholder="Zum Beispiel: Problem, Lösungsschritte, Voraussetzungen, bekannte Hinweise und offene Punkte."
                  rows={7}
                  value={rawContent}
                />
              </label>

              <div className="knowledge-base__full-width knowledge-base__ai-assist">
                <div>
                  <strong>Mit KI aufbereiten</strong>
                  <p>
                    Erst beim Klick wird der Rohinhalt zur Aufbereitung an den
                    für diesen Mandanten freigegebenen externen KI-Anbieter
                    übermittelt. Der Vorschlag wird nicht automatisch
                    gespeichert oder veröffentlicht.
                  </p>
                </div>
                <button
                  className="knowledge-base__button"
                  disabled={isBusy || rawContent.trim().length === 0}
                  onClick={() => void prepareWithAi()}
                  type="button"
                >
                  {aiPreparing ? "KI bereitet auf …" : "Mit KI aufbereiten"}
                </button>
              </div>

              <label className="knowledge-base__full-width">
                Markdown-Inhalt
                <textarea
                  disabled={isBusy}
                  maxLength={100000}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      bodyMarkdown: event.target.value,
                    }))
                  }
                  placeholder={
                    "# Überschrift\n\nBeschreiben Sie hier die Lösung oder den Ablauf in Markdown."
                  }
                  rows={12}
                  value={draft.bodyMarkdown}
                />
              </label>

              <aside className="knowledge-base__preview knowledge-base__full-width">
                <div className="knowledge-base__preview-heading">
                  <p className="eyebrow">Live-Vorschau</p>
                  <span>{visibilityLabels[draft.visibility]}</span>
                </div>
                <h3>{previewTitle}</h3>
                <article className="knowledge-base__markdown knowledge-base__markdown--preview">
                  {draft.bodyMarkdown ? (
                    <ReactMarkdown>{draft.bodyMarkdown}</ReactMarkdown>
                  ) : (
                    <p>
                      Beginnen Sie mit einer kurzen Einleitung. Die Vorschau
                      zeigt die spätere Artikelansicht direkt an.
                    </p>
                  )}
                </article>
              </aside>

              <div className="knowledge-base__form-actions knowledge-base__full-width">
                <button
                  className="primary-button knowledge-base__save"
                  disabled={isBusy}
                  type="submit"
                >
                  {saving === "save"
                    ? "Wird gespeichert …"
                    : editingArticleId
                      ? "Änderungen speichern"
                      : "Artikel anlegen"}
                </button>
                <button
                  className="knowledge-base__button"
                  disabled={isBusy}
                  onClick={closeEditor}
                  type="button"
                >
                  Abbrechen
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {error ? (
        <p
          className="knowledge-base__message knowledge-base__message--error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {success ? (
        <p
          className="knowledge-base__message knowledge-base__message--success"
          role="status"
        >
          {success}
        </p>
      ) : null}
    </div>
  );
}
