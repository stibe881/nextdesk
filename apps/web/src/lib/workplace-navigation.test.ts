import { describe, expect, it } from "vitest";
import {
  isWorkplaceAvailable,
  isWorkspaceNavigationReady,
  migrateWorkplaceStartSection,
  requestedWorkplaceViewForFollowUps,
} from "./workplace-navigation";

describe("Wiedervorlagen im Arbeitsplatz", () => {
  it("stellt den Arbeitsplatz bereit, wenn mindestens eine Arbeitsfunktion aktiv ist", () => {
    expect(isWorkplaceAvailable(true, false)).toBe(true);
    expect(isWorkplaceAvailable(false, true)).toBe(true);
    expect(isWorkplaceAvailable(true, true)).toBe(true);
    expect(isWorkplaceAvailable(false, false)).toBe(false);
  });

  it("öffnet Wiedervorlagen nur bei aktiver Wiedervorlagenfunktion gezielt als Arbeitsplatzregister", () => {
    expect(requestedWorkplaceViewForFollowUps(true, true)).toBe("followUps");
    expect(requestedWorkplaceViewForFollowUps(true, false)).toBeUndefined();
    expect(requestedWorkplaceViewForFollowUps(false, true)).toBeUndefined();
  });

  it("wartet mit einer angemeldeten Startansicht bis Rechte, Mandant und Funktionsflags bereitstehen", () => {
    const readyContext = {
      activeTenantAvailable: true,
      isSupabaseConfigured: true,
      sessionResolved: true,
      signedIn: true,
      tenantFeaturesLoading: false,
      ticketAccessLoading: false,
    };
    expect(isWorkspaceNavigationReady(readyContext)).toBe(true);
    expect(
      isWorkspaceNavigationReady({
        ...readyContext,
        ticketAccessLoading: true,
      }),
    ).toBe(false);
    expect(
      isWorkspaceNavigationReady({
        ...readyContext,
        tenantFeaturesLoading: true,
      }),
    ).toBe(false);
    expect(
      isWorkspaceNavigationReady({
        ...readyContext,
        activeTenantAvailable: false,
      }),
    ).toBe(false);
  });

  it("überführt eine alte Wiedervorlagen-Startansicht mitsamt Zielregister", () => {
    expect(migrateWorkplaceStartSection("Wiedervorlagen")).toEqual({
      requestedView: "followUps",
      section: "Arbeitsplatz",
    });
  });

  it("überführt die frühere Erwähnungsansicht und lässt aktuelle Ziele unverändert", () => {
    expect(migrateWorkplaceStartSection("Erwähnungen")).toEqual({
      requestedView: null,
      section: "Arbeitsplatz",
    });
    expect(migrateWorkplaceStartSection("Tickets")).toEqual({
      requestedView: null,
      section: "Tickets",
    });
  });
});
