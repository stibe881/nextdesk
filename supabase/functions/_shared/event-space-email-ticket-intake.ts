import {
  type EventSpaceEmailIntake,
  eventSpaceEmailIntakeOrganizer,
  eventSpaceEmailIntakeSubject,
  parseEventSpaceEmailIntake,
} from "./event-space-email-intake.ts";

type Admin = any;

type IntakeInput = Readonly<{
  description: string;
  subject: string;
  tenantId: string;
  ticketId: string;
}>;

type OutboxInput = Pick<IntakeInput, "tenantId" | "ticketId">;

export type EventSpaceEmailTicketIntakeOutcome =
  | "failed"
  | "ignored"
  | "processed";

type Room = Readonly<{ id: string; name: string }>;

const STORED_EMAIL_TICKET_PREFIX =
  /^Eingegangene E-Mail von [^\r\n]{1,160}\r?\n\r?\n/u;

function normaliseRoomName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("de-CH");
}

function containsWholeRoomName(value: string, candidate: string): boolean {
  return ` ${value} `.includes(` ${candidate} `);
}

/**
 * Matches the exact room name first. A longer form value such as "A1 09 Aula"
 * may then match the single active room named "Aula". Any ambiguity remains a
 * clarification case; a partial text match never selects the first room.
 */
export function eventSpaceEmailIntakeMatchingRoomId(
  requestedSpaceText: unknown,
  rooms: readonly Room[],
): string | null {
  if (typeof requestedSpaceText !== "string") return null;
  const requested = normaliseRoomName(requestedSpaceText);
  if (!requested) return null;
  const validRooms = rooms.filter(
    (room) =>
      typeof room.id === "string" &&
      typeof room.name === "string" &&
      normaliseRoomName(room.name).length > 0,
  );
  const exact = validRooms.filter(
    (room) => normaliseRoomName(room.name) === requested,
  );
  if (exact.length === 1) return exact[0]!.id;
  if (exact.length > 1) return null;
  const identifiedByName = validRooms.filter((room) => {
    const roomName = normaliseRoomName(room.name);
    return roomName.length >= 4 && containsWholeRoomName(requested, roomName);
  });
  return identifiedByName.length === 1 ? identifiedByName[0]!.id : null;
}

function clarificationCodes(
  result: ReturnType<typeof parseEventSpaceEmailIntake>,
): string[] {
  return result.status === "needs_clarification"
    ? result.clarifications.map((item) => item.code)
    : [];
}

/**
 * Both supported e-mail ingress paths persist this bounded display-name prefix
 * before the original body. A manual recovery only accepts that known envelope;
 * it must never treat an edited arbitrary ticket description as intake input.
 */
export function eventSpaceEmailIntakeBodyFromStoredTicket(
  description: unknown,
): string | null {
  if (
    typeof description !== "string" ||
    description.length < 1 ||
    description.length > 50_000 ||
    !description.isWellFormed() ||
    description.includes("\u0000")
  ) {
    return null;
  }
  const match = STORED_EMAIL_TICKET_PREFIX.exec(description);
  if (!match) return null;
  const body = description.slice(match[0].length);
  return body.length >= 1 && body.length <= 48_000 ? body : null;
}

async function markOutbox(
  admin: Admin,
  input: OutboxInput,
  status: "failed" | "ignored",
  errorCode: string | null,
): Promise<void> {
  const { error } = await admin
    .from("event_space_ticket_intake_outbox")
    .update({
      status,
      last_error_code: errorCode,
      processed_at: null,
      retry_lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("ticket_id", input.ticketId)
    .eq("tenant_id", input.tenantId)
    .in("status", ["pending", "failed", "retrying"]);
  if (error) throw new Error("event_space_intake_outbox_update_failed");
}

/**
 * A recovery error remains private to the optional intake. This helper is also
 * used when a stored ticket no longer has the original ingress envelope.
 */
export async function failEventSpaceEmailTicketIntake(
  admin: Admin,
  input: OutboxInput,
  errorCode: string,
): Promise<void> {
  try {
    await markOutbox(admin, input, "failed", errorCode);
  } catch {
    // The source ticket has already committed. Never turn optional intake
    // bookkeeping into a failed e-mail delivery or recovery response.
  }
}

async function matchingRoomId(
  admin: Admin,
  tenantId: string,
  requestedSpaceText: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("event_spaces")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("active", true);
  if (error) throw new Error("event_space_lookup_failed");
  return eventSpaceEmailIntakeMatchingRoomId(requestedSpaceText, data ?? []);
}

function rpcPayload(
  input: IntakeInput,
  request: EventSpaceEmailIntake | null,
  extraClarifications: readonly string[],
) {
  const subject = eventSpaceEmailIntakeSubject(input.subject);
  if (!subject) return null;
  const requirements = request?.requirements;
  return {
    p_tenant_id: input.tenantId,
    p_ticket_id: input.ticketId,
    p_order_number: subject.sourceOrderNumber,
    p_title: subject.title,
    p_organizer: request?.organiser ??
      eventSpaceEmailIntakeOrganizer(input.description),
    p_space_id: null as string | null,
    p_requested_space_text: request?.requestedSpaceText ?? null,
    p_starts_at: request?.startAt ?? null,
    p_ends_at: request?.endAt ?? null,
    p_equipment_keys: request?.equipmentKeys ?? [],
    p_room_reservation_requested: requirements?.roomReservation ?? false,
    p_ict_material_requested: requirements?.ictMaterial ?? false,
    p_internet_access_requested: requirements?.internetAccess ?? false,
    p_sobe_network_access_requested: requirements?.sobeNetworkAccess ?? false,
    p_reception_laptop_requested: requirements?.receptionLaptop ?? false,
    p_remarks: request?.notes ?? null,
    p_sharepoint_url: request?.orderUrl ?? null,
    p_phone_number: request?.contactPhone ?? null,
    p_clarification_reasons: [...extraClarifications],
  };
}

/**
 * A room plan replaces its e-mail ticket. Removal is best effort: if it fails
 * the plan still exists and the ticket merely stays visible.
 */
async function removeSourceTicket(
  admin: Admin,
  input: OutboxInput,
): Promise<void> {
  try {
    await admin
      .from("tickets")
      .delete()
      .eq("id", input.ticketId)
      .eq("tenant_id", input.tenantId);
  } catch {
    // Never turn optional cleanup into a failed e-mail delivery.
  }
}

/**
 * Runs synchronously after a new email ticket has committed. All failures are
 * isolated from ticket delivery and retained in the private outbox for an
 * explicit later retry; this helper never introduces a scheduler or logs mail
 * data. The database operation remains the final idempotency and conflict lock.
 */
export async function processEventSpaceEmailTicketIntake(
  admin: Admin,
  input: IntakeInput,
): Promise<EventSpaceEmailTicketIntakeOutcome> {
  try {
    const subject = eventSpaceEmailIntakeSubject(input.subject);
    if (!subject) {
      await markOutbox(admin, input, "ignored", null);
      return "ignored";
    }
    const parsed = parseEventSpaceEmailIntake({
      subject: input.subject,
      description: input.description,
    });
    const request = parsed.status === "ready" ? parsed.request : null;
    const extraClarifications = clarificationCodes(parsed);
    const payload = rpcPayload(input, request, extraClarifications);
    if (!payload) {
      await markOutbox(admin, input, "ignored", null);
      return "ignored";
    }

    if (request) {
      const roomId = await matchingRoomId(
        admin,
        input.tenantId,
        request.requestedSpaceText,
      );
      payload.p_space_id = roomId;
    }

    const { error } = await admin.rpc(
      "create_event_space_email_ticket_request",
      payload,
    );
    if (error) throw new Error("event_space_intake_persist_failed");
    await removeSourceTicket(admin, input);
    return "processed";
  } catch {
    await failEventSpaceEmailTicketIntake(
      admin,
      input,
      "event_space_intake_failed",
    );
    return "failed";
  }
}
