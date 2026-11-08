import type { ChartRange } from "@/types/api";
import { jsonError, jsonOk, upstreamError } from "@/lib/server/http";
import { limitPublicRequest } from "@/lib/server/request-guard";
import { getChartData } from "@/lib/server/market";
import { CHART_RANGES } from "@/lib/server/yahoo";
import { normalizeSymbol } from "@/lib/symbols";

const DEFAULT_RANGE: ChartRange = "1y";

function isChartRange(value: string): value is ChartRange {
  return (CHART_RANGES as readonly string[]).includes(value);
}

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * GET /api/stock/[symbol]/chart?range=1y -> ChartData. Intraday ranges (1d, 5d) refresh every minute on the server
 * while the session trades, so the shared cache keeps them briefly; longer ranges for a minute.
 */
export async function GET(request: Request, ctx: { params: Promise<{ symbol: string }> }): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;

  const symbol = normalizeSymbol(decodeParam((await ctx.params).symbol));
  if (!symbol) return jsonError(400, "bad_request", "Invalid symbol.");
  const range = new URL(request.url).searchParams.get("range") || DEFAULT_RANGE;
  if (!isChartRange(range)) return jsonError(400, "bad_request", `The range parameter must be one of: ${CHART_RANGES.join(", ")}.`);

  try {
    const chart = await getChartData(symbol, range);
    if (!chart) return jsonError(404, "not_found", `No market data for ${symbol}.`);
    return jsonOk(chart, { cacheSeconds: chart.intraday ? 30 : 60 });
  } catch (error) {
    return upstreamError("api/stock/chart", error);
  }
}
