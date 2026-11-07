import type { ScreenerUniverse } from "@/types/api";
import { jsonError, jsonOk, upstreamError } from "@/lib/server/http";
import { limitPublicRequest } from "@/lib/server/request-guard";
import { getScreener } from "@/lib/server/screener";

/** A cold snapshot loads daily bars for every universe symbol (queued four at a time), so allow it time to finish. */
export const maxDuration = 60;

/** Shared CDN cache; the snapshot itself is rebuilt at most every 10 minutes. */
const CACHE_SECONDS = 120;
const DEGRADED_CACHE_SECONDS = 30;

const UNIVERSES = new Set<ScreenerUniverse>(["stocks", "etfs"]);

/** GET /api/screener?universe=stocks|etfs -> ScreenerResponse */
export async function GET(request: Request): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;

  const param = new URL(request.url).searchParams.get("universe") ?? "stocks";
  if (!UNIVERSES.has(param as ScreenerUniverse)) return jsonError(400, "bad_request", "universe must be stocks or etfs.");

  try {
    const snapshot = await getScreener(param as ScreenerUniverse);
    return jsonOk(snapshot, { cacheSeconds: snapshot.warnings.length ? DEGRADED_CACHE_SECONDS : CACHE_SECONDS });
  } catch (error) {
    return upstreamError("api/screener", error);
  }
}
