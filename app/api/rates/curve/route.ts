import { extraUnits } from "@/lib/server/charging";
import { jsonOk, upstreamError } from "@/lib/server/http";
import { getYieldCurve, uncachedRatesCalls } from "@/lib/server/rates";
import { chargePublicRequest, limitPublicRequest } from "@/lib/server/request-guard";

/** Treasury publishes once a business day, so the curve can be shared for half an hour. */
const CACHE_SECONDS = 1_800;
const STALE_CACHE_SECONDS = 300;

/** GET /api/rates/curve -> YieldCurveResponse */
export async function GET(request: Request): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;
  const charged = chargePublicRequest(request, extraUnits(uncachedRatesCalls()));
  if (charged) return charged;

  try {
    const curve = await getYieldCurve();
    return jsonOk(curve, { cacheSeconds: curve.stale ? STALE_CACHE_SECONDS : CACHE_SECONDS });
  } catch (error) {
    return upstreamError("api/rates/curve", error);
  }
}
