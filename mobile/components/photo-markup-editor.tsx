import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, {
  Ellipse,
  G,
  Image as SvgImage,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from "react-native-svg";

import { hapticError, hapticSelection } from "@/lib/mobile-haptics";
import {
  EMPTY_HISTORY,
  MARKUP_COLORS,
  REDACTION_FILL,
  appendPoint,
  arrowGeometry,
  arrowHeadPath,
  clampPoint,
  ellipseFromDrag,
  exportSize,
  fitContain,
  freehandPath,
  isMeaningfulShape,
  markupReducer,
  minimumDragFor,
  normalizedRect,
  renderOrder,
  strokeWidthFor,
  textSizeFor,
  viewToImage,
  type MarkupShape,
  type MarkupTool,
  type Point,
} from "@/lib/photo-annotation";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

export type MarkupPhoto = { uri: string; width?: number; height?: number };
export type MarkupResult = { uri: string; width: number; height: number };

type Prepared = { dataUri: string; width: number; height: number };

const TOOLS: {
  tool: MarkupTool;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { tool: "arrow", label: "Pfeil", icon: "arrow-forward" },
  { tool: "ellipse", label: "Kreis", icon: "ellipse-outline" },
  { tool: "rect", label: "Rechteck", icon: "square-outline" },
  { tool: "pen", label: "Freihand", icon: "brush-outline" },
  { tool: "text", label: "Text", icon: "text-outline" },
  { tool: "redact", label: "Schwärzen", icon: "eye-off-outline" },
];

let shapeCounter = 0;
function nextShapeId(): string {
  shapeCounter += 1;
  return `m${Date.now().toString(36)}${shapeCounter}`;
}

/** Loads the photo upright (EXIF orientation applied), at most 2048 px. */
async function preparePhoto(photo: MarkupPhoto): Promise<Prepared> {
  const width = photo.width ?? 0;
  const height = photo.height ?? 0;
  const target = exportSize(width, height);
  const actions: ImageManipulator.Action[] =
    width > 0 && height > 0 && target.width < width
      ? [{ resize: { width: target.width } }]
      : [];
  let image = await ImageManipulator.manipulateAsync(photo.uri, actions, {
    base64: true,
    compress: 0.92,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  // Unknown size up front: scale down once the real size is known.
  const capped = exportSize(image.width, image.height);
  if (capped.width < image.width) {
    image = await ImageManipulator.manipulateAsync(
      image.uri,
      [{ resize: { width: capped.width } }],
      {
        base64: true,
        compress: 0.92,
        format: ImageManipulator.SaveFormat.JPEG,
      },
    );
  }
  if (!image.base64) throw new Error("Das Foto konnte nicht geladen werden.");
  return {
    dataUri: `data:image/jpeg;base64,${image.base64}`,
    width: image.width,
    height: image.height,
  };
}

function ShapeView({ shape }: { shape: MarkupShape }) {
  switch (shape.kind) {
    case "arrow": {
      const geometry = arrowGeometry(shape.from, shape.to, shape.width);
      return (
        <G>
          <Line
            stroke={shape.color}
            strokeLinecap="round"
            strokeWidth={shape.width}
            x1={shape.from.x}
            x2={geometry.shaftEnd.x}
            y1={shape.from.y}
            y2={geometry.shaftEnd.y}
          />
          <Path
            d={arrowHeadPath(geometry)}
            fill={shape.color}
            stroke={shape.color}
            strokeLinejoin="round"
            strokeWidth={shape.width * 0.5}
          />
        </G>
      );
    }
    case "ellipse": {
      const ellipse = ellipseFromDrag(shape.from, shape.to);
      return (
        <Ellipse
          {...ellipse}
          fill="none"
          stroke={shape.color}
          strokeWidth={shape.width}
        />
      );
    }
    case "rect": {
      const rect = normalizedRect(shape.from, shape.to);
      return (
        <Rect
          {...rect}
          fill="none"
          rx={shape.width}
          stroke={shape.color}
          strokeWidth={shape.width}
        />
      );
    }
    case "pen":
      return (
        <Path
          d={freehandPath(shape.points)}
          fill="none"
          stroke={shape.color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={shape.width}
        />
      );
    case "text": {
      // Outline in the contrasting colour keeps the text readable.
      const outline = shape.color === "#000000" ? "#FFFFFF" : REDACTION_FILL;
      return (
        <G>
          <SvgText
            fill={outline}
            fontSize={shape.size}
            fontWeight="bold"
            stroke={outline}
            strokeLinejoin="round"
            strokeWidth={shape.size * 0.16}
            x={shape.at.x}
            y={shape.at.y}
          >
            {shape.text}
          </SvgText>
          <SvgText
            fill={shape.color}
            fontSize={shape.size}
            fontWeight="bold"
            x={shape.at.x}
            y={shape.at.y}
          >
            {shape.text}
          </SvgText>
        </G>
      );
    }
    case "redact": {
      const rect = normalizedRect(shape.from, shape.to);
      return <Rect {...rect} fill={REDACTION_FILL} fillOpacity={1} />;
    }
  }
}

/**
 * «Markieren»: Pfeile, Kreise, Rechtecke, Freihand, Text und Schwärzen auf
 * einem Foto. Das Ergebnis ist ein neues, flaches Bild – Schwärzungen sind
 * eingebrannt, das Original wird nicht mitgesendet.
 */
export function PhotoMarkupEditor({
  photo,
  onCancel,
  onSave,
}: {
  photo: MarkupPhoto | null;
  onCancel: () => void;
  onSave: (result: MarkupResult) => void;
}) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onCancel}
      presentationStyle="fullScreen"
      visible={photo !== null}
    >
      {photo ? (
        // A new photo starts with a fresh workspace (no undo across photos).
        <MarkupWorkspace
          key={photo.uri}
          onCancel={onCancel}
          onSave={onSave}
          photo={photo}
        />
      ) : null}
    </Modal>
  );
}

function MarkupWorkspace({
  photo,
  onCancel,
  onSave,
}: {
  photo: MarkupPhoto;
  onCancel: () => void;
  onSave: (result: MarkupResult) => void;
}) {
  const styles = useStyles();
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [loadError, setLoadError] = useState("");
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<MarkupTool>("arrow");
  const [color, setColor] = useState<string>(MARKUP_COLORS[0].value);
  const [history, dispatch] = useReducer(markupReducer, EMPTY_HISTORY);
  const [draft, setDraft] = useState<MarkupShape | null>(null);
  const [textAt, setTextAt] = useState<Point | null>(null);
  const [textValue, setTextValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const svgRef = useRef<Svg>(null);
  // Shape being drawn; read by the touch handlers between events.
  const draftRef = useRef<MarkupShape | null>(null);

  useEffect(() => {
    let active = true;
    preparePhoto(photo)
      .then((result) => {
        if (active) setPrepared(result);
      })
      .catch(() => {
        if (active) setLoadError("Das Foto konnte nicht geöffnet werden.");
      });
    return () => {
      active = false;
    };
  }, [photo]);

  const layout = useMemo(
    () =>
      prepared
        ? fitContain(prepared.width, prepared.height, box.width, box.height)
        : fitContain(0, 0, 0, 0),
    [box, prepared],
  );

  function imagePoint(event: GestureResponderEvent): Point | null {
    if (!prepared) return null;
    return clampPoint(
      viewToImage(
        { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY },
        { ...layout, offsetX: 0, offsetY: 0 },
      ),
      prepared.width,
      prepared.height,
    );
  }

  function updateDraft(shape: MarkupShape | null) {
    draftRef.current = shape;
    setDraft(shape);
  }

  const touchHandlers = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (event: GestureResponderEvent) => {
      const point = imagePoint(event);
      if (!point || !prepared) return;
      const width = strokeWidthFor(prepared.width, prepared.height);
      const id = nextShapeId();
      if (tool === "text") {
        updateDraft(null);
        setTextAt(point);
        setTextValue("");
        return;
      }
      updateDraft(
        tool === "pen"
          ? { id, kind: "pen", points: [point], color, width }
          : tool === "redact"
            ? { id, kind: "redact", from: point, to: point }
            : { id, kind: tool, from: point, to: point, color, width },
      );
    },
    onResponderMove: (event: GestureResponderEvent) => {
      const current = draftRef.current;
      const point = imagePoint(event);
      if (!current || !point) return;
      if (current.kind === "pen") {
        const points = appendPoint(
          current.points,
          point,
          Math.max(1.5, current.width * 0.35),
        );
        if (points !== current.points) updateDraft({ ...current, points });
      } else if (current.kind !== "text") {
        updateDraft({ ...current, to: point });
      }
    },
    onResponderRelease: () => {
      const current = draftRef.current;
      updateDraft(null);
      if (!current || !prepared) return;
      if (
        isMeaningfulShape(
          current,
          minimumDragFor(prepared.width, prepared.height),
        )
      ) {
        dispatch({ type: "add", shape: current });
      }
    },
    onResponderTerminate: () => updateDraft(null),
  };

  function onCanvasLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    if (width !== box.width || height !== box.height) setBox({ width, height });
  }

  function addText() {
    if (!prepared || !textAt || !textValue.trim()) {
      setTextAt(null);
      return;
    }
    const size = textSizeFor(prepared.width, prepared.height);
    dispatch({
      type: "add",
      shape: {
        id: nextShapeId(),
        kind: "text",
        at: clampPoint(
          { x: textAt.x, y: textAt.y + size * 0.35 },
          prepared.width,
          prepared.height,
        ),
        text: textValue.trim().slice(0, 120),
        color,
        size,
      },
    });
    setTextAt(null);
    setTextValue("");
  }

  function save() {
    if (!prepared || !svgRef.current || saving) return;
    if (history.shapes.length === 0) {
      // Nothing drawn: keep the original photo.
      onCancel();
      return;
    }
    setSaving(true);
    setSaveError("");
    const size = { width: prepared.width, height: prepared.height };
    svgRef.current.toDataURL((base64: string) => {
      void (async () => {
        try {
          if (!base64) throw new Error("empty");
          if (Platform.OS === "web" || !FileSystem.cacheDirectory) {
            onSave({ uri: `data:image/png;base64,${base64}`, ...size });
            return;
          }
          const uri = `${FileSystem.cacheDirectory}nextdesk-markiert-${Date.now()}.png`;
          await FileSystem.writeAsStringAsync(uri, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          onSave({ uri, ...size });
        } catch {
          hapticError();
          setSaveError("Das markierte Foto konnte nicht gespeichert werden.");
        } finally {
          setSaving(false);
        }
      })();
    }, size);
  }

  const shapes = renderOrder(
    draft ? [...history.shapes, draft] : history.shapes,
  );
  const colorEnabled = tool !== "redact";

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          hitSlop={8}
          onPress={onCancel}
          style={styles.topButton}
        >
          <Text style={styles.topButtonText}>Abbrechen</Text>
        </Pressable>
        <View style={styles.historyButtons}>
          <Pressable
            accessibilityLabel="Rückgängig"
            accessibilityRole="button"
            accessibilityState={{ disabled: history.past.length === 0 }}
            disabled={history.past.length === 0 || saving}
            hitSlop={6}
            onPress={() => {
              hapticSelection();
              dispatch({ type: "undo" });
            }}
            style={[
              styles.iconButton,
              history.past.length === 0 && styles.disabled,
            ]}
          >
            <Ionicons
              color={colors.foreground}
              name="arrow-undo-outline"
              size={22}
            />
          </Pressable>
          <Pressable
            accessibilityLabel="Wiederholen"
            accessibilityRole="button"
            accessibilityState={{ disabled: history.undone.length === 0 }}
            disabled={history.undone.length === 0 || saving}
            hitSlop={6}
            onPress={() => {
              hapticSelection();
              dispatch({ type: "redo" });
            }}
            style={[
              styles.iconButton,
              history.undone.length === 0 && styles.disabled,
            ]}
          >
            <Ionicons
              color={colors.foreground}
              name="arrow-redo-outline"
              size={22}
            />
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={!prepared || saving}
          hitSlop={8}
          onPress={save}
          style={[styles.doneButton, (!prepared || saving) && styles.disabled]}
        >
          {saving ? (
            <ActivityIndicator color={colors.onPrimary} size="small" />
          ) : (
            <Text style={styles.doneText}>Fertig</Text>
          )}
        </Pressable>
      </View>

      <View onLayout={onCanvasLayout} style={styles.canvasArea}>
        {loadError ? (
          <Text style={styles.errorText}>{loadError}</Text>
        ) : !prepared || layout.scale === 0 ? (
          <ActivityIndicator color={colors.primary} size="large" />
        ) : (
          <View
            {...touchHandlers}
            accessibilityHint="Zeichne mit dem Finger auf das Foto."
            accessibilityLabel="Foto zum Markieren"
            style={{
              height: layout.height,
              left: layout.offsetX,
              position: "absolute",
              top: layout.offsetY,
              width: layout.width,
            }}
          >
            <Svg
              height={layout.height}
              pointerEvents="none"
              ref={svgRef}
              viewBox={`0 0 ${prepared.width} ${prepared.height}`}
              width={layout.width}
            >
              <SvgImage
                height={prepared.height}
                href={prepared.dataUri}
                preserveAspectRatio="none"
                width={prepared.width}
                x={0}
                y={0}
              />
              {shapes.map((shape) => (
                <ShapeView key={shape.id} shape={shape} />
              ))}
            </Svg>
          </View>
        )}
      </View>

      {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}

      <View style={[styles.toolbar, { paddingBottom: insets.bottom + 10 }]}>
        <Text style={styles.toolHint}>
          {tool === "redact"
            ? "Ziehe ein Feld über vertrauliche Inhalte – es wird fest geschwärzt."
            : tool === "text"
              ? "Tippe auf die Stelle, an der der Text stehen soll."
              : tool === "pen"
                ? "Zeichne frei mit dem Finger."
                : "Ziehe auf dem Foto, um zu markieren."}
        </Text>
        <View style={styles.toolRow}>
          {TOOLS.map((entry) => (
            <Pressable
              accessibilityLabel={entry.label}
              accessibilityRole="button"
              accessibilityState={{ selected: tool === entry.tool }}
              key={entry.tool}
              onPress={() => {
                hapticSelection();
                setTool(entry.tool);
              }}
              style={[
                styles.toolButton,
                tool === entry.tool && styles.toolButtonActive,
              ]}
            >
              <Ionicons
                color={
                  tool === entry.tool ? colors.onPrimary : colors.foreground
                }
                name={entry.icon}
                size={21}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.toolLabel,
                  tool === entry.tool && styles.toolLabelActive,
                ]}
              >
                {entry.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={[styles.colorRow, !colorEnabled && styles.disabled]}>
          {MARKUP_COLORS.map((entry) => (
            <Pressable
              accessibilityLabel={`Farbe ${entry.label}`}
              accessibilityRole="button"
              accessibilityState={{
                disabled: !colorEnabled,
                selected: color === entry.value,
              }}
              disabled={!colorEnabled}
              hitSlop={4}
              key={entry.key}
              onPress={() => {
                hapticSelection();
                setColor(entry.value);
              }}
              style={[
                styles.colorSwatch,
                { backgroundColor: entry.value },
                color === entry.value && colorEnabled && styles.colorActive,
              ]}
            />
          ))}
        </View>
      </View>

      {textAt ? (
        <View style={styles.textOverlay}>
          <View style={styles.textCard}>
            <Text style={styles.textTitle}>Text hinzufügen</Text>
            <TextInput
              autoFocus
              maxLength={120}
              onChangeText={setTextValue}
              onSubmitEditing={addText}
              placeholder="z. B. Hier blinkt es"
              placeholderTextColor={colors.subtle}
              returnKeyType="done"
              style={styles.textInput}
              value={textValue}
            />
            <View style={styles.textActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setTextAt(null)}
                style={styles.textCancel}
              >
                <Text style={styles.textCancelLabel}>Abbrechen</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={!textValue.trim()}
                onPress={addText}
                style={[styles.textAdd, !textValue.trim() && styles.disabled]}
              >
                <Text style={styles.textAddLabel}>Hinzufügen</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  canvasArea: {
    alignItems: "center",
    backgroundColor: c.background,
    flex: 1,
    justifyContent: "center",
    overflow: "hidden",
  },
  colorActive: {
    borderColor: c.primaryText,
    borderWidth: 3,
    transform: [{ scale: 1.12 }],
  },
  colorRow: {
    flexDirection: "row",
    gap: 14,
    justifyContent: "center",
  },
  colorSwatch: {
    borderColor: c.borderStrong,
    borderRadius: 15,
    borderWidth: 1,
    height: 30,
    width: 30,
  },
  disabled: { opacity: 0.4 },
  doneButton: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 38,
    minWidth: 76,
    paddingHorizontal: 14,
  },
  doneText: { color: c.onPrimary, fontSize: 15, fontWeight: "800" },
  errorText: {
    color: c.error,
    fontSize: 13,
    padding: 12,
    textAlign: "center",
  },
  historyButtons: { flexDirection: "row", gap: 6 },
  iconButton: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  screen: { backgroundColor: c.surface, flex: 1 },
  textActions: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  textAdd: {
    backgroundColor: c.primary,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  textAddLabel: { color: c.onPrimary, fontSize: 14, fontWeight: "800" },
  textCancel: { paddingHorizontal: 12, paddingVertical: 10 },
  textCancelLabel: { color: c.primaryText, fontSize: 14, fontWeight: "700" },
  textCard: {
    backgroundColor: c.surface,
    borderRadius: 18,
    gap: 12,
    padding: 18,
    width: "100%",
  },
  textInput: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.borderStrong,
    borderRadius: 12,
    borderWidth: 1,
    color: c.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  textOverlay: {
    alignItems: "center",
    backgroundColor: c.overlay,
    bottom: 0,
    justifyContent: "center",
    left: 0,
    padding: 24,
    position: "absolute",
    right: 0,
    top: 0,
  },
  textTitle: { color: c.foreground, fontSize: 17, fontWeight: "900" },
  toolbar: {
    backgroundColor: c.surface,
    borderTopColor: c.border,
    borderTopWidth: 1,
    gap: 12,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  toolButton: {
    alignItems: "center",
    borderRadius: 12,
    flex: 1,
    gap: 3,
    minHeight: 54,
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  toolButtonActive: { backgroundColor: c.primary },
  toolHint: { color: c.muted, fontSize: 12, textAlign: "center" },
  toolLabel: { color: c.text, fontSize: 10, fontWeight: "700" },
  toolLabelActive: { color: c.onPrimary },
  toolRow: { flexDirection: "row", gap: 4 },
  topBar: {
    alignItems: "center",
    borderBottomColor: c.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  topButton: { paddingHorizontal: 4, paddingVertical: 8 },
  topButtonText: { color: c.primaryText, fontSize: 15, fontWeight: "700" },
}));
