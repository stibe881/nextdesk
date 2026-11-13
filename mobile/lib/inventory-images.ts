import { useEffect, useState } from "react";

import { invokeNextDesk } from "@/lib/nextdesk-client";
import {
  parseInventoryImageUrl,
  pickInventoryImages,
} from "@/lib/inventory-images-model";
import { shopApi } from "@/lib/shop";

/** Signed article photo links live 10 minutes on the server; renew earlier. */
const URL_LIFETIME_MS = 8 * 60 * 1000;
const PARALLEL_REQUESTS = 4;

type CachedUrl = { url: string; expiresAt: number };
const signedUrlCache = new Map<string, CachedUrl>();

async function loadOwnImage(
  tenantId: string,
  itemId: string,
): Promise<string | null> {
  const key = `${tenantId}:${itemId}`;
  const cached = signedUrlCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const url = parseInventoryImageUrl(
    await invokeNextDesk<unknown>("inventory", {
      type: "createDownloadUrl",
      tenantId,
      itemId,
    }),
    itemId,
  );
  if (url) signedUrlCache.set(key, { url, expiresAt: Date.now() + URL_LIFETIME_MS });
  return url;
}

async function loadShopImages(tenantId: string): Promise<Map<string, string>> {
  const images = new Map<string, string>();
  try {
    for (const entry of await shopApi.catalog(tenantId, true)) {
      const url = entry.imageUrl ?? entry.imageUrls?.[0] ?? null;
      if (entry.inventoryItemId && url && !images.has(entry.inventoryItemId)) {
        images.set(entry.inventoryItemId, url);
      }
    }
  } catch {
    // Without the shop module only the articles' own photos are shown.
  }
  return images;
}

export function useInventoryItemImages(
  tenantId: string | null,
  items: readonly { id: string; hasPrimaryImage: boolean }[],
): ReadonlyMap<string, string> {
  const [images, setImages] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const signature = items
    .map((item) => `${item.id}:${item.hasPrimaryImage ? 1 : 0}`)
    .join(",");

  useEffect(() => {
    if (!tenantId || items.length === 0) return;
    let active = true;
    void (async () => {
      const shopImages = await loadShopImages(tenantId);
      const ownImages = new Map<string, string>();
      const queue = items.filter((item) => item.hasPrimaryImage);
      const publish = () => {
        if (!active) return;
        setImages(
          pickInventoryImages({
            ownImages,
            shopImages,
            itemIds: items.map((item) => item.id),
          }),
        );
      };
      publish();
      const workers = Array.from(
        { length: Math.min(PARALLEL_REQUESTS, queue.length) },
        async () => {
          for (let next = queue.shift(); next; next = queue.shift()) {
            if (!active) return;
            try {
              const url = await loadOwnImage(tenantId, next.id);
              if (url) ownImages.set(next.id, url);
            } catch {
              // A single missing photo keeps the shop photo or the icon.
            }
          }
        },
      );
      await Promise.all(workers);
      publish();
    })();
    return () => {
      active = false;
    };
    // `signature` captures the relevant parts of `items`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, signature]);

  return images;
}
