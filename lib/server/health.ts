import "server-only";

import type { HealthResponse } from "@/types/api";

import { MINUTE } from "./cache";
import { readEnv } from "./env";
import { APP_VERSION } from "./version";
import { getUpstreamStats, type UpstreamStats } from "./yahoo";

// The health endpoint's body. Liveness never touches Yahoo, so a Docker HEALTHCHECK cannot restart the container
// because of an upstream outage; readiness (?ready=1) reports the outcomes of the app's own recent Yahoo calls.

export { APP_VERSION } from "./version";

/** Failed calls in a row before the upstream can count as down... */
export const DOWN_AFTER_FAILURES = 5;
/** ...over at least this long, so one burst of errors during a page load does not flip readiness... */
export const DOWN_AFTER_MS = 2 * MINUTE;
/** ...with the latest failure this recent. With no calls since, an old streak says nothing about now. */
export const FAILURE_RELEVANCE_MS = 15 * MINUTE;

/** False after sustained upstream failure (see the constants above). Readiness recovers with the next success. */
export function isUpstreamReady(stats: UpstreamStats, now: number = Date.now()): boolean {
  if (stats.consecutiveFailures < DOWN_AFTER_FAILURES || stats.failingSince === null || stats.lastFailureAt === null) return true;
  const sustained = now - Date.parse(stats.failingSince) >= DOWN_AFTER_MS;
  const recent = now - Date.parse(stats.lastFailureAt) <= FAILURE_RELEVANCE_MS;
  return !(sustained && recent);
}

/**
 * Body and status for GET /api/health; `ready` adds the upstream statistics and answers 503 when not ready. With
 * `activity` false (a caller without a session on a private site) the times of the latest Yahoo calls are null: there
 * only the owner causes Yahoo calls, so those times would tell a stranger when the owner last had the app open.
 */
export function buildHealth({
  ready,
  activity = true,
  now = Date.now(),
}: {
  ready: boolean;
  activity?: boolean;
  now?: number;
}): { status: 200 | 503; body: HealthResponse } {
  const env = readEnv();
  const body: HealthResponse = {
    ok: true,
    time: new Date(now).toISOString(),
    aiConfigured: env.deepseekApiKey !== null,
    version: APP_VERSION,
    commit: env.commit,
    uptimeSeconds: Math.round(process.uptime()),
    dataSource: env.marketDataSource,
  };
  if (!ready) return { status: 200, body };
  const stats = getUpstreamStats();
  const upstreamReady = isUpstreamReady(stats, now);
  const shown = activity ? stats : { ...stats, lastSuccessAt: null, lastFailureAt: null, failingSince: null };
  return { status: upstreamReady ? 200 : 503, body: { ...body, ok: upstreamReady, upstream: { ...shown, ready: upstreamReady } } };
}
