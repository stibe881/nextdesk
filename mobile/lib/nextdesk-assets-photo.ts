import { invokeNextDesk } from "@/lib/nextdesk-client";

/** Eigenes Entra-Profilfoto als kurzlebige signierte URL, sonst `null`. */
export async function loadOwnProfilePhotoUrl(
  tenantId: string,
): Promise<string | null> {
  try {
    const response = await invokeNextDesk<{
      data?: { photoUrl?: unknown };
    }>("service-assets", { type: "ownPhoto", tenantId });
    const url = response?.data?.photoUrl;
    return typeof url === "string" && url.startsWith("https://") ? url : null;
  } catch {
    return null;
  }
}
