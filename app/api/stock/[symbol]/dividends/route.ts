import { extraUnits, uncachedDividendsCalls } from "@/lib/server/charging";
import { jsonError, jsonOk, upstreamError } from "@/lib/server/http";
import { chargePublicRequest, limitPublicRequest } from "@/lib/server/request-guard";
import { getDividends } from "@/lib/server/research";
import { normalizeSymbol } from "@/lib/symbols";

const CACHE_SECONDS = 3600;

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** GET /api/stock/[symbol]/dividends -> DividendHistory (empty payments for a stock that pays none; 404 if unknown). */
export async function GET(request: Request, ctx: { params: Promise<{ symbol: string }> }): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;

  const symbol = normalizeSymbol(decodeParam((await ctx.params).symbol));
  if (!symbol) return jsonError(400, "bad_request", "Invalid symbol.");

  // An uncached load makes up to 2 Yahoo calls (the dividend chart and the quote): the second costs a unit.
  const charged = chargePublicRequest(request, extraUnits(uncachedDividendsCalls(symbol)));
  if (charged) return charged;

  try {
    const data = await getDividends(symbol);
    if (!data) return jsonError(404, "not_found", `No market data for ${symbol}.`);
    return jsonOk(data, { cacheSeconds: CACHE_SECONDS });
  } catch (error) {
    return upstreamError("api/stock/dividends", error);
  }
}
