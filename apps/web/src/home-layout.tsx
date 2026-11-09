import { ArrowDown, ArrowUp, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

/** Blocks of the overview page that each person can hide and reorder. */
export const HOME_BLOCKS = [
  { key: "metrics", label: "Kennzahlen", movable: false },
  { key: "tickets", label: "Priorisierte Tickets", movable: false },
  { key: "myPriorities", label: "Meine Prioritäten", movable: true },
  { key: "approvals", label: "Freigaben", movable: true },
  { key: "agentMetrics", label: "Meine Kennzahlen", movable: true },
  { key: "myDay", label: "Mein Tag", movable: true },
  { key: "activity", label: "Gerade passiert", movable: true },
] as const;

export type HomeLayout = { order: string[]; hidden: string[] };

const STORAGE_KEY = "nextdesk.homeLayout";
const SIDE_KEYS = HOME_BLOCKS.filter((block) => block.movable).map(
  (block) => block.key as string,
);

export function loadHomeLayout(): HomeLayout {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<HomeLayout>) : {};
    const order = (Array.isArray(parsed.order) ? parsed.order : []).filter(
      (key): key is string => SIDE_KEYS.includes(String(key)),
    );
    // New blocks appear on top for people with an older layout.
    for (const key of [...SIDE_KEYS].reverse()) {
      if (!order.includes(key)) order.unshift(key);
    }
    const hidden = (Array.isArray(parsed.hidden) ? parsed.hidden : []).filter(
      (key): key is string =>
        HOME_BLOCKS.some((block) => block.key === String(key)),
    );
    return { order, hidden };
  } catch {
    return { order: [...SIDE_KEYS], hidden: [] };
  }
}

export function saveHomeLayout(layout: HomeLayout) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // A personal convenience; the default layout stays usable.
  }
}

/** «Startseite anpassen»: show or hide blocks and sort the side cards. */
export function HomeLayoutEditor({
  layout,
  onChange,
}: {
  layout: HomeLayout;
  onChange: (next: HomeLayout) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (key: string) =>
    onChange({
      ...layout,
      hidden: layout.hidden.includes(key)
        ? layout.hidden.filter((entry) => entry !== key)
        : [...layout.hidden, key],
    });
  const move = (key: string, direction: -1 | 1) => {
    const order = [...layout.order];
    const index = order.indexOf(key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [
      order[target] as string,
      order[index] as string,
    ];
    onChange({ ...layout, order });
  };
  const fixed = HOME_BLOCKS.filter((block) => !block.movable);
  const sorted = layout.order
    .map((key) => HOME_BLOCKS.find((block) => block.key === key))
    .filter((block): block is (typeof HOME_BLOCKS)[number] => Boolean(block));

  return (
    <div className="home-layout">
      <button
        aria-expanded={open}
        className="text-button home-layout__toggle"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <SlidersHorizontal aria-hidden="true" size={15} />
        Startseite anpassen
      </button>
      {open ? (
        <div
          className="home-layout__panel"
          role="group"
          aria-label="Startseite anpassen"
        >
          <p>
            Blenden Sie Bereiche aus und ordnen Sie die Karten rechts nach Ihrem
            Bedarf.
          </p>
          <ul>
            {[...fixed, ...sorted].map((block) => {
              const index = layout.order.indexOf(block.key);
              return (
                <li key={block.key}>
                  <label>
                    <input
                      checked={!layout.hidden.includes(block.key)}
                      onChange={() => toggle(block.key)}
                      type="checkbox"
                    />
                    {block.label}
                  </label>
                  {block.movable ? (
                    <span className="home-layout__move">
                      <button
                        className="icon-button"
                        aria-label={`${block.label} nach oben`}
                        disabled={index <= 0}
                        onClick={() => move(block.key, -1)}
                        type="button"
                      >
                        <ArrowUp aria-hidden="true" size={14} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`${block.label} nach unten`}
                        disabled={index >= layout.order.length - 1}
                        onClick={() => move(block.key, 1)}
                        type="button"
                      >
                        <ArrowDown aria-hidden="true" size={14} />
                      </button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <button
            className="text-button"
            onClick={() => onChange({ order: [...SIDE_KEYS], hidden: [] })}
            type="button"
          >
            Standard wiederherstellen
          </button>
        </div>
      ) : null}
    </div>
  );
}
