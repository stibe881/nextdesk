import Svg, { Path, Rect } from "react-native-svg";

/**
 * Bereichs-Symbole wie im Web (Lucide, ISC-Lizenz): «Boxes» für das Lager und
 * «Network» für die Infrastruktur. Ionicons hat dafür keine passenden Symbole.
 */
type IconProps = { color: string; size?: number };

function Outline({
  children,
  color,
  size = 24,
}: IconProps & { children: React.ReactNode }) {
  return (
    <Svg
      fill="none"
      height={size}
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </Svg>
  );
}

export function BoxesIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <Path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z" />
      <Path d="m7 16.5-4.74-2.85" />
      <Path d="m7 16.5 5-3" />
      <Path d="M7 16.5v5.17" />
      <Path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z" />
      <Path d="m17 16.5-5-3" />
      <Path d="m17 16.5 4.74-2.85" />
      <Path d="M17 16.5v5.17" />
      <Path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z" />
      <Path d="M12 8 7.26 5.15" />
      <Path d="m12 8 4.74-2.85" />
      <Path d="M12 13.5V8" />
    </Outline>
  );
}

export function NetworkIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <Rect height={6} rx={1} width={6} x={16} y={16} />
      <Rect height={6} rx={1} width={6} x={2} y={16} />
      <Rect height={6} rx={1} width={6} x={9} y={2} />
      <Path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
      <Path d="M12 12V8" />
    </Outline>
  );
}
