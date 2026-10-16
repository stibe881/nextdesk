export type TicketState = "neu" | "in Bearbeitung" | "wartet" | "eskaliert";
export type QueueKey = "alle" | "ict" | "infrastruktur";

export interface DashboardTicket {
  id: string;
  subject: string;
  requester: string;
  queue: Exclude<QueueKey, "alle">;
  state: TicketState;
  age: string;
  sla: string;
  risk: "ok" | "warnung" | "kritisch";
}

export const dashboardTickets: readonly DashboardTicket[] = [
  {
    id: "ICT-2026-0142",
    subject: "VPN-Verbindung bricht intermittierend ab",
    requester: "Nina Keller",
    queue: "ict",
    state: "in Bearbeitung",
    age: "24 min",
    sla: "03:18",
    risk: "warnung",
  },
  {
    id: "INF-2026-0088",
    subject: "Backup-Job DC-02 mit Fehler beendet",
    requester: "Monitoring",
    queue: "infrastruktur",
    state: "eskaliert",
    age: "41 min",
    sla: "00:42",
    risk: "kritisch",
  },
  {
    id: "ICT-2026-0137",
    subject: "Berechtigung für Finance Share anpassen",
    requester: "Marco Steiner",
    queue: "ict",
    state: "wartet",
    age: "1 h 12",
    sla: "06:20",
    risk: "ok",
  },
  {
    id: "INF-2026-0084",
    subject: "Neue VM für Testumgebung bereitstellen",
    requester: "Lea Meier",
    queue: "infrastruktur",
    state: "neu",
    age: "16 min",
    sla: "07:44",
    risk: "ok",
  },
];

export const serviceHealth = [
  {
    name: "Identity & Access",
    detail: "Entra / SSO",
    state: "stabil",
    availability: "99.99%",
  },
  {
    name: "Workplace",
    detail: "Client Services",
    state: "stabil",
    availability: "99.96%",
  },
  {
    name: "Core Infrastructure",
    detail: "Backup & Hosting",
    state: "beobachten",
    availability: "99.82%",
  },
] as const;

export const activityItems = [
  {
    time: "09:42",
    text: "INF-2026-0088 wurde an Infrastruktur eskaliert.",
    tone: "critical",
  },
  {
    time: "09:31",
    text: "Nina Keller hat eine Rückmeldung zu ICT-2026-0142 ergänzt.",
    tone: "neutral",
  },
  {
    time: "09:18",
    text: "SLA-Ziel für ICT-2026-0137 neu berechnet.",
    tone: "neutral",
  },
] as const;
