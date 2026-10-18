import { mobileSecureStorage } from "@/lib/mobile-secure-storage";
import { Platform } from "react-native";

const ACTIVE_USER_KEY = "nextdesk:mobile:active-user:v1";
const tenantKey = (userId: string) => `nextdesk:mobile:tenant:v1:${userId}`;
const stateKey = (userId: string) =>
  `nextdesk:mobile:private-state:v1:${userId}`;
const ticketCacheChunkKey = (userId: string, tenantId: string, index: number) =>
  `nextdesk:mobile:ticket-cache:v1:${userId}:${tenantId}:${index}`;
const TICKET_CACHE_CHUNK_SIZE = 1_000;
const MAX_TICKET_CACHE_CHUNKS = 20;
const MAX_TICKET_CACHE_AGE_MS = 12 * 60 * 60 * 1_000;

export type OfflineTicketListCache = {
  cachedAt: string;
  tenant: { id: string; name: string; slug: string };
  tickets: Array<{
    assignedToCurrentUser: boolean;
    id: string;
    priority: string;
    resolved: boolean;
    status: string;
    subject: string;
    ticketNumber: string;
  }>;
};

type TicketCacheDescriptor = {
  cachedAt: string;
  chunks: number;
};

export type LocalTicketDraft = {
  body: string;
  ticketId: string;
  updatedAt: string;
  visibility: "internal" | "external";
};

type PrivateState = {
  deviceProtection?: boolean;
  drafts: Record<string, LocalTicketDraft>;
  favorites: Record<string, string[]>;
  ticketCaches: Record<string, TicketCacheDescriptor>;
};

const EMPTY_STATE: PrivateState = {
  drafts: {},
  favorites: {},
  ticketCaches: {},
};

function draftKey(
  tenantId: string,
  ticketId: string,
  visibility: LocalTicketDraft["visibility"],
) {
  return `${tenantId}:${ticketId}:${visibility}`;
}

function parseState(value: string | null): PrivateState {
  if (!value)
    return { ...EMPTY_STATE, drafts: {}, favorites: {}, ticketCaches: {} };
  try {
    const parsed = JSON.parse(value) as Partial<PrivateState>;
    const drafts =
      parsed.drafts &&
      typeof parsed.drafts === "object" &&
      !Array.isArray(parsed.drafts)
        ? parsed.drafts
        : {};
    const favorites =
      parsed.favorites &&
      typeof parsed.favorites === "object" &&
      !Array.isArray(parsed.favorites)
        ? parsed.favorites
        : {};
    const ticketCaches = Object.fromEntries(
      Object.entries(parsed.ticketCaches ?? {}).flatMap(([tenantId, value]) => {
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          !Number.isInteger((value as TicketCacheDescriptor).chunks) ||
          (value as TicketCacheDescriptor).chunks < 1 ||
          (value as TicketCacheDescriptor).chunks > MAX_TICKET_CACHE_CHUNKS ||
          typeof (value as TicketCacheDescriptor).cachedAt !== "string" ||
          Number.isNaN(Date.parse((value as TicketCacheDescriptor).cachedAt))
        ) {
          return [];
        }
        return [[tenantId, value as TicketCacheDescriptor]];
      }),
    );
    return {
      deviceProtection:
        typeof parsed.deviceProtection === "boolean"
          ? parsed.deviceProtection
          : undefined,
      drafts,
      favorites,
      ticketCaches,
    };
  } catch {
    return { ...EMPTY_STATE, drafts: {}, favorites: {}, ticketCaches: {} };
  }
}

async function readState(userId: string): Promise<PrivateState> {
  return parseState(await mobileSecureStorage.getItem(stateKey(userId)));
}

async function writeState(userId: string, state: PrivateState): Promise<void> {
  await mobileSecureStorage.setItem(stateKey(userId), JSON.stringify(state));
}

async function removeTicketCacheChunks(
  userId: string,
  tenantId: string,
  chunks: number,
): Promise<void> {
  await Promise.all(
    Array.from({ length: chunks }, (_, index) =>
      mobileSecureStorage.removeItem(
        ticketCacheChunkKey(userId, tenantId, index),
      ),
    ),
  );
}

async function removeMobileUserPrivateState(userId: string): Promise<void> {
  const state = await readState(userId);
  await Promise.all([
    mobileSecureStorage.removeItem(stateKey(userId)),
    mobileSecureStorage.removeItem(tenantKey(userId)),
    ...Object.entries(state.ticketCaches).map(([tenantId, descriptor]) =>
      removeTicketCacheChunks(userId, tenantId, descriptor.chunks),
    ),
  ]);
}

/**
 * Keeps a small, encrypted device-only working state. It stores only draft text
 * and opaque ticket IDs; no ticket history, assets, contact records or secrets
 * are retained outside the server.
 */
export async function prepareMobileUserContext(userId: string): Promise<void> {
  const previousUserId = await mobileSecureStorage.getItem(ACTIVE_USER_KEY);
  if (previousUserId && previousUserId !== userId) {
    await removeMobileUserPrivateState(previousUserId);
  }
  await mobileSecureStorage.setItem(ACTIVE_USER_KEY, userId);
}

export async function clearMobilePrivateState(userId?: string): Promise<void> {
  const activeUserId =
    userId ?? (await mobileSecureStorage.getItem(ACTIVE_USER_KEY));
  if (activeUserId) {
    await removeMobileUserPrivateState(activeUserId);
  }
  await mobileSecureStorage.removeItem(ACTIVE_USER_KEY);
}

/** Clears recoverable working data without ending the authenticated mobile session. */
export async function clearMobileWorkingData(userId: string): Promise<void> {
  const state = await readState(userId);
  state.drafts = {};
  state.favorites = {};
  await Promise.all(
    Object.entries(state.ticketCaches).map(([tenantId, descriptor]) =>
      removeTicketCacheChunks(userId, tenantId, descriptor.chunks),
    ),
  );
  state.ticketCaches = {};
  await writeState(userId, state);
}

export async function getSelectedTenantId(
  userId: string,
): Promise<string | null> {
  return mobileSecureStorage.getItem(tenantKey(userId));
}

export async function setSelectedTenantId(
  userId: string,
  tenantId: string,
): Promise<void> {
  await mobileSecureStorage.setItem(tenantKey(userId), tenantId);
}

export async function getDeviceProtectionPreference(
  userId: string,
): Promise<boolean> {
  const state = await readState(userId);
  return state.deviceProtection === true;
}

export async function setDeviceProtectionPreference(
  userId: string,
  enabled: boolean,
): Promise<void> {
  const state = await readState(userId);
  state.deviceProtection = enabled;
  await writeState(userId, state);
}

export async function loadLocalTicketDraft(input: {
  userId: string;
  tenantId: string;
  ticketId: string;
  visibility: LocalTicketDraft["visibility"];
}): Promise<LocalTicketDraft | null> {
  const state = await readState(input.userId);
  const draft =
    state.drafts[draftKey(input.tenantId, input.ticketId, input.visibility)];
  if (
    !draft ||
    draft.ticketId !== input.ticketId ||
    draft.visibility !== input.visibility
  ) {
    return null;
  }
  return draft;
}

export async function saveLocalTicketDraft(input: {
  userId: string;
  tenantId: string;
  ticketId: string;
  visibility: LocalTicketDraft["visibility"];
  body: string;
}): Promise<void> {
  const body = input.body.slice(0, 50_000);
  const state = await readState(input.userId);
  const key = draftKey(input.tenantId, input.ticketId, input.visibility);
  if (!body.trim()) {
    delete state.drafts[key];
    await writeState(input.userId, state);
    return;
  }

  const nextDraft: LocalTicketDraft = {
    body,
    ticketId: input.ticketId,
    updatedAt: new Date().toISOString(),
    visibility: input.visibility,
  };
  const entries = Object.entries({ ...state.drafts, [key]: nextDraft })
    .sort(([, left], [, right]) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )
    .slice(0, 24);
  state.drafts = Object.fromEntries(entries);
  await writeState(input.userId, state);
}

export async function clearLocalTicketDraft(input: {
  userId: string;
  tenantId: string;
  ticketId: string;
  visibility?: LocalTicketDraft["visibility"];
}): Promise<void> {
  const state = await readState(input.userId);
  for (const visibility of input.visibility
    ? [input.visibility]
    : (["internal", "external"] as const)) {
    delete state.drafts[draftKey(input.tenantId, input.ticketId, visibility)];
  }
  await writeState(input.userId, state);
}

export async function listFavoriteTicketIds(input: {
  userId: string;
  tenantId: string;
}): Promise<string[]> {
  const state = await readState(input.userId);
  return state.favorites[input.tenantId] ?? [];
}

export async function setFavoriteTicket(input: {
  userId: string;
  tenantId: string;
  ticketId: string;
  favorite: boolean;
}): Promise<string[]> {
  const state = await readState(input.userId);
  const existing = new Set(state.favorites[input.tenantId] ?? []);
  if (input.favorite) existing.add(input.ticketId);
  else existing.delete(input.ticketId);
  state.favorites[input.tenantId] = [...existing].slice(-100);
  await writeState(input.userId, state);
  return state.favorites[input.tenantId];
}

/** Removes ticket IDs that no longer appeared in an authorized server result. */
export async function reconcileFavoriteTicketIds(input: {
  userId: string;
  tenantId: string;
  authorizedTicketIds: Iterable<string>;
}): Promise<string[]> {
  const state = await readState(input.userId);
  const authorized = new Set(input.authorizedTicketIds);
  const next = (state.favorites[input.tenantId] ?? []).filter((id) =>
    authorized.has(id),
  );
  state.favorites[input.tenantId] = next;
  await writeState(input.userId, state);
  return next;
}

/**
 * Stores only compact ticket-list metadata in the native OS-encrypted store.
 * Ticket descriptions, conversations, attachments, requester data, assets and
 * knowledge content never enter this cache. Browser previews deliberately do
 * not persist it because their storage is not an encrypted device keychain.
 */
export async function saveOfflineTicketListCache(input: {
  userId: string;
  tenant: OfflineTicketListCache["tenant"];
  tickets: OfflineTicketListCache["tickets"];
}): Promise<void> {
  if (Platform.OS === "web") return;

  const cache: OfflineTicketListCache = {
    cachedAt: new Date().toISOString(),
    tenant: input.tenant,
    tickets: input.tickets.slice(0, 50),
  };
  const serialized = JSON.stringify(cache);
  const chunks = Array.from(
    { length: Math.ceil(serialized.length / TICKET_CACHE_CHUNK_SIZE) },
    (_, index) =>
      serialized.slice(
        index * TICKET_CACHE_CHUNK_SIZE,
        (index + 1) * TICKET_CACHE_CHUNK_SIZE,
      ),
  );
  if (chunks.length === 0 || chunks.length > MAX_TICKET_CACHE_CHUNKS) return;

  const state = await readState(input.userId);
  const previous = state.ticketCaches[input.tenant.id];
  await Promise.all(
    chunks.map((chunk, index) =>
      mobileSecureStorage.setItem(
        ticketCacheChunkKey(input.userId, input.tenant.id, index),
        chunk,
      ),
    ),
  );
  if (previous && previous.chunks > chunks.length) {
    await Promise.all(
      Array.from({ length: previous.chunks - chunks.length }, (_, offset) =>
        mobileSecureStorage.removeItem(
          ticketCacheChunkKey(
            input.userId,
            input.tenant.id,
            chunks.length + offset,
          ),
        ),
      ),
    );
  }
  state.ticketCaches[input.tenant.id] = {
    cachedAt: cache.cachedAt,
    chunks: chunks.length,
  };
  await writeState(input.userId, state);
}

export async function loadOfflineTicketListCache(input: {
  userId: string;
  tenantId: string;
}): Promise<OfflineTicketListCache | null> {
  if (Platform.OS === "web") return null;

  const state = await readState(input.userId);
  const descriptor = state.ticketCaches[input.tenantId];
  if (!descriptor) return null;

  const serialized = (
    await Promise.all(
      Array.from({ length: descriptor.chunks }, (_, index) =>
        mobileSecureStorage.getItem(
          ticketCacheChunkKey(input.userId, input.tenantId, index),
        ),
      ),
    )
  ).join("");
  try {
    const parsed = JSON.parse(serialized) as Partial<OfflineTicketListCache>;
    if (
      parsed.tenant?.id !== input.tenantId ||
      typeof parsed.tenant.name !== "string" ||
      typeof parsed.tenant.slug !== "string" ||
      typeof parsed.cachedAt !== "string" ||
      Number.isNaN(Date.parse(parsed.cachedAt)) ||
      !Array.isArray(parsed.tickets)
    ) {
      throw new Error("invalid_ticket_cache");
    }
    const cachedAtTimestamp = Date.parse(parsed.cachedAt);
    if (
      cachedAtTimestamp < Date.now() - MAX_TICKET_CACHE_AGE_MS ||
      cachedAtTimestamp > Date.now() + 5 * 60 * 1_000
    ) {
      throw new Error("expired_ticket_cache");
    }
    const tickets = parsed.tickets.filter(
      (ticket): ticket is OfflineTicketListCache["tickets"][number] =>
        typeof ticket === "object" &&
        ticket !== null &&
        typeof ticket.id === "string" &&
        typeof ticket.ticketNumber === "string" &&
        typeof ticket.subject === "string" &&
        typeof ticket.status === "string" &&
        typeof ticket.priority === "string" &&
        typeof ticket.resolved === "boolean" &&
        typeof ticket.assignedToCurrentUser === "boolean",
    );
    if (tickets.length !== parsed.tickets.length) {
      throw new Error("invalid_ticket_cache");
    }
    return {
      cachedAt: parsed.cachedAt,
      tenant: parsed.tenant,
      tickets,
    };
  } catch {
    await removeTicketCacheChunks(
      input.userId,
      input.tenantId,
      descriptor.chunks,
    );
    delete state.ticketCaches[input.tenantId];
    await writeState(input.userId, state);
    return null;
  }
}
