import { useSyncExternalStore } from "react";

/**
 * Form of address of a tenant: informal «du» (default) or formal «Sie».
 *
 * Every text that addresses a person is written twice with `tn(du, sie)`;
 * the verification script `scripts/verify-formality.mjs` fails when a formal
 * form («Sie», «Ihr …») appears outside the second argument.
 */
export type Formality = "du" | "sie";

const STORAGE_KEY = "nextdesk:formality";

export function isFormality(value: unknown): value is Formality {
  return value === "du" || value === "sie";
}

function readStored(): Formality {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isFormality(stored) ? stored : "du";
  } catch {
    return "du";
  }
}

// The last known value avoids a flash of the wrong form when the app starts.
let current: Formality = typeof window === "undefined" ? "du" : readStored();
const listeners = new Set<() => void>();

export function getFormality(): Formality {
  return current;
}

export function setFormality(next: Formality): void {
  if (next === current) return;
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage is optional.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders the caller when the form of address changes. */
export function useFormality(): Formality {
  return useSyncExternalStore(subscribe, getFormality, () => "du");
}

/** Picks the wording for the current form of address (texts or JSX). */
export function tn<T>(du: T, sie: T): T {
  return current === "sie" ? sie : du;
}

// Server texts that differ by form of address arrive as «⟦du␞sie⟧» (see
// supabase/functions/_shared/formality.ts) and are resolved here.
const PAIR_PATTERN = /⟦([^⟦⟧␞]*)␞([^⟦⟧]*)⟧/g;

export const FORMALITY_PAIR_START = "⟦";

export function resolveFormalityPairs(
  text: string,
  formality: Formality = current,
): string {
  if (!text.includes(FORMALITY_PAIR_START)) return text;
  return text.replace(PAIR_PATTERN, (_match, du: string, sie: string) =>
    formality === "sie" ? sie : du,
  );
}
