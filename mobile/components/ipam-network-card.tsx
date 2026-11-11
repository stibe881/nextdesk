import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import {
  getMobileAssetNetwork,
  type MobileNetworkAddress,
  mobileFindingLabel,
  mobileNetworkRows,
} from "@/lib/ipam-network";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

/**
 * Karte «Netzwerk» im Assetdetail (nach dem QR-Scan): IP-Adressen, VLAN,
 * Subnetz, Switch-Port, zuletzt gesehen, DNS-Name und offene Funde aus der
 * IP-Adressverwaltung. Ohne Modul, Recht oder Treffer bleibt sie weg.
 */
export function IpamNetworkCard({
  tenantId,
  assetId,
  title = "Netzwerk",
  refreshKey,
}: {
  tenantId: string | null;
  assetId: string;
  title?: string;
  refreshKey?: unknown;
}) {
  const styles = useStyles();
  const colors = useAppColors();
  // Ergebnis je Gerät, damit beim Wechsel nichts Fremdes kurz sichtbar ist.
  const [loaded, setLoaded] = useState<{
    key: string;
    addresses: MobileNetworkAddress[];
  } | null>(null);
  const key = `${tenantId ?? ""}:${assetId}`;

  useEffect(() => {
    let active = true;
    if (!tenantId) return;
    getMobileAssetNetwork(tenantId, assetId)
      .then((next) => {
        if (active)
          setLoaded({ key: `${tenantId}:${assetId}`, addresses: next });
      })
      .catch(() => {
        if (active) setLoaded({ key: `${tenantId}:${assetId}`, addresses: [] });
      });
    return () => {
      active = false;
    };
  }, [assetId, refreshKey, tenantId]);

  const addresses = loaded?.key === key ? loaded.addresses : [];
  if (addresses.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Ionicons
          color={colors.primaryText}
          name="git-network-outline"
          size={18}
        />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {addresses.map((entry, index) => (
        <View
          key={entry.id}
          style={[styles.entry, index > 0 ? styles.entrySeparated : null]}
        >
          <View style={styles.rows}>
            {mobileNetworkRows(entry).map(([label, value]) => (
              <View key={label} style={styles.row}>
                <Text style={styles.rowLabel}>{label}</Text>
                <Text numberOfLines={2} selectable style={styles.rowValue}>
                  {value}
                </Text>
              </View>
            ))}
          </View>
          {entry.findings.map((finding) => (
            <View
              key={finding.id}
              style={[
                styles.finding,
                finding.severity === "critical"
                  ? styles.findingCritical
                  : finding.severity === "info"
                    ? styles.findingInfo
                    : styles.findingWarning,
              ]}
            >
              <Ionicons
                color={
                  finding.severity === "critical"
                    ? colors.error
                    : finding.severity === "info"
                      ? colors.info
                      : colors.warning
                }
                name="warning-outline"
                size={15}
              />
              <Text style={styles.findingText}>
                {mobileFindingLabel(finding.kind)}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  card: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 13,
    padding: 18,
  },
  cardTitle: { color: c.foreground, fontSize: 15, fontWeight: "900" },
  entry: { gap: 10 },
  entrySeparated: {
    borderTopColor: c.border,
    borderTopWidth: 1,
    paddingTop: 12,
  },
  finding: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  findingCritical: { backgroundColor: c.errorSoft, borderColor: c.errorBorder },
  findingInfo: { backgroundColor: c.infoSoft, borderColor: c.border },
  findingText: { color: c.text, flex: 1, fontSize: 12, fontWeight: "700" },
  findingWarning: {
    backgroundColor: c.warningSoft,
    borderColor: c.warningBorder,
  },
  row: { flexDirection: "row", gap: 12, justifyContent: "space-between" },
  rowLabel: { color: c.muted, flex: 1, fontSize: 12 },
  rowValue: {
    color: c.text,
    flex: 1.2,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
  },
  rows: { gap: 10 },
  titleRow: { alignItems: "center", flexDirection: "row", gap: 8 },
}));
