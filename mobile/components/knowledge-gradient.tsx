import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

/**
 * Gradient from the primary to the accent colour of the tenant (Einstellungen →
 * Design). The size comes from the measured container: percentage sizes on the
 * SVG were laid out too small on iOS, so the text ran past the gradient.
 */
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
  const [size, setSize] = useState<{ height: number; width: number } | null>(
    null,
  );
  return (
    <View
      onLayout={(event) => {
        const { height, width } = event.nativeEvent.layout;
        setSize((current) =>
          current && current.width === width && current.height === height
            ? current
            : { height, width },
        );
      }}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
    >
      {size ? (
        <Svg height={size.height} width={size.width}>
          <Defs>
            <LinearGradient id={id} x1="0" x2="1" y1="0" y2="1">
              <Stop offset="0" stopColor={from} />
              <Stop offset="1" stopColor={to} />
            </LinearGradient>
          </Defs>
          <Rect
            fill={`url(#${id})`}
            height={size.height}
            width={size.width}
            x={0}
            y={0}
          />
          {/* Keeps white text readable on light and dark tenant colours. */}
          <Rect
            fill="#000000"
            height={size.height}
            opacity={dark ? 0.3 : 0.14}
            width={size.width}
            x={0}
            y={0}
          />
        </Svg>
      ) : null}
    </View>
  );
}
