import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import { functionErrorMessage } from "./lib/function-error";
import { supabase } from "./lib/supabase";

export type KnowledgeBaseProps = {
  createArticleRequestId?: number | undefined;
  focusArticleId?: string | undefined;
  onCreateArticleRequestConsumed?: ((requestId: number) => void) | undefined;
  tenantId: string;
};

type ArticleVisibility = "internal" | "external";
type ArticleStatus = "draft" | "review" | "published" | "archived";
type EditableArticleStatus = Exclude<ArticleStatus, "archived">;
type SaveState =
  "save" | "archive" | "review" | "decision" | "collection" | null;

type KnowledgeArticle = {
  id: string;
  title: string;
  slug: string;
  visibility: ArticleVisibility;
  status: ArticleStatus;
  currentRevision: number | null;
  publishedRevision: number | null;
  reviewRequestedAt: string | null;
  collectionIds: string[];
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
  collectionIds: string[];
};

type KnowledgeCollection = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
};

type ListCollectionsRequest = { type: "listCollections"; tenantId: string };
type CreateCollectionRequest = {
  type: "createCollection";
  tenantId: string;
  name: string;
  parentId?: string;
};
type SetArticleCollectionsRequest = {
  type: "setArticleCollections";
  tenantId: string;
  articleId: string;
  collectionIds: string[];
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

type SaveArticleRequest = {
  type: "saveArticle";
  tenantId: string;
  articleId?: string;
  title: string;
  bodyMarkdown: string;
  visibility: ArticleVisibility;
};

type ArchiveArticleRequest = {
  type: "archiveArticle";
  tenantId: string;
  articleId: string;
};

type KnowledgeBaseRequest =
  | ListCollectionsRequest
  | CreateCollectionRequest
  | SetArticleCollectionsRequest
  | ReviewRequest
  | ReviewDecisionRequest
  | ListArticlesRequest
  | GetArticleRequest
  | SaveArticleRequest
  | ArchiveArticleRequest;

const EMPTY_DRAFT: ArticleDraft = {
  title: "",
  bodyMarkdown: "",
  visibility: "internal",
  status: "draft",
  collectionIds: [],
};
const MAX_ARTICLE_CATEGORIES = 12;

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

  const collectionIds = Array.isArray(value.collection_ids)
    ? value.collection_ids.filter((id): id is string => typeof id === "string")
    : [];
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
    collectionIds,
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

function parseCollection(value: unknown): KnowledgeCollection | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.slug !== "string" ||
    (typeof value.parent_id !== "string" && value.parent_id !== null)
  ) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    slug: value.slug,
    parentId: value.parent_id,
  };
}

function parseCollections(value: unknown): KnowledgeCollection[] {
  const collections = responseData(value).collections;
  if (!Array.isArray(collections)) {
    throw new KnowledgeBaseRequestError(
      "Die Kategorien der Wissensdatenbank sind unvollständig.",
    );
  }
  const parsed = collections.map(parseCollection);
  if (
    !parsed.every(
      (collection): collection is KnowledgeCollection => collection !== null,
    )
  ) {
    throw new KnowledgeBaseRequestError(
      "Die Kategorien der Wissensdatenbank sind ungültig.",
    );
  }
  return parsed;
}

function sortCollections(
  collections: KnowledgeCollection[],
): KnowledgeCollection[] {
  const byId = new Map(
    collections.map((collection) => [collection.id, collection]),
  );
  return [...collections].sort((left, right) => {
    const leftRoot = left.parentId
      ? (byId.get(left.parentId)?.name ?? left.name)
      : left.name;
    const rightRoot = right.parentId
      ? (byId.get(right.parentId)?.name ?? right.name)
      : right.name;
    const rootComparison = leftRoot.localeCompare(rightRoot, "de-CH");
    if (rootComparison !== 0) return rootComparison;
    if (left.parentId === null && right.parentId !== null) return -1;
    if (left.parentId !== null && right.parentId === null) return 1;
    return left.name.localeCompare(right.name, "de-CH");
  });
}

function collectionPath(
  collectionId: string,
  collectionsById: Map<string, KnowledgeCollection>,
): string | null {
  const collection = collectionsById.get(collectionId);
  if (!collection) return null;
  const parent = collection.parentId
    ? collectionsById.get(collection.parentId)
    : null;
  return parent ? `${parent.name} › ${collection.name}` : collection.name;
}

function collectionPaths(
  collectionIds: string[],
  collectionsById: Map<string, KnowledgeCollection>,
): string[] {
  return [
    ...new Set(
      collectionIds
        .map((collectionId) => collectionPath(collectionId, collectionsById))
        .filter((path): path is string => Boolean(path)),
    ),
  ];
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

function draftFromDetail(detail: ArticleDetail): ArticleDraft {
  return {
    title: detail.article.title,
    bodyMarkdown: detail.revision.body,
    visibility: detail.article.visibility,
    status:
      detail.article.status === "archived" ? "draft" : detail.article.status,
    collectionIds: detail.article.collectionIds,
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
  const [collections, setCollections] = useState<KnowledgeCollection[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [selected, setSelected] = useState<ArticleDetail | null>(null);
  const [editingArticleId, setEditingArticleId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryParentId, setNewCategoryParentId] = useState("");
  const [draft, setDraft] = useState<ArticleDraft>(EMPTY_DRAFT);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState<SaveState>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const listRequestVersion = useRef(0);
  const detailRequestVersion = useRef(0);
  const lastArticleCreateRequestId = useRef<number | undefined>(undefined);

  const isBusy = saving !== null;
  const selectedArticleId = selected?.article.id ?? null;
  const editorPanelRef = useRef<HTMLElement | null>(null);
  const editorTitleInputRef = useRef<HTMLInputElement | null>(null);
  const collectionsById = useMemo(
    () => new Map(collections.map((collection) => [collection.id, collection])),
    [collections],
  );
  const rootCategories = useMemo(
    () => collections.filter((collection) => collection.parentId === null),
    [collections],
  );

  const visibleArticles = useMemo(
    () => articles.filter(({ article }) => article.status !== "archived"),
    [articles],
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

  const loadCollections = useCallback(async () => {
    try {
      const nextCollections = await invokeKnowledgeBase(
        { type: "listCollections", tenantId },
        parseCollections,
      );
      setCollections(sortCollections(nextCollections));
    } catch {
      // The article reader stays usable for people without internal knowledge
      // permissions. Category management is intentionally hidden for them.
      setCollections([]);
    }
  }, [tenantId]);

  useEffect(() => {
    setSelected(null);
    setEditingArticleId(null);
    setDraft(EMPTY_DRAFT);
    setEditorOpen(false);
    setCategoryManagerOpen(false);
    setNewCategoryName("");
    setNewCategoryParentId("");
    setActiveQuery("");
    setSearchInput("");
    void loadArticles("");
    void loadCollections();

    return () => {
      listRequestVersion.current += 1;
      detailRequestVersion.current += 1;
    };
  }, [loadArticles, loadCollections]);

  useEffect(() => {
    if (!editorOpen) return;
    const frame = window.requestAnimationFrame(() => {
      editorPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      editorTitleInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editorOpen]);

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
    setEditingArticleId(null);
    setDraft(EMPTY_DRAFT);
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
    setEditingArticleId(selected.article.id);
    setDraft(draftFromDetail(selected));
    setError("");
    setSuccess("");
    setEditorOpen(true);
  }

  function cancelEdit() {
    setEditingArticleId(null);
    setDraft(EMPTY_DRAFT);
    setEditorOpen(false);
  }

  function toggleDraftCollection(collectionId: string) {
    const isSelected = draft.collectionIds.includes(collectionId);
    if (!isSelected && draft.collectionIds.length >= MAX_ARTICLE_CATEGORIES) {
      setError(
        `Ein Artikel kann höchstens ${MAX_ARTICLE_CATEGORIES} Kategorien haben.`,
      );
      setSuccess("");
      return;
    }
    setDraft((current) => ({
      ...current,
      collectionIds: current.collectionIds.includes(collectionId)
        ? current.collectionIds.filter((id) => id !== collectionId)
        : [...current.collectionIds, collectionId],
    }));
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
    if (draft.collectionIds.length > MAX_ARTICLE_CATEGORIES) {
      setError(
        `Ein Artikel kann höchstens ${MAX_ARTICLE_CATEGORIES} Kategorien haben.`,
      );
      setSuccess("");
      return;
    }

    const isEditing = editingArticleId !== null;
    setSaving("save");
    setError("");
    setSuccess("");

    try {
      const detail = await invokeKnowledgeBase(
        {
          type: "saveArticle",
          tenantId,
          ...(editingArticleId ? { articleId: editingArticleId } : {}),
          title,
          bodyMarkdown: draft.bodyMarkdown,
          visibility: draft.visibility,
        },
        parseArticleDetail,
      );
      await invokeKnowledgeBase(
        {
          type: "setArticleCollections",
          tenantId,
          articleId: detail.article.id,
          collectionIds: draft.collectionIds,
        },
        () => undefined,
      );
      const savedDetail: ArticleDetail = {
        ...detail,
        article: {
          ...detail.article,
          collectionIds: draft.collectionIds,
        },
      };
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
      if (editingArticleId === articleId) cancelEdit();
      setSuccess("Der Wissensartikel wurde archiviert.");
    } catch (nextError) {
      setError(writeErrorMessage(nextError, "archive"));
    } finally {
      setSaving(null);
    }
  }

  async function createCollection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newCategoryName.trim();
    if (name.length < 2 || name.length > 100) {
      setError("Der Kategoriename muss zwischen 2 und 100 Zeichen lang sein.");
      setSuccess("");
      return;
    }

    const parentId = newCategoryParentId || undefined;
    setSaving("collection");
    setError("");
    setSuccess("");
    try {
      const collection = await invokeKnowledgeBase(
        {
          type: "createCollection",
          tenantId,
          name,
          ...(parentId ? { parentId } : {}),
        },
        (value) => {
          const parsed = parseCollection(responseData(value).collection);
          if (!parsed)
            throw new KnowledgeBaseRequestError(
              "Die Kategorieantwort ist ungültig.",
            );
          return parsed;
        },
      );
      setCollections((current) => sortCollections([...current, collection]));
      setDraft((current) => ({
        ...current,
        collectionIds: [...new Set([...current.collectionIds, collection.id])],
      }));
      setNewCategoryName("");
      setCategoryManagerOpen(false);
      setSuccess(
        parentId
          ? `Unterkategorie „${collection.name}“ wurde angelegt.`
          : `Hauptkategorie „${collection.name}“ wurde angelegt.`,
      );
    } catch (nextError) {
      setError(
        errorMessage(nextError, "Die Kategorie konnte nicht angelegt werden."),
      );
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
  const previewTitle = draft.title.trim() || "Titel des Artikels";
  const previewCollections = collections.filter((collection) =>
    draft.collectionIds.includes(collection.id),
  );

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
              {activeQuery
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
          <div className="knowledge-base__toolbar-actions">
            <button
              className="primary-button knowledge-base__button knowledge-base__create-button"
              disabled={isBusy}
              onClick={beginNewArticle}
              type="button"
            >
              Neuer Artikel
            </button>
            <button
              className="knowledge-base__button"
              disabled={isBusy}
              onClick={() => setCategoryManagerOpen((current) => !current)}
              type="button"
            >
              Kategorien verwalten
            </button>
          </div>
        </div>

        {categoryManagerOpen ? (
          <form
            className="knowledge-base__category-manager"
            onSubmit={(event) => void createCollection(event)}
          >
            <div className="knowledge-base__category-manager-copy">
              <strong>Haupt- und Unterkategorien</strong>
              <p>
                Wählen Sie eine Hauptkategorie für eine Unterkategorie oder
                lassen Sie das Feld leer, um eine neue Hauptkategorie anzulegen.
              </p>
            </div>
            <label>
              Übergeordnete Kategorie
              <select
                disabled={isBusy}
                onChange={(event) => setNewCategoryParentId(event.target.value)}
                value={newCategoryParentId}
              >
                <option value="">Neue Hauptkategorie</option>
                {rootCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Name
              <input
                disabled={isBusy}
                maxLength={100}
                minLength={2}
                onChange={(event) => setNewCategoryName(event.target.value)}
                placeholder={
                  newCategoryParentId
                    ? "Zum Beispiel: Microsoft 365"
                    : "Zum Beispiel: Arbeitsplätze"
                }
                required
                value={newCategoryName}
              />
            </label>
            <div className="knowledge-base__category-manager-actions">
              <button
                className="primary-button knowledge-base__save"
                disabled={isBusy}
                type="submit"
              >
                {saving === "collection" ? "Wird angelegt …" : "Anlegen"}
              </button>
              <button
                className="knowledge-base__button"
                disabled={isBusy}
                onClick={() => setCategoryManagerOpen(false)}
                type="button"
              >
                Abbrechen
              </button>
            </div>
          </form>
        ) : null}

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
                  {activeQuery
                    ? "Für diese Suche wurden keine Artikel gefunden."
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
                        {collectionPaths(article.collectionIds, collectionsById)
                          .length ? (
                          <span className="knowledge-base__article-categories">
                            {collectionPaths(
                              article.collectionIds,
                              collectionsById,
                            ).map((path) => (
                              <span key={path}>{path}</span>
                            ))}
                          </span>
                        ) : null}
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
                        {collectionPaths(
                          detailArticle.collectionIds,
                          collectionsById,
                        ).map((path) => (
                          <span
                            className="knowledge-base__badge knowledge-base__badge--category"
                            key={path}
                          >
                            {path}
                          </span>
                        ))}
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
        <section
          className="panel knowledge-base__editor-panel"
          aria-labelledby="knowledge-article-form-heading"
          ref={editorPanelRef}
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
            <span
              className={`knowledge-base__badge knowledge-base__badge--${draft.status}`}
            >
              {statusLabels[draft.status]}
            </span>
          </div>

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

            <fieldset className="knowledge-base__category-picker">
              <legend>Kategorien und Unterkategorien</legend>
              {collections.length > 0 ? (
                <>
                  <p className="knowledge-base__category-limit">
                    {draft.collectionIds.length} von {MAX_ARTICLE_CATEGORIES}{" "}
                    Kategorien ausgewählt
                  </p>
                  <div className="knowledge-base__category-options">
                    {rootCategories.map((category) => {
                      const subcategories = collections.filter(
                        (collection) => collection.parentId === category.id,
                      );
                      return (
                        <div
                          className="knowledge-base__category-group"
                          key={category.id}
                        >
                          <label className="knowledge-base__category-root">
                            <input
                              checked={draft.collectionIds.includes(
                                category.id,
                              )}
                              disabled={isBusy}
                              onChange={() =>
                                toggleDraftCollection(category.id)
                              }
                              type="checkbox"
                            />
                            <span>{category.name} · Allgemein</span>
                          </label>
                          {subcategories.map((subcategory) => (
                            <label
                              className="knowledge-base__category-subcategory"
                              key={subcategory.id}
                            >
                              <input
                                checked={draft.collectionIds.includes(
                                  subcategory.id,
                                )}
                                disabled={isBusy}
                                onChange={() =>
                                  toggleDraftCollection(subcategory.id)
                                }
                                type="checkbox"
                              />
                              <span>{subcategory.name}</span>
                            </label>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="knowledge-base__hint">
                  Legen Sie zuerst eine Kategorie an, um den Artikel später
                  leichter wiederzufinden.
                </p>
              )}
            </fieldset>

            <p className="knowledge-base__hint">
              Unterkategorien werden unter ihrer Hauptkategorie angezeigt und
              können mehrfach ausgewählt werden. Speichern erstellt immer einen
              Entwurf; für externe Artikel bleibt die letzte freigegebene
              Revision sichtbar, bis die neue Revision erneut freigegeben wird.
            </p>

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
              <div className="knowledge-base__preview-categories">
                {previewCollections.length > 0
                  ? previewCollections.map((collection) => (
                      <span key={collection.id}>
                        {collectionPath(collection.id, collectionsById) ??
                          collection.name}
                      </span>
                    ))
                  : "Noch keiner Kategorie zugeordnet"}
              </div>
              <article className="knowledge-base__markdown knowledge-base__markdown--preview">
                {draft.bodyMarkdown ? (
                  <ReactMarkdown>{draft.bodyMarkdown}</ReactMarkdown>
                ) : (
                  <p>
                    Beginnen Sie mit einer kurzen Einleitung. Die Vorschau zeigt
                    die spätere Artikelansicht direkt an.
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
              {editingArticleId ? (
                <button
                  className="knowledge-base__button"
                  disabled={isBusy}
                  onClick={cancelEdit}
                  type="button"
                >
                  Bearbeitung abbrechen
                </button>
              ) : null}
            </div>
          </form>
        </section>
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
