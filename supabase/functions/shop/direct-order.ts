// Bestellung im Namen einer Person ohne Genehmigung (Action
// «placeOrderWithoutApproval»). Reine Anfrageprüfung, damit sie ohne
// Datenbank getestet werden kann. Die verbindliche Prüfung (Berechtigung,
// aktive Person, Artikel, Ausleihzeitraum) macht shop_submit_order_direct.

import { ENTRA_PERSON_PREFIX } from "../_shared/entra-person-account.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DirectOrderLine = {
  catalog_item_id: string;
  quantity: number;
  loan_from: string | null;
  loan_until: string | null;
};

export type DirectOrderSource = {
  type: "security_case";
  id: string;
  reference: string | null;
};

export type DirectOrder = {
  clientRequestId: string;
  /** Konto der Person; bei einer Entra-Person erst nach dem Vorbereiten. */
  requesterId: string;
  /** Entra-Objekt-ID, wenn die Person noch kein Konto hat. */
  entraObjectId: string | null;
  lines: DirectOrderLine[];
  reason: string;
  comment: string | null;
  deliveryMethod: "pickup" | "desk";
  deliveryLocation: string | null;
  neededBy: string | null;
  source: DirectOrderSource | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    !trimmed ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)
  )
    return null;
  return Array.from(trimmed).length <= max ? trimmed : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

/**
 * Prüft die Anfrage:
 * `{ clientRequestId, requesterId, lines: [{ catalogItemId, quantity,
 * loanFrom?, loanUntil? }], reason, comment?, deliveryMethod?,
 * deliveryLocation?, neededBy?, source?: { type: "security_case", id,
 * reference? } }`. `requesterId` ist eine Konto-ID oder `entra:<objectId>`.
 */
export function parseDirectOrder(body: unknown): DirectOrder | null {
  if (!isRecord(body) || !isUuid(body.clientRequestId)) return null;
  let requesterId: string | null = null;
  let entraObjectId: string | null = null;
  if (isUuid(body.requesterId)) {
    requesterId = body.requesterId.toLowerCase();
  } else if (
    typeof body.requesterId === "string" &&
    body.requesterId.startsWith(ENTRA_PERSON_PREFIX) &&
    isUuid(body.requesterId.slice(ENTRA_PERSON_PREFIX.length))
  ) {
    entraObjectId = body.requesterId
      .slice(ENTRA_PERSON_PREFIX.length)
      .toLowerCase();
    requesterId = entraObjectId;
  }
  if (!requesterId) return null;
  if (
    !Array.isArray(body.lines) ||
    body.lines.length < 1 ||
    body.lines.length > 30
  )
    return null;
  const lines: DirectOrderLine[] = [];
  const seen = new Set<string>();
  for (const line of body.lines) {
    if (!isRecord(line) || !isUuid(line.catalogItemId)) return null;
    const id = line.catalogItemId.toLowerCase();
    if (seen.has(id)) return null;
    seen.add(id);
    const quantity = line.quantity;
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 100
    )
      return null;
    if (
      (line.loanFrom !== undefined &&
        line.loanFrom !== null &&
        !isoDate(line.loanFrom)) ||
      (line.loanUntil !== undefined &&
        line.loanUntil !== null &&
        !isoDate(line.loanUntil))
    )
      return null;
    lines.push({
      catalog_item_id: id,
      quantity,
      loan_from: isoDate(line.loanFrom),
      loan_until: isoDate(line.loanUntil),
    });
  }
  const reason = cleanText(body.reason, 500);
  if (!reason || Array.from(reason).length < 3) return null;
  if (
    body.comment !== undefined &&
    body.comment !== null &&
    !cleanText(body.comment, 2000)
  )
    return null;
  if (
    body.deliveryMethod !== undefined &&
    body.deliveryMethod !== "pickup" &&
    body.deliveryMethod !== "desk"
  )
    return null;
  if (
    body.neededBy !== undefined &&
    body.neededBy !== null &&
    !isoDate(body.neededBy)
  )
    return null;
  let source: DirectOrderSource | null = null;
  if (body.source !== undefined && body.source !== null) {
    if (
      !isRecord(body.source) ||
      body.source.type !== "security_case" ||
      !isUuid(body.source.id)
    )
      return null;
    const reference =
      body.source.reference === undefined || body.source.reference === null
        ? null
        : cleanText(body.source.reference, 60);
    if (
      body.source.reference !== undefined &&
      body.source.reference !== null &&
      !reference
    )
      return null;
    source = {
      type: "security_case",
      id: body.source.id.toLowerCase(),
      reference,
    };
  }
  return {
    clientRequestId: body.clientRequestId.toLowerCase(),
    requesterId,
    entraObjectId,
    lines,
    reason,
    comment: cleanText(body.comment, 2000),
    deliveryMethod: body.deliveryMethod === "desk" ? "desk" : "pickup",
    deliveryLocation: cleanText(body.deliveryLocation, 200),
    neededBy: isoDate(body.neededBy),
    source,
  };
}

export type SkipApproval = { kind: "security_case"; ticketId: string };

/**
 * Optionaler Schalter der Action «submitOrder»:
 * `skipApproval: true` mit `source: { kind: "security_case", ticketId }`.
 * Ohne Schalter `null`; ein unvollständiger Schalter ist ungültig.
 */
export function parseSkipApproval(
  body: Record<string, unknown>,
): SkipApproval | null | "invalid" {
  if (body.skipApproval === undefined || body.skipApproval === false) {
    return null;
  }
  if (
    body.skipApproval !== true ||
    !isRecord(body.source) ||
    body.source.kind !== "security_case" ||
    !isUuid(body.source.ticketId)
  ) {
    return "invalid";
  }
  return {
    kind: "security_case",
    ticketId: body.source.ticketId.toLowerCase(),
  };
}
