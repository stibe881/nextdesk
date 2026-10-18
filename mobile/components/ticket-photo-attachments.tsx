import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  listMobileTicketAttachments,
  openMobileTicketAttachment,
  uploadMobileTicketPhoto,
  type MobileTicketAttachment,
} from "@/lib/mobile-ticket-attachments";

type TicketPhotoAttachmentsProps = {
  canUpload: boolean;
  tenantId: string;
  ticketId: string;
};

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function photoFilename(): string {
  return `nextdesk-foto-${new Date().toISOString().slice(0, 10)}.jpg`;
}

export function TicketPhotoAttachments({
  canUpload,
  tenantId,
  ticketId,
}: TicketPhotoAttachmentsProps) {
  const [attachments, setAttachments] = useState<MobileTicketAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAttachments(await listMobileTicketAttachments({ tenantId, ticketId }));
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Die Fotoanhänge konnten nicht geladen werden.",
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId, ticketId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function chooseAndUploadPhoto() {
    setMessage("");
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage(
        "Bitte erlauben Sie den Fotozugriff, um einen Bildanhang auszuwählen.",
      );
      return;
    }

    const selection = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      allowsMultipleSelection: false,
      exif: false,
      mediaTypes: ["images"],
      quality: 1,
    });
    if (selection.canceled || !selection.assets[0]) return;

    setUploading(true);
    try {
      // Re-encoding removes the original metadata before the authenticated upload.
      const image = await ImageManipulator.manipulateAsync(
        selection.assets[0].uri,
        [],
        {
          compress: 0.84,
          format: ImageManipulator.SaveFormat.JPEG,
        },
      );
      const response = await fetch(image.uri);
      if (!response.ok)
        throw new Error("Das ausgewählte Foto konnte nicht gelesen werden.");
      const bytes = await response.arrayBuffer();
      await uploadMobileTicketPhoto({
        tenantId,
        ticketId,
        filename: photoFilename(),
        bytes,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMessage("Foto sicher als Anhang hinzugefügt.");
      await load();
    } catch (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setMessage(
        error instanceof Error
          ? error.message
          : "Der Fotoanhang konnte nicht hochgeladen werden.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function openAttachment(attachmentId: string) {
    setOpeningId(attachmentId);
    setMessage("");
    try {
      const signedUrl = await openMobileTicketAttachment({
        tenantId,
        ticketId,
        attachmentId,
      });
      const supported = await Linking.canOpenURL(signedUrl);
      if (!supported)
        throw new Error(
          "Dieser Fotoanhang kann auf diesem Gerät nicht geöffnet werden.",
        );
      await Linking.openURL(signedUrl);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Der Fotoanhang konnte nicht geöffnet werden.",
      );
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>FOTOANHÄNGE</Text>
          <Text style={styles.title}>Bilder</Text>
        </View>
        {canUpload ? (
          <Pressable
            accessibilityLabel="Foto als Anhang auswählen"
            accessibilityRole="button"
            disabled={uploading}
            onPress={() => void chooseAndUploadPhoto()}
            style={[styles.addButton, uploading && styles.disabled]}
          >
            {uploading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Ionicons color="#FFFFFF" name="camera-outline" size={18} />
            )}
            <Text style={styles.addButtonText}>
              {uploading ? "Lädt hoch …" : "Foto"}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.hint}>
        Fotos werden vor dem Upload neu gespeichert, auf 10 MiB begrenzt und nur
        mit einer kurzlebigen, ticketgebundenen Freigabe übertragen.
      </Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#4438CA" size="small" />
          <Text style={styles.loadingText}>Anhänge werden geladen …</Text>
        </View>
      ) : attachments.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons color="#7069C7" name="images-outline" size={21} />
          <Text style={styles.emptyText}>
            Noch keine Fotoanhänge vorhanden.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {attachments.map((attachment) => (
            <Pressable
              accessibilityLabel={`${attachment.originalFilename} öffnen`}
              accessibilityRole="button"
              disabled={openingId === attachment.id}
              key={attachment.id}
              onPress={() => void openAttachment(attachment.id)}
              style={styles.item}
            >
              <View style={styles.itemIcon}>
                {openingId === attachment.id ? (
                  <ActivityIndicator color="#087A95" size="small" />
                ) : (
                  <Ionicons color="#087A95" name="image-outline" size={19} />
                )}
              </View>
              <View style={styles.itemCopy}>
                <Text numberOfLines={1} style={styles.itemName}>
                  {attachment.originalFilename}
                </Text>
                <Text style={styles.itemMeta}>
                  {formatSize(attachment.byteSize)}
                </Text>
              </View>
              <Ionicons color="#838295" name="chevron-forward" size={18} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: "#77758C",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  title: { color: "#202136", fontSize: 22, fontWeight: "800", marginTop: 3 },
  addButton: {
    alignItems: "center",
    backgroundColor: "#4438CA",
    borderRadius: 12,
    flexDirection: "row",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 12,
  },
  addButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  hint: { color: "#77758C", fontSize: 11, lineHeight: 16 },
  message: {
    backgroundColor: "#F0EFFB",
    borderRadius: 12,
    color: "#4D4794",
    fontSize: 12,
    lineHeight: 17,
    padding: 11,
  },
  loading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
    paddingVertical: 14,
  },
  loadingText: { color: "#77758C", fontSize: 12 },
  empty: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E8E7F0",
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 14,
  },
  emptyText: { color: "#77758C", fontSize: 12 },
  list: { gap: 8 },
  item: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E8E7F0",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 11,
    minHeight: 58,
    paddingHorizontal: 12,
  },
  itemIcon: {
    alignItems: "center",
    backgroundColor: "#E5F7FA",
    borderRadius: 12,
    height: 37,
    justifyContent: "center",
    width: 37,
  },
  itemCopy: { flex: 1, gap: 2 },
  itemName: { color: "#303145", fontSize: 13, fontWeight: "800" },
  itemMeta: { color: "#77758C", fontSize: 11 },
  disabled: { opacity: 0.56 },
});
