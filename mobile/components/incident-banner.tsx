import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  type IncidentStatus,
  type PortalIncidentNotice,
} from "@/lib/nextdesk-portal";
import { useThemeContext } from "@/lib/theme-provider";

const statusCopy: Record<
  IncidentStatus,
  { icon: keyof typeof Ionicons.glyphMap; label: string }
> = {
  identified: { icon: "bulb-outline", label: "Ursache erkannt" },
  investigating: { icon: "search-outline", label: "Untersuchung läuft" },
  monitoring: { icon: "pulse-outline", label: "Überwachung läuft" },
  resolved: { icon: "checkmark-circle-outline", label: "Gelöst" },
};

function formatStart(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "vor Kurzem";
  return new Intl.DateTimeFormat("de-CH", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(date);
}

/** Shows only notices supplied by requester-portal for the active tenant. */
export function IncidentBanner({
  notices,
}: {
  notices: PortalIncidentNotice[];
}) {
  const { colors, density } = useThemeContext();
  const stylesWithTokens = useMemo(
    () => ({
      banner: {
        backgroundColor: colors.warning + "1A",
        borderColor: colors.warning + "66",
      },
      body: { color: colors.foreground },
      meta: { color: colors.muted },
      status: {
        backgroundColor: colors.surface,
        borderColor: colors.warning + "66",
      },
      statusText: { color: colors.foreground },
      title: { color: colors.foreground },
    }),
    [colors],
  );

  if (notices.length === 0) return null;

  return (
    <View
      accessibilityLabel={`${notices.length} aktive Störungsmeldung${notices.length === 1 ? "" : "en"}`}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        styles.banner,
        stylesWithTokens.banner,
        density === "compact" && styles.bannerCompact,
      ]}
    >
      <View style={styles.icon}>
        <Ionicons color={colors.warning} name="warning-outline" size={21} />
      </View>
      <View style={styles.content}>
        <View style={styles.heading}>
          <Text style={[styles.eyebrow, { color: colors.warning }]}>
            STÖRUNG
          </Text>
          <Text style={[styles.count, { color: colors.warning }]}>
            {notices.length} aktiv
          </Text>
        </View>
        {notices.map((notice) => {
          const status = statusCopy[notice.status];
          return (
            <View key={notice.id} style={styles.notice}>
              <View style={styles.noticeHeading}>
                <Text style={[styles.title, stylesWithTokens.title]}>
                  {notice.title}
                </Text>
                <View
                  accessibilityLabel={`Status: ${status.label}`}
                  style={[styles.status, stylesWithTokens.status]}
                >
                  <Ionicons
                    color={colors.warning}
                    name={status.icon}
                    size={13}
                  />
                  <Text
                    style={[styles.statusText, stylesWithTokens.statusText]}
                  >
                    {status.label}
                  </Text>
                </View>
              </View>
              <Text style={[styles.body, stylesWithTokens.body]}>
                {notice.description}
              </Text>
              <Text style={[styles.meta, stylesWithTokens.meta]}>
                Seit {formatStart(notice.starts_at)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: "flex-start",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 11,
    padding: 16,
  },
  bannerCompact: { padding: 13 },
  body: { fontSize: 13, lineHeight: 19 },
  content: { flex: 1, gap: 10 },
  count: { fontSize: 11, fontWeight: "900" },
  eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 1.1 },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  icon: { paddingTop: 1 },
  meta: { fontSize: 11, lineHeight: 16 },
  notice: { gap: 5 },
  noticeHeading: { gap: 7 },
  status: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  statusText: { fontSize: 10, fontWeight: "800" },
  title: { fontSize: 15, fontWeight: "900", lineHeight: 20 },
});
