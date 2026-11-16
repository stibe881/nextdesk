// «Überwachung» in the app: calls to the monitoring-sensors edge function.
// Types and formatting are shared with the web app (monitoring-model.ts).
import type {
  MonitoringConnections,
  MonitoringDeviceDetail,
  MonitoringOverview,
  MonitoringRange,
  MonitoringSeries,
} from "@/lib/monitoring-model";
import { monitoringData } from "@/lib/monitoring-response";
import { invokeNextDesk } from "@/lib/nextdesk-client";

const call = async <T>(body: Record<string, unknown>): Promise<T> =>
  monitoringData<T>(await invokeNextDesk<unknown>("monitoring-sensors", body));

export * from "@/lib/monitoring-model";

export const loadMonitoringOverview = (tenantId: string) =>
  call<MonitoringOverview>({
    type: "overview",
    tenantId,
  });

export const loadMonitoringDevice = (tenantId: string, assetId: string) =>
  call<MonitoringDeviceDetail>({
    type: "device",
    tenantId,
    assetId,
  });

/** Ports and neighbours of a device; older servers do not know the call. */
export const loadMonitoringConnections = (tenantId: string, assetId: string) =>
  call<MonitoringConnections>({
    type: "connections",
    tenantId,
    assetId,
  });

export const loadMonitoringSeries = (
  tenantId: string,
  sensorId: string,
  range: MonitoringRange,
) =>
  call<MonitoringSeries>({
    type: "series",
    tenantId,
    sensorId,
    range,
  });

export const pauseMonitoringDevice = (
  tenantId: string,
  assetId: string,
  paused: boolean,
) =>
  call<{ ok: boolean }>({
    type: "pauseDevice",
    tenantId,
    assetId,
    paused,
  });
