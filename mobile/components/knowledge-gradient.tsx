import { StyleSheet } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

/** Gradient from the primary to the accent colour of the tenant (Einstellungen → Design). */
export function BrandGradient({
  dark,
  from,
  id,
  to,
}: {
  dark: boolean;
  from: string;
  id: string;
  to: string;
}) {
  return (
    <Svg
      height="100%"
      preserveAspectRatio="none"
      style={StyleSheet.absoluteFill}
      width="100%"
    >
      <Defs>
        <LinearGradient id={id} x1="0" x2="1" y1="0" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect fill={`url(#${id})`} height="100%" width="100%" />
      {/* Keeps white text readable on light and dark tenant colours. */}
      <Rect
        fill="#000000"
        height="100%"
        opacity={dark ? 0.3 : 0.14}
        width="100%"
      />
    </Svg>
  );
}
