import { Fragment, type ReactNode } from "react";
import { useFormality } from "./lib/formality";

/**
 * Remounts the app below when the form of address changes, so that every text
 * is rendered again with the new wording.
 */
export function FormalityBoundary({ children }: { children: ReactNode }) {
  const formality = useFormality();
  return <Fragment key={formality}>{children}</Fragment>;
}
