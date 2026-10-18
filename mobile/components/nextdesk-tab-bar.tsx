import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import type { ComponentProps } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppColors } from "@/lib/themed-styles";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

export type NextDeskTabItem = {
  name: string;
  label: string;
  icon: IoniconName;
  activeIcon: IoniconName;
};

const HOME_ROUTE = "index";
const HOME_LABEL = "Home";
const BAR_CONTENT_HEIGHT = 56;
const HOME_RING_SIZE = 60;
const HOME_RING_PADDING = 4;
// Anhebung so gewählt, dass die Beschriftung auf der Linie der übrigen Tabs liegt.
const HOME_LIFT = 28;

/**
 * Ausgeblendete Unterseiten markieren den Tab, zu dem sie inhaltlich gehören,
 * damit die Leiste auch dort einen klaren aktiven Zustand zeigt.
 */
const ROUTE_ALIASES: Record<string, string> = {
  "knowledge/[id]": "knowledge",
  settings: HOME_ROUTE,
  assets: "scan",
};

function triggerHaptic(style: Haptics.ImpactFeedbackStyle) {
  if (process.env.EXPO_OS === "ios") {
    void Haptics.impactAsync(style);
  }
}

type NextDeskTabBarProps = BottomTabBarProps & {
  /** Sichtbare Tabs ohne Home in fachlicher Reihenfolge. */
  items: NextDeskTabItem[];
};

/**
 * Untere Navigation von nextDesk: Home sitzt immer in der Mitte als
 * hervorgehobener Kreis. Die übrigen sichtbaren Tabs werden in ihrer
 * Reihenfolge gleichmässig links und rechts verteilt, sodass Home auch dann
 * zentriert bleibt, wenn Mandantenfunktionen (z. B. Wissen, Scan) fehlen.
 */
export function NextDeskTabBar({
  state,
  navigation,
  items,
}: NextDeskTabBarProps) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === "web" ? 12 : Math.max(insets.bottom, 8);

  const availableItems = items.filter((item) =>
    state.routes.some((route) => route.name === item.name),
  );
  const leftCount = Math.ceil(availableItems.length / 2);
  const leftItems = availableItems.slice(0, leftCount);
  const rightItems = availableItems.slice(leftCount);

  const focusedRouteName = state.routes[state.index]?.name ?? HOME_ROUTE;
  const activeName = ROUTE_ALIASES[focusedRouteName] ?? focusedRouteName;

  function navigateTo(routeName: string) {
    const route = state.routes.find(
      (candidate) => candidate.name === routeName,
    );
    if (!route) {
      return;
    }
    const isFocused = state.routes[state.index]?.key === route.key;
    const event = navigation.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true,
    });
    if (!isFocused && !event.defaultPrevented) {
      navigation.navigate(route.name, route.params);
    }
  }

  function longPress(routeName: string) {
    const route = state.routes.find(
      (candidate) => candidate.name === routeName,
    );
    if (route) {
      navigation.emit({ type: "tabLongPress", target: route.key });
    }
  }

  function renderSideItem(item: NextDeskTabItem) {
    const selected = activeName === item.name;
    const tint = selected ? colors.primaryText : colors.muted;
    return (
      <Pressable
        accessibilityLabel={item.label}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        key={item.name}
        onLongPress={() => longPress(item.name)}
        onPress={() => navigateTo(item.name)}
        onPressIn={() => triggerHaptic(Haptics.ImpactFeedbackStyle.Light)}
        style={({ pressed }) => [
          styles.sideItem,
          pressed && styles.sideItemPressed,
        ]}
      >
        <View
          style={[
            styles.iconPill,
            selected && { backgroundColor: colors.primarySoft },
          ]}
        >
          <Ionicons
            color={tint}
            name={selected ? item.activeIcon : item.icon}
            size={22}
          />
        </View>
        <Text numberOfLines={1} style={[styles.label, { color: tint }]}>
          {item.label}
        </Text>
      </Pressable>
    );
  }

  return (
    <View
      style={[
        styles.bar,
        {
          paddingBottom: bottomPadding,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          shadowColor: colors.shadow,
        },
      ]}
    >
      <View style={styles.side}>{leftItems.map(renderSideItem)}</View>
      <HomeTabButton
        focused={activeName === HOME_ROUTE}
        onLongPress={() => longPress(HOME_ROUTE)}
        onPress={() => navigateTo(HOME_ROUTE)}
      />
      <View style={styles.side}>{rightItems.map(renderSideItem)}</View>
    </View>
  );
}

type HomeTabButtonProps = {
  focused: boolean;
  onPress: () => void;
  onLongPress: () => void;
};

function HomeTabButton({ focused, onPress, onLongPress }: HomeTabButtonProps) {
  const colors = useAppColors();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  return (
    <View style={styles.homeSlot}>
      <Pressable
        accessibilityLabel={HOME_LABEL}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        hitSlop={8}
        onLongPress={onLongPress}
        onPress={onPress}
        onPressIn={() => {
          triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
          scale.set(withSpring(0.9, { damping: 15, stiffness: 320 }));
        }}
        onPressOut={() => {
          scale.set(withSpring(1, { damping: 12, stiffness: 260 }));
        }}
        style={styles.homePressable}
      >
        <Animated.View
          style={[
            styles.homeRing,
            { backgroundColor: colors.surface, shadowColor: colors.shadow },
            animatedStyle,
          ]}
        >
          <View
            style={[
              styles.homeCircle,
              {
                backgroundColor: colors.primary,
                borderColor: focused
                  ? colors.primarySoftBorder
                  : colors.primary,
                shadowColor: colors.primary,
              },
            ]}
          >
            <Ionicons
              color={colors.onPrimary}
              name={focused ? "home" : "home-outline"}
              size={25}
            />
          </View>
        </Animated.View>
        <Text
          numberOfLines={1}
          style={[
            styles.label,
            styles.homeLabel,
            { color: focused ? colors.primaryText : colors.muted },
          ]}
        >
          {HOME_LABEL}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 10,
  },
  side: {
    flex: 1,
    flexDirection: "row",
  },
  sideItem: {
    flex: 1,
    height: BAR_CONTENT_HEIGHT - 6,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  sideItemPressed: {
    opacity: 0.6,
  },
  iconPill: {
    width: 48,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  homeSlot: {
    width: 92,
    height: BAR_CONTENT_HEIGHT - 6,
    alignItems: "center",
  },
  homePressable: {
    alignItems: "center",
    marginTop: -HOME_LIFT,
  },
  homeRing: {
    width: HOME_RING_SIZE,
    height: HOME_RING_SIZE,
    borderRadius: HOME_RING_SIZE / 2,
    padding: HOME_RING_PADDING,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  homeCircle: {
    flex: 1,
    borderRadius: (HOME_RING_SIZE - HOME_RING_PADDING * 2) / 2,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  homeLabel: {
    marginTop: 1,
  },
});
