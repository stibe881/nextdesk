import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";

import { IpamNetworkCard } from "@/components/ipam-network-card";
import { ScreenContainer } from "@/components/screen-container";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";

const IP_ADDRESS = /^[0-9a-f.:]{2,45}$/i;

function parseAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const value = decodeURIComponent(raw);
    return IP_ADDRESS.test(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Ziel einer Mitteilung der IP-Adressverwaltung (Fund, ablaufende
 * Reservierung) ohne bekanntes Gerät: zeigt die dokumentierten Netzwerkdaten
 * der Adresse. Rechte prüft der Server (ipam.read, Modul eingeschaltet).
 */
export default function IpamAddressScreen() {
  const { address: raw } = useLocalSearchParams<{ address?: string }>();
  const router = useRouter();
  const styles = useStyles();
  const colors = useAppColors();
  const checkingSession = useMobileSessionGuard();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const address = parseAddress(raw);

  useEffect(() => {
    if (checkingSession) return;
    let active = true;
    loadCurrentTenant()
      .then((tenant) => {
        if (active) setTenantId(tenant.id);
      })
      .catch(() => {
        if (active) setCount(0);
      });
    return () => {
      active = false;
    };
  }, [checkingSession]);

  return (
    <ScreenContainer className="px-5">
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          accessibilityLabel="Zurück"
          accessibilityRole="button"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/")
          }
          style={styles.back}
        >
          <Ionicons color={colors.primaryText} name="chevron-back" size={20} />
          <Text style={styles.backText}>Zurück</Text>
        </Pressable>
        <Text style={styles.eyebrow}>IP-ADRESSVERWALTUNG</Text>
        <Text selectable style={styles.title}>
          {address ?? "Unbekannte Adresse"}
        </Text>
        {address ? (
          <IpamNetworkCard
            address={address}
            onLoaded={setCount}
            tenantId={tenantId}
            title="Dokumentiert"
          />
        ) : null}
        {!address || count === 0 ? (
          <Text style={styles.hint}>
            Zu dieser Adresse findest du keine Daten. Entweder ist sie nicht
            dokumentiert oder dir fehlt das Recht für die IP-Adressverwaltung.
            Details siehst du in der Web-App unter «IP-Adressen».
          </Text>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const useStyles = makeThemedStyles((c) => ({
  back: { alignItems: "center", flexDirection: "row", gap: 4 },
  backText: { color: c.primaryText, fontSize: 15, fontWeight: "700" },
  content: { gap: 14, paddingBottom: 40, paddingTop: 12 },
  eyebrow: {
    color: c.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  hint: { color: c.muted, fontSize: 13, lineHeight: 19 },
  title: { color: c.foreground, fontSize: 24, fontWeight: "900" },
}));
