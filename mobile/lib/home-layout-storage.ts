import {
  DEFAULT_HOME_LAYOUT,
  parseStoredHomeLayout,
  type HomeLayout,
} from "@/lib/home-layout";
import { mobileSecureStorage } from "@/lib/mobile-secure-storage";

const layoutKey = (userId: string) =>
  `nextdesk:mobile:home-layout:v1:${userId}`;

export async function loadHomeLayout(userId: string): Promise<HomeLayout> {
  return parseStoredHomeLayout(
    await mobileSecureStorage.getItem(layoutKey(userId)),
  );
}

export async function saveHomeLayout(
  userId: string,
  layout: HomeLayout,
): Promise<void> {
  await mobileSecureStorage.setItem(layoutKey(userId), JSON.stringify(layout));
}

export async function resetHomeLayout(userId: string): Promise<HomeLayout> {
  await mobileSecureStorage.removeItem(layoutKey(userId));
  return DEFAULT_HOME_LAYOUT;
}
