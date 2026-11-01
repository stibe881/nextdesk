const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GRAPH_ORIGIN = "https://graph.microsoft.com";
const REQUEST_TIMEOUT_MS = 15_000;
export const DIRECTORY_CONNECTION_TEST_PATH = "/v1.0/users/$count";

export const DIRECTORY_GRAPH_FIELDS = [
  "id",
  "displayName",
  "mail",
  "userPrincipalName",
  "jobTitle",
  "department",
  "accountEnabled",
  "userType",
].join(",");

export type GraphUser = {
  manager?: unknown;
  id?: unknown;
  displayName?: unknown;
  mail?: unknown;
  userPrincipalName?: unknown;
  jobTitle?: unknown;
  department?: unknown;
  accountEnabled?: unknown;
  userType?: unknown;
};

type FetchLike = typeof fetch;

export class EntraDirectoryGraphError extends Error {
  constructor() {
    super("directory_graph_failed");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

export async function graphAccessToken(
  entraTenantId: string,
  fetcher: FetchLike = fetch,
): Promise<string> {
  if (!isUuid(entraTenantId)) throw new EntraDirectoryGraphError();

  const clientId = Deno.env.get("ENTRA_DIRECTORY_CLIENT_ID");
  const clientSecret = Deno.env.get("ENTRA_DIRECTORY_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new EntraDirectoryGraphError();

  let tokenResponse: Response;
  try {
    tokenResponse = await fetcher(
      `https://login.microsoftonline.com/${entraTenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "client_credentials",
          scope: "https://graph.microsoft.com/.default",
        }),
        redirect: "error",
        signal: timeoutSignal(),
      },
    );
  } catch {
    throw new EntraDirectoryGraphError();
  }

  const payload = (await tokenResponse.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!tokenResponse.ok || typeof payload?.access_token !== "string") {
    throw new EntraDirectoryGraphError();
  }
  return payload.access_token;
}

export async function testEntraDirectoryConnection(
  entraTenantId: string,
  fetcher: FetchLike = fetch,
): Promise<void> {
  const token = await graphAccessToken(entraTenantId, fetcher);
  let response: Response;
  try {
    response = await fetcher(
      `${GRAPH_ORIGIN}${DIRECTORY_CONNECTION_TEST_PATH}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ConsistencyLevel: "eventual",
        },
        redirect: "error",
        signal: timeoutSignal(),
      },
    );
  } catch {
    throw new EntraDirectoryGraphError();
  }

  const count = await response.text().catch(() => "");
  if (!response.ok || !/^\d+$/.test(count.trim())) {
    throw new EntraDirectoryGraphError();
  }
}

export async function graphUsers(
  token: string,
  fetcher: FetchLike = fetch,
  afterPage?: () => Promise<void>,
): Promise<GraphUser[]> {
  const users: GraphUser[] = [];
  let next: string | null =
    `${GRAPH_ORIGIN}/v1.0/users?$select=${encodeURIComponent(
      DIRECTORY_GRAPH_FIELDS,
    )}&$expand=${encodeURIComponent("manager($select=id)")}&$top=999`;

  for (let page = 0; next && page < 100; page += 1) {
    let url: URL;
    try {
      url = new URL(next);
    } catch {
      throw new EntraDirectoryGraphError();
    }
    if (
      url.origin !== GRAPH_ORIGIN ||
      !url.pathname.startsWith("/v1.0/users")
    ) {
      throw new EntraDirectoryGraphError();
    }

    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: timeoutSignal(),
      });
    } catch {
      throw new EntraDirectoryGraphError();
    }
    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!response.ok || !payload || !Array.isArray(payload.value)) {
      throw new EntraDirectoryGraphError();
    }
    users.push(...payload.value.filter(isRecord));
    if (afterPage) {
      try {
        await afterPage();
      } catch {
        throw new EntraDirectoryGraphError();
      }
    }
    next =
      typeof payload["@odata.nextLink"] === "string"
        ? payload["@odata.nextLink"]
        : null;
  }

  if (next) throw new EntraDirectoryGraphError();
  return users;
}

/** Entra object id of the person's manager, if Graph delivered one. */
export function graphManagerId(user: GraphUser): string | null {
  const manager = user.manager;
  if (!isRecord(manager) || typeof manager.id !== "string") return null;
  return isUuid(manager.id) ? manager.id.toLowerCase() : null;
}
