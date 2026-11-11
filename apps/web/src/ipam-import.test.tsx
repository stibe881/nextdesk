import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { IpamImportWizard } from "./ipam-import";

describe("IpamImportWizard", () => {
  it("starts with the source step", () => {
    const html = renderToString(
      <IpamImportWizard
        tenantId="00000000-0000-4000-8000-000000000001"
        canManage
      />,
    );
    expect(html).toContain("Daten importieren");
    expect(html).toContain("Automatisch erkennen");
    expect(html).toContain("phpIPAM");
  });

  it("explains the missing permission", () => {
    const html = renderToString(
      <IpamImportWizard
        tenantId="00000000-0000-4000-8000-000000000001"
        canManage={false}
      />,
    );
    expect(html).toContain("Berechtigung");
    expect(html).not.toContain("Automatisch erkennen");
  });
});
