// Person overview for agents (people search, person screen). Same model as
// apps/web/src/lib/person-overview.ts: single ratings and comments are never
// part of it, only the average from three ratings on.

export type PersonRef = {
  entraObjectId?: string | null;
  requesterContactId?: string | null;
  userId?: string | null;
  /** Shown while loading. */
  displayName?: string | null;
};

export type PersonSearchHit = {
  kind: "entra" | "requester";
  id: string;
  displayName: string;
  email: string | null;
  jobTitle: string | null;
  department: string | null;
  accountEnabled: boolean | null;
  openTicketCount: number;
};

export type PersonTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  statusKey: string;
  statusLabel: string;
  isClosed: boolean;
  priorityKey: string | null;
  priorityLabel: string | null;
  categoryName: string | null;
  assignedAgentName: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

export type PersonDevice = {
  id: string;
  name: string;
  assetTag: string | null;
  kind: string | null;
  manufacturer: string | null;
  model: string | null;
  operatingSystem: string | null;
  complianceState: string | null;
  lastSyncAt: string | null;
  assignedAt: string | null;
  source: "assignment" | "intune";
};

export type PersonLicense = {
  id: string;
  licenseId: string;
  title: string;
  vendorName: string | null;
  assignedAt: string | null;
};

export type PersonOrder = {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  items: string | null;
};

export type PersonOverview = {
  person: {
    entraObjectId: string | null;
    userId: string | null;
    requesterContactId: string | null;
    displayName: string;
    email: string | null;
    jobTitle: string | null;
    department: string | null;
    source: "entra" | "local";
    accountEnabled: boolean | null;
    removedFromDirectory: boolean;
    managerName: string | null;
    lastSignInAt: string | null;
    isMember: boolean;
  };
  stats: {
    openTickets: number;
    waitingOnPerson: number;
    ticketsLast12Months: number;
    ticketsPrevious12Months: number;
    totalTickets: number;
    avgResolutionHours: number | null;
    tenantAvgResolutionHours: number | null;
  };
  satisfaction: {
    ratingCount: number;
    minimumRatings: number;
    average: number | null;
    positiveShare: number | null;
    tenantAverage: number | null;
    trend: "up" | "down" | "stable" | null;
  };
  topics: { name: string; count: number }[];
  tickets: PersonTicket[];
  /** null: no permission or module off. */
  devices: PersonDevice[] | null;
  licenses: PersonLicense[] | null;
  orders: PersonOrder[] | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string | null =>
  typeof value === "string" ? value : null;
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() && Number.isFinite(+value)
      ? Number(value)
      : null;
const bool = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

export function parsePersonSearchHits(value: unknown): PersonSearchHit[] {
  if (!Array.isArray(value)) return [];
  const hits: PersonSearchHit[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = str(item.id);
    const displayName = str(item.displayName);
    if (
      !id ||
      !displayName ||
      (item.kind !== "entra" && item.kind !== "requester")
    ) {
      continue;
    }
    hits.push({
      kind: item.kind,
      id,
      displayName,
      email: str(item.email),
      jobTitle: str(item.jobTitle),
      department: str(item.department),
      accountEnabled: bool(item.accountEnabled),
      openTicketCount: num(item.openTicketCount) ?? 0,
    });
  }
  return hits;
}

export function personRefFromHit(hit: PersonSearchHit): PersonRef {
  return hit.kind === "entra"
    ? { entraObjectId: hit.id, displayName: hit.displayName }
    : { requesterContactId: hit.id, displayName: hit.displayName };
}

function list<T>(
  value: unknown,
  parseItem: (item: Record<string, unknown>) => T | null,
): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = isRecord(item) ? parseItem(item) : null;
    return parsed ? [parsed] : [];
  });
}

function parseTicket(item: Record<string, unknown>): PersonTicket | null {
  const id = str(item.id);
  const createdAt = str(item.createdAt);
  if (!id || !createdAt) return null;
  return {
    id,
    ticketNumber: str(item.ticketNumber) ?? "",
    subject: str(item.subject) ?? "",
    statusKey: str(item.statusKey) ?? "",
    statusLabel: str(item.statusLabel) ?? "",
    isClosed: item.isClosed === true,
    priorityKey: str(item.priorityKey),
    priorityLabel: str(item.priorityLabel),
    categoryName: str(item.categoryName),
    assignedAgentName: str(item.assignedAgentName),
    createdAt,
    updatedAt: str(item.updatedAt) ?? createdAt,
    closedAt: str(item.closedAt),
  };
}

function parseDevice(item: Record<string, unknown>): PersonDevice | null {
  const id = str(item.id);
  if (!id) return null;
  return {
    id,
    name: str(item.name) ?? "Gerät",
    assetTag: str(item.assetTag),
    kind: str(item.kind),
    manufacturer: str(item.manufacturer),
    model: str(item.model),
    operatingSystem: str(item.operatingSystem),
    complianceState: str(item.complianceState),
    lastSyncAt: str(item.lastSyncAt),
    assignedAt: str(item.assignedAt),
    source: item.source === "intune" ? "intune" : "assignment",
  };
}

function parseLicense(item: Record<string, unknown>): PersonLicense | null {
  const id = str(item.id);
  const licenseId = str(item.licenseId);
  if (!id || !licenseId) return null;
  return {
    id,
    licenseId,
    title: str(item.title) ?? "Lizenz",
    vendorName: str(item.vendorName),
    assignedAt: str(item.assignedAt),
  };
}

function parseOrder(item: Record<string, unknown>): PersonOrder | null {
  const id = str(item.id);
  const createdAt = str(item.createdAt);
  if (!id || !createdAt) return null;
  return {
    id,
    orderNumber: str(item.orderNumber) ?? "",
    status: str(item.status) ?? "",
    createdAt,
    items: str(item.items),
  };
}

export function parsePersonOverview(value: unknown): PersonOverview | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const data = value.data;
  const person = isRecord(data.person) ? data.person : null;
  const displayName = person ? str(person.displayName) : null;
  if (!person || !displayName) return null;
  const stats = isRecord(data.stats) ? data.stats : {};
  const satisfaction = isRecord(data.satisfaction) ? data.satisfaction : {};
  const trend = satisfaction.trend;
  return {
    person: {
      entraObjectId: str(person.entraObjectId),
      userId: str(person.userId),
      requesterContactId: str(person.requesterContactId),
      displayName,
      email: str(person.email),
      jobTitle: str(person.jobTitle),
      department: str(person.department),
      source: person.source === "entra" ? "entra" : "local",
      accountEnabled: bool(person.accountEnabled),
      removedFromDirectory: person.removedFromDirectory === true,
      managerName: str(person.managerName),
      lastSignInAt: str(person.lastSignInAt),
      isMember: person.isMember === true,
    },
    stats: {
      openTickets: num(stats.openTickets) ?? 0,
      waitingOnPerson: num(stats.waitingOnPerson) ?? 0,
      ticketsLast12Months: num(stats.ticketsLast12Months) ?? 0,
      ticketsPrevious12Months: num(stats.ticketsPrevious12Months) ?? 0,
      totalTickets: num(stats.totalTickets) ?? 0,
      avgResolutionHours: num(stats.avgResolutionHours),
      tenantAvgResolutionHours: num(stats.tenantAvgResolutionHours),
    },
    satisfaction: {
      ratingCount: num(satisfaction.ratingCount) ?? 0,
      minimumRatings: num(satisfaction.minimumRatings) ?? 3,
      average: num(satisfaction.average),
      positiveShare: num(satisfaction.positiveShare),
      tenantAverage: num(satisfaction.tenantAverage),
      trend:
        trend === "up" || trend === "down" || trend === "stable" ? trend : null,
    },
    topics: list(data.topics, (item) => {
      const name = str(item.name);
      const count = num(item.count);
      return name && count !== null ? { name, count } : null;
    }),
    tickets: list(data.tickets, parseTicket),
    devices: Array.isArray(data.devices)
      ? list(data.devices, parseDevice)
      : null,
    licenses: Array.isArray(data.licenses)
      ? list(data.licenses, parseLicense)
      : null,
    orders: Array.isArray(data.orders) ? list(data.orders, parseOrder) : null,
  };
}

export function personInitials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/u)
    .filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** "6.4 h", "2.5 Tage" */
export function formatDuration(hours: number | null): string {
  if (hours === null) return "–";
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} Tage`;
}

export function satisfactionLabel(average: number): string {
  if (average >= 4.5) return "Sehr zufrieden";
  if (average >= 3.75) return "Zufrieden";
  if (average >= 3) return "Gemischt";
  return "Eher unzufrieden";
}

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending_approval: "Wartet auf Freigabe",
  submitted: "Eingereicht",
  in_progress: "In Bearbeitung",
  ready: "Bereit zur Abholung",
  issued: "Ausgegeben",
  loaned: "Ausgeliehen",
  returned: "Zurückgegeben",
  rejected: "Abgelehnt",
  cancelled: "Storniert",
};

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABEL[status] ?? status;
}

export type PersonTimelineEntry = {
  at: string;
  kind: "ticket_created" | "ticket_closed" | "device" | "license" | "order";
  title: string;
  detail: string;
  ticketId?: string;
};

export function personTimeline(
  overview: PersonOverview,
): PersonTimelineEntry[] {
  const entries: PersonTimelineEntry[] = [];
  for (const ticket of overview.tickets) {
    entries.push({
      at: ticket.createdAt,
      kind: "ticket_created",
      title: `Ticket erfasst: ${ticket.subject}`,
      detail: ticket.ticketNumber,
      ticketId: ticket.id,
    });
    if (ticket.isClosed && ticket.closedAt) {
      entries.push({
        at: ticket.closedAt,
        kind: "ticket_closed",
        title: `Ticket ${ticket.statusLabel.toLowerCase()}: ${ticket.subject}`,
        detail: ticket.ticketNumber,
        ticketId: ticket.id,
      });
    }
  }
  for (const device of overview.devices ?? []) {
    if (!device.assignedAt) continue;
    entries.push({
      at: device.assignedAt,
      kind: "device",
      title: `Gerät zugeordnet: ${device.name}`,
      detail: device.source === "intune" ? "Intune" : "Assets",
    });
  }
  for (const license of overview.licenses ?? []) {
    if (!license.assignedAt) continue;
    entries.push({
      at: license.assignedAt,
      kind: "license",
      title: `Lizenz zugewiesen: ${license.title}`,
      detail: license.vendorName ?? "",
    });
  }
  for (const order of overview.orders ?? []) {
    entries.push({
      at: order.createdAt,
      kind: "order",
      title: `Bestellung ${order.orderNumber}`,
      detail: order.items ?? orderStatusLabel(order.status),
    });
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 80);
}
