import { Ionicons } from "@expo/vector-icons";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

export type PolishLength = "short" | "detailed";

/** Appends dictated text to existing text with a single space. */
export function appendDictation(existing: string, dictated: string): string {
  const addition = dictated.trim();
  if (!addition) return existing;
  if (!existing.trim()) return addition;
  return /\s$/.test(existing) ? existing + addition : `${existing} ${addition}`;
}

/**
 * Microphone button (on-device speech recognition, Swiss German → text) and
 * «KI kurz» / «KI ausführlich» (rewrite, always friendly) for the reply field.
 */
export function DictationControls({
  text,
  onTextChange,
  onPolish,
  disabled,
}: {
  text: string;
  onTextChange: (text: string) => void;
  onPolish?: ((length: PolishLength) => Promise<void>) | undefined;
  disabled?: boolean;
}) {
  const colors = useAppColors();
  const styles = useStyles();
  const [listening, setListening] = useState(false);
  const [polishing, setPolishing] = useState<PolishLength | null>(null);
  // Text before the last rewrite, so the original can be restored.
  const [original, setOriginal] = useState<string | null>(null);
  const [interim, setInterim] = useState("");
  // Text before dictation started; final results are appended to it.
  const base = useRef("");

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript ?? "";
    if (event.isFinal) {
      base.current = appendDictation(base.current, transcript);
      onTextChange(base.current);
      setInterim("");
    } else {
      setInterim(transcript);
    }
  });
  useSpeechRecognitionEvent("end", () => {
    setListening(false);
    setInterim("");
  });
  useSpeechRecognitionEvent("error", (event) => {
    setListening(false);
    setInterim("");
    if (event.error !== "aborted" && event.error !== "no-speech") {
      Alert.alert(
        "Diktat nicht möglich",
        event.message || "Die Spracherkennung ist gerade nicht verfügbar.",
      );
    }
  });

  async function toggle() {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    try {
      const permission =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Mikrofon nicht freigegeben",
          "Erlaube Mikrofon und Spracherkennung in den Einstellungen, um zu diktieren.",
        );
        return;
      }
      base.current = text;
      setListening(true);
      ExpoSpeechRecognitionModule.start({
        lang: "de-CH",
        interimResults: true,
        continuous: true,
        addsPunctuation: true,
      });
    } catch {
      setListening(false);
      Alert.alert(
        "Diktat nicht möglich",
        "Die Spracherkennung ist auf diesem Gerät nicht verfügbar.",
      );
    }
  }

  async function polish(length: PolishLength) {
    if (!onPolish || polishing) return;
    setPolishing(length);
    const before = text;
    try {
      await onPolish(length);
      setOriginal(before);
    } finally {
      setPolishing(null);
    }
  }

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityLabel={listening ? "Diktat beenden" : "Antwort diktieren"}
        accessibilityRole="button"
        accessibilityState={{ selected: listening }}
        disabled={disabled}
        onPress={() => void toggle()}
        style={[styles.button, listening ? styles.buttonActive : null]}
      >
        <Ionicons
          color={listening ? colors.onPrimary : colors.primaryText}
          name={listening ? "stop" : "mic-outline"}
          size={16}
        />
        <Text style={[styles.label, listening ? styles.labelActive : null]}>
          {listening ? "Stopp" : "Diktieren"}
        </Text>
      </Pressable>
      {onPolish
        ? (
            [
              ["short", "KI kurz"],
              ["detailed", "KI ausführlich"],
            ] as const
          ).map(([length, label]) => (
            <Pressable
              accessibilityLabel={
                length === "short"
                  ? "Text mit KI kurz und freundlich umformulieren"
                  : "Text mit KI ausführlich und freundlich umformulieren"
              }
              accessibilityRole="button"
              disabled={disabled || listening || polishing !== null || !text.trim()}
              key={length}
              onPress={() => void polish(length)}
              style={[
                styles.button,
                disabled || listening || !text.trim() ? styles.disabled : null,
              ]}
            >
              {polishing === length ? (
                <ActivityIndicator color={colors.primaryText} size="small" />
              ) : (
                <Ionicons color={colors.primaryText} name="sparkles" size={15} />
              )}
              <Text style={styles.label}>{label}</Text>
            </Pressable>
          ))
        : null}
      {original !== null && original !== text ? (
        <Pressable
          accessibilityLabel="Originaltext wiederherstellen"
          accessibilityRole="button"
          disabled={disabled || listening || polishing !== null}
          onPress={() => {
            onTextChange(original);
            setOriginal(null);
          }}
          style={styles.button}
        >
          <Ionicons color={colors.primaryText} name="arrow-undo" size={15} />
          <Text style={styles.label}>Original</Text>
        </Pressable>
      ) : null}
      {interim ? (
        <Text numberOfLines={1} style={styles.interim}>
          {interim}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeThemedStyles((c) => ({
  button: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 999,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  buttonActive: { backgroundColor: c.error },
  disabled: { opacity: 0.45 },
  interim: { color: c.muted, flex: 1, fontSize: 12, fontStyle: "italic" },
  label: { color: c.primaryText, fontSize: 12, fontWeight: "700" },
  labelActive: { color: c.onPrimary },
  row: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 6,
  },
}));
