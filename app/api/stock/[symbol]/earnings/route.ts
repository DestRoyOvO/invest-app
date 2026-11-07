import { extraUnits } from "@/lib/server/charging";
import { getEarningsDetail, uncachedEarningsCalls } from "@/lib/server/earnings";
import { jsonError, jsonOk, upstreamError } from "@/lib/server/http";
import { chargePublicRequest, limitPublicRequest } from "@/lib/server/request-guard";
import { normalizeSymbol } from "@/lib/symbols";

const CACHE_SECONDS = 1800;

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** GET /api/stock/[symbol]/earnings -> EarningsDetail (404 not_found when Yahoo has none, e.g. for funds). */
export async function GET(request: Request, ctx: { params: Promise<{ symbol: string }> }): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;

  const { symbol: param } = await ctx.params;
  const symbol = normalizeSymbol(decodeParam(param));
  if (!symbol) return jsonError(400, "bad_request", "Invalid symbol.");

  // One quoteSummary call when uncached; each call beyond the first costs a unit of the client's budget.
  const charged = chargePublicRequest(request, extraUnits(uncachedEarningsCalls(symbol)));
  if (charged) return charged;

  try {
    const data = await getEarningsDetail(symbol);
    if (!data) return jsonError(404, "not_found", `No earnings data for ${symbol}.`);
    return jsonOk(data, { cacheSeconds: CACHE_SECONDS });
  } catch (error) {
    return upstreamError("api/stock/earnings", error);
  }
}
