import { hasRequiredDelegatedMailScopes } from "./exchange-delegated-oauth.ts";

Deno.test(
  "delegated Exchange scope validation accepts a Microsoft token response without offline_access",
  () => {
    const accepted = hasRequiredDelegatedMailScopes([
      "User.Read",
      "Mail.Read",
      "Mail.Send",
      "Mail.Read.Shared",
      "Mail.Send.Shared",
      "openid",
      "profile",
    ]);

    if (!accepted) {
      throw new Error("The required delegated Mail scopes must be accepted");
    }
  },
);

Deno.test(
  "delegated Exchange scope validation rejects a missing shared send scope",
  () => {
    const accepted = hasRequiredDelegatedMailScopes([
      "User.Read",
      "Mail.Read",
      "Mail.Send",
      "Mail.Read.Shared",
    ]);

    if (accepted) {
      throw new Error("Mail.Send.Shared must remain mandatory");
    }
  },
);
