import { describe, expect, it, vi } from "vitest";

vi.mock("expo-speech-recognition", () => ({
  ExpoSpeechRecognitionModule: {},
  useSpeechRecognitionEvent: () => undefined,
}));
vi.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
vi.mock("react-native", () => ({}));
vi.mock("@/lib/themed-styles", () => ({
  makeThemedStyles: () => () => ({}),
  useAppColors: () => ({}),
}));
vi.mock("@/lib/formality", () => ({
  tn: (du: string) => du,
}));

describe("appendDictation", () => {
  it("joins dictated text with one space", async () => {
    const { appendDictation } = await import("../components/dictation-controls");
    expect(appendDictation("", " Hallo ")).toBe("Hallo");
    expect(appendDictation("Guten Tag.", "Der Drucker geht.")).toBe(
      "Guten Tag. Der Drucker geht.",
    );
    expect(appendDictation("Text ", "mehr")).toBe("Text mehr");
    expect(appendDictation("Text", "  ")).toBe("Text");
  });
});
