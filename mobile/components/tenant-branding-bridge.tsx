import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { AppState, View } from "react-native";
import { vars } from "nativewind";

import { useMobileFeatures } from "@/components/mobile-feature-gate";
import { TenantBrandingScope, useThemeContext } from "@/lib/theme-provider";
import { loadTenantBranding } from "@/lib/tenant-branding";

/**
 * Loads the web design only for the confirmed active tenant. The surrounding
 * scope synchronously exposes the default palette while this request is pending
 * or a workspace changes, so previous-tenant colours cannot render meanwhile.
 */
function TenantBrandingSynchronizer({
  checkingWorkspace,
  children,
  tenantId,
}: PropsWithChildren<{
  checkingWorkspace: boolean;
  tenantId: string | null;
}>) {
  const { colors, setTenantBrandColors } = useThemeContext();
  const requestVersion = useRef(0);
  const themeVariables = useMemo(
    () =>
      vars(
        Object.fromEntries(
          Object.entries(colors).map(([token, value]) => [
            `color-${token}`,
            value,
          ]),
        ),
      ),
    [colors],
  );

  const refreshBranding = useCallback(async () => {
    const requestedTenantId = tenantId;
    const version = requestVersion.current + 1;
    requestVersion.current = version;

    if (checkingWorkspace || !requestedTenantId) {
      setTenantBrandColors(null);
      return;
    }

    try {
      const branding = await loadTenantBranding(requestedTenantId);
      if (requestVersion.current !== version) return;
      setTenantBrandColors({
        tenantId: requestedTenantId,
        colors: {
          accentColor: branding.accentColor,
          primaryColor: branding.primaryColor,
          secondaryColor: branding.secondaryColor,
        },
      });
    } catch {
      if (requestVersion.current === version) setTenantBrandColors(null);
    }
  }, [checkingWorkspace, setTenantBrandColors, tenantId]);

  useEffect(() => {
    void refreshBranding();
    return () => {
      requestVersion.current += 1;
    };
  }, [refreshBranding]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshBranding();
    });
    return () => subscription.remove();
  }, [refreshBranding]);

  return <View style={[{ flex: 1 }, themeVariables]}>{children}</View>;
}

export function TenantBrandingBridge({ children }: PropsWithChildren) {
  const { loading: checkingWorkspace, tenantId } = useMobileFeatures();

  return (
    <TenantBrandingScope
      checkingWorkspace={checkingWorkspace}
      tenantId={tenantId}
    >
      <TenantBrandingSynchronizer
        checkingWorkspace={checkingWorkspace}
        tenantId={tenantId}
      >
        {children}
      </TenantBrandingSynchronizer>
    </TenantBrandingScope>
  );
}
