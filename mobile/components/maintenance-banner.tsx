import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { type PortalMaintenance } from "@/lib/nextdesk-portal";
import { useThemeContext } from "@/lib/theme-provider";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

/** «17. Nov., 18:00 – 20:00», with both dates when the window spans days. */
export function maintenanceWindowText(startsAt: string, endsAt: string): string {
  const zone = "Europe/Zurich";
  const day = (value: string) =>
    new Intl.DateTimeFormat("de-CH", {
      day: "numeric",
      month: "short",
      timeZone: zone,
    }).format(new Date(value));
  const time = (value: string) =>
    new Intl.DateTimeFormat("de-CH", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: zone,
    }).format(new Date(value));
  return day(startsAt) === day(endsAt)
    ? `${day(startsAt)}, ${time(startsAt)} – ${time(endsAt)}`
    : `${day(startsAt)}, ${time(startsAt)} – ${day(endsAt)}, ${time(endsAt)}`;
}

/** Running maintenance windows and those starting within 24 hours. */
export function MaintenanceBanner({
  maintenances,
}: {
  maintenances: PortalMaintenance[];
}) {
  const { density } = useThemeContext();
  const colors = useAppColors();
  const styles = useStyles();
  if (maintenances.length === 0) return null;

  return (
    <View
      accessibilityLabel={`${maintenances.length} Wartung${maintenances.length === 1 ? "" : "en"}`}
      accessibilityLiveRegion="polite"
      style={[styles.banner, density === "compact" && styles.bannerCompact]}
    >
      <View style={styles.icon}>
        <Ionicons color={colors.info} name="construct-outline" size={21} />
      </View>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>WARTUNG</Text>
        {maintenances.map((maintenance) => {
          const affected = [
            ...(maintenance.service_names ?? []),
            ...(maintenance.device_names ?? []).filter(
              (name) => !(maintenance.service_names ?? []).includes(name),
            ),
          ];
          return (
            <View key={maintenance.id} style={styles.entry}>
              <Text style={styles.title}>
                {maintenance.running ? "Laufend" : "Geplant"}:{" "}
                {maintenance.title}
              </Text>
              <Text style={styles.meta}>
                {maintenanceWindowText(maintenance.starts_at, maintenance.ends_at)}
              </Text>
              {maintenance.description ? (
                <Text numberOfLines={3} style={styles.body}>
                  {maintenance.description}
                </Text>
              ) : null}
              {affected.length > 0 ? (
                <Text style={styles.meta}>Betroffen: {affected.join(", ")}</Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  banner: {
    alignItems: "flex-start",
    backgroundColor: c.infoSoft,
    borderColor: c.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 11,
    padding: 16,
  },
  bannerCompact: { padding: 13 },
  body: { color: c.foreground, fontSize: 13, lineHeight: 19 },
  content: { flex: 1, gap: 10 },
  entry: { gap: 4 },
  eyebrow: {
    color: c.info,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  icon: { paddingTop: 1 },
  meta: { color: c.muted, fontSize: 11, lineHeight: 16 },
  title: { color: c.foreground, fontSize: 15, fontWeight: "800" },
}));
