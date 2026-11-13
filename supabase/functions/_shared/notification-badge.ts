/**
 * Zahl der ungelesenen Mitteilungen einer Person (alle Arbeitsbereiche, in
 * denen sie aktiv Mitglied ist). Sie erscheint als Zahl auf dem App-Symbol.
 */
export async function unreadNotificationCount(
  admin: any,
  userId: string,
): Promise<number> {
  const { data: memberships, error } = await admin
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error || !Array.isArray(memberships) || memberships.length === 0) {
    return 0;
  }
  const { count, error: countError } = await admin
    .from("ticket_notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null)
    .in(
      "tenant_id",
      memberships.map((row: { tenant_id: string }) => row.tenant_id),
    );
  if (countError || typeof count !== "number") return 0;
  return Math.min(count, 9999);
}
