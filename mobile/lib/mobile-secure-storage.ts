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

/**
 * Android's SecureStore is only reliable for values up to ~2 KB per entry.
 * An Entra (Microsoft) session carries provider tokens and is several KB, so
 * storing it in one entry failed right after SSO sign-in. Larger values are
 * split into numbered chunks; a small header entry records the chunk count.
 */
const CHUNK_SIZE = 1_800;
const CHUNK_HEADER = "nextdesk-chunks:";

const secureOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function chunkKey(baseKey: string, index: number): string {
  return `${baseKey}.chunk${index}`;
}

function chunkCount(header: string | null): number {
  if (!header?.startsWith(CHUNK_HEADER)) return 0;
  const count = Number(header.slice(CHUNK_HEADER.length));
  return Number.isInteger(count) && count > 0 && count < 1_000 ? count : 0;
}

async function removeChunks(baseKey: string, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await SecureStore.deleteItemAsync(chunkKey(baseKey, index));
  }
}

const nativeStorage: AsyncKeyValueStorage = {
  // Every key is normalised to the Keychain-safe character set first; the
  // readable app namespaces ("nextdesk:mobile:…") are otherwise rejected.
  getItem: async (key) => {
    const baseKey = toSecureStoreKey(key);
    const stored = await SecureStore.getItemAsync(baseKey);
    const count = chunkCount(stored);
    if (count === 0) return stored;
    const parts: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(baseKey, index));
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join("");
  },
  setItem: async (key, value) => {
    const baseKey = toSecureStoreKey(key);
    const previousCount = chunkCount(await SecureStore.getItemAsync(baseKey));
    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(baseKey, value, secureOptions);
      await removeChunks(baseKey, previousCount);
      return;
    }
    const count = Math.ceil(value.length / CHUNK_SIZE);
    for (let index = 0; index < count; index += 1) {
      await SecureStore.setItemAsync(
        chunkKey(baseKey, index),
        value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
        secureOptions,
      );
    }
    await SecureStore.setItemAsync(
      baseKey,
      `${CHUNK_HEADER}${count}`,
      secureOptions,
    );
    for (let index = count; index < previousCount; index += 1) {
      await SecureStore.deleteItemAsync(chunkKey(baseKey, index));
    }
  },
  removeItem: async (key) => {
    const baseKey = toSecureStoreKey(key);
    const count = chunkCount(await SecureStore.getItemAsync(baseKey));
    await SecureStore.deleteItemAsync(baseKey);
    await removeChunks(baseKey, count);
  },
};

/**
 * Native data is encrypted by the operating system. The web preview deliberately
 * uses the browser store because SecureStore is unavailable there; it must never
 * be treated as a confidential offline cache.
 */
export const mobileSecureStorage: AsyncKeyValueStorage =
  Platform.OS === "web" ? webStorage : nativeStorage;
