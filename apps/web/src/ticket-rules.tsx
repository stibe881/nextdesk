import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { supabase } from "./lib/supabase";
import "./ticket-rules.css";

type Option = { id: string; name: string; departmentId?: string };
type TimeCondition = {
  kind: "no_reply" | "in_status" | "sla_due" | "unassigned";
  hours?: number;
  minutes?: number;
  statusKeys?: string[];
};
type Conditions = {
  trigger?: "created" | "time";
  time?: TimeCondition | undefined;
  departmentIds?: string[];
  categoryIds?: string[];
  priorityIds?: string[];
  sources?: string[];
  keywords?: string[];
};
type Actions = {
  teamId?: string | null;
  agentId?: string | null;
  priorityId?: string | null;
  watcherIds?: string[];
  notify?: ("assignee" | "watchers" | "supervisors")[] | undefined;
};

const TIME_KINDS: { id: TimeCondition["kind"]; name: string }[] = [
  { id: "no_reply", name: "keine Antwort seit … Stunden" },
  { id: "unassigned", name: "nicht zugewiesen seit … Stunden" },
  { id: "in_status", name: "im Status … seit … Stunden" },
  { id: "sla_due", name: "SLA läuft in … Minuten ab" },
];
const NOTIFY: Option[] = [
  { id: "assignee", name: "Zugewiesene Person" },
  { id: "watchers", name: "Beobachtende" },
  { id: "supervisors", name: "Vorgesetzte der Abteilung" },
];

function describeTime(
  time: TimeCondition | undefined,
  statusName: (key: string) => string,
): string {
  if (!time) return "";
  switch (time.kind) {
    case "no_reply":
      return `seit ${time.hours ?? 0} h keine Antwort`;
    case "unassigned":
      return `seit ${time.hours ?? 0} h nicht zugewiesen`;
    case "in_status":
      return `seit ${time.hours ?? 0} h im Status ${(time.statusKeys ?? []).map(statusName).join(" oder ") || "…"}`;
    case "sla_due":
      return `SLA läuft in ${time.minutes ?? 0} min ab`;
  }
}
type Rule = {
  id: string | null;
  name: string;
  active: boolean;
  position: number;
  conditions: Conditions;
  actions: Actions;
  appliedCount?: number;
  lastAppliedAt?: string | null;
};
type Catalog = {
  departments: Option[];
  categories: Option[];
  priorities: Option[];
  teams: Option[];
  people: Option[];
};

const SOURCES: Option[] = [
  { id: "portal", name: "Portal / App" },
  { id: "email", name: "E-Mail" },
  { id: "phone", name: "Telefon" },
  { id: "api", name: "Schnittstelle" },
];

const EMPTY_RULE: Rule = {
  id: null,
  name: "",
  active: true,
  position: 0,
  conditions: {},
  actions: {},
};

function toggle(list: string[] | undefined, id: string): string[] {
  const current = list ?? [];
  return current.includes(id)
    ? current.filter((value) => value !== id)
    : [...current, id];
}

function ChipPicker({
  label,
  options,
  selected,
  onChange,
  emptyHint,
}: {
  label: string;
  options: Option[];
  selected: string[] | undefined;
  onChange: (next: string[]) => void;
  emptyHint: string;
}) {
  return (
    <fieldset className="ticket-rules__chips">
      <legend>{label}</legend>
      {options.length ? (
        <div>
          {options.map((option) => {
            const active = (selected ?? []).includes(option.id);
            return (
              <button
                aria-pressed={active}
                className={active ? "is-active" : ""}
                key={option.id}
                onClick={() => onChange(toggle(selected, option.id))}
                type="button"
              >
                {option.name}
              </button>
            );
          })}
        </div>
      ) : (
        <p>{emptyHint}</p>
      )}
    </fieldset>
  );
}

/**
 * No-code rules: conditions on new tickets (department, category, priority,
 * channel, keywords) lead to actions (team, person, priority, watchers).
 */
export function TicketRules({ tenantId }: { tenantId: string }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [catalog, setCatalog] = useState<Catalog>({
    departments: [],
    categories: [],
    priorities: [],
    teams: [],
    people: [],
  });
  const [editing, setEditing] = useState<Rule | null>(null);
  const [keywordText, setKeywordText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [statuses, setStatuses] = useState<{ key: string; label: string }[]>(
    [],
  );

  const load = useCallback(async () => {
    if (!supabase) return;
    void supabase
      .rpc("list_ticket_rule_statuses", { p_tenant_id: tenantId })
      .then(({ data }) => {
        if (Array.isArray(data))
          setStatuses(data as { key: string; label: string }[]);
      });
    const { data, error: loadError } = await supabase.rpc("list_ticket_rules", {
      p_tenant_id: tenantId,
    });
    if (loadError) {
      setError("Die Regeln konnten nicht geladen werden.");
      return;
    }
    const payload = (data ?? {}) as Partial<Catalog> & { rules?: Rule[] };
    setRules(payload.rules ?? []);
    setCatalog({
      departments: payload.departments ?? [],
      categories: payload.categories ?? [],
      priorities: payload.priorities ?? [],
      teams: payload.teams ?? [],
      people: payload.people ?? [],
    });
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const list of Object.values(catalog))
      for (const option of list as Option[]) map.set(option.id, option.name);
    for (const source of SOURCES) map.set(source.id, source.name);
    return (id: string | null | undefined) => (id ? (map.get(id) ?? "?") : "");
  }, [catalog]);

  async function save(rule: Rule) {
    if (!supabase) return false;
    setPending(true);
    setError("");
    const { error: saveError } = await supabase.rpc("save_ticket_rule", {
      p_tenant_id: tenantId,
      p_rule: {
        ...(rule.id ? { id: rule.id } : {}),
        name: rule.name.trim(),
        active: rule.active,
        ...(rule.position ? { position: rule.position } : {}),
        conditions: rule.conditions,
        actions: rule.actions,
      },
    });
    setPending(false);
    if (saveError) {
      setError("Die Regel konnte nicht gespeichert werden.");
      return false;
    }
    await load();
    return true;
  }

  async function remove(rule: Rule) {
    if (!supabase || !rule.id) return;
    if (!window.confirm(`Regel «${rule.name}» löschen?`)) return;
    setPending(true);
    const { error: deleteError } = await supabase.rpc("delete_ticket_rule", {
      p_tenant_id: tenantId,
      p_rule_id: rule.id,
    });
    setPending(false);
    if (deleteError) setError("Die Regel konnte nicht gelöscht werden.");
    await load();
  }

  async function move(index: number, direction: -1 | 1) {
    const other = rules[index + direction];
    const rule = rules[index];
    if (!other || !rule) return;
    await save({ ...rule, position: other.position });
    await save({ ...other, position: rule.position });
  }

  function startEdit(rule: Rule) {
    setEditing(rule);
    setKeywordText((rule.conditions.keywords ?? []).join(", "));
  }

  async function submit() {
    if (!editing) return;
    const keywords = keywordText
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 20);
    const saved = await save({
      ...editing,
      conditions: { ...editing.conditions, keywords },
    });
    if (saved) setEditing(null);
  }

  function describe(rule: Rule): { when: string; then: string } {
    const when: string[] = [];
    const c = rule.conditions;
    if (c.trigger === "time") {
      when.push(
        describeTime(
          c.time,
          (key) => statuses.find((status) => status.key === key)?.label ?? key,
        ),
      );
    }
    if (c.departmentIds?.length)
      when.push(`Abteilung ${c.departmentIds.map(nameOf).join(" oder ")}`);
    if (c.categoryIds?.length)
      when.push(`Kategorie ${c.categoryIds.map(nameOf).join(" oder ")}`);
    if (c.priorityIds?.length)
      when.push(`Priorität ${c.priorityIds.map(nameOf).join(" oder ")}`);
    if (c.sources?.length)
      when.push(`Eingang ${c.sources.map(nameOf).join(" oder ")}`);
    if (c.keywords?.length)
      when.push(`Text enthält «${c.keywords.join("» oder «")}»`);
    const then: string[] = [];
    const a = rule.actions;
    if (a.teamId) then.push(`Team ${nameOf(a.teamId)}`);
    if (a.agentId) then.push(`zuweisen an ${nameOf(a.agentId)}`);
    if (a.priorityId) then.push(`Priorität ${nameOf(a.priorityId)}`);
    if (a.watcherIds?.length)
      then.push(`Beobachtende ${a.watcherIds.map(nameOf).join(", ")}`);
    if (a.notify?.length)
      then.push(
        `benachrichtigen: ${a.notify
          .map((key) => NOTIFY.find((entry) => entry.id === key)?.name ?? key)
          .join(", ")}`,
      );
    return {
      when: when.length
        ? when.join(" und ")
        : c.trigger === "time"
          ? "jedes offene Ticket"
          : "jedes neue Ticket",
      then: then.length ? then.join(", ") : "keine Aktion",
    };
  }

  const teamOptions = catalog.teams.filter(
    (team) =>
      !editing?.conditions.departmentIds?.length ||
      editing.conditions.departmentIds.includes(team.departmentId ?? ""),
  );
  const categoryOptions = catalog.categories.filter(
    (category) =>
      !editing?.conditions.departmentIds?.length ||
      editing.conditions.departmentIds.includes(category.departmentId ?? ""),
  );

  return (
    <section
      aria-labelledby="ticket-rules-heading"
      className="tenant-automation ticket-rules"
    >
      <div className="tenant-automation__heading">
        <div>
          <p className="eyebrow">REGEL-BAUKASTEN</p>
          <h2 id="ticket-rules-heading">Regeln für neue Tickets</h2>
          <p>
            «Wenn … dann …»: Regeln greifen beim Erstellen eines Tickets oder
            zeitgesteuert (alle 10 Minuten geprüft, pro Ticket einmal), in der
            angezeigten Reihenfolge. Beim Erstellen wird nicht überschrieben,
            was eine frühere Regel oder die erfassende Person gesetzt hat.
          </p>
        </div>
        <button
          className="primary-button"
          disabled={pending}
          onClick={() => startEdit({ ...EMPTY_RULE })}
          type="button"
        >
          <Plus aria-hidden="true" size={16} /> Neue Regel
        </button>
      </div>
      {error ? (
        <p className="form-message form-message--error" role="alert">
          {error}
        </p>
      ) : null}

      {editing ? (
        <div className="ticket-rules__editor">
          <label className="ticket-rules__name">
            Name der Regel
            <input
              maxLength={120}
              onChange={(event) =>
                setEditing({ ...editing, name: event.target.value })
              }
              placeholder="z. B. Druckerprobleme an das Drucker-Team"
              value={editing.name}
            />
          </label>
          <fieldset className="ticket-rules__trigger">
            <legend>Auslöser</legend>
            <label>
              <input
                checked={editing.conditions.trigger !== "time"}
                name="rule-trigger"
                onChange={() =>
                  setEditing({
                    ...editing,
                    conditions: {
                      ...editing.conditions,
                      trigger: "created",
                      time: undefined,
                    },
                  })
                }
                type="radio"
              />
              Beim Erstellen eines Tickets
            </label>
            <label>
              <input
                checked={editing.conditions.trigger === "time"}
                name="rule-trigger"
                onChange={() =>
                  setEditing({
                    ...editing,
                    conditions: {
                      ...editing.conditions,
                      trigger: "time",
                      time: editing.conditions.time ?? {
                        kind: "no_reply",
                        hours: 4,
                      },
                    },
                  })
                }
                type="radio"
              />
              Zeitgesteuert
            </label>
            {editing.conditions.trigger === "time" ? (
              <div className="ticket-rules__time">
                <select
                  aria-label="Zeitbedingung"
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      conditions: {
                        ...editing.conditions,
                        time: {
                          ...(editing.conditions.time ?? { kind: "no_reply" }),
                          kind: event.target.value as TimeCondition["kind"],
                        },
                      },
                    })
                  }
                  value={editing.conditions.time?.kind ?? "no_reply"}
                >
                  {TIME_KINDS.map((kind) => (
                    <option key={kind.id} value={kind.id}>
                      {kind.name}
                    </option>
                  ))}
                </select>
                {editing.conditions.time?.kind === "sla_due" ? (
                  <label>
                    Minuten
                    <input
                      max={43200}
                      min={1}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          conditions: {
                            ...editing.conditions,
                            time: {
                              ...(editing.conditions.time ?? {
                                kind: "sla_due",
                              }),
                              minutes: Number(event.target.value) || 0,
                            },
                          },
                        })
                      }
                      type="number"
                      value={editing.conditions.time?.minutes ?? 60}
                    />
                  </label>
                ) : (
                  <label>
                    Stunden
                    <input
                      max={2160}
                      min={0.5}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          conditions: {
                            ...editing.conditions,
                            time: {
                              ...(editing.conditions.time ?? {
                                kind: "no_reply",
                              }),
                              hours: Number(event.target.value) || 0,
                            },
                          },
                        })
                      }
                      step={0.5}
                      type="number"
                      value={editing.conditions.time?.hours ?? 4}
                    />
                  </label>
                )}
                {editing.conditions.time?.kind === "in_status" ? (
                  <ChipPicker
                    emptyHint="Keine Status vorhanden."
                    label="Status"
                    onChange={(statusKeys) =>
                      setEditing({
                        ...editing,
                        conditions: {
                          ...editing.conditions,
                          time: {
                            ...(editing.conditions.time ?? {
                              kind: "in_status",
                            }),
                            statusKeys,
                          },
                        },
                      })
                    }
                    options={statuses.map((status) => ({
                      id: status.key,
                      name: status.label,
                    }))}
                    selected={editing.conditions.time?.statusKeys}
                  />
                ) : null}
              </div>
            ) : null}
          </fieldset>
          <div className="ticket-rules__columns">
            <div className="ticket-rules__block">
              <h3>Wenn …</h3>
              <ChipPicker
                emptyHint="Keine Abteilungen vorhanden."
                label="Abteilung"
                onChange={(departmentIds) =>
                  setEditing({
                    ...editing,
                    conditions: { ...editing.conditions, departmentIds },
                  })
                }
                options={catalog.departments}
                selected={editing.conditions.departmentIds}
              />
              <ChipPicker
                emptyHint="Keine Kategorien vorhanden."
                label="Kategorie"
                onChange={(categoryIds) =>
                  setEditing({
                    ...editing,
                    conditions: { ...editing.conditions, categoryIds },
                  })
                }
                options={categoryOptions}
                selected={editing.conditions.categoryIds}
              />
              <ChipPicker
                emptyHint="Keine Prioritäten vorhanden."
                label="Priorität"
                onChange={(priorityIds) =>
                  setEditing({
                    ...editing,
                    conditions: { ...editing.conditions, priorityIds },
                  })
                }
                options={catalog.priorities}
                selected={editing.conditions.priorityIds}
              />
              <ChipPicker
                emptyHint=""
                label="Eingang"
                onChange={(sources) =>
                  setEditing({
                    ...editing,
                    conditions: { ...editing.conditions, sources },
                  })
                }
                options={SOURCES}
                selected={editing.conditions.sources}
              />
              <label className="ticket-rules__keywords">
                Betreff oder Beschreibung enthält (Stichworte, mit Komma
                getrennt)
                <input
                  onChange={(event) => setKeywordText(event.target.value)}
                  placeholder="z. B. Drucker, Toner, Papierstau"
                  value={keywordText}
                />
              </label>
              <p className="ticket-rules__hint">
                Nicht ausgewählte Bedingungen gelten immer. Innerhalb einer
                Bedingung genügt ein Treffer.
              </p>
            </div>
            <div className="ticket-rules__block">
              <h3>… dann</h3>
              <label>
                Team zuweisen
                <select
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      actions: {
                        ...editing.actions,
                        teamId: event.target.value || null,
                      },
                    })
                  }
                  value={editing.actions.teamId ?? ""}
                >
                  <option value="">– nicht ändern –</option>
                  {teamOptions.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Person zuweisen
                <select
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      actions: {
                        ...editing.actions,
                        agentId: event.target.value || null,
                      },
                    })
                  }
                  value={editing.actions.agentId ?? ""}
                >
                  <option value="">– nicht ändern –</option>
                  {catalog.people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priorität setzen
                <select
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      actions: {
                        ...editing.actions,
                        priorityId: event.target.value || null,
                      },
                    })
                  }
                  value={editing.actions.priorityId ?? ""}
                >
                  <option value="">– nicht ändern –</option>
                  {catalog.priorities.map((priority) => (
                    <option key={priority.id} value={priority.id}>
                      {priority.name}
                    </option>
                  ))}
                </select>
              </label>
              <ChipPicker
                emptyHint="Keine Personen vorhanden."
                label="Beobachtende hinzufügen"
                onChange={(watcherIds) =>
                  setEditing({
                    ...editing,
                    actions: { ...editing.actions, watcherIds },
                  })
                }
                options={catalog.people}
                selected={editing.actions.watcherIds}
              />
              {editing.conditions.trigger === "time" ? (
                <ChipPicker
                  emptyHint=""
                  label="Benachrichtigen"
                  onChange={(notify) =>
                    setEditing({
                      ...editing,
                      actions: {
                        ...editing.actions,
                        notify: notify as Actions["notify"],
                      },
                    })
                  }
                  options={NOTIFY}
                  selected={editing.actions.notify}
                />
              ) : null}
              <p className="ticket-rules__hint">
                Eine Person wird nur zugewiesen, wenn sie in der Abteilung (und
                im Team) arbeitet. Sonst überspringt die Regel diesen Schritt.
              </p>
            </div>
          </div>
          <div className="ticket-rules__editor-actions">
            <label className="tenant-automation__switch">
              <input
                checked={editing.active}
                onChange={(event) =>
                  setEditing({ ...editing, active: event.target.checked })
                }
                type="checkbox"
              />
              <span>{editing.active ? "Aktiv" : "Inaktiv"}</span>
            </label>
            <button
              className="secondary-button"
              onClick={() => setEditing(null)}
              type="button"
            >
              Abbrechen
            </button>
            <button
              className="primary-button"
              disabled={pending || editing.name.trim().length < 2}
              onClick={() => void submit()}
              type="button"
            >
              Regel speichern
            </button>
          </div>
        </div>
      ) : null}

      {rules.length ? (
        <ol className="ticket-rules__list">
          {rules.map((rule, index) => {
            const text = describe(rule);
            return (
              <li className={rule.active ? "" : "is-inactive"} key={rule.id}>
                <span aria-hidden="true" className="ticket-rules__icon">
                  <Zap size={16} />
                </span>
                <div className="ticket-rules__text">
                  <strong>{rule.name}</strong>
                  <span>
                    <b>Wenn</b> {text.when} <b>→ dann</b> {text.then}
                  </span>
                  <small>
                    {rule.active ? "Aktiv" : "Inaktiv"} ·{" "}
                    {rule.appliedCount ?? 0}× angewendet
                  </small>
                </div>
                <div className="ticket-rules__row-actions">
                  <button
                    aria-label="Nach oben"
                    className="icon-button"
                    disabled={pending || index === 0}
                    onClick={() => void move(index, -1)}
                    type="button"
                  >
                    <ArrowUp aria-hidden="true" size={15} />
                  </button>
                  <button
                    aria-label="Nach unten"
                    className="icon-button"
                    disabled={pending || index === rules.length - 1}
                    onClick={() => void move(index, 1)}
                    type="button"
                  >
                    <ArrowDown aria-hidden="true" size={15} />
                  </button>
                  <button
                    aria-label={`${rule.name} bearbeiten`}
                    className="icon-button"
                    disabled={pending}
                    onClick={() => startEdit(rule)}
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={15} />
                  </button>
                  <button
                    aria-label={`${rule.name} löschen`}
                    className="icon-button"
                    disabled={pending}
                    onClick={() => void remove(rule)}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={15} />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : !editing ? (
        <p className="empty-state">
          Noch keine Regeln. Legen Sie zum Beispiel fest, dass Tickets mit
          «Drucker» im Betreff automatisch an das Drucker-Team gehen.
        </p>
      ) : null}
    </section>
  );
}
