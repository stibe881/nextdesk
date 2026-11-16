import { Check, ChevronDown, LoaderCircle, Plus } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export type PickOption = {
  value: string;
  label: string;
  /** Second line, e.g. the location of a rack. */
  hint?: string | null;
};

/**
 * Selection from existing entries (e.g. locations, racks) with the option to
 * add a missing entry directly below the list, without a separate field.
 */
export function PickOrCreate({
  createLabel,
  createPlaceholder,
  disabled = false,
  emptyLabel,
  id,
  labelledBy,
  onChange,
  onCreate,
  options,
  value,
}: {
  /** Label of the add row, e.g. «Neuer Standort». */
  createLabel: string;
  createPlaceholder?: string;
  disabled?: boolean;
  /** Entry for «nothing selected», e.g. «– kein Standort –». */
  emptyLabel: string;
  id?: string;
  /** Id of the visible field label. */
  labelledBy?: string;
  onChange: (value: string | null) => void;
  /** Creates the entry and returns its value, or null if it failed. */
  onCreate?: (name: string) => Promise<string | null>;
  options: readonly PickOption[];
  value: string | null;
}) {
  const generatedId = useId();
  const listId = `${id ?? generatedId}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((option) => option.value === value) ?? null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("de-CH");
    return needle
      ? options.filter((option) =>
          `${option.label} ${option.hint ?? ""}`
            .toLocaleLowerCase("de-CH")
            .includes(needle),
        )
      : options;
  }, [options, query]);
  const draftName = draft.trim();
  const duplicate = options.find(
    (option) =>
      option.label.trim().toLocaleLowerCase("de-CH") ===
      draftName.toLocaleLowerCase("de-CH"),
  );

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    searchRef.current?.focus();
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function choose(next: string | null) {
    onChange(next);
    setOpen(false);
    setQuery("");
  }

  async function create() {
    if (!onCreate || !draftName || creating) return;
    // An existing entry with the same name is simply selected.
    if (duplicate) {
      setDraft("");
      choose(duplicate.value);
      return;
    }
    setCreating(true);
    const created = await onCreate(draftName);
    setCreating(false);
    if (created) {
      setDraft("");
      choose(created);
    }
  }

  return (
    <div
      className="pick-or-create"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
      ref={rootRef}
    >
      <button
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={
          labelledBy ? `${labelledBy} ${id ?? generatedId}` : undefined
        }
        className="pick-or-create__trigger"
        disabled={disabled}
        id={id}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className={selected ? undefined : "pick-or-create__placeholder"}>
          {selected ? selected.label : emptyLabel}
        </span>
        <ChevronDown aria-hidden="true" size={16} />
      </button>
      {open ? (
        <div className="pick-or-create__popover">
          {options.length > 6 ? (
            <input
              aria-label="Liste durchsuchen"
              className="pick-or-create__search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Suchen …"
              ref={searchRef}
              value={query}
            />
          ) : null}
          <ul
            aria-labelledby={labelledBy}
            className="pick-or-create__list"
            id={listId}
            role="listbox"
          >
            <li
              aria-selected={value === null}
              className="pick-or-create__option pick-or-create__option--empty"
              onClick={() => choose(null)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  choose(null);
                }
              }}
              role="option"
              tabIndex={0}
            >
              {emptyLabel}
            </li>
            {filtered.map((option) => (
              <li
                aria-selected={option.value === value}
                className="pick-or-create__option"
                key={option.value}
                onClick={() => choose(option.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    choose(option.value);
                  }
                }}
                role="option"
                tabIndex={0}
              >
                <span>
                  {option.label}
                  {option.hint ? <small>{option.hint}</small> : null}
                </span>
                {option.value === value ? (
                  <Check aria-hidden="true" size={15} />
                ) : null}
              </li>
            ))}
            {filtered.length === 0 && options.length > 0 ? (
              <li className="pick-or-create__none">Keine Treffer.</li>
            ) : null}
            {options.length === 0 ? (
              <li className="pick-or-create__none">Noch keine Einträge.</li>
            ) : null}
          </ul>
          {onCreate ? (
            <div className="pick-or-create__create">
              <label htmlFor={`${listId}-new`}>{createLabel}</label>
              <span>
                <input
                  id={`${listId}-new`}
                  maxLength={160}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      // Not the surrounding form's submit.
                      event.preventDefault();
                      void create();
                    }
                  }}
                  placeholder={createPlaceholder}
                  value={draft}
                />
                <button
                  className="secondary-button"
                  disabled={!draftName || creating}
                  onClick={() => void create()}
                  type="button"
                >
                  {creating ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="ticket-detail-spinner"
                      size={15}
                    />
                  ) : (
                    <Plus aria-hidden="true" size={15} />
                  )}
                  {duplicate ? "Auswählen" : "Hinzufügen"}
                </button>
              </span>
              {duplicate ? (
                <small>
                  «{duplicate.label}» gibt es bereits und wird ausgewählt.
                </small>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
