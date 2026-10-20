import { describe, expect, it } from "vitest";
import {
  groupRolePermissions,
  roleScopeLabel,
} from "./role-management-presentation";

describe("role-management presentation", () => {
  it.each([
    ["ticket.update", "Tickets"],
    ["knowledge.manage", "Wissensdatenbank"],
    ["asset.integration.manage", "Assets"],
    ["event.spaces.manage", "Planung"],
    ["onboarding.request", "Planung"],
    ["team.manage", "Zusammenarbeit"],
    ["report.read", "Auswertungen"],
    ["tenant.settings.manage", "Administration"],
    ["platform.support_access.request", "Administration"],
  ])("ordnet %s dem Fachbereich %s zu", (code, expectedLabel) => {
    const [group] = groupRolePermissions([
      {
        code,
        description: `Beschreibung für ${code}`,
        isSensitive: false,
      },
    ]);

    expect(group?.label).toBe(expectedLabel);
  });

  it("sortiert mehrere Fachbereiche in einer ruhigen Arbeitsreihenfolge", () => {
    const groups = groupRolePermissions([
      {
        code: "platform.tenants.manage",
        description: "Mandanten verwalten",
        isSensitive: true,
      },
      {
        code: "ticket.update",
        description: "Tickets bearbeiten",
        isSensitive: false,
      },
      {
        code: "knowledge.manage",
        description: "Wissensartikel verwalten",
        isSensitive: false,
      },
    ]);

    expect(groups.map((group) => group.label)).toEqual([
      "Tickets",
      "Wissensdatenbank",
      "Administration",
    ]);
  });

  it("behält unbekannte Berechtigungen in einer sichtbaren Restgruppe", () => {
    const [group] = groupRolePermissions([
      {
        code: "custom.export",
        description: "Eigenen Export ausführen",
        isSensitive: false,
      },
    ]);

    expect(group).toMatchObject({
      id: "other",
      label: "Weitere Berechtigungen",
    });
  });

  it("benennt Rollenbereiche ohne technische Scopenamen", () => {
    expect(roleScopeLabel("tenant")).toBe("Für den ganzen Mandanten");
    expect(roleScopeLabel("department")).toBe("Für eine Abteilung");
    expect(roleScopeLabel("team")).toBe("Für ein Team");
  });
});
