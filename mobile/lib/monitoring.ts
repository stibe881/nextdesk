// «Überwachung» in the app: calls to the monitoring-sensors edge function.
// Types and formatting are shared with the web app (monitoring-model.ts).
import type {
  MonitoringDeviceDetail,
  MonitoringOverview,
  MonitoringRange,
  MonitoringSeries,
} from "@/lib/monitoring-model";
import { invokeNextDesk } from "@/lib/nextdesk-client";

export * from "@/lib/monitoring-model";

export const loadMonitoringOverview = (tenantId: string) =>
  invokeNextDesk<MonitoringOverview>("monitoring-sensors", {
    type: "overview",
    tenantId,
  });

export const loadMonitoringDevice = (tenantId: string, assetId: string) =>
  invokeNextDesk<MonitoringDeviceDetail>("monitoring-sensors", {
    type: "device",
    tenantId,
    assetId,
  });

export const loadMonitoringSeries = (
  tenantId: string,
  sensorId: string,
  range: MonitoringRange,
) =>
  invokeNextDesk<MonitoringSeries>("monitoring-sensors", {
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
  invokeNextDesk<{ ok: boolean }>("monitoring-sensors", {
    type: "pauseDevice",
    tenantId,
    assetId,
    paused,
  });
