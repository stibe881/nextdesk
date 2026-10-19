import { withSupabase } from "@supabase/server";

const ORIGIN = "https://app.nextdesk.ch";
// Historic requester contacts were deterministically backfilled from MD5 values
// in migration 0023. PostgreSQL stores them as valid UUIDs even when their
// version/variant nibbles are not RFC-generated, so accept canonical UUID text.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAILBOX =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

type Action =
  | { type: "getOwn"; tenantId: string }
  | { type: "getProfile"; tenantId: string; requesterContactId: string }
  | { type: "listProfiles"; tenantId: string }
  | ({
      type: "saveProfile";
      tenantId: string;
      requesterContactId: string;
    } & ProfileInput)
  | { type: "search"; tenantId: string; query: string }
  | {
      type: "create";
      tenantId: string;
      displayName: string;
      email: string | null;
    }
  | {
      type: "assign";
      tenantId: string;
      ticketId: string;
      requesterContactId: string;
    };

type Contact = { id: string; displayName: string; userId: string | null };
type EntraDirectoryPerson = {
  email: string;
  display_name: string;
  local_user_id: string | null;
};
const CONTACT_CHANNELS = ["email", "phone", "portal", "chat", "sms"] as const;
type ContactChannel = (typeof CONTACT_CHANNELS)[number];
type ProfileInput = {
  location: string | null;
  department: string | null;
  language: string | null;
  preferredContactChannel: ContactChannel | null;
  importantNote: string | null;
};
type RequesterProfile = ProfileInput & { requesterContactId: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
function shortText(value: unknown, min: number, max: number): string | null {
  if (
    typeof value !== "string" ||
    value.includes("\u0000") ||
    /\p{Cs}/u.test(value)
  )
    return null;
  const result = value.trim();
  return [...result].length >= min && [...result].length <= max ? result : null;
}
function profileText(value: unknown, max: number): string | null | false {
  if (value === null) return null;
  if (typeof value !== "string" || /\p{Cc}|\p{Cs}/u.test(value)) return false;
  const result = value.trim();
  return result && [...result].length <= max ? result : false;
}
function profileLanguage(value: unknown): string | null | false {
  const text = profileText(value, 35);
  if (text === null || text === false) return text;
  const normalized = text.toLowerCase();
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(normalized)
    ? normalized
    : false;
}
function contactChannel(value: unknown): ContactChannel | null | false {
  const text = profileText(value, 16);
  if (text === null || text === false) return text;
  const normalized = text.toLowerCase();
  return (CONTACT_CHANNELS as readonly string[]).includes(normalized)
    ? (normalized as ContactChannel)
    : false;
}
function profileInput(value: Record<string, unknown>): ProfileInput | null {
  const location = profileText(value.location, 120);
  const department = profileText(value.department, 120);
  const language = profileLanguage(value.language);
  const preferredContactChannel = contactChannel(value.preferredContactChannel);
  const importantNote = profileText(value.importantNote, 2000);
  if (
    location === false ||
    department === false ||
    language === false ||
    preferredContactChannel === false ||
    importantNote === false
  )
    return null;
  return {
    location,
    department,
    language,
    preferredContactChannel,
    importantNote,
  };
}
function email(value: unknown): string | null | false {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || /[\r\n\t]/.test(value)) return false;
  const result = value.trim().toLowerCase();
  return result.length <= 254 && MAILBOX.test(result) ? result : false;
}
function parse(value: unknown): Action | null {
  if (!record(value) || !uuid(value.tenantId) || typeof value.type !== "string")
    return null;
  if (value.type === "getOwn")
    return { type: value.type, tenantId: value.tenantId };
  if (value.type === "getProfile" && uuid(value.requesterContactId))
    return {
      type: value.type,
      tenantId: value.tenantId,
      requesterContactId: value.requesterContactId,
    };
  if (value.type === "listProfiles")
    return { type: value.type, tenantId: value.tenantId };
  if (value.type === "saveProfile" && uuid(value.requesterContactId)) {
    const profile = profileInput(value);
    return profile
      ? {
          type: value.type,
          tenantId: value.tenantId,
          requesterContactId: value.requesterContactId,
          ...profile,
        }
      : null;
  }
  if (value.type === "search") {
    const query = shortText(value.query, 2, 120);
    return query ? { type: value.type, tenantId: value.tenantId, query } : null;
  }
  if (value.type === "create") {
    const displayName = shortText(value.displayName, 2, 160);
    const normalizedEmail = email(value.email);
    return displayName && normalizedEmail !== false
      ? {
          type: value.type,
          tenantId: value.tenantId,
          displayName,
          email: normalizedEmail,
        }
      : null;
  }
  if (
    value.type === "assign" &&
    uuid(value.ticketId) &&
    uuid(value.requesterContactId)
  )
    return {
      type: value.type,
      tenantId: value.tenantId,
      ticketId: value.ticketId,
      requesterContactId: value.requesterContactId,
    };
  return null;
}
function cors(request: Request) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Vary: "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  if (request.headers.get("origin") === ORIGIN) {
    headers.set("Access-Control-Allow-Origin", ORIGIN);
    headers.set(
      "Access-Control-Allow-Headers",
      "authorization, apikey, content-type, x-client-info",
    );
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return headers;
}
function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors(request) });
}
function fail(request: Request, code: string, status: number) {
  return json(request, { error: { code } }, status);
}
function cleanName(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && !text.includes("@") ? text.slice(0, 160) : "Anfragende Person";
}
function contact(row: any): Contact | null {
  return uuid(row?.id)
    ? {
        id: row.id,
        displayName: cleanName(row.display_name),
        userId: uuid(row.user_id) ? row.user_id : null,
      }
    : null;
}
function requesterProfile(row: any): RequesterProfile | null {
  if (!uuid(row?.requester_id)) return null;
  const profile = profileInput({
    location: row.location ?? null,
    department: row.department ?? null,
    language: row.language ?? null,
    preferredContactChannel: row.preferred_contact_channel ?? null,
    importantNote: row.important_note ?? null,
  });
  return profile ? { requesterContactId: row.requester_id, ...profile } : null;
}
function escapeLike(value: string) {
  return value.replace(/[\\%_(),]/g, "\\$&");
}

async function listMatchingActiveMemberProfiles(
  admin: any,
  tenantId: string,
  needle: string,
): Promise<{
  profiles: Array<{ id: string; display_name: string }>;
  error: boolean;
}> {
  const profiles: Array<{ id: string; display_name: string }> = [];
  let afterUserId: string | null = null;
  const pageSize = 500;

  while (true) {
    let membershipsQuery = admin
      .from("tenant_memberships")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("user_id", { ascending: true })
      .limit(pageSize);
    if (afterUserId)
      membershipsQuery = membershipsQuery.gt("user_id", afterUserId);
    const { data: memberships, error: membershipsError } =
      await membershipsQuery;
    if (membershipsError) return { profiles: [], error: true };

    const memberIds = (memberships ?? [])
      .map((membership: any) => membership.user_id)
      .filter(uuid);
    if (memberIds.length > 0) {
      const { data, error } = await admin
        .from("user_profiles")
        .select("id,display_name")
        .in("id", memberIds)
        .ilike("display_name", `%${needle}%`)
        .order("display_name")
        .limit(30);
      if (error) return { profiles: [], error: true };
      for (const profile of data ?? []) {
        if (
          uuid(profile?.id) &&
          typeof profile.display_name === "string" &&
          Boolean(profile.display_name.trim())
        ) {
          profiles.push({ id: profile.id, display_name: profile.display_name });
        }
      }
    }

    const page = memberships ?? [];
    if (page.length < pageSize) break;
    const lastUserId = page[page.length - 1]?.user_id;
    if (!uuid(lastUserId)) return { profiles: [], error: true };
    afterUserId = lastUserId;
  }

  return { profiles: profiles.slice(0, 30), error: false };
}

async function member(admin: any, tenantId: string, actorId: string) {
  const { data, error } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .eq("status", "active")
    .maybeSingle();
  return error ? null : Boolean(data);
}
async function canManage(client: any, tenantId: string) {
  const { data, error } = await client.rpc("can_manage_ticket_requesters", {
    p_tenant_id: tenantId,
  });
  return error ? null : data === true;
}
async function requesterExists(
  client: any,
  tenantId: string,
  requesterContactId: string,
) {
  const { data, error } = await client
    .from("ticket_requesters")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", requesterContactId)
    .maybeSingle();
  return error ? null : Boolean(data);
}

/**
 * Liefert Suchtreffer aus bestehenden Kontakten sowie aktiven Mitgliedern und
 * Entra-Verzeichnispersonen des aktuellen Mandanten. Für einen echten Treffer
 * wird bei Bedarf ein gebundener Anfragendenkontakt erstellt. Das macht die
 * Person für die Ticketerfassung auswählbar, ohne irgendeine Agentenrolle zu
 * vergeben.
 */
async function searchRequestersIncludingActiveMembers(
  admin: any,
  tenantId: string,
  query: string,
): Promise<{ contacts: Contact[]; error: boolean }> {
  const needle = escapeLike(query);
  const [contactResult, directoryResult, memberProfilesResult] =
    await Promise.all([
      admin
        .from("ticket_requesters")
        .select("id,display_name,email,user_id")
        .eq("tenant_id", tenantId)
        .or(`display_name.ilike.%${needle}%,email.ilike.%${needle}%`)
        .order("display_name")
        .limit(30),
      admin
        .from("tenant_entra_directory_people")
        .select("email,display_name,local_user_id")
        .eq("tenant_id", tenantId)
        .eq("account_enabled", true)
        .is("inactive_at", null)
        .or(`display_name.ilike.%${needle}%,email.ilike.%${needle}%`)
        .order("display_name")
        .limit(30),
      listMatchingActiveMemberProfiles(admin, tenantId, needle),
    ]);
  if (
    contactResult.error ||
    directoryResult.error ||
    memberProfilesResult.error
  ) {
    return { contacts: [], error: true };
  }

  const matchedProfiles = memberProfilesResult.profiles;
  const profileIds = matchedProfiles.map((profile: any) => profile.id);
  const profileContactResult = profileIds.length
    ? await admin
        .from("ticket_requesters")
        .select("id,display_name,user_id")
        .eq("tenant_id", tenantId)
        .in("user_id", profileIds)
    : { data: [], error: null };
  if (profileContactResult.error) return { contacts: [], error: true };

  const contactsByUserId = new Map<string, Contact>();
  for (const row of profileContactResult.data ?? []) {
    const value = contact(row);
    if (value?.userId) contactsByUserId.set(value.userId, value);
  }

  for (const profile of matchedProfiles) {
    if (contactsByUserId.has(profile.id)) continue;
    const { data: requesterContactId, error } = await admin.rpc(
      "ensure_ticket_user_requester",
      {
        p_tenant_id: tenantId,
        p_user_id: profile.id,
        p_source: "manual",
      },
    );
    if (error || !uuid(requesterContactId)) {
      return { contacts: [], error: true };
    }
    contactsByUserId.set(profile.id, {
      id: requesterContactId,
      displayName: cleanName(profile.display_name),
      userId: profile.id,
    });
  }

  const contactsByDirectoryKey = new Map<string, Contact>();
  for (const row of contactResult.data ?? []) {
    const value = contact(row);
    if (!value) continue;
    if (value.userId) contactsByDirectoryKey.set(`user:${value.userId}`, value);
    if (typeof row.email === "string") {
      contactsByDirectoryKey.set(`email:${row.email.toLowerCase()}`, value);
    }
  }
  for (const [userId, requester] of contactsByUserId) {
    contactsByDirectoryKey.set(`user:${userId}`, requester);
  }
  const discardedContactIds = new Set<string>();
  for (const person of (directoryResult.data ?? []) as EntraDirectoryPerson[]) {
    const displayName = cleanName(person.display_name);
    const normalizedEmail = email(person.email);
    if (
      displayName === "Anfragende Person" ||
      typeof normalizedEmail !== "string"
    ) {
      continue;
    }
    const userKey = uuid(person.local_user_id)
      ? `user:${person.local_user_id}`
      : null;
    const emailKey = `email:${normalizedEmail}`;
    const emailRequester = contactsByDirectoryKey.get(emailKey) ?? null;
    const userRequester = userKey
      ? (contactsByDirectoryKey.get(userKey) ?? null)
      : null;
    let requester = emailRequester ?? userRequester;

    // A materialised Entra contact keeps its e-mail identity while a historic
    // portal contact keeps its immutable user binding. Prefer the Entra contact
    // for the picker and never present both as separate people.
    if (
      emailRequester &&
      userRequester &&
      emailRequester.id !== userRequester.id
    ) {
      discardedContactIds.add(userRequester.id);
    }

    if (!requester) {
      const { data: created, error } = await admin
        .from("ticket_requesters")
        .insert({
          tenant_id: tenantId,
          display_name: displayName,
          email: normalizedEmail,
          user_id: uuid(person.local_user_id) ? person.local_user_id : null,
          source: "entra",
        })
        .select("id,display_name,user_id")
        .single();
      requester = !error ? contact(created) : null;
      if (error?.code === "23505") {
        const byEmail = await admin
          .from("ticket_requesters")
          .select("id,display_name,user_id")
          .eq("tenant_id", tenantId)
          .eq("email", normalizedEmail)
          .maybeSingle();
        if (byEmail.error) return { contacts: [], error: true };
        requester = contact(byEmail.data);
        if (!requester && uuid(person.local_user_id)) {
          const byUser = await admin
            .from("ticket_requesters")
            .select("id,display_name,user_id")
            .eq("tenant_id", tenantId)
            .eq("user_id", person.local_user_id)
            .maybeSingle();
          if (byUser.error) return { contacts: [], error: true };
          requester = contact(byUser.data);
        }
      }
    }
    if (!requester) return { contacts: [], error: true };
    contactsByDirectoryKey.set(emailKey, requester);
    if (userKey) contactsByDirectoryKey.set(userKey, requester);
  }

  const contactsById = new Map<string, Contact>();
  for (const row of contactResult.data ?? []) {
    const value = contact(row);
    if (value && !discardedContactIds.has(value.id)) {
      contactsById.set(value.id, value);
    }
  }
  for (const value of contactsByUserId.values()) {
    if (!discardedContactIds.has(value.id)) contactsById.set(value.id, value);
  }
  for (const value of contactsByDirectoryKey.values()) {
    if (!discardedContactIds.has(value.id)) contactsById.set(value.id, value);
  }
  const contacts = [...contactsById.values()]
    .sort(
      (left, right) =>
        left.displayName.localeCompare(right.displayName, "de-CH") ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 30);
  return { contacts, error: false };
}
async function ensureOwn(
  client: any,
  admin: any,
  tenantId: string,
  actorId: string,
): Promise<{ value: Contact | null; error: boolean }> {
  const existing = await client
    .from("ticket_requesters")
    .select("id,display_name,user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .maybeSingle();
  if (existing.error) return { value: null, error: true };
  const found = contact(existing.data);
  if (found) return { value: found, error: false };
  const profile = await admin
    .from("user_profiles")
    .select("display_name")
    .eq("id", actorId)
    .maybeSingle();
  if (profile.error) return { value: null, error: true };
  const created = await client
    .from("ticket_requesters")
    .insert({
      tenant_id: tenantId,
      user_id: actorId,
      display_name: cleanName(profile.data?.display_name),
      source: "portal",
    })
    .select("id,display_name,user_id")
    .maybeSingle();
  if (created.data) return { value: contact(created.data), error: false };
  if (created.error?.code !== "23505") return { value: null, error: true };
  const raced = await client
    .from("ticket_requesters")
    .select("id,display_name,user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", actorId)
    .maybeSingle();
  return {
    value: contact(raced.data),
    error: Boolean(raced.error) || !contact(raced.data),
  };
}

const handler = withSupabase({ auth: "user" }, async (request, context) => {
  if (request.method !== "POST")
    return fail(request, "method_not_allowed", 405);
  const action = parse(await request.json().catch(() => null));
  const actorId = context.userClaims?.id;
  if (!action || !uuid(actorId)) return fail(request, "invalid_request", 422);
  const active = await member(context.supabaseAdmin, action.tenantId, actorId);
  if (active === null) return fail(request, "authorization_check_failed", 500);
  if (!active) return fail(request, "tenant_membership_required", 403);

  if (action.type === "getOwn") {
    const own = await ensureOwn(
      context.supabase,
      context.supabaseAdmin,
      action.tenantId,
      actorId,
    );
    return own.error || !own.value
      ? fail(request, "requester_unavailable", 500)
      : json(request, {
          data: {
            requester: { id: own.value.id, displayName: own.value.displayName },
          },
        });
  }

  const managed = await canManage(context.supabase, action.tenantId);
  if (managed === null) return fail(request, "authorization_check_failed", 500);
  if (!managed) return fail(request, "requester_manage_denied", 403);

  if (action.type === "getProfile") {
    const exists = await requesterExists(
      context.supabase,
      action.tenantId,
      action.requesterContactId,
    );
    if (exists === null) return fail(request, "requester_profile_failed", 500);
    if (!exists) return fail(request, "requester_not_found", 404);
    const { data, error } = await context.supabase
      .from("ticket_requester_profiles")
      .select(
        "requester_id,location,department,language,preferred_contact_channel,important_note",
      )
      .eq("tenant_id", action.tenantId)
      .eq("requester_id", action.requesterContactId)
      .maybeSingle();
    if (error) return fail(request, "requester_profile_failed", 500);
    const profile = data ? requesterProfile(data) : null;
    return profile || !data
      ? json(request, { data: { profile } })
      : fail(request, "requester_profile_failed", 500);
  }

  if (action.type === "listProfiles") {
    const { data, error } = await context.supabase
      .from("ticket_requester_profiles")
      .select(
        "requester_id,location,department,language,preferred_contact_channel,important_note",
      )
      .eq("tenant_id", action.tenantId)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) return fail(request, "requester_profiles_list_failed", 500);
    const profiles = (data ?? [])
      .map(requesterProfile)
      .filter((entry): entry is RequesterProfile => entry !== null);
    return json(request, { data: { profiles } });
  }

  if (action.type === "saveProfile") {
    const exists = await requesterExists(
      context.supabase,
      action.tenantId,
      action.requesterContactId,
    );
    if (exists === null)
      return fail(request, "requester_profile_save_failed", 500);
    if (!exists) return fail(request, "requester_not_found", 404);
    const { data, error } = await context.supabase
      .from("ticket_requester_profiles")
      .upsert(
        {
          tenant_id: action.tenantId,
          requester_id: action.requesterContactId,
          location: action.location,
          department: action.department,
          language: action.language,
          preferred_contact_channel: action.preferredContactChannel,
          important_note: action.importantNote,
        },
        { onConflict: "requester_id" },
      )
      .select(
        "requester_id,location,department,language,preferred_contact_channel,important_note",
      )
      .maybeSingle();
    const profile = requesterProfile(data);
    if (error || !profile)
      return fail(request, "requester_profile_save_failed", 422);
    return json(request, { data: { profile } });
  }

  if (action.type === "search") {
    const result = await searchRequestersIncludingActiveMembers(
      context.supabaseAdmin,
      action.tenantId,
      action.query,
    );
    if (result.error) return fail(request, "requester_search_failed", 500);
    const requesters = result.contacts.map(({ id, displayName }) => ({
      id,
      displayName,
    }));
    return json(request, { data: { requesters } });
  }

  if (action.type === "create") {
    if (action.email) {
      const existing = await context.supabase
        .from("ticket_requesters")
        .select("id,display_name,user_id")
        .eq("tenant_id", action.tenantId)
        .eq("email", action.email)
        .maybeSingle();
      if (existing.error) return fail(request, "requester_create_failed", 500);
      const found = contact(existing.data);
      if (found)
        return json(request, {
          data: { requester: { id: found.id, displayName: found.displayName } },
        });
    }
    const created = await context.supabase
      .from("ticket_requesters")
      .insert({
        tenant_id: action.tenantId,
        display_name: action.displayName,
        email: action.email,
        source: "manual",
      })
      .select("id,display_name,user_id")
      .maybeSingle();
    const value = contact(created.data);
    if (value)
      return json(
        request,
        {
          data: { requester: { id: value.id, displayName: value.displayName } },
        },
        201,
      );
    if (created.error?.code === "23505" && action.email) {
      const raced = await context.supabase
        .from("ticket_requesters")
        .select("id,display_name,user_id")
        .eq("tenant_id", action.tenantId)
        .eq("email", action.email)
        .maybeSingle();
      const found = contact(raced.data);
      if (found)
        return json(request, {
          data: { requester: { id: found.id, displayName: found.displayName } },
        });
    }
    return fail(request, "requester_create_failed", 422);
  }

  const [ticketResult, requesterResult] = await Promise.all([
    context.supabaseAdmin
      .from("tickets")
      .select("id,tenant_id,department_id,requester_id,requester_contact_id")
      .eq("id", action.ticketId)
      .eq("tenant_id", action.tenantId)
      .maybeSingle(),
    context.supabaseAdmin
      .from("ticket_requesters")
      .select("id,tenant_id,user_id,display_name")
      .eq("id", action.requesterContactId)
      .eq("tenant_id", action.tenantId)
      .maybeSingle(),
  ]);
  if (ticketResult.error || requesterResult.error)
    return fail(request, "requester_assignment_failed", 500);
  const ticket = ticketResult.data;
  const requester = contact(requesterResult.data);
  if (!ticket || !requester)
    return fail(request, "requester_or_ticket_not_found", 404);
  const { data: allowed, error: permissionError } = await context.supabase.rpc(
    "has_ticket_permission",
    {
      p_tenant_id: action.tenantId,
      p_department_id: ticket.department_id,
      p_permission_code: "ticket.update",
    },
  );
  if (permissionError) return fail(request, "authorization_check_failed", 500);
  if (allowed !== true)
    return fail(request, "requester_assignment_denied", 403);
  const update: Record<string, unknown> = {
    requester_contact_id: requester.id,
  };
  if (requester.userId) update.requester_id = requester.userId;
  const { error } = await context.supabaseAdmin
    .from("tickets")
    .update(update)
    .eq("id", ticket.id)
    .eq("tenant_id", action.tenantId);
  if (error) return fail(request, "requester_assignment_failed", 422);
  return json(request, {
    data: {
      requester: { id: requester.id, displayName: requester.displayName },
    },
  });
});

export default {
  fetch(request: Request): Response | Promise<Response> {
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ORIGIN)
      return fail(request, "origin_not_allowed", 403);
    if (request.method === "OPTIONS")
      return origin === ORIGIN
        ? new Response(null, { status: 204, headers: cors(request) })
        : fail(request, "origin_not_allowed", 403);
    return handler(request);
  },
};
