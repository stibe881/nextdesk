/** Minimal logger with levels. Never pass tokens or credentials. */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;
let threshold: number = LEVELS.info;

export function setLogLevel(level: Level): void {
  threshold = LEVELS[level];
}

function write(level: Level, message: string, details?: unknown): void {
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
  const suffix =
    details === undefined
      ? ""
      : ` ${details instanceof Error ? details.message : JSON.stringify(details)}`;
  (level === "error" || level === "warn" ? console.error : console.log)(
    line + suffix,
  );
}

export const log = {
  debug: (message: string, details?: unknown) =>
    write("debug", message, details),
  info: (message: string, details?: unknown) => write("info", message, details),
  warn: (message: string, details?: unknown) => write("warn", message, details),
  error: (message: string, details?: unknown) =>
    write("error", message, details),
};
