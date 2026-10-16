export const productDefaults = {
  productName: "TicketHub",
  defaultLocale: "de-CH",
  supportedLocales: ["de-CH", "en", "fr", "it"] as const,
  timezone: "Europe/Zurich",
  internalTimestampTimezone: "UTC",
  comments: {
    defaultVisibility: "internal" as const,
  },
} as const;

export type ProductDefaults = typeof productDefaults;
