import { tn } from "./lib/formality";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { History, LoaderCircle, Search, X } from "lucide-react";
import {
  parsePersonSearchHits,
  personInitials,
  personRefFromHit,
  type PersonRef,
  type PersonSearchHit,
} from "./lib/person-overview";
import { functionErrorMessage } from "./lib/function-error";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import {
  loadRecentItems,
  RECENT_ITEM_TYPE_LABEL,
  recentItemAgeLabel,
  type RecentItem,
} from "./lib/recent-items";
import "./person-overview.css";

export type GlobalSearchResult = {
  resultType:
    | "ticket"
    | "follow_up"
    | "knowledge"
    | "event_space"
    | "onboarding"
    | "incident"
    | "security_case";
  entityId: string;
  title: string;
  detail: string;
  section:
    | "Tickets"
    | "Wiedervorlagen"
    | "Wissen"
    | "Raumplanung"
    | "Eintritte"
    | "Störungen"
    | "Sicherheitsfälle";
  ticketId: string | null;
};

export type GlobalSearchScope = "all" | "tickets-only";

type GlobalSearchProps = {
  disabled?: boolean;
  tenantId: string;
  onSelect: (result: GlobalSearchResult) => void;
  /** «Zuletzt angesehen»: shown while the search field is empty. */
  onSelectRecent?: ((item: RecentItem) => void) | undefined;
  /** Agents only: people from the Entra directory. */
  onSelectPerson?: ((person: PersonRef) => void) | undefined;
  scope?: GlobalSearchScope;
};

type SearchTab = "all" | "people" | GlobalSearchResult["section"];

const PEOPLE_PREVIEW = 3;

export function parsePeople(value: unknown): PersonSearchHit[] {
  if (!isRecord(value) || !isRecord(value.data)) return [];
  return parsePersonSearchHits(value.data.people);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseResults(value: unknown): GlobalSearchResult[] | null {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    !Array.isArray(value.data.results)
  ) {
    return null;
  }
  const allowedTypes = new Set<GlobalSearchResult["resultType"]>([
    "ticket",
    "follow_up",
    "knowledge",
    "event_space",
    "onboarding",
    "incident",
    "security_case",
  ]);
  const allowedSections = new Set<GlobalSearchResult["section"]>([
    "Tickets",
    "Wiedervorlagen",
    "Wissen",
    "Raumplanung",
    "Eintritte",
    "Störungen",
    "Sicherheitsfälle",
  ]);
  const results: GlobalSearchResult[] = [];
  for (const rawItem of value.data.results) {
    // The search function still labels this section with its former name.
    const item =
      isRecord(rawItem) && rawItem.section === "Veranstaltungsräume"
        ? { ...rawItem, section: "Raumplanung" }
        : rawItem;
    if (
      !isRecord(item) ||
      !allowedTypes.has(item.resultType as GlobalSearchResult["resultType"]) ||
      typeof item.entityId !== "string" ||
      typeof item.title !== "string" ||
      typeof item.detail !== "string" ||
      !allowedSections.has(item.section as GlobalSearchResult["section"]) ||
      (item.ticketId !== null && typeof item.ticketId !== "string")
    ) {
      return null;
    }
    results.push({
      resultType: item.resultType as GlobalSearchResult["resultType"],
      entityId: item.entityId,
      title: item.title,
      detail: item.detail,
      section: item.section as GlobalSearchResult["section"],
      ticketId: item.ticketId,
    });
  }
  return results;
}

export function filterGlobalSearchResults(
  results: readonly GlobalSearchResult[],
  scope: GlobalSearchScope,
): GlobalSearchResult[] {
  return scope === "tickets-only"
    ? results.filter((result) => result.resultType === "ticket")
    : [...results];
}

const typeLabel: Record<GlobalSearchResult["resultType"], string> = {
  ticket: "Ticket",
  follow_up: "Wiedervorlage",
  knowledge: "Wissensartikel",
  event_space: "Raumauftrag",
  onboarding: "Eintritt",
  incident: "Störung",
  security_case: "Sicherheitsfall",
};

export function GlobalSearch({
  disabled = false,
  tenantId,
  onSelect,
  onSelectRecent,
  onSelectPerson,
  scope = "all",
}: GlobalSearchProps) {
  const [people, setPeople] = useState<PersonSearchHit[]>([]);
  const [tab, setTab] = useState<SearchTab>("all");
  const [recentItems, setRecentItems] = useState<RecentItem[] | null>(null);
  const [recentError, setRecentError] = useState("");
  const panelRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultsId = useId();
  const normalizedQuery = query.trim();
  const showPeople = scope === "all" && Boolean(onSelectPerson);
  const shownPeople = showPeople ? people : [];
  const scopedResults = filterGlobalSearchResults(results, scope);
  const sectionCounts = new Map<GlobalSearchResult["section"], number>();
  for (const result of scopedResults) {
    sectionCounts.set(
      result.section,
      (sectionCounts.get(result.section) ?? 0) + 1,
    );
  }
  const activeTab: SearchTab =
    tab === "all" ||
    (tab === "people" && shownPeople.length > 0) ||
    (tab !== "people" && sectionCounts.has(tab))
      ? tab
      : "all";
  const visibleResults =
    activeTab === "all"
      ? scopedResults
      : activeTab === "people"
        ? []
        : scopedResults.filter((result) => result.section === activeTab);
  const visiblePeople =
    activeTab === "all"
      ? shownPeople.slice(0, PEOPLE_PREVIEW)
      : activeTab === "people"
        ? shownPeople
        : [];
  const showTabs =
    shownPeople.length > 0 && scopedResults.length + shownPeople.length > 0;

  useEffect(() => {
    requestVersion.current += 1;
    const version = requestVersion.current;
    if (
      !isSupabaseConfigured ||
      !supabase ||
      disabled ||
      normalizedQuery.length < 2
    ) {
      setResults([]);
      setPeople([]);
      setLoading(false);
      setError("");
      return;
    }
    const client = supabase;
    setLoading(true);
    setError("");
    const timeout = window.setTimeout(() => {
      void client.functions
        .invoke("global-search", {
          body: { type: "search", tenantId, query: normalizedQuery },
        })
        .then(async ({ data, error: invokeError }) => {
          if (requestVersion.current !== version) return;
          if (invokeError) throw invokeError;
          const parsed = parseResults(data);
          if (!parsed) throw new Error("invalid_global_search_response");
          setResults(filterGlobalSearchResults(parsed, scope));
          setPeople(parsePeople(data));
          setTab("all");
        })
        .catch(async (searchError: unknown) => {
          if (requestVersion.current !== version) return;
          setResults([]);
          setPeople([]);
          setError(
            await functionErrorMessage(
              searchError,
              "Die globale Suche konnte nicht ausgeführt werden.",
            ),
          );
        })
        .finally(() => {
          if (requestVersion.current === version) setLoading(false);
        });
    }, 240);
    return () => window.clearTimeout(timeout);
  }, [disabled, normalizedQuery, scope, tenantId]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  function clear() {
    setQuery("");
    setResults([]);
    setPeople([]);
    setError("");
    inputRef.current?.focus();
  }

  const showRecent =
    isOpen &&
    normalizedQuery.length < 2 &&
    Boolean(onSelectRecent) &&
    !disabled &&
    isSupabaseConfigured;
  const visibleRecentItems = (recentItems ?? []).filter(
    (item) => scope === "all" || item.itemType === "ticket",
  );

  // Reload whenever the empty field is focused: the list changes on every
  // opened item (also on other devices).
  useEffect(() => {
    if (!showRecent) return;
    let active = true;
    setRecentError("");
    loadRecentItems(tenantId)
      .then((items) => {
        if (active) setRecentItems(items);
      })
      .catch(() => {
        if (!active) return;
        setRecentItems([]);
        setRecentError("Zuletzt angesehene Elemente sind nicht verfügbar.");
      });
    return () => {
      active = false;
    };
  }, [showRecent, tenantId]);

  useEffect(() => {
    setRecentItems(null);
  }, [tenantId]);

  function moveFocus(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const options = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="option"]',
      ) ?? [],
    );
    if (options.length === 0) return;
    event.preventDefault();
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) {
      (event.key === "ArrowDown" ? options[0] : options.at(-1))?.focus();
      return;
    }
    const next = index + (event.key === "ArrowDown" ? 1 : -1);
    if (next < 0) {
      inputRef.current?.focus();
      return;
    }
    options[Math.min(next, options.length - 1)]?.focus();
  }

  const showPanel = isOpen && normalizedQuery.length >= 2;
  const panelOpen = showPanel || showRecent;
  return (
    <div
      className="global-search"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          setIsOpen(false);
        }
      }}
      onKeyDown={moveFocus}
    >
      <label className="search-field global-search__field">
        <Search aria-hidden="true" size={17} strokeWidth={1.8} />
        <input
          aria-autocomplete="list"
          aria-controls={panelOpen ? resultsId : undefined}
          aria-expanded={panelOpen}
          aria-label="Global suchen"
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setIsOpen(true)}
          placeholder="Global suchen …"
          ref={inputRef}
          role="combobox"
          value={query}
        />
        {loading ? (
          <LoaderCircle
            aria-label="Suche läuft"
            className="global-search__loading"
            size={16}
          />
        ) : normalizedQuery ? (
          <button
            aria-label="Suche löschen"
            className="global-search__clear"
            onClick={clear}
            type="button"
          >
            <X aria-hidden="true" size={15} />
          </button>
        ) : null}
      </label>
      {showRecent && !showPanel ? (
        <section
          aria-label="Zuletzt angesehen"
          className="global-search__panel"
          id={resultsId}
          onMouseDown={(event) => event.preventDefault()}
          ref={panelRef}
          role="listbox"
        >
          <p className="global-search__heading">
            <History aria-hidden="true" size={14} />
            Zuletzt angesehen
          </p>
          {recentError ? (
            <p className="global-search__state" role="status">
              {recentError}
            </p>
          ) : recentItems === null ? (
            <p className="global-search__state" role="status">
              Wird geladen …
            </p>
          ) : visibleRecentItems.length === 0 ? (
            <p className="global-search__state">
              Noch nichts angesehen. Geöffnete Tickets, Geräte und
              Wissensartikel erscheinen hier – auch aus der App.
            </p>
          ) : (
            <ul>
              {visibleRecentItems.map((item) => (
                <li key={`${item.itemType}:${item.itemId}`}>
                  <button
                    onClick={() => {
                      onSelectRecent?.(item);
                      setIsOpen(false);
                    }}
                    role="option"
                    aria-selected={false}
                    type="button"
                  >
                    <span className="global-search__result-type">
                      {RECENT_ITEM_TYPE_LABEL[item.itemType]} ·{" "}
                      {recentItemAgeLabel(item.viewedAt)}
                    </span>
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {showPanel ? (
        <section
          aria-label="Globale Suchtreffer"
          className={
            shownPeople.length > 0
              ? "global-search__panel global-search__panel--wide"
              : "global-search__panel"
          }
          id={resultsId}
          onMouseDown={(event) => event.preventDefault()}
          ref={panelRef}
          role="listbox"
        >
          {error ? (
            <p className="global-search__state" role="status">
              {error}
            </p>
          ) : loading ? (
            <p className="global-search__state" role="status">
              {tn(
                "Durchsuche deine zugänglichen Inhalte …",
                "Durchsuche Ihre zugänglichen Inhalte …",
              )}
            </p>
          ) : scopedResults.length === 0 && shownPeople.length === 0 ? (
            <p className="global-search__state">
              Keine zugänglichen Treffer für «{normalizedQuery}».
            </p>
          ) : (
            <>
              {showTabs ? (
                <div
                  className="global-search__tabs"
                  role="group"
                  aria-label="Treffer filtern"
                >
                  {(
                    [
                      ["all", "Alle"],
                      ["people", `Personen ${shownPeople.length}`],
                      ...[...sectionCounts.entries()].map(
                        ([section, count]) =>
                          [section, `${section} ${count}`] as const,
                      ),
                    ] as Array<readonly [SearchTab, string]>
                  ).map(([key, label]) => (
                    <button
                      aria-pressed={activeTab === key}
                      className={activeTab === key ? "is-active" : undefined}
                      key={key}
                      onClick={() => setTab(key)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
              {visiblePeople.length > 0 ? (
                <>
                  <p className="global-search__section">
                    <span>Personen</span>
                  </p>
                  <ul>
                    {visiblePeople.map((person) => (
                      <li key={`person:${person.kind}:${person.id}`}>
                        <button
                          aria-selected={false}
                          className="global-search__person"
                          onClick={() => {
                            onSelectPerson?.(personRefFromHit(person));
                            setIsOpen(false);
                          }}
                          role="option"
                          type="button"
                        >
                          <span className="person-avatar" aria-hidden="true">
                            {personInitials(person.displayName)}
                          </span>
                          <span className="global-search__person-text">
                            <strong>{person.displayName}</strong>
                            <span>
                              {[
                                person.jobTitle,
                                person.department,
                                person.email,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "Keine weiteren Angaben"}
                            </span>
                          </span>
                          <span className="global-search__person-meta">
                            {person.accountEnabled === false ? (
                              <span className="person-chip person-chip--bad">
                                Deaktiviert
                              </span>
                            ) : person.openTicketCount > 0 ? (
                              <span className="person-chip person-chip--primary">
                                {person.openTicketCount} offen
                              </span>
                            ) : null}
                            <span className="person-chip">
                              {person.kind === "entra" ? "Entra" : "Kontakt"}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {activeTab === "all" &&
                  shownPeople.length > PEOPLE_PREVIEW ? (
                    <button
                      className="person-more global-search__more"
                      onClick={() => setTab("people")}
                      type="button"
                    >
                      Alle {shownPeople.length} Personen anzeigen
                    </button>
                  ) : null}
                  {visibleResults.length > 0 ? (
                    <p className="global-search__section">
                      <span>Weitere Treffer</span>
                    </p>
                  ) : null}
                </>
              ) : null}
              {visibleResults.length > 0 ? (
                <ul>
                  {visibleResults.map((result) => (
                    <li key={`${result.resultType}:${result.entityId}`}>
                      <button
                        onClick={() => {
                          onSelect(result);
                          setIsOpen(false);
                        }}
                        role="option"
                        aria-selected={false}
                        type="button"
                      >
                        <span className="global-search__result-type">
                          {typeLabel[result.resultType]}
                        </span>
                        <strong>{result.title}</strong>
                        <span>{result.detail}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {shownPeople.length > 0 ? (
                <p className="global-search__footnote">
                  Personen aus Microsoft Entra und Ticketkontakten · nur für
                  Agenten
                </p>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
