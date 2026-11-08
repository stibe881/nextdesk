import { invokeNextDesk } from "@/lib/nextdesk-client";
import {
  parseHandbook,
  parseHandbookList,
  type Handbook,
  type HandbookId,
  type HandbookSummary,
} from "@/lib/handbooks-model";

export * from "@/lib/handbooks-model";

export async function listMobileHandbooks(
  tenantId: string,
): Promise<HandbookSummary[]> {
  return parseHandbookList(
    await invokeNextDesk<unknown>("handbooks", { type: "list", tenantId }),
  );
}

export async function loadMobileHandbook(
  tenantId: string,
  handbookId: HandbookId,
): Promise<Handbook> {
  return parseHandbook(
    await invokeNextDesk<unknown>("handbooks", {
      type: "get",
      tenantId,
      handbookId,
    }),
  );
}
