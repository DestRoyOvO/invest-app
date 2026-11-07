import { extraUnits, uncachedOwnershipCalls } from "@/lib/server/charging";
import { jsonError, jsonOk, upstreamError } from "@/lib/server/http";
import { chargePublicRequest, limitPublicRequest } from "@/lib/server/request-guard";
import { getOwnership } from "@/lib/server/research";
import { normalizeSymbol } from "@/lib/symbols";

const CACHE_SECONDS = 3600;

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** GET /api/stock/[symbol]/ownership -> OwnershipData (404 not_found when Yahoo has none, e.g. for funds). */
export async function GET(request: Request, ctx: { params: Promise<{ symbol: string }> }): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;

  const symbol = normalizeSymbol(decodeParam((await ctx.params).symbol));
  if (!symbol) return jsonError(400, "bad_request", "Invalid symbol.");

  const charged = chargePublicRequest(request, extraUnits(uncachedOwnershipCalls(symbol)));
  if (charged) return charged;

  try {
    const data = await getOwnership(symbol);
    if (!data) return jsonError(404, "not_found", `No ownership data for ${symbol}.`);
    return jsonOk(data, { cacheSeconds: CACHE_SECONDS });
  } catch (error) {
    return upstreamError("api/stock/ownership", error);
  }
}
