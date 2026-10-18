import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

type AsyncKeyValueStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const webStorage: AsyncKeyValueStorage = {
  getItem: async (key) =>
    typeof window === "undefined" ? null : window.localStorage.getItem(key),
  setItem: async (key, value) => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  },
  removeItem: async (key) => {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
  },
};

const nativeStorage: AsyncKeyValueStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: async (key, value) => {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

/**
 * Native data is encrypted by the operating system. The web preview deliberately
 * uses the browser store because SecureStore is unavailable there; it must never
 * be treated as a confidential offline cache.
 */
export const mobileSecureStorage: AsyncKeyValueStorage =
  Platform.OS === "web" ? webStorage : nativeStorage;
