import { describe, expect, it } from "vitest";
import {
  contractOptions,
  licenseOptions,
  newContractValues,
  newLicenseValues,
  newRecordProblem,
  parseLinkableContracts,
  parseLinkableLicenses,
} from "./contract-license-link";

const licenses = parseLinkableLicenses([
  {
    id: "l1",
    title: "Microsoft 365 E3",
    vendorName: "Microsoft",
    status: "active",
    contractId: "c1",
  },
  {
    id: "l2",
    title: "Adobe Acrobat",
    vendorName: "Adobe",
    status: "active",
    contractId: null,
  },
  {
    id: "l3",
    title: "Visio",
    vendorName: "Microsoft",
    status: "draft",
    contractId: "c2",
  },
  { broken: true },
]);

describe("Verträge und Lizenzen verknüpfen", () => {
  it("liest nur gültige Einträge", () => {
    expect(licenses.map((license) => license.id)).toEqual(["l1", "l2", "l3"]);
    expect(
      parseLinkableContracts([
        {
          id: "c1",
          title: "EA",
          counterpartyName: "Microsoft",
          status: "active",
        },
        null,
      ]),
    ).toEqual([
      {
        id: "c1",
        title: "EA",
        counterpartyName: "Microsoft",
        status: "active",
      },
    ]);
  });

  it("bietet nicht gewählte Lizenzen an und zeigt einen fremden Vertrag als Hinweis", () => {
    const options = licenseOptions(licenses, ["l2"], "c1", (id) =>
      id === "c2" ? "Visio-Vertrag" : null,
    );
    expect(options.map((option) => option.value)).toEqual(["l1", "l3"]);
    expect(options[0]?.hint).toBe("Microsoft");
    expect(options[1]?.hint).toBe("Microsoft · gehört zu «Visio-Vertrag»");
    expect(
      contractOptions([
        { id: "c1", title: "EA", counterpartyName: "", status: "draft" },
      ])[0]?.hint,
    ).toBeNull();
  });

  it("übernimmt Partner, Zuständigkeit und Status für das neu erstellte Gegenstück", () => {
    const form = {
      counterpartyName: " Microsoft ",
      status: "active" as const,
      departmentId: "",
      responsibleUserId: "u1",
    };
    expect(newLicenseValues(" Visio ", form)).toMatchObject({
      title: "Visio",
      vendorName: "Microsoft",
      status: "active",
      quantity: null,
      departmentId: null,
      responsibleUserId: "u1",
    });
    expect(
      newContractValues("EA 2027", {
        vendorName: "Microsoft",
        status: "terminated",
        departmentId: "d1",
        responsibleUserId: "",
      }),
    ).toMatchObject({
      title: "EA 2027",
      counterpartyName: "Microsoft",
      contractType: "license",
      status: "draft",
      departmentId: "d1",
      responsibleUserId: null,
    });
  });

  it("verlangt einen Namen und den Partner", () => {
    expect(newRecordProblem("ab", "Microsoft", "Vertragspartner")).toMatch(
      /3 Zeichen/,
    );
    expect(newRecordProblem("Visio", " ", "Vertragspartner")).toMatch(
      /Vertragspartner/,
    );
    expect(newRecordProblem("EA 2027", "", "Hersteller / Anbieter")).toMatch(
      /Hersteller/,
    );
    expect(
      newRecordProblem("Visio", "Microsoft", "Vertragspartner"),
    ).toBeNull();
  });
});
