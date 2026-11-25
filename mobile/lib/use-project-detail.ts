import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { useMobileNetworkStatus } from "@/components/offline-status";
import { getMobileUserId, loadCurrentTenant } from "@/lib/nextdesk-client";
import {
  isProjectAccessDenied,
  loadProject,
  type MobileProjectDetail,
} from "@/lib/projects";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Liest einen Routenparameter als UUID. */
export function routeUuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

/**
 * Lädt ein Projekt mit Plan, Kommentaren und Team, sobald der Bildschirm
 * sichtbar wird. «denied» steht für fehlendes Modul, fehlende Beteiligung
 * oder ein unbekanntes Projekt.
 */
export function useProjectDetail(projectId: string | null) {
  const checkingSession = useMobileSessionGuard();
  const { isOffline, recoveryEpoch } = useMobileNetworkStatus();
  const [data, setData] = useState<MobileProjectDetail | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);

  const load = useCallback(
    async (pull = false) => {
      if (!projectId) {
        setDenied(true);
        setLoading(false);
        return;
      }
      setError("");
      if (pull) setRefreshing(true);
      try {
        const tenant = await loadCurrentTenant();
        setTenantId(tenant.id);
        const [detail, user] = await Promise.all([
          loadProject(tenant.id, projectId),
          getMobileUserId().catch(() => null),
        ]);
        setData(detail);
        setUserId(user);
        setDenied(false);
      } catch (nextError) {
        const status =
          typeof nextError === "object" && nextError !== null
            ? (nextError as { status?: unknown }).status
            : undefined;
        if (isProjectAccessDenied(nextError) || status === 404) {
          setDenied(true);
          setData(null);
        } else {
          setError(
            nextError instanceof Error && nextError.message
              ? nextError.message
              : "Das Projekt konnte nicht geladen werden.",
          );
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [projectId],
  );

  useFocusEffect(
    useCallback(() => {
      void recoveryEpoch;
      if (!checkingSession) void load();
    }, [checkingSession, load, recoveryEpoch]),
  );

  return {
    checkingSession,
    data,
    denied,
    error,
    isOffline,
    load,
    loading,
    refreshing,
    setData,
    setError,
    tenantId,
    userId,
  };
}
