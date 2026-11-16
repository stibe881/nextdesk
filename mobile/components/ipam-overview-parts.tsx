import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { tn } from "@/lib/formality";
import {
  type IpamAddressRow,
  type IpamUsage,
  ipamAddressMeta,
  ipamAddressStatusLabel,
  ipamUsageLabel,
  ipamUsageTone,
} from "@/lib/ipam-overview-model";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

/** Auslastungsbalken mit «59 von 254 belegt · 23 %». */
export function IpamUsageBar({
  usage,
  warningPercent,
}: {
  usage: IpamUsage | null;
  warningPercent: number;
}) {
  const styles = useStyles();
  const tone = ipamUsageTone(usage?.percent, warningPercent);
  const percent = usage ? Math.max(0, Math.min(100, usage.percent)) : 0;
  return (
    <View
      accessible
      accessibilityLabel={`Auslastung: ${ipamUsageLabel(usage)}`}
      style={styles.usage}
    >
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            tone === "danger"
              ? styles.fillDanger
              : tone === "warning"
                ? styles.fillWarning
                : null,
            { width: `${percent}%` },
          ]}
        />
      </View>
      <Text
        style={[
          styles.usageText,
          tone === "danger"
            ? styles.textDanger
            : tone === "warning"
              ? styles.textWarning
              : null,
        ]}
      >
        {ipamUsageLabel(usage)}
      </Text>
    </View>
  );
}

/** Zeile einer Adresse; öffnet die Adressseite, wenn die Adresse gültig ist. */
export function IpamAddressItem({
  address,
  onPress,
}: {
  address: IpamAddressRow;
  onPress: (() => void) | null;
}) {
  const styles = useStyles();
  const colors = useAppColors();
  const status = address.status;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!onPress}
      onPress={onPress ?? undefined}
      style={styles.row}
    >
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} selectable style={styles.rowTitle}>
          {address.address}
        </Text>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {ipamAddressMeta(address)}
        </Text>
      </View>
      {status !== "active" ? (
        <Text
          style={[
            styles.badge,
            status === "reserved" ? styles.badgeWarn : null,
            status === "deprecated" ? styles.badgeMuted : null,
          ]}
        >
          {ipamAddressStatusLabel(status)}
        </Text>
      ) : null}
      {onPress ? (
        <Ionicons color={colors.subtle} name="chevron-forward" size={18} />
      ) : null}
    </Pressable>
  );
}

/** Freundlicher Hinweis statt Fehler bei fehlendem Recht oder Modul. */
export function IpamAccessDenied() {
  const styles = useStyles();
  const colors = useAppColors();
  return (
    <View style={styles.stateCard}>
      <Ionicons
        color={colors.primaryText}
        name="lock-closed-outline"
        size={28}
      />
      <Text style={styles.stateTitle}>
        Kein Zugriff auf die IP-Adressverwaltung
      </Text>
      <Text style={styles.stateText}>
        {tn(
          "Die IP-Adressverwaltung ist für dich nicht eingeschaltet oder dir fehlt das Recht «IP-Adressverwaltung ansehen». Wende dich bei Bedarf an die Administration deines Mandanten.",
          "Die IP-Adressverwaltung ist für Sie nicht eingeschaltet oder Ihnen fehlt das Recht «IP-Adressverwaltung ansehen». Wenden Sie sich bei Bedarf an die Administration Ihres Mandanten.",
        )}
      </Text>
    </View>
  );
}

/** Hinweis ohne Verbindung, solange noch keine Daten geladen sind. */
export function IpamOffline() {
  const styles = useStyles();
  const colors = useAppColors();
  return (
    <View style={styles.stateCard}>
      <Ionicons
        color={colors.primaryText}
        name="cloud-offline-outline"
        size={28}
      />
      <Text style={styles.stateTitle}>Keine Verbindung</Text>
      <Text style={styles.stateText}>
        Die IP-Adressen werden geladen, sobald wieder eine Verbindung besteht.
      </Text>
    </View>
  );
}

export function IpamErrorCard({ message }: { message: string }) {
  const styles = useStyles();
  const colors = useAppColors();
  return (
    <View style={styles.errorCard}>
      <Ionicons color={colors.error} name="alert-circle-outline" size={19} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export const useIpamStyles = makeThemedStyles((c) => ({
  back: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 4,
  },
  backText: { color: c.primaryText, fontSize: 15, fontWeight: "700" },
  badge: {
    backgroundColor: c.infoSoft,
    borderRadius: 8,
    color: c.info,
    fontSize: 10,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  card: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 19,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  cardHead: { alignItems: "center", flexDirection: "row", gap: 10 },
  cardMeta: { color: c.muted, fontSize: 12 },
  cardTitle: { color: c.foreground, flex: 1, fontSize: 15, fontWeight: "800" },
  centered: { alignItems: "center", flex: 1, justifyContent: "center" },
  content: { gap: 16, paddingBottom: 34, paddingTop: 12 },
  eyebrow: {
    color: c.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  group: { gap: 10 },
  infoLabel: { color: c.muted, fontSize: 12, width: 120 },
  infoRow: { flexDirection: "row", gap: 10 },
  infoValue: { color: c.foreground, flex: 1, fontSize: 13, fontWeight: "600" },
  kpi: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  kpiLabel: { color: c.muted, fontSize: 11, fontWeight: "700" },
  kpiRow: { flexDirection: "row", gap: 8 },
  kpiValue: { color: c.foreground, fontSize: 20, fontWeight: "900" },
  kpiWarn: { color: c.warning },
  list: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 19,
    borderWidth: 1,
    overflow: "hidden",
  },
  more: {
    alignItems: "center",
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 11,
  },
  moreText: { color: c.primaryText, fontSize: 13, fontWeight: "800" },
  searchInput: { color: c.text, flex: 1, fontSize: 14, paddingVertical: 4 },
  searchRow: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.borderStrong,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  subtitle: { color: c.muted, fontSize: 13, marginTop: 4 },
  title: {
    color: c.foreground,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.8,
    marginTop: 3,
  },
}));

const useStyles = makeThemedStyles((c) => ({
  badge: {
    backgroundColor: c.infoSoft,
    borderRadius: 8,
    color: c.info,
    fontSize: 10,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeMuted: { backgroundColor: c.surfaceSubtle, color: c.muted },
  badgeWarn: { backgroundColor: c.warningSoft, color: c.warning },
  errorCard: {
    alignItems: "flex-start",
    backgroundColor: c.errorSoft,
    borderRadius: 16,
    flexDirection: "row",
    gap: 9,
    padding: 13,
  },
  errorText: { color: c.error, flex: 1, fontSize: 12, lineHeight: 18 },
  fill: { backgroundColor: c.primary, borderRadius: 4, height: 6 },
  fillDanger: { backgroundColor: c.error },
  fillWarning: { backgroundColor: c.warning },
  row: {
    alignItems: "center",
    borderBottomColor: c.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  rowCopy: { flex: 1, gap: 2 },
  rowMeta: { color: c.muted, fontSize: 12 },
  rowTitle: {
    color: c.foreground,
    fontSize: 15,
    fontVariant: ["tabular-nums"],
    fontWeight: "800",
  },
  stateCard: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 7,
    padding: 26,
  },
  stateText: {
    color: c.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  stateTitle: {
    color: c.foreground,
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center",
  },
  textDanger: { color: c.error },
  textWarning: { color: c.warning },
  track: {
    backgroundColor: c.surfaceSubtle,
    borderRadius: 4,
    height: 6,
    overflow: "hidden",
  },
  usage: { gap: 5 },
  usageText: { color: c.muted, fontSize: 12, fontWeight: "600" },
}));
