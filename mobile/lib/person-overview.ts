import { invokeNextDesk } from "@/lib/nextdesk-client";
import {
  parsePersonOverview,
  parsePersonSearchHits,
  type PersonOverview,
  type PersonRef,
  type PersonSearchHit,
} from "@/lib/person-overview-model";

export * from "@/lib/person-overview-model";

/** People from the Entra directory; empty for people who are not agents. */
export async function searchMobilePeople(
  tenantId: string,
  query: string,
): Promise<PersonSearchHit[]> {
  const response = await invokeNextDesk<unknown>("global-search", {
    type: "search",
    tenantId,
    query,
  });
  const data =
    typeof response === "object" && response !== null
      ? (response as { data?: { people?: unknown } }).data
      : null;
  return parsePersonSearchHits(data?.people);
}

export async function loadMobilePersonOverview(
  tenantId: string,
  person: PersonRef,
): Promise<PersonOverview> {
  const overview = parsePersonOverview(
    await invokeNextDesk<unknown>("person-overview", {
      type: "get",
      tenantId,
      entraObjectId: person.entraObjectId ?? null,
      requesterContactId: person.requesterContactId ?? null,
      userId: person.userId ?? null,
    }),
  );
  if (!overview) {
    throw new Error("Die Personenübersicht konnte nicht gelesen werden.");
  }
  return overview;
}

/** Route for the person screen: /person/<kind>:<id>. */
export function personRoute(person: PersonRef): string | null {
  if (person.entraObjectId) return `/person/entra:${person.entraObjectId}`;
  if (person.requesterContactId) {
    return `/person/contact:${person.requesterContactId}`;
  }
  if (person.userId) return `/person/user:${person.userId}`;
  return null;
}

export function personRefFromRouteId(value: unknown): PersonRef | null {
  if (typeof value !== "string") return null;
  const match =
    /^(entra|contact|user):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
      value,
    );
  if (!match) return null;
  const [, kind, id] = match;
  if (kind === "entra") return { entraObjectId: id };
  if (kind === "contact") return { requesterContactId: id };
  return { userId: id };
}
