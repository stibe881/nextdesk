import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Search, X } from "lucide-react";
import { functionErrorMessage } from "./lib/function-error";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

export type GlobalSearchResult = {
  resultType:
    "ticket" | "follow_up" | "knowledge" | "event_space" | "onboarding";
  entityId: string;
  title: string;
  detail: string;
  section:
    | "Tickets"
    | "Wiedervorlagen"
    | "Wissen"
    | "Veranstaltungsräume"
    | "Eintritte";
  ticketId: string | null;
};

type GlobalSearchProps = {
  disabled?: boolean;
  tenantId: string;
  onSelect: (result: GlobalSearchResult) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResults(value: unknown): GlobalSearchResult[] | null {
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
  ]);
  const allowedSections = new Set<GlobalSearchResult["section"]>([
    "Tickets",
    "Wiedervorlagen",
    "Wissen",
    "Veranstaltungsräume",
    "Eintritte",
  ]);
  const results: GlobalSearchResult[] = [];
  for (const item of value.data.results) {
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

const typeLabel: Record<GlobalSearchResult["resultType"], string> = {
  ticket: "Ticket",
  follow_up: "Wiedervorlage",
  knowledge: "Wissensartikel",
  event_space: "Raumauftrag",
  onboarding: "Eintritt",
};

export function GlobalSearch({
  disabled = false,
  tenantId,
  onSelect,
}: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultsId = useId();
  const normalizedQuery = query.trim();

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
          setResults(parsed);
        })
        .catch(async (searchError: unknown) => {
          if (requestVersion.current !== version) return;
          setResults([]);
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
  }, [disabled, normalizedQuery, tenantId]);

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
    setError("");
    inputRef.current?.focus();
  }

  const showPanel = isOpen && normalizedQuery.length >= 2;
  return (
    <div className="global-search">
      <label className="search-field global-search__field">
        <Search aria-hidden="true" size={17} strokeWidth={1.8} />
        <input
          aria-autocomplete="list"
          aria-controls={showPanel ? resultsId : undefined}
          aria-expanded={showPanel}
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
      {showPanel ? (
        <section
          aria-label="Globale Suchtreffer"
          className="global-search__panel"
          id={resultsId}
          role="listbox"
        >
          {error ? (
            <p className="global-search__state" role="status">
              {error}
            </p>
          ) : loading ? (
            <p className="global-search__state" role="status">
              Durchsuche Ihre zugänglichen Inhalte …
            </p>
          ) : results.length === 0 ? (
            <p className="global-search__state">
              Keine zugänglichen Treffer für «{normalizedQuery}».
            </p>
          ) : (
            <ul>
              {results.map((result) => (
                <li key={`${result.resultType}:${result.entityId}`}>
                  <button
                    onClick={() => {
                      onSelect(result);
                      setIsOpen(false);
                    }}
                    role="option"
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
          )}
        </section>
      ) : null}
    </div>
  );
}
