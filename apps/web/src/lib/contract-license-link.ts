import { tn } from "./formality";
import type { PickOption } from "../pick-or-create";

/** A license as offered in the contract form (contracts → listLicenses). */
export type LinkableLicense = {
  id: string;
  title: string;
  vendorName: string;
  status: string;
  contractId: string | null;
};

/** A contract as offered in the license form (licenses → listContracts). */
export type LinkableContract = {
  id: string;
  title: string;
  counterpartyName: string;
  status: string;
};

type DraftStatus = "draft" | "active" | "terminated";

export function parseLinkableLicenses(value: unknown): LinkableLicense[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.title !== "string") return [];
    return [
      {
        id: row.id,
        title: row.title,
        vendorName: typeof row.vendorName === "string" ? row.vendorName : "",
        status: typeof row.status === "string" ? row.status : "draft",
        contractId: typeof row.contractId === "string" ? row.contractId : null,
      },
    ];
  });
}

export function parseLinkableContracts(value: unknown): LinkableContract[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.title !== "string") return [];
    return [
      {
        id: row.id,
        title: row.title,
        counterpartyName:
          typeof row.counterpartyName === "string" ? row.counterpartyName : "",
        status: typeof row.status === "string" ? row.status : "draft",
      },
    ];
  });
}

/**
 * Licenses that can still be added to a contract. A license that belongs to
 * another contract is offered too (it moves on saving), with a hint.
 */
export function licenseOptions(
  licenses: readonly LinkableLicense[],
  selectedIds: readonly string[],
  contractId: string | null,
  contractTitle: (id: string) => string | null,
): PickOption[] {
  return licenses
    .filter((license) => !selectedIds.includes(license.id))
    .map((license) => {
      const other =
        license.contractId && license.contractId !== contractId
          ? contractTitle(license.contractId)
          : null;
      return {
        value: license.id,
        label: license.title,
        hint:
          [license.vendorName, other ? `gehört zu «${other}»` : null]
            .filter(Boolean)
            .join(" · ") || null,
      };
    });
}

export function contractOptions(
  contracts: readonly LinkableContract[],
): PickOption[] {
  return contracts.map((contract) => ({
    value: contract.id,
    label: contract.title,
    hint: contract.counterpartyName || null,
  }));
}

/** Readable reason why a name cannot be used for a new record, or null. */
export function newRecordProblem(
  name: string,
  partner: string,
  partnerLabel: "Vertragspartner" | "Hersteller / Anbieter",
): string | null {
  if (Array.from(name.trim()).length < 3)
    return "Der Name muss mindestens 3 Zeichen lang sein.";
  if (Array.from(partner.trim()).length < 2)
    return partnerLabel === "Vertragspartner"
      ? tn(
          "Bitte erfasse zuerst den Vertragspartner; er wird als Hersteller / Anbieter der Lizenz übernommen.",
          "Bitte erfassen Sie zuerst den Vertragspartner; er wird als Hersteller / Anbieter der Lizenz übernommen.",
        )
      : tn(
          "Bitte erfasse zuerst den Hersteller / Anbieter; er wird als Vertragspartner übernommen.",
          "Bitte erfassen Sie zuerst den Hersteller / Anbieter; er wird als Vertragspartner übernommen.",
        );
  return null;
}

function draftStatus(status: DraftStatus): DraftStatus {
  return status === "active" ? "active" : "draft";
}

/** Values for licenses → create, started from the contract form. */
export function newLicenseValues(
  name: string,
  contract: {
    counterpartyName: string;
    status: DraftStatus;
    departmentId: string;
    responsibleUserId: string;
  },
) {
  return {
    title: name.trim(),
    vendorName: contract.counterpartyName.trim(),
    referenceNumber: null,
    licenseType: "subscription",
    quantity: null,
    status: draftStatus(contract.status),
    startsOn: null,
    endsOn: null,
    noticePeriodDays: null,
    departmentId: contract.departmentId || null,
    responsibleUserId: contract.responsibleUserId || null,
    notes: null,
  };
}

/** Values for contracts → create, started from the license form. */
export function newContractValues(
  name: string,
  license: {
    vendorName: string;
    status: DraftStatus;
    departmentId: string;
    responsibleUserId: string;
  },
) {
  return {
    title: name.trim(),
    counterpartyName: license.vendorName.trim(),
    referenceNumber: null,
    contractType: "license",
    status: draftStatus(license.status),
    startsOn: null,
    endsOn: null,
    noticePeriodDays: null,
    departmentId: license.departmentId || null,
    responsibleUserId: license.responsibleUserId || null,
    notes: null,
  };
}

/** Readable server message of a failed functions.invoke, if there is one. */
export async function invokeErrorMessage(error: unknown): Promise<string> {
  try {
    const context = (error as { context?: Response }).context;
    const payload = context ? await context.json() : null;
    if (typeof payload?.error?.message === "string")
      return payload.error.message;
  } catch {
    // fall through to the generic message
  }
  return "";
}
