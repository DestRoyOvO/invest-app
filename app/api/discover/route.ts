import type { DiscoverScreen } from "@/types/api";
import { DEFAULT_MIN_MARKET_CAP, DISCOVER_SCREENS, getDiscover } from "@/lib/server/discover";
import { jsonError, jsonOk, upstreamError } from "@/lib/server/http";
import { limitPublicRequest } from "@/lib/server/request-guard";

const CACHE_SECONDS = 60;
/** Accepted market-cap floors: 0 (no floor) up to $100B. */
const MAX_MIN_CAP = 1e11;

/** GET /api/discover?screen=day_gainers[&minCap=1000000000] -> DiscoverResponse */
export async function GET(request: Request): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const screen = params.get("screen") ?? "day_gainers";
  if (!DISCOVER_SCREENS.includes(screen as DiscoverScreen)) {
    return jsonError(400, "bad_request", `screen must be one of ${DISCOVER_SCREENS.join(", ")}.`);
  }
  const minCapParam = params.get("minCap");
  const minCap = minCapParam === null ? DEFAULT_MIN_MARKET_CAP : Number(minCapParam);
  if (!Number.isFinite(minCap) || minCap < 0 || minCap > MAX_MIN_CAP) return jsonError(400, "bad_request", "minCap must be between 0 and 1e11.");

  try {
    return jsonOk(await getDiscover(screen as DiscoverScreen, minCap), { cacheSeconds: CACHE_SECONDS });
  } catch (error) {
    return upstreamError("api/discover", error);
  }
}
