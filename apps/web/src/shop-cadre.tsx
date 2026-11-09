import { Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { shopApi, type CadreSettings } from "./lib/shop";

const LEVEL_OPTIONS = [
  { value: 1, label: "Kaderstufe 1" },
  { value: 2, label: "Kaderstufe 2" },
  { value: 3, label: "Kaderstufe 3" },
];

function levelText(level: number): string {
  return level > 0 ? `Kaderstufe ${level}` : "Kein Kader";
}

/**
 * Kaderstufen verwalten: Funktion (aus Entra) → Kaderstufe, plus manuelle
 * Festlegung für einzelne Personen. Shop-Artikel können auf Kaderstufen
 * beschränkt werden.
 */
export function ShopCadreDialog({
  tenantId,
  onClose,
}: {
  tenantId: string;
  onClose: (changed: boolean) => void;
}) {
  const [settings, setSettings] = useState<CadreSettings | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [changed, setChanged] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newLevel, setNewLevel] = useState(1);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    shopApi
      .cadreSettings(tenantId)
      .then((data) => {
        if (active) setSettings(data);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Die Kaderstufen konnten nicht geladen werden.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [tenantId]);

  const run = async (action: () => Promise<CadreSettings>) => {
    setPending(true);
    setError("");
    try {
      setSettings(await action());
      setChanged(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.",
      );
    } finally {
      setPending(false);
    }
  };

  const ruleKeys = useMemo(
    () =>
      new Set(
        (settings?.rules ?? []).map((rule) =>
          rule.jobTitle.trim().toLowerCase(),
        ),
      ),
    [settings],
  );
  const suggestions = (settings?.jobTitles ?? []).filter(
    (entry) => !ruleKeys.has(entry.jobTitle.trim().toLowerCase()),
  );
  const members = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = settings?.members ?? [];
    const filtered = needle
      ? list.filter((member) =>
          `${member.name} ${member.jobTitle ?? ""}`
            .toLowerCase()
            .includes(needle),
        )
      : list.filter(
          (member) => member.cadreLevel > 0 || member.manualLevel !== null,
        );
    return filtered.slice(0, 100);
  }, [query, settings]);

  const addRule = (jobTitle: string, cadreLevel: number) =>
    run(() => shopApi.saveCadreRule(tenantId, { jobTitle, cadreLevel }));

  return (
    <div
      className="contracts__dialog-backdrop"
      onClick={() => onClose(changed)}
      role="presentation"
    >
      <section
        aria-labelledby="shop-cadre-title"
        aria-modal="true"
        className="contracts__editor-dialog shop__cadre-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="panel-heading">
          <div>
            <p className="eyebrow">Shop</p>
            <h2 id="shop-cadre-title">Kaderstufen verwalten</h2>
          </div>
          <button
            aria-label="Schliessen"
            className="icon-button"
            onClick={() => onClose(changed)}
            type="button"
          >
            <X size={18} />
          </button>
        </header>
        <div className="shop__cadre-body">
          <p className="shop__muted">
            Die Kaderstufe ergibt sich aus der Funktion der Person in Entra.
            Artikel mit «Sichtbar für: Kaderstufe …» sehen und bestellen nur
            Personen genau dieser Stufen.
          </p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          {settings === null && !error ? (
            <p className="shop__muted">Kaderstufen werden geladen …</p>
          ) : null}
          {settings ? (
            <>
              <h3>Funktion → Kaderstufe</h3>
              {settings.rules.length === 0 ? (
                <p className="shop__muted">Noch keine Zuordnung.</p>
              ) : (
                <ul className="shop__cadre-rules">
                  {settings.rules.map((rule) => (
                    <li key={rule.jobTitle}>
                      <span>
                        <strong>{rule.jobTitle}</strong>
                        <small>
                          {rule.people === 1
                            ? "1 Person"
                            : `${rule.people} Personen`}
                        </small>
                      </span>
                      <select
                        aria-label={`Kaderstufe für ${rule.jobTitle}`}
                        disabled={pending}
                        onChange={(event) =>
                          void addRule(
                            rule.jobTitle,
                            Number(event.target.value),
                          )
                        }
                        value={rule.cadreLevel}
                      >
                        {LEVEL_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <button
                        aria-label={`Zuordnung ${rule.jobTitle} entfernen`}
                        className="icon-button"
                        disabled={pending}
                        onClick={() =>
                          void run(() =>
                            shopApi.saveCadreRule(tenantId, {
                              jobTitle: rule.jobTitle,
                              cadreLevel: null,
                            }),
                          )
                        }
                        type="button"
                      >
                        <Trash2 aria-hidden="true" size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="shop__cadre-add"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (newTitle.trim().length < 2) return;
                  void addRule(newTitle.trim(), newLevel).then(() =>
                    setNewTitle(""),
                  );
                }}
              >
                <input
                  aria-label="Funktion"
                  list="shop-cadre-titles"
                  onChange={(event) => setNewTitle(event.target.value)}
                  placeholder="Funktion, z. B. Teamleitung"
                  value={newTitle}
                />
                <datalist id="shop-cadre-titles">
                  {suggestions.map((entry) => (
                    <option key={entry.jobTitle} value={entry.jobTitle}>
                      {entry.people} Personen
                    </option>
                  ))}
                </datalist>
                <select
                  aria-label="Kaderstufe"
                  onChange={(event) => setNewLevel(Number(event.target.value))}
                  value={newLevel}
                >
                  {LEVEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  className="secondary-button"
                  disabled={pending || newTitle.trim().length < 2}
                  type="submit"
                >
                  <Plus aria-hidden="true" size={15} /> Zuordnen
                </button>
              </form>

              <h3>Personen</h3>
              <label className="shop__cadre-search">
                <Search aria-hidden="true" size={15} />
                <input
                  aria-label="Person suchen"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Person oder Funktion suchen"
                  value={query}
                />
              </label>
              <p className="shop__muted">
                {query.trim()
                  ? "Suchergebnis (angemeldete Personen)."
                  : "Personen mit Kaderstufe. Suchen Sie, um eine Stufe von Hand festzulegen."}
              </p>
              {members.length === 0 ? (
                <p className="shop__muted">Keine Personen gefunden.</p>
              ) : (
                <ul className="shop__cadre-members">
                  {members.map((member) => (
                    <li key={member.id}>
                      <span>
                        <strong>{member.name}</strong>
                        <small>
                          {member.jobTitle ?? "Keine Funktion"} ·{" "}
                          {levelText(member.cadreLevel)}
                          {member.manualLevel !== null ? " (von Hand)" : ""}
                        </small>
                      </span>
                      <select
                        aria-label={`Kaderstufe für ${member.name}`}
                        disabled={pending}
                        onChange={(event) =>
                          void run(() =>
                            shopApi.setCadreOverride(
                              tenantId,
                              member.id,
                              event.target.value === ""
                                ? null
                                : Number(event.target.value),
                            ),
                          )
                        }
                        value={
                          member.manualLevel === null
                            ? ""
                            : String(member.manualLevel)
                        }
                      >
                        <option value="">
                          Aus Funktion ({levelText(member.titleLevel)})
                        </option>
                        <option value="0">Kein Kader</option>
                        {LEVEL_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
