import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "./lib/supabase";

export type PickedAsset = {
  id: string;
  name: string;
  detail: string;
};

const KIND_TEXT: Record<string, string> = {
  device: "Gerät",
  laptop: "Notebook",
  monitor: "Monitor",
  phone: "Telefon",
  printer: "Drucker",
};

function normalized(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("de-CH");
}

/**
 * Asset search for the ticket composer: pick assets (with their primary
 * person) and remove them again; the composer links them after creating.
 */
export function TicketAssetPicker({
  tenantId,
  disabled,
  selected,
  onChange,
}: {
  tenantId: string;
  disabled: boolean;
  selected: readonly PickedAsset[];
  onChange: (assets: PickedAsset[]) => void;
}) {
  const [assets, setAssets] = useState<PickedAsset[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setAssets(null);
    setUnavailable(false);
  }, [tenantId]);

  useEffect(() => {
    if (!open || assets !== null || unavailable || !supabase) return;
    let active = true;
    void supabase.functions
      .invoke("service-assets", { body: { type: "listCatalog", tenantId } })
      .then(({ data, error }) => {
        if (!active) return;
        const rows = (data as { data?: { assets?: unknown } } | null)?.data
          ?.assets;
        if (error || !Array.isArray(rows)) {
          setUnavailable(true);
          return;
        }
        setAssets(
          rows.flatMap((row: unknown) => {
            const asset = row as Record<string, unknown>;
            if (typeof asset.id !== "string" || typeof asset.name !== "string")
              return [];
            const parts = [
              typeof asset.intune_primary_person_name === "string" &&
              asset.intune_primary_person_name.trim()
                ? `Primäre Person: ${asset.intune_primary_person_name.trim()}`
                : null,
              typeof asset.asset_tag === "string" && asset.asset_tag
                ? `Kennung: ${asset.asset_tag}`
                : null,
              typeof asset.kind === "string"
                ? (KIND_TEXT[asset.kind] ?? asset.kind)
                : null,
            ].filter((part): part is string => part !== null);
            return [
              { id: asset.id, name: asset.name, detail: parts.join(" · ") },
            ];
          }),
        );
      });
    return () => {
      active = false;
    };
  }, [assets, open, tenantId, unavailable]);

  const results = useMemo(() => {
    const terms = normalized(query.trim()).split(/\s+/u).filter(Boolean);
    if (!assets || terms.length === 0) return [];
    const chosen = new Set(selected.map((asset) => asset.id));
    return assets
      .filter((asset) => {
        if (chosen.has(asset.id)) return false;
        const text = normalized(`${asset.name} ${asset.detail}`);
        return terms.every((term) => text.includes(term));
      })
      .slice(0, 12);
  }, [assets, query, selected]);

  if (unavailable) return null;

  return (
    <div className="ticket-asset-picker">
      <label>
        Betroffenes Asset (optional)
        <input
          autoComplete="off"
          disabled={disabled}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
            if (event.key === "Escape") setOpen(false);
          }}
          placeholder="Name, Kennung oder Person suchen, z. B. NB001"
          type="search"
          value={query}
        />
      </label>
      {open && query.trim() ? (
        <div className="ticket-asset-picker__options" role="listbox">
          {assets === null ? (
            <p className="data-caption">Assets werden geladen …</p>
          ) : results.length === 0 ? (
            <p className="data-caption">Kein passendes Asset gefunden.</p>
          ) : (
            results.map((asset) => (
              <button
                className="ticket-asset-picker__option"
                key={asset.id}
                onClick={() => {
                  onChange([...selected, asset]);
                  setQuery("");
                  setOpen(false);
                }}
                onMouseDown={(event) => event.preventDefault()}
                role="option"
                aria-selected={false}
                type="button"
              >
                <strong>{asset.name}</strong>
                {asset.detail ? <small>{asset.detail}</small> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
      {selected.length > 0 ? (
        <ul
          aria-label="Ausgewählte Assets"
          className="ticket-asset-picker__chosen"
        >
          {selected.map((asset) => (
            <li key={asset.id}>
              <span>
                <strong>{asset.name}</strong>
                {asset.detail ? <small>{asset.detail}</small> : null}
              </span>
              <button
                aria-label={`${asset.name} entfernen`}
                disabled={disabled}
                onClick={() =>
                  onChange(selected.filter((item) => item.id !== asset.id))
                }
                type="button"
              >
                <X aria-hidden="true" size={15} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
