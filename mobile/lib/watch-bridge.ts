import { AppState, Platform } from "react-native";

import {
  loadCurrentTenant,
  nextDesk,
  nextDeskPublicConfig,
} from "@/lib/nextdesk-client";

/**
 * Verbindung zur nextDesk-App auf der Apple Watch (targets/watch).
 *
 * Die Watch hat keine eigene Anmeldung. Das iPhone schickt ihr über
 * WatchConnectivity das kurzlebige Zugriffstoken der angemeldeten Person und
 * den gewählten Arbeitsbereich und beantwortet Anfragen nach einem frischen
 * Token. Refresh-Tokens verlassen das iPhone nie; meldet sich die Person ab,
 * wird auch die Watch abgemeldet.
 */
type WatchModule = typeof import("react-native-watch-connectivity");

const TOKEN_REQUEST = "nextdesk.token";
/** Frisches Token holen, wenn das aktuelle in weniger als 5 Minuten abläuft. */
const MIN_TOKEN_LIFETIME_S = 5 * 60;

let watch: WatchModule | null = null;
let started = false;

function loadWatchModule(): WatchModule | null {
  if (Platform.OS !== "ios") return null;
  try {
    // Erst zur Laufzeit laden: Web und Expo Go haben das native Modul nicht.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("react-native-watch-connectivity") as WatchModule;
  } catch {
    return null;
  }
}

export type WatchContext =
  | { signedOut: true }
  | {
      accessToken: string;
      expiresAt: number;
      supabaseUrl: string;
      anonKey: string;
      tenantId: string;
      tenantName: string;
      userId: string;
    };

/** Baut den Inhalt für die Watch; erneuert das Token, wenn es bald abläuft. */
export async function buildWatchContext(): Promise<WatchContext> {
  if (!nextDesk) return { signedOut: true };
  let {
    data: { session },
  } = await nextDesk.auth.getSession();
  if (!session) return { signedOut: true };
  const nowS = Date.now() / 1000;
  if (!session.expires_at || session.expires_at - nowS < MIN_TOKEN_LIFETIME_S) {
    const refreshed = await nextDesk.auth.refreshSession();
    if (refreshed.data.session) session = refreshed.data.session;
  }
  const tenant = await loadCurrentTenant();
  return {
    accessToken: session.access_token,
    expiresAt: session.expires_at ?? Math.floor(nowS) + 3600,
    supabaseUrl: nextDeskPublicConfig.url,
    anonKey: nextDeskPublicConfig.publishableKey,
    tenantId: tenant.id,
    tenantName: tenant.name,
    userId: session.user.id,
  };
}

async function watchIsReady(module: WatchModule): Promise<boolean> {
  try {
    const [paired, installed] = await Promise.all([
      module.getIsPaired(),
      module.getIsWatchAppInstalled(),
    ]);
    return paired && installed;
  } catch {
    return false;
  }
}

/** Schickt den aktuellen Stand an die Watch (falls eine mit der App gekoppelt ist). */
export async function syncWatch(): Promise<void> {
  const module = watch;
  if (!module || !(await watchIsReady(module))) return;
  try {
    module.updateApplicationContext(await buildWatchContext());
  } catch {
    // Ohne Arbeitsbereich oder Netz bleibt der letzte Stand bestehen; die Watch
    // fragt bei Bedarf selbst nach.
  }
}

/** Startet die Verbindung einmal pro App-Start (nur iOS mit nativem Modul). */
export function startWatchBridge(): void {
  if (started) return;
  started = true;
  watch = loadWatchModule();
  const module = watch;
  if (!module || !nextDesk) return;

  module.watchEvents.on("message", (message, reply) => {
    if (
      !reply ||
      (message as { type?: unknown } | null)?.type !== TOKEN_REQUEST
    ) {
      return;
    }
    void buildWatchContext()
      .then((context) => reply(context))
      .catch(() => reply({ signedOut: true }));
  });

  nextDesk.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      void watchIsReady(module).then((ready) => {
        if (ready) module.updateApplicationContext({ signedOut: true });
      });
    } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
      // Erst nach dem aktuellen Auth-Ereignis lesen (Supabase sperrt die
      // Sitzung während des Callbacks).
      setTimeout(() => void syncWatch(), 0);
    }
  });

  AppState.addEventListener("change", (state) => {
    if (state === "active") void syncWatch();
  });
  void syncWatch();
}
