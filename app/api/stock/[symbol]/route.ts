import { extraUnits, uncachedStockDetailCalls } from "@/lib/server/charging";
import { jsonError, jsonOk, upstreamError } from "@/lib/server/http";
import { chargePublicRequest, limitPublicRequest } from "@/lib/server/request-guard";
import { getStockDetail } from "@/lib/server/market";
import { isSessionActive } from "@/lib/server/yahoo";
import { normalizeSymbol } from "@/lib/symbols";

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ symbol: string }> }): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;

  const symbol = normalizeSymbol(decodeParam((await ctx.params).symbol));
  if (!symbol) return jsonError(400, "bad_request", "Invalid symbol.");

  // An uncached page can take up to 7 Yahoo calls (quote, summary, news searches): each one beyond the first costs a unit.
  const charged = chargePublicRequest(request, extraUnits(uncachedStockDetailCalls(symbol)));
  if (charged) return charged;

  try {
    const detail = await getStockDetail(symbol);
    if (!detail) return jsonError(404, "not_found", `No market data for ${symbol}.`);
    return jsonOk(detail, { cacheSeconds: isSessionActive(detail.quote.marketState) ? 15 : 60 });
  } catch (error) {
    return upstreamError("api/stock", error);
  }
}
