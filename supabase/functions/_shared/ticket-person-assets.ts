// Assets of the requesting and the affected person of a ticket: active
// assignments (asset_assignments) and Intune primary person links (via the
// Entra directory mirror). Read with the service role; callers must check
// the ticket permission themselves and read the resulting assets with the
// caller's client so asset RLS and the department scope apply.

// deno-lint-ignore no-explicit-any
type Admin = any;
type Row = Record<string, unknown>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export type TicketPersonRef = {
  requester_id?: unknown;
  affected_user_id?: unknown;
  requester_contact_id?: unknown;
};

export type TicketPersonAssets = {
  assignedIds: Set<string>;
  intuneIds: Set<string>;
};

export class TicketPersonAssetsError extends Error {
  constructor(readonly dbError: unknown) {
    super("ticket_person_assets_failed");
  }
}

export async function ticketPersonAssetIds(
  admin: Admin,
  tenantId: string,
  ticket: TicketPersonRef,
): Promise<TicketPersonAssets> {
  const userIds = [ticket.requester_id, ticket.affected_user_id].filter(isUuid);
  const [requesters, directoryPeople] = await Promise.all([
    userIds.length
      ? admin
          .from("ticket_requesters")
          .select("id")
          .eq("tenant_id", tenantId)
          .in("user_id", userIds)
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? admin
          .from("tenant_entra_directory_people")
          .select("entra_object_id")
          .eq("tenant_id", tenantId)
          .in("local_user_id", userIds)
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (requesters.error) throw new TicketPersonAssetsError(requesters.error);
  if (directoryPeople.error) {
    throw new TicketPersonAssetsError(directoryPeople.error);
  }
  const requesterIds = [
    ...new Set(
      [
        ticket.requester_contact_id,
        ...(requesters.data ?? []).map((row: Row) => row.id),
      ].filter(isUuid),
    ),
  ];
  const entraObjectIds = [
    ...new Set(
      (directoryPeople.data ?? [])
        .map((row: Row) => row.entra_object_id)
        .filter(isUuid),
    ),
  ];
  const [assignments, primaryLinks] = await Promise.all([
    requesterIds.length
      ? admin
          .from("asset_assignments")
          .select("asset_id")
          .eq("tenant_id", tenantId)
          .in("requester_id", requesterIds)
          .is("returned_at", null)
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
    entraObjectIds.length
      ? admin
          .from("asset_intune_primary_person_links")
          .select("asset_id")
          .eq("tenant_id", tenantId)
          .in("entra_object_id", entraObjectIds)
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (assignments.error) throw new TicketPersonAssetsError(assignments.error);
  if (primaryLinks.error) throw new TicketPersonAssetsError(primaryLinks.error);
  return {
    assignedIds: new Set(
      (assignments.data ?? []).map((row: Row) => row.asset_id).filter(isUuid),
    ),
    intuneIds: new Set(
      (primaryLinks.data ?? []).map((row: Row) => row.asset_id).filter(isUuid),
    ),
  };
}
