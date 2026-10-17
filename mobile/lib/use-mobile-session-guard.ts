import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";

import { isNextDeskConfigured, nextDesk } from "@/lib/nextdesk-client";

/** Redirects unauthenticated sessions before tab content becomes available. */
export function useMobileSessionGuard(): boolean {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!isNextDeskConfigured || !nextDesk) {
        setChecking(false);
        return () => {
          active = false;
        };
      }

      setChecking(true);
      void nextDesk.auth.getSession().then(({ data }) => {
        if (!active) return;
        if (!data.session) {
          router.replace("/auth");
          return;
        }
        setChecking(false);
      });

      return () => {
        active = false;
      };
    }, [router]),
  );

  return checking;
}
