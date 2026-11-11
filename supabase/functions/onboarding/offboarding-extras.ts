// Austritt: offene Shop-Ausleihen und Lizenzen der austretenden Person sowie
// die Lagerorte für die Rücknahme (Standard-Lagerort vorausgewählt). Die
// Rückbuchung bzw. der Entzug geschieht beim Abschluss der Aufgabe in der
// Datenbank (Trigger onboarding_complete_asset_return, Migration 0314).

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ExtrasDatabaseError extends Error {
  constructor(readonly databaseError: unknown) {
    super("offboarding_extras_failed");
  }
}

export type LinkedTask = { taskId: string; status: string; sameEntry: boolean };

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function rowsOf(result: Result): Row[] {
  if (result.error) throw new ExtrasDatabaseError(result.error);
  return (Array.isArray(result.data) ? result.data : []) as Row[];
}

const empty: Promise<Result> = Promise.resolve({ data: [], error: null });

/** Title of a loan return task: «Rückgabe Ausleihe: <Artikel> (<Bestellung>)». */
export function loanReturnTaskTitle(
  itemName: string,
  orderNumber: string | null,
) {
  const name = itemName.trim().replace(/\s+/g, " ") || "Artikel";
  const suffix = orderNumber ? ` (${orderNumber})` : "";
  const prefix = "Rückgabe Ausleihe: ";
  const room = 240 - prefix.length - Array.from(suffix).length;
  const short =
    Array.from(name).length > room
      ? `${Array.from(name)
          .slice(0, room - 1)
          .join("")}…`
      : name;
  return `${prefix}${short}${suffix}`;
}

/** Title of a license revocation task: «Lizenz entziehen: <Lizenz>». */
export function licenseRevocationTaskTitle(licenseTitle: string) {
  const name = licenseTitle.trim().replace(/\s+/g, " ") || "Lizenz";
  const prefix = "Lizenz entziehen: ";
  const room = 240 - prefix.length;
  return `${prefix}${
    Array.from(name).length > room
      ? `${Array.from(name)
          .slice(0, room - 1)
          .join("")}…`
      : name
  }`;
}

async function linkedTasks(
  admin: Admin,
  tenantId: string,
  entryId: string,
  taskIds: string[],
): Promise<Map<string, LinkedTask>> {
  if (!taskIds.length) return new Map();
  const rows = rowsOf(
    await admin
      .from("onboarding_tasks")
      .select("id, entry_id, status")
      .eq("tenant_id", tenantId)
      .in("id", taskIds)
      .limit(taskIds.length),
  );
  return new Map(
    rows.map((row) => [
      String(row.id),
      {
        taskId: String(row.id),
        status: String(row.status),
        sameEntry: row.entry_id === entryId,
      },
    ]),
  );
}

export async function offboardingExtras(
  admin: Admin,
  tenantId: string,
  entryId: string,
  entryTaskIds: string[],
  requesterId: string | null,
) {
  let userId: string | null = null;
  if (requesterId) {
    const { data, error } = await admin
      .from("ticket_requesters")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("id", requesterId)
      .maybeSingle();
    if (error) throw new ExtrasDatabaseError(error);
    userId = isUuid(data?.user_id) ? data.user_id : null;
  }
  const [loanLinks, licenseLinks, locations, defaultLocation] =
    await Promise.all([
      entryTaskIds.length
        ? admin
            .from("onboarding_loan_returns")
            .select("order_line_id")
            .eq("tenant_id", tenantId)
            .in("task_id", entryTaskIds)
            .limit(200)
        : empty,
      entryTaskIds.length
        ? admin
            .from("onboarding_license_revocations")
            .select("license_assignment_id")
            .eq("tenant_id", tenantId)
            .in("task_id", entryTaskIds)
            .limit(200)
        : empty,
      admin
        .from("inventory_locations")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("name")
        .limit(500),
      admin.rpc("inventory_default_return_location", {
        p_tenant_id: tenantId,
        p_department_id: null,
      }),
    ]);
  const linkedLineIds = rowsOf(loanLinks).map((row) =>
    String(row.order_line_id),
  );
  const linkedSeatIds = rowsOf(licenseLinks).map((row) =>
    String(row.license_assignment_id),
  );
  const locationRows = rowsOf(locations);

  // Ausleihen: offene der Person und bereits verknüpfte dieses Austritts.
  const lineSelect = "id, order_id, item_name, quantity, loan_until, status";
  const lineRows: Row[] = [];
  if (userId) {
    const orderIds = rowsOf(
      await admin
        .from("shop_orders")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("requester_id", userId)
        .eq("status", "loaned")
        .limit(200),
    ).map((row) => String(row.id));
    if (orderIds.length) {
      lineRows.push(
        ...rowsOf(
          await admin
            .from("shop_order_lines")
            .select(lineSelect)
            .eq("tenant_id", tenantId)
            .in("order_id", orderIds)
            .eq("kind", "loan")
            .eq("status", "issued")
            .limit(200),
        ),
      );
    }
  }
  const missingLines = linkedLineIds.filter(
    (id) => !lineRows.some((row) => row.id === id),
  );
  if (missingLines.length) {
    lineRows.push(
      ...rowsOf(
        await admin
          .from("shop_order_lines")
          .select(lineSelect)
          .eq("tenant_id", tenantId)
          .in("id", missingLines)
          .limit(missingLines.length),
      ),
    );
  }

  // Lizenzen: aktive Zuweisungen der Person (Konto oder Entra-Objekt).
  const seatSelect = "id, license_id, assignee_label, assigned_at, released_at";
  const seatRows: Row[] = [];
  if (userId) {
    const people = rowsOf(
      await admin
        .from("tenant_entra_directory_people")
        .select("entra_object_id")
        .eq("tenant_id", tenantId)
        .eq("local_user_id", userId)
        .limit(1),
    );
    const entraObjectId = isUuid(people[0]?.entra_object_id)
      ? people[0].entra_object_id
      : null;
    seatRows.push(
      ...rowsOf(
        await admin
          .from("license_assignments")
          .select(seatSelect)
          .eq("tenant_id", tenantId)
          .is("released_at", null)
          .or(
            entraObjectId
              ? `user_id.eq.${userId},entra_object_id.eq.${entraObjectId}`
              : `user_id.eq.${userId}`,
          )
          .limit(200),
      ),
    );
  }
  const missingSeats = linkedSeatIds.filter(
    (id) => !seatRows.some((row) => row.id === id),
  );
  if (missingSeats.length) {
    seatRows.push(
      ...rowsOf(
        await admin
          .from("license_assignments")
          .select(seatSelect)
          .eq("tenant_id", tenantId)
          .in("id", missingSeats)
          .limit(missingSeats.length),
      ),
    );
  }

  const orderIds = [...new Set(lineRows.map((row) => String(row.order_id)))];
  const licenseIds = [
    ...new Set(seatRows.map((row) => String(row.license_id))),
  ];
  const lineIds = lineRows.map((row) => String(row.id));
  const seatIds = seatRows.map((row) => String(row.id));
  const [orderResult, licenseResult, lineLinkResult, seatLinkResult] =
    await Promise.all([
      orderIds.length
        ? admin
            .from("shop_orders")
            .select("id, order_number")
            .eq("tenant_id", tenantId)
            .in("id", orderIds)
            .limit(orderIds.length)
        : empty,
      licenseIds.length
        ? admin
            .from("licenses")
            .select("id, title")
            .eq("tenant_id", tenantId)
            .in("id", licenseIds)
            .limit(licenseIds.length)
        : empty,
      lineIds.length
        ? admin
            .from("onboarding_loan_returns")
            .select("order_line_id, task_id")
            .eq("tenant_id", tenantId)
            .in("order_line_id", lineIds)
            .limit(lineIds.length)
        : empty,
      seatIds.length
        ? admin
            .from("onboarding_license_revocations")
            .select("license_assignment_id, task_id")
            .eq("tenant_id", tenantId)
            .in("license_assignment_id", seatIds)
            .limit(seatIds.length)
        : empty,
    ]);
  const lineLinks = rowsOf(lineLinkResult);
  const seatLinks = rowsOf(seatLinkResult);
  const tasks = await linkedTasks(admin, tenantId, entryId, [
    ...lineLinks.map((row) => String(row.task_id)),
    ...seatLinks.map((row) => String(row.task_id)),
  ]);
  const taskForLine = new Map(
    lineLinks.map((row) => [
      String(row.order_line_id),
      tasks.get(String(row.task_id)) ?? null,
    ]),
  );
  const taskForSeat = new Map(
    seatLinks.map((row) => [
      String(row.license_assignment_id),
      tasks.get(String(row.task_id)) ?? null,
    ]),
  );
  const numbers = new Map(
    rowsOf(orderResult).map((row) => [
      String(row.id),
      String(row.order_number),
    ]),
  );
  const titles = new Map(
    rowsOf(licenseResult).map((row) => [String(row.id), String(row.title)]),
  );
  return {
    loans: lineRows.map((row) => ({
      lineId: String(row.id),
      orderId: String(row.order_id),
      orderNumber: numbers.get(String(row.order_id)) ?? null,
      itemName: String(row.item_name),
      quantity: Number(row.quantity),
      loanUntil: typeof row.loan_until === "string" ? row.loan_until : null,
      returned: row.status === "returned",
      returnTask: taskForLine.get(String(row.id)) ?? null,
    })),
    licenses: seatRows.map((row) => ({
      assignmentId: String(row.id),
      licenseTitle: titles.get(String(row.license_id)) ?? "Lizenz",
      assigneeLabel: String(row.assignee_label),
      assignedAt: String(row.assigned_at),
      released: typeof row.released_at === "string",
      revokeTask: taskForSeat.get(String(row.id)) ?? null,
    })),
    locations: locationRows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
    })),
    defaultLocationId:
      !defaultLocation.error && isUuid(defaultLocation.data)
        ? defaultLocation.data
        : null,
  };
}
