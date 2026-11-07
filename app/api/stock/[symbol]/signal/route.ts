import { jsonError, jsonOk, upstreamError } from "@/lib/server/http";
import { limitPublicRequest } from "@/lib/server/request-guard";
import { getSignalReport, SignalNotFoundError } from "@/lib/server/signal-service";
import { normalizeSymbol } from "@/lib/symbols";

/** Shared CDN cache for reports; the service itself caches each symbol for 15 minutes. */
const CACHE_SECONDS = 300;

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** GET /api/stock/[symbol]/signal -> SignalReport (404 not_found when Yahoo has no data for the symbol). */
export async function GET(request: Request, ctx: { params: Promise<{ symbol: string }> }): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;

  const { symbol: param } = await ctx.params;
  const symbol = normalizeSymbol(decodeParam(param));
  if (!symbol) return jsonError(400, "bad_request", "Invalid symbol.");

  try {
    return jsonOk(await getSignalReport(symbol), { cacheSeconds: CACHE_SECONDS });
  } catch (error) {
    if (error instanceof SignalNotFoundError) return jsonError(404, "not_found", `No market data for ${symbol}.`);
    return upstreamError("api/stock/signal", error);
  }
}
