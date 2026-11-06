import { describe, expect, it } from "vitest";
import {
  quickCreateActionsForContext,
  quickCreateRequestMatchesTenant,
} from "./quick-create-actions";

describe("zentrale Erfassungsaktionen", () => {
  it("stellt alle vier Aktionen bei aktivem Mandanten und freigegebenen Bereichen bereit", () => {
    expect(
      quickCreateActionsForContext({
        assetManagementEnabled: true,
        canWorkTickets: true,
        experienceWorkspaceEnabled: true,
        hasActiveTenant: true,
        knowledgeBaseEnabled: true,
      }),
    ).toEqual(["followUp", "ticket", "problem", "knowledge"]);
  });

  it("ordnet alle Aktionen wie die Navigation", () => {
    expect(
      quickCreateActionsForContext({
        assetManagementEnabled: true,
        canWorkTickets: true,
        experienceWorkspaceEnabled: true,
        hasActiveTenant: true,
        knowledgeBaseEnabled: true,
        serviceTasksAvailable: true,
        inventoryAvailable: true,
        contractsAvailable: true,
      }),
    ).toEqual([
      "followUp",
      "ticket",
      "problem",
      "serviceTask",
      "knowledge",
      "inventoryItem",
      "contract",
      "license",
    ]);
  });

  it("blendet nur nicht verfügbare Bereichsaktionen aus", () => {
    expect(
      quickCreateActionsForContext({
        assetManagementEnabled: false,
        canWorkTickets: true,
        experienceWorkspaceEnabled: false,
        hasActiveTenant: true,
        knowledgeBaseEnabled: true,
      }),
    ).toEqual(["ticket", "knowledge"]);
  });

  it("bietet reinen Anfragenden ausschliesslich die Ticketerfassung an", () => {
    expect(
      quickCreateActionsForContext({
        assetManagementEnabled: true,
        canWorkTickets: false,
        experienceWorkspaceEnabled: true,
        hasActiveTenant: true,
        knowledgeBaseEnabled: true,
      }),
    ).toEqual(["ticket"]);
  });

  it("liefert Erfassungsimpulse nach einem Mandantenwechsel nicht an den neuen Mandanten", () => {
    expect(quickCreateRequestMatchesTenant("tenant-vorher", "tenant-neu")).toBe(
      false,
    );
    expect(
      quickCreateRequestMatchesTenant("tenant-aktuell", "tenant-aktuell"),
    ).toBe(true);
  });

  it("bietet ohne aktiven Mandanten keine Erfassungsaktion an", () => {
    expect(
      quickCreateActionsForContext({
        assetManagementEnabled: true,
        canWorkTickets: true,
        experienceWorkspaceEnabled: true,
        hasActiveTenant: false,
        knowledgeBaseEnabled: true,
      }),
    ).toEqual([]);
  });
});
