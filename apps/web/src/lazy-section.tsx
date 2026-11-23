import { lazy, Suspense, type ComponentType } from "react";

/**
 * Lädt einen grossen Bereich (Einstellungen, Berichte, Inventar …) erst,
 * wenn er geöffnet wird. Der erste Aufbau der Web-App bleibt dadurch klein.
 */
export function lazySection<
  Module extends Record<string, unknown>,
  Name extends keyof Module,
>(load: () => Promise<Module>, name: Name) {
  type Props = Module[Name] extends ComponentType<infer P> ? P : never;
  const Lazy = lazy(async () => ({
    default: (await load())[name] as unknown as ComponentType<Props>,
  }));
  function Section(props: Props) {
    return (
      <Suspense
        fallback={
          <p className="empty-state" role="status">
            Wird geladen …
          </p>
        }
      >
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Lazy {...(props as any)} />
      </Suspense>
    );
  }
  Section.displayName = `Lazy(${String(name)})`;
  return Section;
}
