/** From this many seconds up, a wait reads better in minutes. */
const MINUTES_FROM_SECONDS = 120;
/** Wait to show when a 429 arrives without a usable Retry-After header. */
const DEFAULT_WAIT_SECONDS = 60;

/**
 * How long the unlock form asks the visitor to wait after too many attempts: whole seconds under two minutes, whole
 * minutes from then on. Both round up, so the form never suggests retrying before the limit allows it.
 */
export function retryWait(retryAfterSeconds: number | undefined): { unit: "s" | "min"; value: number } {
  const seconds =
    retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.ceil(retryAfterSeconds)
      : DEFAULT_WAIT_SECONDS;
  return seconds < MINUTES_FROM_SECONDS ? { unit: "s", value: seconds } : { unit: "min", value: Math.ceil(seconds / 60) };
}
