export type Period = "Heute" | "7 Tage" | "30 Tage";
export type QueueKey = string;

export interface DashboardTicket {
  age: string;
  assignedToCurrentUser: boolean;
  isClosed: boolean;
  isUnassigned: boolean;
  id: string;
  recordId?: string;
  priority?: string;
  queue: QueueKey;
  queueLabel: string;
  risk: "ok" | "warnung" | "kritisch";
  sla: string;
  state: string;
  subject: string;
}

export interface DashboardMetrics {
  closed: string;
  closedDetail: string;
  mine: string;
  mineDetail: string;
  open: string;
  openDetail: string;
  unassigned: string;
  unassignedDetail: string;
}

export type DashboardMetricKey = "closed" | "mine" | "open" | "unassigned";

export type DashboardMetricTrend = {
  direction: "down" | "same" | "up";
  percentage: number;
  previous: number;
};

export type DashboardMetricTrends = Partial<
  Record<DashboardMetricKey, DashboardMetricTrend>
>;

export function dashboardComparisonWindow(
  period: Period,
  referenceDate = new Date(),
): { currentStart: string; previousStart: string } {
  const days = period === "Heute" ? 1 : period === "7 Tage" ? 7 : 30;
  const currentStart = new Date(referenceDate);
  currentStart.setDate(currentStart.getDate() - days);
  const previousStart = new Date(currentStart);
  previousStart.setDate(previousStart.getDate() - days);
  return {
    currentStart: currentStart.toISOString(),
    previousStart: previousStart.toISOString(),
  };
}

export function dashboardTrendFromComparison(
  current: number,
  previous: number,
): DashboardMetricTrend | null {
  if (
    !Number.isFinite(current) ||
    !Number.isFinite(previous) ||
    current < 0 ||
    previous <= 0
  ) {
    return null;
  }
  const change = current - previous;
  return {
    direction: change > 0 ? "up" : change < 0 ? "down" : "same",
    percentage: Math.round((Math.abs(change) / previous) * 100),
    previous,
  };
}

export interface ServiceHealth {
  availability: string;
  detail: string;
  name: string;
  state: "stabil" | "beobachten";
}

export interface TimelineItem {
  text: string;
  time: string;
  tone: "critical" | "neutral";
}

export const dashboardTickets: readonly DashboardTicket[] = [
  {
    age: "24 min",
    assignedToCurrentUser: true,
    id: "ICT-2026-0142",
    isClosed: false,
    isUnassigned: false,
    queue: "ict",
    queueLabel: "ICT",
    risk: "warnung",
    sla: "03:18",
    state: "in Bearbeitung",
    subject: "VPN-Verbindung bricht intermittierend ab",
  },
  {
    age: "41 min",
    assignedToCurrentUser: false,
    id: "INF-2026-0088",
    isClosed: false,
    isUnassigned: true,
    queue: "infrastruktur",
    queueLabel: "Infrastruktur",
    risk: "kritisch",
    sla: "00:42",
    state: "eskaliert",
    subject: "Backup-Job DC-02 mit Fehler beendet",
  },
  {
    age: "1 h 12",
    assignedToCurrentUser: false,
    id: "ICT-2026-0137",
    isClosed: true,
    isUnassigned: false,
    queue: "ict",
    queueLabel: "ICT",
    risk: "ok",
    sla: "06:20",
    state: "wartet",
    subject: "Berechtigung für Finance Share anpassen",
  },
  {
    age: "16 min",
    assignedToCurrentUser: false,
    id: "INF-2026-0084",
    isClosed: false,
    isUnassigned: true,
    queue: "infrastruktur",
    queueLabel: "Infrastruktur",
    risk: "ok",
    sla: "07:44",
    state: "neu",
    subject: "Neue VM für Testumgebung bereitstellen",
  },
];

export const previewMetrics: DashboardMetrics = {
  closed: "68",
  closedDetail: "im gewählten Zeitraum",
  mine: "12",
  mineDetail: "mir zugewiesen oder erstellt",
  open: "36",
  openDetail: "6 ausserhalb des Zielkorridors",
  unassigned: "7",
  unassignedDetail: "benötigen eine Zuweisung",
};

export const serviceHealth: readonly ServiceHealth[] = [
  {
    availability: "99.99%",
    detail: "Entra / SSO",
    name: "Identität & Zugriffe",
    state: "stabil",
  },
  {
    availability: "99.96%",
    detail: "Client-Dienste",
    name: "Arbeitsplatz",
    state: "stabil",
  },
  {
    availability: "99.82%",
    detail: "Sicherung & Hosting",
    name: "Kerninfrastruktur",
    state: "beobachten",
  },
];

export const activityItems: readonly TimelineItem[] = [
  {
    text: "INF-2026-0088 wurde an Infrastruktur eskaliert.",
    time: "09:42",
    tone: "critical",
  },
  {
    text: "Nina Keller hat eine Rückmeldung zu ICT-2026-0142 ergänzt.",
    time: "09:31",
    tone: "neutral",
  },
  {
    text: "SLA-Ziel für ICT-2026-0137 neu berechnet.",
    time: "09:18",
    tone: "neutral",
  },
];
