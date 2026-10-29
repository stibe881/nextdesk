export type SupportContactSource =
  | "tenant_setting"
  | "exchange_mailbox"
  | null;

export type ResolvedSupportContact = {
  email: string | null;
  source: SupportContactSource;
  hasMultipleActiveExchangeMailboxes: boolean;
};

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}

/**
 * Resolves a presentation-only support contact. An explicit tenant setting
 * always wins; a mailbox is only used as fallback when it is unambiguous.
 */
export function resolveSupportContact(
  configuredSupportEmail: unknown,
  activeExchangeMailboxAddresses: Iterable<unknown>,
): ResolvedSupportContact {
  const tenantEmail = normalizedEmail(configuredSupportEmail);
  const activeExchangeMailboxes = [
    ...new Set(
      Array.from(activeExchangeMailboxAddresses, normalizedEmail).filter(
        (email): email is string => email !== null,
      ),
    ),
  ];
  const hasMultipleActiveExchangeMailboxes = activeExchangeMailboxes.length > 1;

  if (tenantEmail) {
    return {
      email: tenantEmail,
      source: "tenant_setting",
      hasMultipleActiveExchangeMailboxes,
    };
  }

  if (activeExchangeMailboxes.length === 1) {
    return {
      email: activeExchangeMailboxes[0],
      source: "exchange_mailbox",
      hasMultipleActiveExchangeMailboxes: false,
    };
  }

  return {
    email: null,
    source: null,
    hasMultipleActiveExchangeMailboxes,
  };
}
