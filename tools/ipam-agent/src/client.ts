/** HTTPS client for the nextDesk edge function `ipam-agent` (outbound only). */

import { log } from "./log.ts";
import { VERSION } from "./version.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`nextDesk antwortet ${status} (${code})`);
    this.status = status;
    this.code = code;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class NextdeskClient {
  readonly url: string;
  readonly #token: string;

  constructor(url: string, token: string) {
    this.url = url;
    this.#token = token;
  }

  /** POST with retries for network errors, 429 and 5xx (not for 4xx). */
  async post<T = Record<string, unknown>>(
    body: Record<string, unknown>,
    attempts = 4,
  ): Promise<T> {
    let delay = 2000;
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await fetch(this.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.#token}`,
            "Content-Type": "application/json",
            "User-Agent": `nextdesk-ipam-agent/${VERSION}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        });
        const text = await response.text();
        let payload: Record<string, unknown> = {};
        try {
          payload = text ? JSON.parse(text) : {};
        } catch {
          payload = {};
        }
        if (response.ok) return payload as T;
        const code =
          typeof payload.error === "string" ? payload.error : "http_error";
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt >= attempts)
          throw new ApiError(response.status, code);
        const retryAfter = Number(response.headers.get("retry-after"));
        delay =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : delay;
        log.warn(
          `nextDesk antwortet ${response.status} (${code}), neuer Versuch in ${Math.round(delay / 1000)} s`,
        );
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (attempt >= attempts) throw error;
        log.warn(
          `Verbindung zu nextDesk fehlgeschlagen, neuer Versuch in ${Math.round(delay / 1000)} s`,
          error,
        );
      }
      await sleep(delay);
      delay = Math.min(delay * 2, 60_000);
    }
  }
}
