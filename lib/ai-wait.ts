// How long the AI features ask the reader to wait after a 429. Short waits read best in seconds, longer ones in
// minutes (as on the unlock page, app/unlock/wait.ts) and the daily budget, which resets at midnight UTC, in hours.
// Every unit rounds up, so the copy never suggests retrying before the limit allows it.

/** From this many seconds up, a wait reads better in minutes. */
const MINUTES_FROM_SECONDS = 120;
/** From this many minutes up, in hours. */
const HOURS_FROM_MINUTES = 120;
/** Wait to show when a 429 arrives without a usable Retry-After header. */
export const DEFAULT_WAIT_SECONDS = 60;

export type WaitUnit = "s" | "min" | "h";

export function aiWait(retryAfterSeconds: number | undefined): { unit: WaitUnit; value: number } {
  const seconds =
    retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? Math.ceil(retryAfterSeconds) : DEFAULT_WAIT_SECONDS;
  if (seconds < MINUTES_FROM_SECONDS) return { unit: "s", value: seconds };
  const minutes = Math.ceil(seconds / 60);
  if (minutes < HOURS_FROM_MINUTES) return { unit: "min", value: minutes };
  return { unit: "h", value: Math.ceil(minutes / 60) };
}

/** True for the 429 of the server's daily AI budget (its message names the daily limit), not the per-client limit. */
export function isDailyLimit(message: string | undefined): boolean {
  return typeof message === "string" && /daily/i.test(message);
}
