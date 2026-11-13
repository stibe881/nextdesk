import { Fragment, type PropsWithChildren, useEffect } from "react";

import { useMobileFeatures } from "@/components/mobile-feature-gate";
import {
  isFormality,
  restoreStoredFormality,
  setFormality,
  useFormality,
} from "@/lib/formality";
import { requireNextDesk } from "@/lib/nextdesk-client";

/**
 * Reads the form of address of the active tenant (tenant_settings.formality)
 * and applies it. Until then the last stored value is used.
 */
export function TenantFormalitySynchronizer() {
  const { loading, tenantId } = useMobileFeatures();

  useEffect(() => {
    void restoreStoredFormality();
  }, []);

  useEffect(() => {
    if (loading || !tenantId) return;
    let active = true;
    void Promise.resolve(
      requireNextDesk()
        .from("tenant_settings")
        .select("formality")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    )
      .then(({ data, error }) => {
        if (!active || error) return;
        const value = data?.formality;
        setFormality(isFormality(value) ? value : "du");
      })
      .catch(() => {
        // Keeps the last known form of address.
      });
    return () => {
      active = false;
    };
  }, [loading, tenantId]);

  return null;
}

/**
 * Remounts the interface below when the form of address changes, so that every
 * text is rendered again with the new wording.
 */
export function FormalityBoundary({ children }: PropsWithChildren) {
  const formality = useFormality();
  return <Fragment key={formality}>{children}</Fragment>;
}
