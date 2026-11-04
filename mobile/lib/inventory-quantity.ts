/** Accepts "3", "2.5" or "2,5"; returns null for anything else or <= 0. */
export function parseReceiptQuantity(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(normalized)) return null;
  const quantity = Number(normalized);
  return Number.isFinite(quantity) && quantity > 0 && quantity <= 1_000_000
    ? quantity
    : null;
}
