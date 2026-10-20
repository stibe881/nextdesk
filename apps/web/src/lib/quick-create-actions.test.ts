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
    ).toEqual(["ticket", "problem", "followUp", "knowledge"]);
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

  it("bietet ohne Ticketarbeitsberechtigung weder Fall noch Wissensartikel an", () => {
    expect(
      quickCreateActionsForContext({
        assetManagementEnabled: true,
        canWorkTickets: false,
        experienceWorkspaceEnabled: true,
        hasActiveTenant: true,
        knowledgeBaseEnabled: true,
      }),
    ).toEqual(["ticket", "followUp"]);
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
