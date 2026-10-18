import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { toSecureStoreKey } from "./secure-store-key";

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
  // Every key is normalised to the Keychain-safe character set first; the
  // readable app namespaces ("nextdesk:mobile:…") are otherwise rejected.
  getItem: (key) => SecureStore.getItemAsync(toSecureStoreKey(key)),
  setItem: async (key, value) => {
    await SecureStore.setItemAsync(toSecureStoreKey(key), value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  removeItem: (key) => SecureStore.deleteItemAsync(toSecureStoreKey(key)),
};

/**
 * Native data is encrypted by the operating system. The web preview deliberately
 * uses the browser store because SecureStore is unavailable there; it must never
 * be treated as a confidential offline cache.
 */
export const mobileSecureStorage: AsyncKeyValueStorage =
  Platform.OS === "web" ? webStorage : nativeStorage;
