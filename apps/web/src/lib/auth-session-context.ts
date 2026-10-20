export type WorkspaceAuthEventContext = {
  event: string;
  currentUserId: string | null | undefined;
  nextUserId: string | null;
};

/**
 * Entscheidet, ob ein Auth-Ereignis den vollständigen, mandantenbezogenen
 * Arbeitsbereich erneut aufbauen muss. Supabase kann bei Fensterfokus
 * `SIGNED_IN` oder `TOKEN_REFRESHED` für dieselbe Person erneut melden.
 */
export function requiresWorkspaceContextReset({
  event,
  currentUserId,
  nextUserId,
}: WorkspaceAuthEventContext): boolean {
  if (event === "SIGNED_OUT") return true;
  if (currentUserId === undefined) return true;

  return currentUserId !== nextUserId;
}
