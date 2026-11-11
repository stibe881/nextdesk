// Grafiken und kleine Bedienelemente des IPAM-Moduls: Ringanzeige,
// gestapelter Balken, Sparkline, Verlauf mit Prognoseband, Begriffs-Hilfe,
// Kopieren-Knopf und Tastatursteuerung für Raster. Handgemachtes SVG,
// Farben ausschliesslich über CSS-Variablen (Dark Mode).

import { Check, Copy } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  nearestPoint,
  ringDash,
  sparklinePath,
  trendChart,
} from "./lib/ipam-charts";
import { formatDay } from "./lib/ipam-model";
import { percentText, percentTone } from "./lib/ipam-format";
import type { UtilizationHistory } from "./lib/ipam-redesign-types";

// ---------------------------------------------------------------------------
// Ring gauge

export function RingGauge({
  caption,
  label,
  percent,
  size = 64,
  warningPercent = 85,
}: {
  /** Small text below the value inside the ring («belegt»). */
  caption?: string;
  /** Accessible name prefix («10.10.1.0/24»). */
  label?: string;
  percent: number | null | undefined;
  size?: number;
  warningPercent?: number;
}) {
  const stroke = Math.max(5, Math.round(size / 9));
  const radius = (size - stroke) / 2;
  const { circumference, dash } = ringDash(percent, radius);
  const tone = percentTone(percent, warningPercent);
  return (
    <span
      aria-label={`${label ? `${label}: ` : ""}Auslastung ${percentText(percent)}`}
      className={`ipam-ring ipam-ring--${tone}`}
      role="img"
      style={{ width: size, height: size }}
    >
      <svg aria-hidden="true" viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="ipam-ring__track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
        />
        <circle
          className="ipam-ring__value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeDasharray={dash}
          strokeDashoffset={0}
          strokeWidth={stroke}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          data-circumference={circumference}
        />
      </svg>
      <span aria-hidden="true" className="ipam-ring__text">
        <b>{percentText(percent)}</b>
        {caption ? <small>{caption}</small> : null}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Stacked bar

export type StackPart = {
  key: string;
  label: string;
  count: number;
  /** CSS class suffix for the colour (ipam-swatch--<tone>). */
  tone: string;
};

export function StackedBar({
  label,
  parts,
}: {
  label: string;
  parts: StackPart[];
}) {
  const total = parts.reduce((sum, part) => sum + part.count, 0);
  const text = parts
    .filter((part) => part.count > 0)
    .map((part) => `${part.label} ${part.count}`)
    .join(", ");
  return (
    <span aria-label={`${label}: ${text}`} className="ipam-stack" role="img">
      {parts
        .filter((part) => part.count > 0)
        .map((part) => (
          <span
            className={`ipam-stack__part ipam-swatch--${part.tone}`}
            key={part.key}
            style={{ flexGrow: total ? part.count / total : 0 }}
            title={`${part.label}: ${part.count}`}
          />
        ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sparkline

export function Sparkline({
  label,
  values,
  warningPercent = 85,
}: {
  label: string;
  values: number[];
  warningPercent?: number;
}) {
  const width = 96;
  const height = 26;
  const path = sparklinePath(values, width, height);
  const last = values[values.length - 1];
  const first = values[0];
  if (!path.last || last === undefined || first === undefined) {
    return <span className="ipam-spark ipam-spark--empty" aria-hidden="true" />;
  }
  const tone = percentTone(last, warningPercent);
  const delta = Math.round(last - first);
  return (
    <svg
      aria-label={`${label}: ${delta >= 0 ? "+" : ""}${delta} Prozentpunkte in ${values.length} Tagen`}
      className={`ipam-spark ipam-spark--${tone}`}
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <path className="ipam-spark__area" d={path.area} />
      <path className="ipam-spark__line" d={path.line} />
      <circle
        className="ipam-spark__dot"
        cx={path.last.x}
        cy={path.last.y}
        r={2.5}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Trend chart (area + forecast band + threshold, hover/keyboard tooltip)

export function TrendChartView({
  days = 90,
  history,
}: {
  days?: number;
  history: UtilizationHistory;
}) {
  const chart = trendChart(history, days);
  const gradientId = useId();
  const [active, setActive] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  if (!history.points.length) {
    return (
      <p className="ipam-empty">
        Noch kein Verlauf. Die Auslastung wird einmal täglich gemessen – die
        Kurve erscheint nach dem ersten Messtag.
      </p>
    );
  }
  const point = active !== null ? chart.points[active] : null;
  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const x = ((event.clientX - box.left) / box.width) * chart.width;
    if (x > chart.todayX + 8) {
      setActive(null);
      return;
    }
    setActive(nearestPoint(chart.points, x));
  };
  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    const last = chart.points.length - 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -1 : 1;
      setActive((current) =>
        Math.min(last, Math.max(0, (current ?? last) + step)),
      );
    } else if (event.key === "Escape") setActive(null);
  };
  const tipX = point ? Math.min(Math.max(point.x, 70), chart.width - 70) : 0;
  return (
    <figure className="ipam-trend">
      <svg
        aria-label={chart.description}
        className="ipam-trend__svg"
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
        onPointerLeave={() => setActive(null)}
        onPointerMove={onMove}
        ref={svgRef}
        role="img"
        tabIndex={0}
        viewBox={`0 0 ${chart.width} ${chart.height}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop className="ipam-trend__stop-top" offset="0%" />
            <stop className="ipam-trend__stop-bottom" offset="100%" />
          </linearGradient>
        </defs>
        {chart.yTicks.map((tick) => (
          <g key={tick.label}>
            <line
              className="ipam-trend__grid"
              x1={chart.plot.left}
              x2={chart.plot.right}
              y1={tick.y}
              y2={tick.y}
            />
            <text
              className="ipam-trend__axis"
              textAnchor="end"
              x={chart.plot.left - 8}
              y={tick.y + 4}
            >
              {tick.label}
            </text>
          </g>
        ))}
        {chart.forecast ? (
          <rect
            className="ipam-trend__future"
            height={chart.plot.bottom - chart.plot.top}
            width={chart.plot.right - chart.todayX}
            x={chart.todayX}
            y={chart.plot.top}
          />
        ) : null}
        <path
          className="ipam-trend__area"
          d={chart.area}
          fill={`url(#${gradientId})`}
        />
        <line
          className="ipam-trend__warn"
          x1={chart.plot.left}
          x2={chart.plot.right}
          y1={chart.warningY}
          y2={chart.warningY}
        />
        <text
          className="ipam-trend__warn-label"
          textAnchor="start"
          x={chart.plot.left + 6}
          y={chart.warningY - 6}
        >
          Warnschwelle {chart.warningPercent} %
        </text>
        <path className="ipam-trend__line" d={chart.line} />
        {chart.forecast ? (
          <>
            <path className="ipam-trend__band" d={chart.forecast.band} />
            <path className="ipam-trend__forecast" d={chart.forecast.line} />
            <circle
              className="ipam-trend__target"
              cx={chart.forecast.endX}
              cy={chart.forecast.endY}
              r={4}
            />
          </>
        ) : null}
        <line
          className="ipam-trend__today"
          x1={chart.todayX}
          x2={chart.todayX}
          y1={chart.plot.top}
          y2={chart.plot.bottom}
        />
        {chart.points.length ? (
          <circle
            className="ipam-trend__dot"
            cx={chart.points[chart.points.length - 1]!.x}
            cy={chart.points[chart.points.length - 1]!.y}
            r={4.5}
          />
        ) : null}
        {chart.xTicks.map((tick) => (
          <text
            className="ipam-trend__axis"
            key={tick.label}
            textAnchor={tick.anchor}
            x={tick.x}
            y={chart.height - 8}
          >
            {tick.label}
          </text>
        ))}
        {point ? (
          <g className="ipam-trend__hover" pointerEvents="none">
            <line
              x1={point.x}
              x2={point.x}
              y1={chart.plot.top}
              y2={chart.plot.bottom}
            />
            <circle cx={point.x} cy={point.y} r={4} />
            <rect
              height={40}
              rx={6}
              width={124}
              x={tipX - 62}
              y={chart.plot.top}
            />
            <text textAnchor="middle" x={tipX} y={chart.plot.top + 16}>
              {formatDay(point.day)}
            </text>
            <text
              className="ipam-trend__hover-value"
              textAnchor="middle"
              x={tipX}
              y={chart.plot.top + 32}
            >
              {percentText(point.percent)} belegt
            </text>
          </g>
        ) : null}
      </svg>
      <figcaption className="ipam-trend__legend">
        <span>
          <i className="ipam-trend__key ipam-trend__key--line" /> gemessen
          (täglich)
        </span>
        {chart.forecast ? (
          <span>
            <i className="ipam-trend__key ipam-trend__key--forecast" /> Prognose
            mit Unsicherheit
          </span>
        ) : null}
        <span>
          <i className="ipam-trend__key ipam-trend__key--warn" /> Warnschwelle
        </span>
        <span className="ipam-muted">
          Pfeiltasten oder Maus zeigen Tageswerte
        </span>
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Jargon tooltips

export const GLOSSARY: Record<string, string> = {
  VRF: "Virtual Routing and Forwarding: eine eigene, getrennte Routing-Tabelle. Gleiche IP-Adressen dürfen in verschiedenen VRFs vorkommen.",
  DHCP: "Dynamic Host Configuration Protocol: Adressen aus diesem Bereich (Pool) vergibt der DHCP-Server automatisch. Feste Adressen gehören ausserhalb des Pools.",
  Präfix:
    "Ein Netz in CIDR-Schreibweise, z. B. 10.10.1.0/24. Die Zahl nach dem Schrägstrich bestimmt die Grösse: /24 = 256 Adressen, /22 = 1024.",
  Gateway:
    "Router-Adresse des Subnetzes, über die Geräte andere Netze erreichen. Meist die erste nutzbare Adresse.",
  VLAN: "Virtuelles LAN: trennt Netze auf denselben Switches. Die VLAN-ID (1–4094) muss auf Switch und Firewall gleich sein.",
  Zone: "Sicherheitszone der Firewall (z. B. LAN, DMZ, MGMT). Regeln gelten meist pro Zone.",
  Container:
    "Supernetz, das nur Teilnetze enthält und selbst keine Adressen vergibt.",
  "Ghost-IP":
    "Eine Adresse antwortet im Netz, ist aber nicht dokumentiert. Übernehmen oder abklären.",
  Konflikt:
    "Zwei Geräte melden dieselbe IP, oder eine fremde MAC nutzt eine reservierte Adresse.",
};

/** Term with a dotted underline; hover or focus shows the explanation. */
export function Term({
  children,
  name,
}: {
  children?: ReactNode;
  name: keyof typeof GLOSSARY | string;
}) {
  const id = useId();
  const text = GLOSSARY[name];
  if (!text) return <>{children ?? name}</>;
  return (
    <span className="ipam-term">
      <span aria-describedby={id} className="ipam-term__word" tabIndex={0}>
        {children ?? name}
      </span>
      <span className="ipam-term__tip" id={id} role="tooltip">
        {text}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Copy to clipboard

export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back below.
  }
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({
  label,
  value,
}: {
  label?: string;
  value: string;
}) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDone(false), 1600);
    return () => window.clearTimeout(timer);
  }, [done]);
  return (
    <button
      aria-label={done ? `${value} kopiert` : `${label ?? value} kopieren`}
      className={`ipam-copy${done ? " is-done" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        void copyText(value).then(setDone);
      }}
      title={done ? "Kopiert" : "In die Zwischenablage kopieren"}
      type="button"
    >
      {done ? (
        <Check aria-hidden="true" size={13} />
      ) : (
        <Copy aria-hidden="true" size={13} />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Keyboard navigation for button grids (roving tabindex)

/**
 * Arrow keys, Home/End and PageUp/PageDown move the focus between the cells
 * of a grid whose buttons carry `data-cell="<index>"`. Returns the index that
 * gets tabIndex 0 and the key handler for the container.
 */
export function useGridKeys(count: number, columns: number, start = 0) {
  const [focus, setFocus] = useState(start);
  useEffect(() => {
    setFocus((current) =>
      current < start || current >= start + count ? start : current,
    );
  }, [count, start]);
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const target = event.target as HTMLElement;
      const current = Number(target.dataset.cell ?? NaN);
      if (Number.isNaN(current)) return;
      const last = start + count - 1;
      let next: number | null = null;
      if (event.key === "ArrowRight") next = current + 1;
      else if (event.key === "ArrowLeft") next = current - 1;
      else if (event.key === "ArrowDown") next = current + columns;
      else if (event.key === "ArrowUp") next = current - columns;
      else if (event.key === "Home") next = start;
      else if (event.key === "End") next = last;
      else if (event.key === "PageDown") next = current + columns * 4;
      else if (event.key === "PageUp") next = current - columns * 4;
      if (next === null) return;
      event.preventDefault();
      next = Math.min(last, Math.max(start, next));
      setFocus(next);
      const container = event.currentTarget;
      window.requestAnimationFrame(() =>
        container.querySelector<HTMLElement>(`[data-cell="${next}"]`)?.focus(),
      );
    },
    [columns, count, start],
  );
  return { focus, setFocus, onKeyDown };
}
