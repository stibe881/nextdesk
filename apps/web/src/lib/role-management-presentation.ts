export type RolePermissionPresentation = {
  code: string;
  description: string;
  isSensitive: boolean;
};

export type RolePermissionGroup = {
  id: string;
  label: string;
  permissions: RolePermissionPresentation[];
};

const GROUPS: ReadonlyArray<{
  id: string;
  label: string;
  prefixes: readonly string[];
}> = [
  { id: "tickets", label: "Tickets", prefixes: ["ticket"] },
  { id: "knowledge", label: "Wissensdatenbank", prefixes: ["knowledge"] },
  { id: "assets", label: "Assets", prefixes: ["asset"] },
  { id: "contracts", label: "Verträge", prefixes: ["contracts"] },
  {
    id: "planning",
    label: "Planung",
    prefixes: ["event", "event_space", "onboarding"],
  },
  {
    id: "workplace",
    label: "Zusammenarbeit",
    prefixes: ["experience", "follow_up", "team"],
  },
  { id: "reports", label: "Auswertungen", prefixes: ["report"] },
  {
    id: "administration",
    label: "Administration",
    prefixes: [
      "tenant",
      "role",
      "user",
      "department",
      "automation",
      "privacy",
      "platform",
    ],
  },
];

function groupForCode(code: string): Pick<RolePermissionGroup, "id" | "label"> {
  const prefix = code.split(".")[0] ?? "";
  return (
    GROUPS.find((group) => group.prefixes.includes(prefix)) ?? {
      id: "other",
      label: "Weitere Berechtigungen",
    }
  );
}

export function groupRolePermissions(
  permissions: RolePermissionPresentation[],
): RolePermissionGroup[] {
  const groups = new Map<string, RolePermissionGroup>();

  for (const permission of permissions) {
    const group = groupForCode(permission.code);
    const current = groups.get(group.id) ?? {
      id: group.id,
      label: group.label,
      permissions: [],
    };
    current.permissions.push(permission);
    groups.set(group.id, current);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      permissions: [...group.permissions].sort((left, right) =>
        left.description.localeCompare(right.description, "de-CH"),
      ),
    }))
    .sort((left, right) => {
      const leftIndex = GROUPS.findIndex((group) => group.id === left.id);
      const rightIndex = GROUPS.findIndex((group) => group.id === right.id);
      const normalizedLeftIndex = leftIndex === -1 ? GROUPS.length : leftIndex;
      const normalizedRightIndex =
        rightIndex === -1 ? GROUPS.length : rightIndex;
      return normalizedLeftIndex - normalizedRightIndex;
    });
}

export function roleScopeLabel(scope: string): string {
  if (scope === "tenant") return "Für den ganzen Mandanten";
  if (scope === "department") return "Für eine Abteilung";
  if (scope === "team") return "Für ein Team";
  return "Eingeschränkter Geltungsbereich";
}

/**
 * One short sentence per permission: what someone with it can do in the app.
 * Shown under the permission name in the role editor.
 */
const PERMISSION_HINTS: Readonly<Record<string, string>> = {
  "asset.integration.manage":
    "Verbindet Intune und andere Quellen und startet den Geräteabgleich.",
  "asset.intune.actions":
    "Löst Aktionen direkt auf Intune-Geräten aus, z. B. Neustart oder Sperren.",
  "asset.manage": "Erfasst, ändert und archiviert Geräte und Assets.",
  "automation.manage":
    "Richtet Ticketregeln, Triage, Lieferanten und Abläufe ein.",
  "contracts.manage": "Sieht und pflegt alle Verträge und Lizenzen.",
  "department.manage": "Legt Abteilungen an und ändert sie.",
  "event.spaces.manage": "Verwaltet Räume und bearbeitet Raumaufträge.",
  "event.spaces.request": "Kann Veranstaltungsräume reservieren lassen.",
  "inventory.adjust": "Korrigiert Bestände von Hand, z. B. nach Schwund.",
  "inventory.count.close":
    "Schliesst Inventuren ab und übernimmt die gezählten Mengen.",
  "inventory.manage": "Pflegt Lagerorte und Artikel im Lager.",
  "inventory.issue":
    "Bucht Bestände von Hand aus (Entnahme aus dem Lager).",
  "inventory.move":
    "Bucht Eingänge, Umlagerungen, Reservierungen und deren Ausgabe.",
  "inventory.read": "Sieht Lagerbestände und Bewegungen, ohne zu buchen.",
  "knowledge.manage": "Schreibt, ändert und archiviert Wissensartikel.",
  "knowledge.publish": "Gibt Wissensartikel für alle frei.",
  "knowledge.read": "Liest veröffentlichte Wissensartikel.",
  "onboarding.manage": "Bearbeitet Eintritte und deren Aufgaben.",
  "onboarding.request": "Meldet neue Mitarbeitende zum Eintritt an.",
  "platform.support_access.request":
    "Erlaubt dem Plattform-Support befristet und protokolliert Zugriff.",
  "platform.tenants.manage": "Verwaltet Mandanten der gesamten Plattform.",
  "report.read": "Sieht Berichte und Auswertungen.",
  "role.manage": "Erstellt Rollen und weist sie Personen zu.",
  "service_tasks.execute": "Erledigt fällige Serviceaufgaben.",
  "service_tasks.manage":
    "Plant wiederkehrende Serviceaufgaben und ändert sie.",
  "service_tasks.read": "Sieht Serviceaufgaben, ohne sie zu erledigen.",
  "shop.fulfill":
    "Bearbeitet Shop-Bestellungen und bucht die Artikel aus dem Lager.",
  "shop.manage": "Pflegt Artikel und Kategorien des Shops.",
  "shop.order": "Bestellt oder leiht Artikel im Shop.",
  "team.manage": "Legt Teams an und ändert ihre Mitglieder.",
  "team.supervise":
    "Führt ein Team: Auslastung, Umverteilen, Qualität und Monatsbericht.",
  "tenant.settings.manage":
    "Ändert die Einstellungen dieses Mandanten, inkl. Design und Funktionen.",
  "ticket.approval.decide": "Genehmigt oder lehnt Ticketfreigaben ab.",
  "ticket.approval.request": "Holt für ein Ticket eine Freigabe ein.",
  "ticket.assign": "Weist Tickets Personen oder Teams zu.",
  "ticket.close": "Setzt Tickets auf gelöst oder geschlossen.",
  "ticket.comment.external": "Schreibt Antworten, die Anfragende sehen.",
  "ticket.comment.external.own":
    "Anfragende können in ihren eigenen Tickets antworten.",
  "ticket.create": "Erstellt neue Tickets.",
  "ticket.delete": "Löscht Tickets endgültig.",
  "ticket.escalate": "Eskaliert Tickets an die nächste Stufe oder Leitung.",
  "ticket.export": "Exportiert Ticketlisten, z. B. als CSV.",
  "ticket.internal_notes.read":
    "Sieht interne Notizen, die Anfragende nicht sehen.",
  "ticket.internal_notes.write": "Schreibt interne Notizen in Tickets.",
  "ticket.manage":
    "Verwaltet gemeinsame Ticketansichten und Problemfälle für alle.",
  "ticket.merge": "Führt doppelte Tickets zusammen oder teilt sie auf.",
  "ticket.quality.review": "Bewertet die Qualität bearbeiteter Tickets.",
  "ticket.read.assigned": "Sieht nur Tickets, die der Person zugewiesen sind.",
  "ticket.read.department": "Sieht alle Tickets der eigenen Abteilungen.",
  "ticket.read.own": "Sieht eigene Tickets und solche, die sie betreffen.",
  "ticket.sla.manage":
    "Legt SLA-Profile mit Reaktions- und Lösungszeiten fest.",
  "ticket.template.manage": "Erstellt und ändert Ticketvorlagen.",
  "ticket.time.track": "Erfasst Arbeitszeit auf Tickets.",
  "ticket.update": "Ändert Status, Priorität und Felder von Tickets.",
  "ticket.watch": "Folgt Tickets und erhält Benachrichtigungen dazu.",
  "user.manage": "Lädt Personen ein, ändert und entfernt sie.",
};

export function permissionHint(code: string): string | null {
  return PERMISSION_HINTS[code] ?? null;
}
