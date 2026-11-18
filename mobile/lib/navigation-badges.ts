import { useCallback, useEffect, useState } from "react";

import { useAppActiveInterval } from "@/lib/use-app-active-interval";
import { invokeNextDesk, requireNextDesk } from "@/lib/nextdesk-client";
import {
  parseShopAttention,
  parseTicketAttention,
  type NavigationBadges,
} from "@/lib/navigation-badges-model";

/** Loads the counts for the menu badges; failures simply show no badge. */
export async function loadNavigationBadges(
  tenantId: string,
  includeShop: boolean,
): Promise<NavigationBadges> {
  try {
    const client = requireNextDesk();
    const [attention, shop] = await Promise.all([
      Promise.resolve(
        client.rpc("navigation_ticket_attention", { p_tenant_id: tenantId }),
      )
        .then(({ data, error }) => (error ? {} : parseTicketAttention(data)))
        .catch(() => ({}) as NavigationBadges),
      includeShop
        ? invokeNextDesk<unknown>("shop", { type: "getContext", tenantId })
            .then((data) => parseShopAttention(data))
            .catch(() => 0)
        : Promise.resolve(0),
    ]);
    return { ...attention, shop };
  } catch {
    return {};
  }
}

/**
 * Menu badges of the bottom navigation: loaded for the current tenant,
 * refreshed every minute while the app is in the foreground and on demand
 * (e.g. when another tab is opened).
 */
export function useNavigationBadges(
  tenantId: string | null,
  includeShop: boolean,
): { badges: NavigationBadges; refresh: () => void } {
  const [state, setState] = useState<{
    tenantId: string;
    badges: NavigationBadges;
  } | null>(null);

  const refresh = useCallback(() => {
    if (!tenantId) return;
    void loadNavigationBadges(tenantId, includeShop).then((badges) =>
      setState({ tenantId, badges }),
    );
  }, [tenantId, includeShop]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useAppActiveInterval(refresh, 30_000, Boolean(tenantId));

  return {
    badges: state && state.tenantId === tenantId ? state.badges : {},
    refresh,
  };
}
