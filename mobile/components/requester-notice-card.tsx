import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";

import {
  loadRequesterNotices,
  trackRequesterNotice,
} from "@/lib/requester-notices";
import {
  noticeColors,
  pickNotice,
  resolveNoticeSymbol,
  resolveNoticeTarget,
  type NoticeView,
} from "@/lib/requester-notices-model";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

/**
 * Hinweis der ICT für Anfragende (höchstens einer). Wird beim Fokus der
 * Startseite im Hintergrund geladen; ohne Hinweis oder bei Fehlern bleibt die
 * Karte unsichtbar.
 */
export function RequesterNoticeCard({ tenantId }: { tenantId: string | null }) {
  const router = useRouter();
  const colors = useAppColors();
  const styles = useStyles();
  const [loaded, setLoaded] = useState<{
    tenantId: string;
    notices: NoticeView[];
  } | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Pro Anzeige (Laden beim Fokus) wird "view" genau einmal gemeldet.
  const viewTracked = useRef(new Set<string>());

  useFocusEffect(
    useCallback(() => {
      if (!tenantId) {
        setLoaded(null);
        return;
      }
      let active = true;
      viewTracked.current = new Set();
      void loadRequesterNotices(tenantId).then((notices) => {
        if (active) setLoaded({ tenantId, notices });
      });
      return () => {
        active = false;
      };
    }, [tenantId]),
  );

  const notice =
    loaded && loaded.tenantId === tenantId
      ? pickNotice(loaded.notices, dismissed)
      : null;
  const noticeId = notice?.id ?? null;

  useEffect(() => {
    if (!tenantId || !noticeId || viewTracked.current.has(noticeId)) return;
    viewTracked.current.add(noticeId);
    void trackRequesterNotice(tenantId, noticeId, "view");
  }, [tenantId, noticeId]);

  const palette = useMemo(
    () => ({ primary: colors.primary, onPrimary: colors.onPrimary }),
    [colors.onPrimary, colors.primary],
  );

  if (!tenantId || !notice) return null;
  const scheme = noticeColors(notice.color, palette);
  const symbol = resolveNoticeSymbol(notice.symbol);
  const iconName =
    symbol.kind === "icon" && symbol.name in Ionicons.glyphMap
      ? (symbol.name as keyof typeof Ionicons.glyphMap)
      : "megaphone-outline";

  async function open() {
    if (!tenantId || !notice) return;
    const target = resolveNoticeTarget(notice);
    if (!target) return;
    // Der Klick wird vor der Navigation gemeldet, ohne darauf zu warten.
    void trackRequesterNotice(tenantId, notice.id, "click");
    if (target.kind === "route") {
      router.push(target.href as never);
    } else {
      await Linking.openURL(target.url).catch(() => undefined);
    }
  }

  function dismiss() {
    if (!tenantId || !notice) return;
    const id = notice.id;
    setDismissed((current) => new Set(current).add(id));
    void trackRequesterNotice(tenantId, id, "dismiss");
  }

  return (
    <View style={[styles.card, { backgroundColor: scheme.background }]}>
      <View style={styles.row}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.symbol}
        >
          {symbol.kind === "text" ? (
            <Text style={styles.symbolText}>{symbol.text}</Text>
          ) : (
            <Ionicons color={scheme.foreground} name={iconName} size={24} />
          )}
        </View>
        <View style={styles.copy}>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: scheme.foreground }]}
          >
            {notice.title}
          </Text>
          {notice.body ? (
            <Text style={[styles.body, { color: scheme.foreground }]}>
              {notice.body}
            </Text>
          ) : null}
        </View>
        {notice.dismissible ? (
          <Pressable
            accessibilityLabel={`Hinweis «${notice.title}» ausblenden`}
            accessibilityRole="button"
            hitSlop={10}
            onPress={dismiss}
            style={styles.close}
          >
            <Ionicons color={scheme.foreground} name="close" size={20} />
          </Pressable>
        ) : null}
      </View>
      <Pressable
        accessibilityLabel={`${notice.buttonLabel}: ${notice.title}`}
        accessibilityRole="button"
        onPress={() => void open()}
        style={styles.button}
      >
        <Text style={[styles.buttonText, { color: scheme.buttonText }]}>
          {notice.buttonLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeThemedStyles(() => ({
  body: { fontSize: 14, lineHeight: 20, opacity: 0.95 },
  button: {
    alignSelf: "flex-start",
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  buttonText: { fontSize: 14, fontWeight: "800" },
  card: { borderRadius: 22, gap: 14, padding: 17 },
  close: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  copy: { flex: 1, gap: 4 },
  row: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  symbol: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  symbolText: { fontSize: 24 },
  title: { fontSize: 18, fontWeight: "800" },
}));
