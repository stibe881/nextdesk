Deno.test(
  "Intune manual sync endpoint remains JWT-bound, allowlisted and provider-safe",
  async () => {
    const source = await Deno.readTextFile(
      new URL("./index.ts", import.meta.url),
    );
    for (const required of [
      'auth: "user"',
      'type: "runManualIntuneSync"',
      "confirmApply",
      "claim_asset_intune_manual_sync_run",
      "renew_asset_intune_manual_sync_fence",
      "mark_asset_intune_manual_sync_provider_contact",
      "stage_asset_intune_manual_sync_devices",
      "complete_asset_intune_manual_sync_run",
      "fail_asset_intune_manual_sync_run",
      "readIntuneGraphCredentials",
      "intune_manual_sync_cleanup_failed",
    ]) {
      if (!source.includes(required)) {
        throw new Error(
          `Manual Intune sync is missing its required control: ${required}`,
        );
      }
    }
    for (const forbidden of [
      "ENTRA_DIRECTORY_CLIENT_ID",
      "ENTRA_DIRECTORY_CLIENT_SECRET",
      "DeviceManagementManagedDevices.ReadWrite.All",
      "console.log",
      "console.error",
      'Deno.env.get("ENTRA',
    ]) {
      if (source.includes(forbidden)) {
        throw new Error(
          `Manual Intune sync contains forbidden provider coupling: ${forbidden}`,
        );
      }
    }
  },
);
