import { mobileSecureStorage } from "@/lib/mobile-secure-storage";

const ACTIVE_USER_KEY = "nextdesk:mobile:active-user:v1";
const tenantKey = (userId: string) => `nextdesk:mobile:tenant:v1:${userId}`;
const stateKey = (userId: string) =>
  `nextdesk:mobile:private-state:v1:${userId}`;

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
};

const EMPTY_STATE: PrivateState = { drafts: {}, favorites: {} };

function draftKey(
  tenantId: string,
  ticketId: string,
  visibility: LocalTicketDraft["visibility"],
) {
  return `${tenantId}:${ticketId}:${visibility}`;
}

function parseState(value: string | null): PrivateState {
  if (!value) return { ...EMPTY_STATE, drafts: {}, favorites: {} };
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
    return {
      deviceProtection:
        typeof parsed.deviceProtection === "boolean"
          ? parsed.deviceProtection
          : undefined,
      drafts,
      favorites,
    };
  } catch {
    return { ...EMPTY_STATE, drafts: {}, favorites: {} };
  }
}

async function readState(userId: string): Promise<PrivateState> {
  return parseState(await mobileSecureStorage.getItem(stateKey(userId)));
}

async function writeState(userId: string, state: PrivateState): Promise<void> {
  await mobileSecureStorage.setItem(stateKey(userId), JSON.stringify(state));
}

/**
 * Keeps a small, encrypted device-only working state. It stores only draft text
 * and opaque ticket IDs; no ticket history, assets, contact records or secrets
 * are retained outside the server.
 */
export async function prepareMobileUserContext(userId: string): Promise<void> {
  const previousUserId = await mobileSecureStorage.getItem(ACTIVE_USER_KEY);
  if (previousUserId && previousUserId !== userId) {
    await Promise.all([
      mobileSecureStorage.removeItem(stateKey(previousUserId)),
      mobileSecureStorage.removeItem(tenantKey(previousUserId)),
    ]);
  }
  await mobileSecureStorage.setItem(ACTIVE_USER_KEY, userId);
}

export async function clearMobilePrivateState(userId?: string): Promise<void> {
  const activeUserId =
    userId ?? (await mobileSecureStorage.getItem(ACTIVE_USER_KEY));
  if (activeUserId) {
    await Promise.all([
      mobileSecureStorage.removeItem(stateKey(activeUserId)),
      mobileSecureStorage.removeItem(tenantKey(activeUserId)),
    ]);
  }
  await mobileSecureStorage.removeItem(ACTIVE_USER_KEY);
}

/** Clears recoverable working data without ending the authenticated mobile session. */
export async function clearMobileWorkingData(userId: string): Promise<void> {
  const state = await readState(userId);
  state.drafts = {};
  state.favorites = {};
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
