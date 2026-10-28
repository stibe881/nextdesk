import { describe, expect, it } from "vitest";

import {
  parseInventoryWorkspace,
  parseSourceReservationRules,
} from "./inventory";

const tenantId = "00000000-0000-4000-8000-000000000001";
const itemId = "00000000-0000-4000-8000-000000000002";
const locationId = "00000000-0000-4000-8000-000000000003";
const eventRuleId = "00000000-0000-4000-8000-000000000004";
const onboardingRuleId = "00000000-0000-4000-8000-000000000005";
const templateId = "00000000-0000-4000-8000-000000000006";
const templateTaskId = "00000000-0000-4000-8000-000000000007";

const workspace = {
  data: {
    permissions: {
      canRead: true,
      canManage: false,
      canMove: true,
      canAdjust: false,
      canCloseInventoryCount: false,
    },
    summary: {
      criticalItemCount: 1,
      openReservationCount: 2,
      activeCountSessionCount: 0,
    },
    items: [
      {
        id: "item-1",
        name: "HDMI-Kabel",
        articleNumber: "HDMI-2M",
        unit: "Stück",
        trackingMode: "quantity",
        physicalQuantity: 8,
        reservedQuantity: 3,
        availableQuantity: 5,
        minQuantity: 4,
        targetQuantity: 12,
        locationName: "Hauptlager",
        active: true,
        hasPrimaryImage: false,
      },
    ],
    locations: [
      { id: "location-1", name: "Hauptlager", code: "A-01", active: true },
    ],
    recentEvents: [
      {
        id: "event-1",
        type: "receipt",
        occurredAt: "2026-10-28T12:00:00.000Z",
        itemName: "HDMI-Kabel",
        physicalDelta: 8,
        reservedDelta: 0,
        locationName: "Hauptlager",
      },
    ],
    lowStockItems: [],
  },
};

describe("parseInventoryWorkspace", () => {
  it("akzeptiert nur den datenminimalen serverautorisierten Lagervertrag", () => {
    expect(parseInventoryWorkspace(workspace)).toMatchObject({
      permissions: { canRead: true, canMove: true },
      summary: { criticalItemCount: 1 },
      items: [{ id: "item-1", availableQuantity: 5 }],
    });
  });

  it("weist fehlende Leseberechtigung, Zusatzfelder und inkonsistente Mengen zurück", () => {
    expect(
      parseInventoryWorkspace({
        data: {
          ...workspace.data,
          permissions: { ...workspace.data.permissions, canRead: false },
        },
      }),
    ).toBeNull();
    expect(
      parseInventoryWorkspace({
        data: {
          ...workspace.data,
          items: [{ ...workspace.data.items[0], reservedQuantity: 9 }],
        },
      }),
    ).toBeNull();
    expect(
      parseInventoryWorkspace({
        data: {
          ...workspace.data,
          items: [
            { ...workspace.data.items[0], internalNote: "Nicht anzeigen" },
          ],
        },
      }),
    ).toBeNull();
  });
});

describe("parseSourceReservationRules", () => {
  const sourceRules = {
    data: {
      canManageEventRules: true,
      canManageOnboardingRules: true,
      rules: [
        {
          id: eventRuleId,
          sourceKind: "event_space_equipment",
          equipmentKey: "projector",
          itemId,
          locationId,
          quantity: 1.5,
          enabled: false,
        },
        {
          id: onboardingRuleId,
          sourceKind: "onboarding_template_task",
          templateId,
          templateTaskId,
          itemId,
          locationId,
          quantity: 2,
          enabled: true,
        },
      ],
      onboardingTemplateTasks: [
        {
          templateId,
          templateTitle: "ICT",
          templateTaskId,
          templateTaskTitle: "Gerät bereitstellen",
        },
      ],
    },
  };

  it("akzeptiert nur die datenminimale, serverautorisierte Regelantwort", () => {
    expect(parseSourceReservationRules(sourceRules)).toEqual({
      canManageEventRules: true,
      canManageOnboardingRules: true,
      rules: [
        {
          id: eventRuleId,
          sourceKind: "event_space_equipment",
          equipmentKey: "projector",
          itemId,
          locationId,
          quantity: 1.5,
          enabled: false,
        },
        {
          id: onboardingRuleId,
          sourceKind: "onboarding_template_task",
          templateId,
          templateTaskId,
          itemId,
          locationId,
          quantity: 2,
          enabled: true,
        },
      ],
      onboardingTemplateTasks: [
        {
          templateId,
          templateTitle: "ICT",
          templateTaskId,
          templateTaskTitle: "Gerät bereitstellen",
        },
      ],
    });
  });

  it("weist nicht autorisierte Quellen, Reservierungen und Zusatzfelder fail-closed zurück", () => {
    expect(
      parseSourceReservationRules({
        data: {
          ...sourceRules.data,
          canManageEventRules: false,
        },
      }),
    ).toBeNull();
    expect(
      parseSourceReservationRules({
        data: {
          ...sourceRules.data,
          rules: [
            {
              ...sourceRules.data.rules[0],
              reservationId: tenantId,
            },
          ],
          onboardingTemplateTasks: [],
        },
      }),
    ).toBeNull();
    expect(
      parseSourceReservationRules({
        data: {
          ...sourceRules.data,
          onboardingTemplateTasks: [
            {
              ...sourceRules.data.onboardingTemplateTasks[0],
              internalNote: "Nicht anzeigen",
            },
          ],
        },
      }),
    ).toBeNull();
    expect(
      parseSourceReservationRules({
        data: {
          ...sourceRules.data,
          rules: [
            {
              ...sourceRules.data.rules[0],
              quantity: 1.2345,
            },
          ],
          onboardingTemplateTasks: [],
          currentReservations: [],
        },
      }),
    ).toBeNull();
  });
});
