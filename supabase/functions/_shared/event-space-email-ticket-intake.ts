import {
  type EventSpaceEmailIntake,
  eventSpaceEmailIntakeOrganizer,
  eventSpaceEmailIntakeSubject,
  parseEventSpaceEmailIntake,
} from "./event-space-email-intake.ts";
import {
  EVENT_ORDER_NUMBER_PREFIX,
  type EventOrder,
  eventOrderIntakeInput,
  eventOrderSubjectTitle,
  parseEventOrderPdf,
  parseEventOrderText,
} from "./event-space-pdf-intake.ts";
import { extractPdfTextItems } from "./onboarding-pdf-text.ts";

type Admin = any;

type PdfAttachment = Readonly<{
  bytes: Uint8Array;
  contentType: string;
}>;

type IntakeInput = Readonly<{
  description: string;
  subject: string;
  tenantId: string;
  ticketId: string;
  /**
   * Anhänge der Mail. Bestellungen der Anlässe-App tragen ihre Angaben im PDF
   * «Anlassdetails». Fehlt die Liste (manuelle Wiederholung), werden die PDFs
   * des Tickets aus dem Speicher gelesen.
   */
  attachments?: readonly PdfAttachment[];
  /** Anzeigename der absendenden Person (Organisator bei PDF-Bestellungen). */
  senderName?: string | null;
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
  const matched = eventSpaceEmailIntakeMatchingRoomId(
    requestedSpaceText,
    data ?? [],
  );
  if (matched) return matched;
  return await createRoomFromRequestedText(admin, tenantId, requestedSpaceText);
}

/**
 * An unknown room named in the form is created instead of leaving the request
 * unresolved. Only a clearly unmatched, non-empty name is created; an
 * ambiguous match (several rooms fit) stays a clarification case.
 */
async function createRoomFromRequestedText(
  admin: Admin,
  tenantId: string,
  requestedSpaceText: string,
): Promise<string | null> {
  const name = requestedSpaceText.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (name.length < 2 || name.length > 160) return null;
  const { data: rooms, error: roomsError } = await admin
    .from("event_spaces")
    .select("id, name")
    .eq("tenant_id", tenantId);
  if (roomsError) throw new Error("event_space_lookup_failed");
  const requested = normaliseRoomName(name);
  const similar = (rooms ?? []).some((room: Room) => {
    const existing = normaliseRoomName(room.name);
    return (
      existing === requested ||
      (existing.length >= 4 && containsWholeRoomName(requested, existing))
    );
  });
  // Existing (possibly inactive or ambiguous) rooms are never duplicated.
  if (similar) return null;
  // event_spaces.created_by must be an active member of the tenant.
  const { data: member, error: memberError } = await admin
    .from("tenant_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (memberError || !member?.user_id) return null;
  const { data: created, error: createError } = await admin
    .from("event_spaces")
    .insert({
      tenant_id: tenantId,
      name,
      kind: requested.includes("aula") ? "event_room" : "meeting_room",
      created_by: member.user_id,
    })
    .select("id")
    .single();
  if (createError || !created?.id) return null;
  return String(created.id);
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
const MAX_ORDER_PDFS = 3;
const MAX_ORDER_PDF_BYTES = 5 * 1024 * 1024;

async function storedTicketPdfs(
  admin: Admin,
  input: OutboxInput,
): Promise<PdfAttachment[]> {
  const { data } = await admin
    .from("ticket_attachments")
    .select("storage_bucket, storage_object_path, content_type, byte_size")
    .eq("tenant_id", input.tenantId)
    .eq("ticket_id", input.ticketId)
    .eq("content_type", "application/pdf")
    .lte("byte_size", MAX_ORDER_PDF_BYTES)
    .limit(MAX_ORDER_PDFS);
  const pdfs: PdfAttachment[] = [];
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    if (
      typeof row.storage_bucket !== "string" ||
      typeof row.storage_object_path !== "string"
    ) continue;
    const download = await admin.storage
      .from(row.storage_bucket)
      .download(row.storage_object_path);
    if (download.error || !download.data) continue;
    pdfs.push({
      bytes: new Uint8Array(await download.data.arrayBuffer()),
      contentType: "application/pdf",
    });
  }
  return pdfs;
}

/** Erstes PDF «Anlassdetails» der Anlässe-App unter den Anhängen. */
async function eventOrderFromPdfs(
  attachments: readonly PdfAttachment[],
): Promise<EventOrder | null> {
  const pdfs = attachments
    .filter(
      (attachment) =>
        attachment.contentType === "application/pdf" &&
        attachment.bytes.byteLength > 0 &&
        attachment.bytes.byteLength <= MAX_ORDER_PDF_BYTES,
    )
    .slice(0, MAX_ORDER_PDFS);
  for (const pdf of pdfs) {
    try {
      const order = parseEventOrderPdf(await extractPdfTextItems(pdf.bytes));
      if (order) return order;
    } catch {
      // Ein anderes oder defektes PDF ist keine Anlass-Bestellung.
    }
  }
  return null;
}

/**
 * Bestellung der Anlässe-App (PDF oder Mail «Neue Bestellung Einrichten
 * Anlässe <ID>»): Jede Bestellung kommt als zwei Mails mit derselben ID. Die
 * erste legt den Eintrag in der Anlassplanung an, die zweite ergänzt ihn
 * (Bemerkungen, Technik). Das Ticket entfällt in beiden Fällen.
 */
async function processEventOrder(
  admin: Admin,
  input: IntakeInput,
  order: EventOrder,
): Promise<EventSpaceEmailTicketIntakeOutcome> {
  const organiser = input.senderName?.trim() || order.costCenterEmail ||
    "Anlässe-App";
  const converted = eventOrderIntakeInput(order, organiser);
  const parsed = parseEventSpaceEmailIntake({
    subject: converted.subject,
    description: converted.description,
  });
  const request = parsed.status === "ready"
    ? { ...parsed.request, notes: converted.notes }
    : null;
  const orderNumber = `${EVENT_ORDER_NUMBER_PREFIX}${order.orderId}`;
  const persons = Number.parseInt(order.persons ?? "", 10);

  const { data: existing } = await admin
    .from("event_space_requests")
    .select(
      "id, remarks, requested_starts_at, expected_participants, ict_material_requested, internet_access_requested, reception_laptop_requested, requested_equipment_keys",
    )
    .eq("tenant_id", input.tenantId)
    .eq("source_order_number", orderNumber)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    const notes = [converted.notes];
    if (
      request &&
      typeof existing.requested_starts_at === "string" &&
      Date.parse(existing.requested_starts_at) !== Date.parse(request.startAt)
    ) {
      notes.push(
        `Abweichende Angabe in einer weiteren Mail: ${order.date} ${order.startTime} Uhr, ${order.location}`,
      );
    }
    const previous = typeof existing.remarks === "string" ? existing.remarks : "";
    const addition = notes.join("\n");
    const equipment = [
      ...new Set([
        ...((existing.requested_equipment_keys ?? []) as string[]),
        ...(request?.equipmentKeys ?? []),
      ]),
    ];
    await admin
      .from("event_space_requests")
      .update({
        remarks: previous.includes(addition)
          ? previous
          : [previous, addition].filter(Boolean).join("\n\n").slice(0, 8_000),
        expected_participants: existing.expected_participants ??
          (Number.isFinite(persons) && persons > 0 ? persons : null),
        ict_material_requested: existing.ict_material_requested === true ||
          request?.requirements.ictMaterial === true,
        internet_access_requested:
          existing.internet_access_requested === true ||
          request?.requirements.internetAccess === true,
        reception_laptop_requested:
          existing.reception_laptop_requested === true ||
          request?.requirements.receptionLaptop === true,
        requested_equipment_keys: equipment,
      })
      .eq("id", existing.id)
      .eq("tenant_id", input.tenantId);
    if (request?.equipmentKeys.length) {
      await admin.from("event_space_request_equipment").upsert(
        request.equipmentKeys.map((equipmentKey) => ({
          tenant_id: input.tenantId,
          request_id: existing.id,
          equipment_key: equipmentKey,
        })),
        { onConflict: "request_id,equipment_key", ignoreDuplicates: true },
      );
    }
    await markOutbox(admin, input, "ignored", null);
    await removeSourceTicket(admin, input);
    return "processed";
  }

  const payload = rpcPayload(
    {
      ...input,
      subject: converted.subject,
      description: converted.description,
    },
    request,
    clarificationCodes(parsed),
  );
  if (!payload) {
    await markOutbox(admin, input, "ignored", null);
    return "ignored";
  }
  if (request) {
    payload.p_space_id = await matchingRoomId(
      admin,
      input.tenantId,
      request.requestedSpaceText,
    );
  }
  const { data: created, error } = await admin.rpc(
    "create_event_space_email_ticket_request",
    payload,
  );
  if (error) throw new Error("event_space_intake_persist_failed");
  const createdId = (Array.isArray(created) ? created[0] : created)?.request_id;
  if (typeof createdId === "string") {
    // Bemerkungen und Personenzahl auch bei einem Klärungsfall behalten.
    await admin
      .from("event_space_requests")
      .update({
        remarks: converted.notes,
        expected_participants: Number.isFinite(persons) && persons > 0
          ? persons
          : null,
      })
      .eq("id", createdId)
      .eq("tenant_id", input.tenantId);
  }
  await removeSourceTicket(admin, input);
  return "processed";
}

/**
 * Mail «Bestellung Anlässe … für Anlass <Titel>» ohne lesbares PDF (z. B.
 * Anhang fehlt): Ist dieselbe Bestellung schon eingeplant, entfällt das
 * Ticket; sonst bleibt es zur Bearbeitung stehen.
 */
async function isKnownEventOrderTitle(
  admin: Admin,
  input: OutboxInput,
  title: string,
): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("event_space_requests")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .like("source_order_number", `${EVENT_ORDER_NUMBER_PREFIX}%`)
    .ilike("title", title.replace(/[%_\\]/gu, "\\$&"))
    .gte("created_at", since)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

export async function processEventSpaceEmailTicketIntake(
  admin: Admin,
  input: IntakeInput,
): Promise<EventSpaceEmailTicketIntakeOutcome> {
  try {
    const subject = eventSpaceEmailIntakeSubject(input.subject);
    if (!subject) {
      const order = parseEventOrderText(input.subject, input.description) ??
        (await eventOrderFromPdfs(
          input.attachments ?? (await storedTicketPdfs(admin, input)),
        ));
      if (order) return await processEventOrder(admin, input, order);
      const orderTitle = eventOrderSubjectTitle(input.subject);
      if (orderTitle && (await isKnownEventOrderTitle(admin, input, orderTitle))) {
        await markOutbox(admin, input, "ignored", null);
        await removeSourceTicket(admin, input);
        return "processed";
      }
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
