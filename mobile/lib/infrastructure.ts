import { invokeNextDesk } from "@/lib/nextdesk-client";
import type {
  InfraDetail,
  InfraDevice,
  InfraLifecycle,
  MaintenanceKind,
} from "@/lib/infrastructure-model";

export * from "@/lib/infrastructure-model";

export type InfraList = { canManage: boolean; devices: InfraDevice[] };

type Envelope<T> = { data?: T };

function unwrap<T>(response: Envelope<T> | null): T {
  if (!response || response.data === undefined || response.data === null) {
    throw new Error("Die Antwort von nextDesk ist unvollständig.");
  }
  return response.data;
}

export async function listInfrastructure(tenantId: string): Promise<InfraList> {
  const data = unwrap(
    await invokeNextDesk<Envelope<Partial<InfraList>>>("infrastructure", {
      type: "list",
      tenantId,
    }),
  );
  return {
    canManage: data.canManage === true,
    devices: Array.isArray(data.devices) ? data.devices : [],
  };
}

export async function getInfrastructureDetail(
  tenantId: string,
  assetId: string,
): Promise<InfraDetail> {
  const data = unwrap(
    await invokeNextDesk<Envelope<Partial<InfraDetail>>>("infrastructure", {
      type: "detail",
      tenantId,
      assetId,
    }),
  );
  return {
    lifecycle: data.lifecycle ?? [],
    maintenance: data.maintenance ?? [],
    connected: data.connected ?? [],
    tickets: data.tickets ?? [],
  };
}

export async function setInfrastructureLifecycle(
  tenantId: string,
  assetId: string,
  state: InfraLifecycle,
  reason: string,
): Promise<void> {
  await invokeNextDesk("infrastructure", {
    type: "setLifecycle",
    tenantId,
    assetId,
    state,
    reason,
  });
}

export async function addInfrastructureMaintenance(
  tenantId: string,
  assetId: string,
  performedOn: string,
  kind: MaintenanceKind,
  note: string,
): Promise<void> {
  await invokeNextDesk("infrastructure", {
    type: "addMaintenance",
    tenantId,
    assetId,
    performedOn,
    kind,
    note,
  });
}
