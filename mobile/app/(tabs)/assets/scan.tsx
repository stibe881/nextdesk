import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { lookupMobileAsset } from "@/lib/asset-registry";
import {
  MobileFeatureLoadingScreen,
  MobileFeatureUnavailableScreen,
  useMobileFeatures,
} from "@/components/mobile-feature-gate";
import { hapticError, hapticSuccess } from "@/lib/mobile-haptics";
import { loadCurrentTenant } from "@/lib/nextdesk-client";
import { useMobileSessionGuard } from "@/lib/use-mobile-session-guard";

export default function AssetScanScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const checkingSession = useMobileSessionGuard();
  const { isEnabled, loading: checkingFeatures } = useMobileFeatures();
  const assetsEnabled = isEnabled("assets.management");
  const [permission, requestPermission] = useCameraPermissions();
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const wideLayout = width >= 768;

  const resolveCode = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim();
      if (!code || busy || !assetsEnabled) return;
      setBusy(true);
      setError("");
      try {
        const tenant = await loadCurrentTenant();
        const detail = await lookupMobileAsset(tenant.id, code);
        hapticSuccess();
        router.replace(`/assets/${detail.asset.id}` as never);
      } catch (nextError) {
        hapticError();
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Der Code konnte nicht aufgelöst werden.",
        );
      } finally {
        setBusy(false);
      }
    },
    [assetsEnabled, busy, router],
  );

  if (checkingSession || checkingFeatures) {
    return <MobileFeatureLoadingScreen />;
  }

  if (!assetsEnabled) {
    return (
      <MobileFeatureUnavailableScreen
        feature="assets.management"
        title="Assetscanner"
      />
    );
  }

  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#4438CA" size="large" />
      </View>
    );
  }

  const cameraAvailable = Platform.OS !== "web" && permission.granted;

  return (
    <View style={styles.screen}>
      <View style={[styles.topbar, wideLayout && styles.topbarWide]}>
        <Pressable
          accessibilityLabel="Zurück"
          onPress={() => router.back()}
          style={styles.closeButton}
        >
          <Ionicons color="#FFFFFF" name="close" size={25} />
        </Pressable>
        <Text style={styles.title}>Asset scannen</Text>
        <View style={styles.closeButton} />
      </View>

      <View style={[styles.scanContent, wideLayout && styles.scanContentWide]}>
        {cameraAvailable ? (
          <View
            style={[styles.cameraShell, wideLayout && styles.cameraShellWide]}
          >
            <CameraView
              barcodeScannerSettings={{
                barcodeTypes: ["qr", "code128", "code39", "ean13", "ean8"],
              }}
              onBarcodeScanned={
                busy ? undefined : ({ data }) => void resolveCode(data)
              }
              style={styles.camera}
            />
            <View pointerEvents="none" style={styles.overlay}>
              <View style={styles.scanFrame} />
              <Text style={styles.cameraHint}>
                QR-Code, Inventar- oder Seriennummer erfassen
              </Text>
            </View>
          </View>
        ) : (
          <View
            style={[
              styles.permissionCard,
              wideLayout && styles.permissionCardWide,
            ]}
          >
            <Ionicons color="#4438CA" name="camera-outline" size={33} />
            <Text style={styles.permissionTitle}>Kamera aktivieren</Text>
            <Text style={styles.permissionText}>
              Die Kamera wird ausschliesslich genutzt, um den QR- oder Barcode
              eines Assets zu lesen.
            </Text>
            {Platform.OS !== "web" ? (
              <Pressable
                onPress={() => void requestPermission()}
                style={styles.permissionButton}
              >
                <Text style={styles.permissionButtonText}>Kamera erlauben</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        <View style={[styles.manualCard, wideLayout && styles.manualCardWide]}>
          <Text style={styles.manualTitle}>Code manuell eingeben</Text>
          <Text style={styles.manualText}>
            Zum Beispiel Inventarnummer, Seriennummer oder Asset-Tag.
          </Text>
          <View style={styles.inputRow}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setManualCode}
              onSubmitEditing={() => void resolveCode(manualCode)}
              placeholder="Code eingeben"
              returnKeyType="search"
              style={styles.input}
              value={manualCode}
            />
            <Pressable
              accessibilityLabel="Assetcode suchen"
              disabled={busy || !manualCode.trim()}
              onPress={() => void resolveCode(manualCode)}
              style={[
                styles.lookupButton,
                (busy || !manualCode.trim()) && styles.lookupButtonDisabled,
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Ionicons color="#FFFFFF" name="search" size={19} />
              )}
            </Pressable>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  camera: { flex: 1 },
  cameraHint: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  cameraShell: {
    flex: 1,
    minHeight: 330,
    overflow: "hidden",
    position: "relative",
  },
  cameraShellWide: { borderRadius: 24, flex: 1, minHeight: 480 },
  centered: {
    alignItems: "center",
    backgroundColor: "#171827",
    flex: 1,
    justifyContent: "center",
  },
  closeButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  error: { color: "#B42335", fontSize: 12, lineHeight: 18, marginTop: 10 },
  input: {
    color: "#303145",
    flex: 1,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  inputRow: {
    alignItems: "center",
    borderColor: "#DDDDE7",
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    overflow: "hidden",
  },
  lookupButton: {
    alignItems: "center",
    backgroundColor: "#4438CA",
    height: 44,
    justifyContent: "center",
    width: 47,
  },
  lookupButtonDisabled: { backgroundColor: "#9996B6" },
  manualCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    gap: 7,
    padding: 21,
  },
  manualCardWide: {
    borderRadius: 24,
    flex: 1,
    justifyContent: "center",
    minHeight: 480,
  },
  manualText: { color: "#747486", fontSize: 12, lineHeight: 18 },
  manualTitle: { color: "#292A3E", fontSize: 16, fontWeight: "900" },
  overlay: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    padding: 28,
    position: "absolute",
    right: 0,
    top: 0,
  },
  permissionButton: {
    backgroundColor: "#4438CA",
    borderRadius: 12,
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  permissionButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  permissionCard: {
    alignItems: "center",
    backgroundColor: "#F0EEFF",
    flex: 1,
    gap: 8,
    justifyContent: "center",
    padding: 32,
  },
  permissionCardWide: { borderRadius: 24, flex: 1 },
  permissionText: {
    color: "#615C8A",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  permissionTitle: {
    color: "#332C70",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 3,
  },
  scanFrame: {
    borderColor: "#FFFFFF",
    borderRadius: 21,
    borderWidth: 3,
    height: 210,
    width: 210,
  },
  screen: { backgroundColor: "#171827", flex: 1 },
  scanContent: { flex: 1 },
  scanContentWide: {
    alignSelf: "center",
    flexDirection: "row",
    gap: 20,
    maxWidth: 1_120,
    padding: 20,
    width: "100%",
  },
  title: { color: "#FFFFFF", fontSize: 18, fontWeight: "900" },
  topbar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 13,
    paddingTop: 14,
  },
  topbarWide: { alignSelf: "center", maxWidth: 1_120, width: "100%" },
});
