import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";

/** Shared layout of the quick-create screens (header, intro, form card). */
export function CreateScreen({
  title,
  heading,
  intro,
  children,
}: {
  title: string;
  heading: string;
  intro: string;
  children: ReactNode;
}) {
  const styles = useCreateStyles();
  const colors = useAppColors();
  return (
    <ScreenContainer className="px-5">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <Pressable
              accessibilityLabel="Zurück"
              accessibilityRole="button"
              hitSlop={10}
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace("/")
              }
              style={styles.backButton}
            >
              <Ionicons
                color={colors.primaryText}
                name="arrow-back"
                size={22}
              />
            </Pressable>
            <Text style={styles.topTitle}>{title}</Text>
            <View style={styles.topSpacer} />
          </View>
          <View style={styles.intro}>
            <Text style={styles.title}>{heading}</Text>
            <Text style={styles.copy}>{intro}</Text>
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

export function FormCard({ children }: { children: ReactNode }) {
  const styles = useCreateStyles();
  return <View style={styles.form}>{children}</View>;
}

export function Field({ label, ...input }: TextInputProps & { label: string }) {
  const styles = useCreateStyles();
  const colors = useAppColors();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      <TextInput
        placeholderTextColor={colors.subtle}
        style={[styles.input, input.multiline ? styles.multiline : null]}
        {...input}
      />
    </View>
  );
}

export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const styles = useCreateStyles();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      <View style={styles.chips}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={option.value}
              onPress={() => onChange(option.value)}
              style={[styles.chip, selected ? styles.chipSelected : null]}
            >
              <Text
                style={[
                  styles.chipText,
                  selected ? styles.chipTextSelected : null,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function SubmitButton({
  label,
  busyLabel,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  busyLabel: string;
  busy: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const styles = useCreateStyles();
  const colors = useAppColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: busy || disabled }}
      disabled={busy || disabled}
      onPress={onPress}
      style={[
        styles.primaryButton,
        busy || disabled ? styles.primaryButtonDisabled : null,
      ]}
    >
      {busy ? <ActivityIndicator color={colors.onPrimary} /> : null}
      <Text style={styles.primaryButtonText}>{busy ? busyLabel : label}</Text>
    </Pressable>
  );
}

export function FormMessage({
  text,
  tone,
}: {
  text: string;
  tone: "error" | "info";
}) {
  const styles = useCreateStyles();
  if (!text) return null;
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={tone === "error" ? styles.error : styles.copy}
    >
      {text}
    </Text>
  );
}

export function LoadingBlock({ text }: { text: string }) {
  const styles = useCreateStyles();
  const colors = useAppColors();
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.copy}>{text}</Text>
    </View>
  );
}

export const useCreateStyles = makeThemedStyles((c) => ({
  flex: { flex: 1 },
  content: { gap: 16, paddingTop: 14, paddingBottom: 120 },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  backButton: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 18,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  topTitle: { color: c.foreground, fontSize: 17, fontWeight: "800" },
  topSpacer: { width: 40 },
  intro: { gap: 8, paddingTop: 10 },
  title: {
    color: c.foreground,
    fontSize: 27,
    fontWeight: "800",
    letterSpacing: -0.5,
    lineHeight: 33,
  },
  copy: { color: c.muted, fontSize: 15, lineHeight: 23 },
  centered: { alignItems: "center", gap: 10, paddingVertical: 35 },
  form: {
    backgroundColor: c.surface,
    borderColor: c.surfaceSubtle,
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 17,
  },
  field: { gap: 7 },
  label: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  input: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 13,
    borderWidth: 1,
    color: c.foreground,
    fontSize: 15,
    minHeight: 50,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  multiline: { minHeight: 110, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderColor: c.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  chipSelected: { backgroundColor: c.primarySoft, borderColor: c.primary },
  chipText: { color: c.foreground, fontSize: 13, fontWeight: "700" },
  chipTextSelected: { color: c.primaryText },
  error: { color: c.error, fontSize: 13, lineHeight: 19 },
  primaryButton: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 16,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 16,
  },
  primaryButtonDisabled: { opacity: 0.55 },
  primaryButtonText: { color: c.onPrimary, fontSize: 15, fontWeight: "800" },
}));
