import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { useMobileFeatures } from "@/components/mobile-feature-gate";
import { QUICK_CREATE, type QuickCreate } from "@/lib/quick-create-actions";
import { useAppColors } from "@/lib/themed-styles";

const RADIUS = 128;
const BUBBLE_SIZE = 56;
const HOME_SIZE = 52;
const STAGGER_MS = 45;
const CLOSE_MS = 180;
const SPRING = { damping: 14, stiffness: 190, mass: 0.8 };

type QuickCreateMenuProps = {
  visible: boolean;
  onClose: () => void;
  /** Distance of the Home button's centre from the bottom of the screen. */
  homeCenterFromBottom: number;
};

/** Angles (degrees, 0 = right) spread evenly over the arc above Home. */
export function arcAngles(count: number): number[] {
  if (count <= 1) return [90];
  const span = count >= 4 ? 124 : count === 3 ? 116 : 70;
  const start = 90 + span / 2;
  return Array.from(
    { length: count },
    (_, index) => start - (index * span) / (count - 1),
  );
}

/**
 * Radial menu that opens on a long press of the Home tab: round buttons fan
 * out in a half circle above Home, one after the other with a slight spring,
 * while Home turns into a close button.
 */
export function QuickCreateMenu({
  visible,
  onClose,
  homeCenterFromBottom,
}: QuickCreateMenuProps) {
  const colors = useAppColors();
  const router = useRouter();
  const { isEnabled } = useMobileFeatures();
  const items = QUICK_CREATE.filter(
    (item) => !item.feature || isEnabled(item.feature),
  );
  const angles = arcAngles(items.length);

  const [mounted, setMounted] = useState(visible);
  // Mount as soon as the menu opens; unmount after the closing animation.
  if (visible && !mounted) setMounted(true);
  const backdrop = useSharedValue(0);
  const p0 = useSharedValue(0);
  const p1 = useSharedValue(0);
  const p2 = useSharedValue(0);
  const p3 = useSharedValue(0);
  const progress = [p0, p1, p2, p3];

  useEffect(() => {
    if (visible) {
      backdrop.set(withTiming(1, { duration: 200 }));
      progress.forEach((value, index) =>
        value.set(withDelay(index * STAGGER_MS, withSpring(1, SPRING))),
      );
      return;
    }
    backdrop.set(withTiming(0, { duration: CLOSE_MS }));
    progress.forEach((value) =>
      value.set(withTiming(0, { duration: CLOSE_MS })),
    );
    const timer = setTimeout(() => setMounted(false), CLOSE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdrop.get(),
  }));
  const closeStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${interpolate(backdrop.get(), [0, 1], [-90, 0])}deg` },
      { scale: interpolate(backdrop.get(), [0, 1], [0.85, 1]) },
    ],
  }));

  function choose(item: QuickCreate) {
    onClose();
    router.push(item.href as Href);
  }

  return (
    <Modal
      animationType="none"
      navigationBarTranslucent
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={mounted}
    >
      <Pressable
        accessibilityLabel="Menü schliessen"
        onPress={onClose}
        style={StyleSheet.absoluteFill}
      >
        <Animated.View style={[styles.backdrop, backdropStyle]} />
      </Pressable>
      <View
        pointerEvents="box-none"
        style={[styles.anchor, { bottom: homeCenterFromBottom }]}
      >
        {items.map((item, index) => (
          <ArcButton
            angle={angles[index] ?? 90}
            item={item}
            key={item.id}
            onPress={() => choose(item)}
            progress={progress[index] ?? p0}
          />
        ))}
        <Pressable
          accessibilityLabel="Menü schliessen"
          accessibilityRole="button"
          hitSlop={10}
          onPress={onClose}
          style={[
            styles.close,
            {
              backgroundColor: colors.primary,
              borderColor: colors.surface,
              shadowColor: colors.primary,
            },
          ]}
        >
          <Animated.View style={closeStyle}>
            <Ionicons color={colors.onPrimary} name="close" size={28} />
          </Animated.View>
        </Pressable>
      </View>
    </Modal>
  );
}

type ArcButtonProps = {
  angle: number;
  item: QuickCreate;
  onPress: () => void;
  progress: SharedValue<number>;
};

function ArcButton({ angle, item, onPress, progress }: ArcButtonProps) {
  const colors = useAppColors();
  const radians = (angle * Math.PI) / 180;
  const x = Math.cos(radians) * RADIUS;
  const y = -Math.sin(radians) * RADIUS;

  const style = useAnimatedStyle(() => {
    const value = progress.get();
    return {
      opacity: interpolate(value, [0, 0.4, 1], [0, 1, 1]),
      transform: [
        { translateX: x * value },
        { translateY: y * value },
        { scale: interpolate(value, [0, 1], [0.3, 1]) },
      ],
    };
  });
  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0.6, 1], [0, 1], "clamp"),
  }));
  const label = item.title.replace(/ erfassen$/, "");

  return (
    <Animated.View pointerEvents="box-none" style={[styles.slot, style]}>
      <Pressable
        accessibilityLabel={item.title}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.bubble,
          {
            backgroundColor: colors.surface,
            shadowColor: colors.shadow,
          },
          pressed && styles.bubblePressed,
        ]}
      >
        <Ionicons color={colors.primaryText} name={item.icon} size={25} />
      </Pressable>
      <Animated.Text numberOfLines={2} style={[styles.label, labelStyle]}>
        {label}
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
  },
  anchor: {
    position: "absolute",
    left: "50%",
    width: 0,
    height: 0,
  },
  slot: {
    position: "absolute",
    left: -BUBBLE_SIZE / 2,
    top: -BUBBLE_SIZE / 2,
    width: BUBBLE_SIZE,
    alignItems: "center",
  },
  bubble: {
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 10,
  },
  bubblePressed: {
    transform: [{ scale: 0.92 }],
  },
  label: {
    marginTop: 6,
    width: 96,
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    textShadowColor: "rgba(0, 0, 0, 0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  close: {
    position: "absolute",
    left: -HOME_SIZE / 2 - 4,
    top: -HOME_SIZE / 2 - 4,
    width: HOME_SIZE + 8,
    height: HOME_SIZE + 8,
    borderRadius: (HOME_SIZE + 8) / 2,
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 12,
  },
});
