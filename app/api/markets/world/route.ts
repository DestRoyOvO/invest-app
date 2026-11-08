import { extraUnits } from "@/lib/server/charging";
import { jsonOk, upstreamError } from "@/lib/server/http";
import { chargePublicRequest, limitPublicRequest } from "@/lib/server/request-guard";
import { getWorldMarkets, uncachedWorldCalls } from "@/lib/server/world";

const CACHE_SECONDS = 15;
/** Shorter shared-cache lifetime while some series are missing, so the next poll picks them up. */
const PARTIAL_CACHE_SECONDS = 5;

/** GET /api/markets/world -> WorldMarketsResponse */
export async function GET(request: Request): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;
  // A cold board costs one batched quote request plus one chart request per series, like /api/sparklines.
  const charged = chargePublicRequest(request, extraUnits(uncachedWorldCalls()));
  if (charged) return charged;

  try {
    const world = await getWorldMarkets();
    return jsonOk(world, { cacheSeconds: world.warnings.includes("sparklines") ? PARTIAL_CACHE_SECONDS : CACHE_SECONDS });
  } catch (error) {
    return upstreamError("api/markets/world", error);
  }
}
