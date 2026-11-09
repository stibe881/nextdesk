import {
  normalizeHomeLayout,
  parseStoredHomeLayoutRecord,
  resolveHomeLayoutSync,
  type HomeLayout,
  type StoredHomeLayout,
} from "@/lib/home-layout";
import { mobileSecureStorage } from "@/lib/mobile-secure-storage";
import { requireNextDesk } from "@/lib/nextdesk-client";

const layoutKey = (userId: string) =>
  `nextdesk:mobile:home-layout:v1:${userId}`;

export async function loadLocalHomeLayout(
  userId: string,
): Promise<StoredHomeLayout | null> {
  return parseStoredHomeLayoutRecord(
    await mobileSecureStorage.getItem(layoutKey(userId)),
  );
}

async function saveLocalHomeLayout(
  userId: string,
  stored: StoredHomeLayout,
): Promise<void> {
  await mobileSecureStorage.setItem(layoutKey(userId), JSON.stringify(stored));
}

async function fetchRemoteHomeLayout(
  userId: string,
): Promise<StoredHomeLayout | null> {
  const { data, error } = await requireNextDesk()
    .from("mobile_home_layouts")
    .select("layout, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Die Home-Anpassung konnte nicht geladen werden.");
  if (!data || typeof data.updated_at !== "string") return null;
  return {
    layout: normalizeHomeLayout(data.layout),
    changedAt: data.updated_at,
  };
}

/** Writes the layout to the server; returns the server's time of change. */
async function pushRemoteHomeLayout(
  userId: string,
  layout: HomeLayout,
): Promise<string> {
  const { data, error } = await requireNextDesk()
    .from("mobile_home_layouts")
    .upsert({ user_id: userId, layout }, { onConflict: "user_id" })
    .select("updated_at")
    .single();
  if (error || typeof data?.updated_at !== "string") {
    throw new Error("Die Home-Anpassung konnte nicht gespeichert werden.");
  }
  return data.updated_at;
}

/**
 * Brings this device and the server in line (last change wins), so the home
 * screen looks the same on every device of the person. Offline or on errors
 * the device copy stays in use and is sent later.
 */
export async function syncHomeLayout(
  userId: string,
): Promise<StoredHomeLayout | null> {
  const local = await loadLocalHomeLayout(userId);
  let remote: StoredHomeLayout | null;
  try {
    remote = await fetchRemoteHomeLayout(userId);
  } catch {
    return local;
  }
  const action = resolveHomeLayoutSync(local, remote);
  if (action === "adopt-remote" && remote) {
    await saveLocalHomeLayout(userId, remote);
    return remote;
  }
  if (action === "push-local" && local) {
    try {
      const changedAt = await pushRemoteHomeLayout(userId, local.layout);
      const synced = { layout: local.layout, changedAt };
      await saveLocalHomeLayout(userId, synced);
      return synced;
    } catch {
      return local;
    }
  }
  return local;
}

/** A change made on this device: kept locally and sent to the server. */
export async function commitHomeLayout(
  userId: string,
  layout: HomeLayout,
): Promise<void> {
  const changedAt = new Date().toISOString();
  await saveLocalHomeLayout(userId, { layout, changedAt });
  try {
    const serverTime = await pushRemoteHomeLayout(userId, layout);
    await saveLocalHomeLayout(userId, { layout, changedAt: serverTime });
  } catch {
    // The next sync sends the newer device copy.
  }
}
