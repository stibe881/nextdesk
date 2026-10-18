import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  listMobileTicketAttachments,
  openMobileTicketAttachment,
  uploadMobileTicketPhoto,
  type MobileTicketAttachment,
} from "@/lib/mobile-ticket-attachments";
import {
  hapticError,
  hapticSelection,
  hapticSuccess,
} from "@/lib/mobile-haptics";
import { useThemeContext } from "@/lib/theme-provider";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

type TicketPhotoAttachmentsProps = {
  canUpload: boolean;
  tenantId: string;
  ticketId: string;
};

type PhotoSource = "camera" | "library";

type Notice = { tone: "success" | "error"; text: string } | null;

// Short-lived signed preview links are only requested for the first tiles to
// keep the number of authorised download URLs per ticket view small.
const MAX_PREVIEWS = 12;
const MAX_LIBRARY_SELECTION = 5;
// Longest edge after re-encoding. Keeps modern 24–48 MP camera photos well
// below the 10 MiB server limit and speeds up uploads on mobile networks.
const MAX_EDGE = 2560;
const GRID_GAP = 8;
const GRID_COLUMNS = 3;

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function photoFilename(index: number): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `nextdesk-foto-${stamp}${index > 0 ? `-${index + 1}` : ""}.jpg`;
}

function resizeActions(
  asset: ImagePicker.ImagePickerAsset,
): ImageManipulator.Action[] {
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  if (width <= MAX_EDGE && height <= MAX_EDGE) return [];
  return width >= height
    ? [{ resize: { width: MAX_EDGE } }]
    : [{ resize: { height: MAX_EDGE } }];
}

async function deleteCachedFile(uri: string | null): Promise<void> {
  // Only files inside the app's own cache are removed; picker and camera
  // results are temporary copies there and must not linger after upload.
  if (!uri || !FileSystem.cacheDirectory) return;
  if (!uri.startsWith(FileSystem.cacheDirectory)) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(
    () => undefined,
  );
}

export function TicketPhotoAttachments({
  canUpload,
  tenantId,
  ticketId,
}: TicketPhotoAttachmentsProps) {
  const styles = useStyles();
  const colors = useAppColors();
  const { reducedMotion } = useThemeContext();
  const insets = useSafeAreaInsets();
  const [attachments, setAttachments] = useState<MobileTicketAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [upload, setUpload] = useState<{ current: number; total: number }>();
  const [notice, setNotice] = useState<Notice>(null);
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const [gridWidth, setGridWidth] = useState(0);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [failedPreviews, setFailedPreviews] = useState<Record<string, true>>(
    {},
  );
  const requestedPreviews = useRef(new Set<string>());
  const mounted = useRef(true);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState("");
  const uploading = upload !== undefined;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAttachments(await listMobileTicketAttachments({ tenantId, ticketId }));
    } catch (error) {
      setNotice({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "Die Fotos konnten nicht geladen werden.",
      });
    } finally {
      setLoading(false);
    }
  }, [tenantId, ticketId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const missing = attachments
      .slice(0, MAX_PREVIEWS)
      .filter((item) => !requestedPreviews.current.has(item.id));
    if (missing.length === 0) return;
    missing.forEach((item) => requestedPreviews.current.add(item.id));
    void Promise.allSettled(
      missing.map(async (item) => {
        try {
          const url = await openMobileTicketAttachment({
            tenantId,
            ticketId,
            attachmentId: item.id,
          });
          if (mounted.current)
            setPreviewUrls((current) => ({ ...current, [item.id]: url }));
        } catch {
          if (mounted.current)
            setFailedPreviews((current) => ({ ...current, [item.id]: true }));
        }
      }),
    );
  }, [attachments, tenantId, ticketId]);

  async function pickAssets(
    source: PhotoSource,
  ): Promise<ImagePicker.ImagePickerAsset[] | null> {
    if (source === "camera") {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setPermissionBlocked(!permission.canAskAgain);
        setNotice({
          tone: "error",
          text: "Bitte erlaube den Kamerazugriff, um ein Foto direkt aufzunehmen.",
        });
        return null;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        cameraType: ImagePicker.CameraType.back,
        exif: false,
        mediaTypes: ["images"],
        quality: 1,
      });
      return result.canceled ? null : result.assets.slice(0, 1);
    }
    // The iOS system photo picker runs out of process and needs no library
    // permission; only the selected images are handed to nextDesk.
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      allowsMultipleSelection: true,
      exif: false,
      mediaTypes: ["images"],
      orderedSelection: true,
      quality: 1,
      selectionLimit: MAX_LIBRARY_SELECTION,
    });
    return result.canceled ? null : result.assets;
  }

  async function addPhotos(source: PhotoSource) {
    if (uploading) return;
    hapticSelection();
    setNotice(null);
    setPermissionBlocked(false);
    let assets: ImagePicker.ImagePickerAsset[] | null;
    try {
      assets = await pickAssets(source);
    } catch {
      setNotice({
        tone: "error",
        text:
          source === "camera"
            ? "Die Kamera konnte nicht geöffnet werden."
            : "Die Mediathek konnte nicht geöffnet werden.",
      });
      return;
    }
    if (!assets || assets.length === 0) return;

    let uploaded = 0;
    let failure: string | null = null;
    for (const [index, asset] of assets.entries()) {
      setUpload({ current: index + 1, total: assets.length });
      let sanitizedUri: string | null = null;
      try {
        // Re-encoding strips the original metadata (e.g. location) before the
        // authenticated upload and normalises the format to JPEG.
        const image = await ImageManipulator.manipulateAsync(
          asset.uri,
          resizeActions(asset),
          { compress: 0.84, format: ImageManipulator.SaveFormat.JPEG },
        );
        sanitizedUri = image.uri;
        const response = await fetch(sanitizedUri);
        if (!response.ok)
          throw new Error("Das Foto konnte nicht gelesen werden.");
        await uploadMobileTicketPhoto({
          tenantId,
          ticketId,
          filename: photoFilename(index),
          bytes: await response.arrayBuffer(),
        });
        uploaded += 1;
      } catch (error) {
        failure =
          error instanceof Error
            ? error.message
            : "Das Foto konnte nicht hochgeladen werden.";
      } finally {
        await deleteCachedFile(sanitizedUri);
        await deleteCachedFile(asset.uri);
      }
    }
    setUpload(undefined);

    if (uploaded > 0) {
      hapticSuccess();
      await load();
    } else {
      hapticError();
    }
    if (failure) {
      setNotice({
        tone: "error",
        text:
          uploaded > 0
            ? `${uploaded} von ${assets.length} Fotos hinzugefügt. ${failure}`
            : failure,
      });
    } else {
      setNotice({
        tone: "success",
        text:
          uploaded === 1
            ? "Foto sicher zum Ticket hinzugefügt."
            : `${uploaded} Fotos sicher zum Ticket hinzugefügt.`,
      });
    }
  }

  const openViewerAt = useCallback(
    async (index: number) => {
      const item = attachments[index];
      if (!item) return;
      setViewerIndex(index);
      setViewerError("");
      setViewerUrl(null);
      try {
        // A fresh short-lived link is requested for every full-size view.
        setViewerUrl(
          await openMobileTicketAttachment({
            tenantId,
            ticketId,
            attachmentId: item.id,
          }),
        );
      } catch (error) {
        setViewerError(
          error instanceof Error
            ? error.message
            : "Das Foto konnte nicht geöffnet werden.",
        );
      }
    },
    [attachments, tenantId, ticketId],
  );

  function closeViewer() {
    setViewerIndex(null);
    setViewerUrl(null);
    setViewerError("");
  }

  function onGridLayout(event: LayoutChangeEvent) {
    const width = Math.floor(event.nativeEvent.layout.width);
    if (width !== gridWidth) setGridWidth(width);
  }

  const tileSize =
    gridWidth > 0
      ? Math.floor((gridWidth - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS)
      : 0;
  const viewerItem = viewerIndex === null ? null : attachments[viewerIndex];

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>ANHÄNGE</Text>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Fotos</Text>
            {attachments.length > 0 ? (
              <View style={styles.countPill}>
                <Text style={styles.countText}>{attachments.length}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.card}>
        {canUpload ? (
          <View style={styles.actions}>
            <Pressable
              accessibilityHint="Öffnet die Kamera, um ein Foto direkt aufzunehmen."
              accessibilityLabel="Foto mit der Kamera aufnehmen"
              accessibilityRole="button"
              accessibilityState={{ disabled: uploading }}
              disabled={uploading}
              onPress={() => void addPhotos("camera")}
              style={({ pressed }) => [
                styles.actionButton,
                styles.actionPrimary,
                pressed && styles.pressed,
                uploading && styles.disabled,
              ]}
            >
              <Ionicons color={colors.onPrimary} name="camera" size={19} />
              <Text style={styles.actionPrimaryText}>Kamera</Text>
            </Pressable>
            <Pressable
              accessibilityHint={`Wähle bis zu ${MAX_LIBRARY_SELECTION} Bilder aus deiner Mediathek.`}
              accessibilityLabel="Fotos aus der Mediathek auswählen"
              accessibilityRole="button"
              accessibilityState={{ disabled: uploading }}
              disabled={uploading}
              onPress={() => void addPhotos("library")}
              style={({ pressed }) => [
                styles.actionButton,
                styles.actionSecondary,
                pressed && styles.pressed,
                uploading && styles.disabled,
              ]}
            >
              <Ionicons color={colors.primaryText} name="images" size={18} />
              <Text style={styles.actionSecondaryText}>Mediathek</Text>
            </Pressable>
          </View>
        ) : null}

        {upload ? (
          <View accessibilityLiveRegion="polite" style={styles.progress}>
            <ActivityIndicator color={colors.primaryText} size="small" />
            <Text style={styles.progressText}>
              {upload.total > 1
                ? `Foto ${upload.current} von ${upload.total} wird sicher hochgeladen …`
                : "Foto wird sicher hochgeladen …"}
            </Text>
          </View>
        ) : null}

        {notice ? (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.notice,
              notice.tone === "success"
                ? styles.noticeSuccess
                : styles.noticeError,
            ]}
          >
            <Ionicons
              color={notice.tone === "success" ? colors.success : colors.error}
              name={
                notice.tone === "success"
                  ? "checkmark-circle"
                  : "alert-circle-outline"
              }
              size={17}
            />
            <View style={styles.noticeCopy}>
              <Text
                style={[
                  styles.noticeText,
                  notice.tone === "success"
                    ? styles.noticeTextSuccess
                    : styles.noticeTextError,
                ]}
              >
                {notice.text}
              </Text>
              {permissionBlocked ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => void Linking.openSettings()}
                >
                  <Text style={styles.noticeLink}>Einstellungen öffnen</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {loading && attachments.length === 0 ? (
          <View onLayout={onGridLayout} style={styles.grid}>
            {Array.from({ length: GRID_COLUMNS }, (_, index) => (
              <View
                key={index}
                style={[
                  styles.tile,
                  styles.skeleton,
                  { height: tileSize || 96, width: tileSize || 96 },
                ]}
              />
            ))}
          </View>
        ) : attachments.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons
                color={colors.primaryText}
                name="camera-outline"
                size={24}
              />
            </View>
            <Text style={styles.emptyTitle}>Noch keine Fotos</Text>
            <Text style={styles.emptyText}>
              {canUpload
                ? "Halte das Problem direkt mit der Kamera fest oder wähle Bilder aus deiner Mediathek."
                : "Zu diesem Ticket wurden noch keine Fotos hinzugefügt."}
            </Text>
          </View>
        ) : (
          <View onLayout={onGridLayout} style={styles.grid}>
            {tileSize > 0
              ? attachments.map((attachment, index) => {
                  const url = previewUrls[attachment.id];
                  const showImage =
                    Boolean(url) && !failedPreviews[attachment.id];
                  return (
                    <Pressable
                      accessibilityHint="Öffnet das Foto in voller Grösse."
                      accessibilityLabel={`Foto ${index + 1} von ${attachments.length}, ${formatSize(attachment.byteSize)}`}
                      accessibilityRole="imagebutton"
                      key={attachment.id}
                      onPress={() => {
                        hapticSelection();
                        void openViewerAt(index);
                      }}
                      style={({ pressed }) => [
                        styles.tile,
                        { height: tileSize, width: tileSize },
                        pressed && styles.pressed,
                      ]}
                    >
                      {showImage ? (
                        <Image
                          accessibilityIgnoresInvertColors
                          cachePolicy="memory"
                          contentFit="cover"
                          onError={() =>
                            setFailedPreviews((current) => ({
                              ...current,
                              [attachment.id]: true,
                            }))
                          }
                          recyclingKey={attachment.id}
                          source={{ uri: url }}
                          style={styles.tileImage}
                          transition={reducedMotion ? 0 : 160}
                        />
                      ) : (
                        <View style={styles.tilePlaceholder}>
                          {!failedPreviews[attachment.id] &&
                          index < MAX_PREVIEWS ? (
                            <ActivityIndicator
                              color={colors.subtle}
                              size="small"
                            />
                          ) : (
                            <Ionicons
                              color={colors.subtle}
                              name="image-outline"
                              size={22}
                            />
                          )}
                        </View>
                      )}
                      <View style={styles.tileBadge}>
                        <Text style={styles.tileBadgeText}>
                          {formatSize(attachment.byteSize)}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })
              : null}
          </View>
        )}

        <View style={styles.footer}>
          <Ionicons color={colors.subtle} name="lock-closed" size={12} />
          <Text style={styles.footerText}>
            Ohne Standortdaten · max. 10 MB · nur für dieses Ticket freigegeben
          </Text>
        </View>
      </View>

      <Modal
        animationType={reducedMotion ? "none" : "fade"}
        onRequestClose={closeViewer}
        statusBarTranslucent
        transparent
        visible={viewerItem !== null && viewerItem !== undefined}
      >
        <View style={styles.viewerRoot}>
          <View style={[styles.viewerTop, { paddingTop: insets.top + 8 }]}>
            <Pressable
              accessibilityLabel="Foto schliessen"
              accessibilityRole="button"
              hitSlop={10}
              onPress={closeViewer}
              style={styles.viewerIconButton}
            >
              <Ionicons color={colors.foreground} name="close" size={22} />
            </Pressable>
            {viewerItem ? (
              <View style={styles.viewerMeta}>
                <Text numberOfLines={1} style={styles.viewerTitle}>
                  Foto {(viewerIndex ?? 0) + 1} von {attachments.length}
                </Text>
                <Text numberOfLines={1} style={styles.viewerSubtitle}>
                  {[
                    formatDate(viewerItem.createdAt),
                    formatSize(viewerItem.byteSize),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={styles.viewerStage}>
            {viewerUrl ? (
              <Image
                accessibilityIgnoresInvertColors
                accessibilityLabel={`Foto ${(viewerIndex ?? 0) + 1} in voller Grösse`}
                cachePolicy="memory"
                contentFit="contain"
                onError={() =>
                  setViewerError("Das Foto konnte nicht angezeigt werden.")
                }
                source={{ uri: viewerUrl }}
                style={styles.viewerImage}
                transition={reducedMotion ? 0 : 180}
              />
            ) : viewerError ? null : (
              <ActivityIndicator color={colors.primaryText} size="large" />
            )}
            {viewerError ? (
              <View style={styles.viewerErrorBox}>
                <Ionicons
                  color={colors.error}
                  name="alert-circle-outline"
                  size={22}
                />
                <Text style={styles.viewerErrorText}>{viewerError}</Text>
              </View>
            ) : null}
          </View>
          {attachments.length > 1 && viewerIndex !== null ? (
            <View
              style={[
                styles.viewerBottom,
                { paddingBottom: insets.bottom + 12 },
              ]}
            >
              <Pressable
                accessibilityLabel="Vorheriges Foto"
                accessibilityRole="button"
                accessibilityState={{ disabled: viewerIndex === 0 }}
                disabled={viewerIndex === 0}
                onPress={() => void openViewerAt(viewerIndex - 1)}
                style={[
                  styles.viewerIconButton,
                  viewerIndex === 0 && styles.disabled,
                ]}
              >
                <Ionicons
                  color={colors.foreground}
                  name="chevron-back"
                  size={22}
                />
              </Pressable>
              <Text style={styles.viewerCounter}>
                {viewerIndex + 1} / {attachments.length}
              </Text>
              <Pressable
                accessibilityLabel="Nächstes Foto"
                accessibilityRole="button"
                accessibilityState={{
                  disabled: viewerIndex >= attachments.length - 1,
                }}
                disabled={viewerIndex >= attachments.length - 1}
                onPress={() => void openViewerAt(viewerIndex + 1)}
                style={[
                  styles.viewerIconButton,
                  viewerIndex >= attachments.length - 1 && styles.disabled,
                ]}
              >
                <Ionicons
                  color={colors.foreground}
                  name="chevron-forward"
                  size={22}
                />
              </Pressable>
            </View>
          ) : (
            <View style={{ height: insets.bottom + 12 }} />
          )}
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  section: { gap: 10 },
  header: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  headerCopy: { gap: 3 },
  eyebrow: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  titleRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  title: { color: c.foreground, fontSize: 22, fontWeight: "800" },
  countPill: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderColor: c.primarySoftBorder,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minWidth: 26,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countText: { color: c.primaryText, fontSize: 12, fontWeight: "800" },
  card: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: 14,
    padding: 14,
  },
  actions: { flexDirection: "row", gap: 10 },
  actionButton: {
    alignItems: "center",
    borderRadius: 14,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 12,
  },
  actionPrimary: { backgroundColor: c.primary },
  actionPrimaryText: { color: c.onPrimary, fontSize: 14, fontWeight: "800" },
  actionSecondary: {
    backgroundColor: c.primarySoft,
    borderColor: c.primarySoftBorder,
    borderWidth: 1,
  },
  actionSecondaryText: {
    color: c.primaryText,
    fontSize: 14,
    fontWeight: "800",
  },
  pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.5 },
  progress: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 12,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  progressText: {
    color: c.primaryText,
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
  },
  notice: {
    alignItems: "flex-start",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noticeSuccess: {
    backgroundColor: c.successSoft,
    borderColor: c.successBorder,
  },
  noticeError: { backgroundColor: c.errorSoft, borderColor: c.errorBorder },
  noticeCopy: { flex: 1, gap: 6 },
  noticeText: { fontSize: 13, lineHeight: 18 },
  noticeTextSuccess: { color: c.success },
  noticeTextError: { color: c.error },
  noticeLink: { color: c.primaryText, fontSize: 13, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  tile: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  skeleton: { opacity: 0.7 },
  tileImage: { height: "100%", width: "100%" },
  tilePlaceholder: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  tileBadge: {
    backgroundColor: c.overlay,
    borderRadius: 999,
    bottom: 6,
    left: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    position: "absolute",
  },
  tileBadgeText: { color: c.onPrimary, fontSize: 10, fontWeight: "800" },
  empty: {
    alignItems: "center",
    borderColor: c.borderStrong,
    borderRadius: 16,
    borderStyle: "dashed",
    borderWidth: 1.5,
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 22,
  },
  emptyIcon: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 999,
    height: 52,
    justifyContent: "center",
    marginBottom: 4,
    width: 52,
  },
  emptyTitle: { color: c.foreground, fontSize: 15, fontWeight: "800" },
  emptyText: {
    color: c.muted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  footer: { alignItems: "center", flexDirection: "row", gap: 6 },
  footerText: { color: c.subtle, flex: 1, fontSize: 11, lineHeight: 15 },
  viewerRoot: { backgroundColor: c.background, flex: 1 },
  viewerTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingBottom: 10,
    paddingHorizontal: 16,
  },
  viewerIconButton: {
    alignItems: "center",
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  viewerMeta: { flex: 1, gap: 2 },
  viewerTitle: { color: c.foreground, fontSize: 15, fontWeight: "800" },
  viewerSubtitle: { color: c.muted, fontSize: 12 },
  viewerStage: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  viewerImage: { height: "100%", width: "100%" },
  viewerErrorBox: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 32,
    position: "absolute",
  },
  viewerErrorText: {
    color: c.text,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  viewerBottom: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  viewerCounter: { color: c.muted, fontSize: 13, fontWeight: "700" },
}));
