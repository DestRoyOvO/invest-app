import type { NewsResponse } from "@/types/api";
import { extraUnits, uncachedStockNewsCalls } from "@/lib/server/charging";
import { jsonError, jsonOk, upstreamError } from "@/lib/server/http";
import { getStockNews } from "@/lib/server/market";
import { chargePublicRequest, limitPublicRequest } from "@/lib/server/request-guard";
import { normalizeSymbol } from "@/lib/symbols";

const CACHE_SECONDS = 300;

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** GET /api/stock/[symbol]/news -> NewsResponse: company news first, then industry and macro context. */
export async function GET(request: Request, ctx: { params: Promise<{ symbol: string }> }): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;

  const symbol = normalizeSymbol(decodeParam((await ctx.params).symbol));
  if (!symbol) return jsonError(400, "bad_request", "Invalid symbol.");

  // An uncached feed can take up to 7 Yahoo calls (quote, summary, news searches): each one beyond the first costs a unit.
  const charged = chargePublicRequest(request, extraUnits(uncachedStockNewsCalls(symbol)));
  if (charged) return charged;

  try {
    const news = await getStockNews(symbol);
    if (!news) return jsonError(404, "not_found", `No market data for ${symbol}.`);
    const body: NewsResponse = { asOf: new Date().toISOString(), news };
    return jsonOk(body, { cacheSeconds: CACHE_SECONDS });
  } catch (error) {
    return upstreamError("api/stock/news", error);
  }
}
