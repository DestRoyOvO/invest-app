import { extraUnits } from "@/lib/server/charging";
import { jsonError, jsonOk, upstreamError } from "@/lib/server/http";
import { getImpliedMoveResponse, uncachedImpliedMoveCalls } from "@/lib/server/options";
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

/**
 * GET /api/stock/[symbol]/implied-move -> ImpliedMoveResponse: the approximate ATM straddle through the first expiry
 * after the next report, or { available: false, reason } when there is none (no listed options, no report within 30
 * days, no usable quotes): a normal answer the calendar and the earnings panel show, not an error the browser logs.
 * 404 not_found only for a symbol Yahoo does not know.
 */
export async function GET(request: Request, ctx: { params: Promise<{ symbol: string }> }): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;

  const { symbol: param } = await ctx.params;
  const symbol = normalizeSymbol(decodeParam(param));
  if (!symbol) return jsonError(400, "bad_request", "Invalid symbol.");

  // Up to two options() calls when uncached (expiries, then the target expiry): the second costs an extra unit.
  const charged = chargePublicRequest(request, extraUnits(uncachedImpliedMoveCalls(symbol)));
  if (charged) return charged;

  try {
    const data = await getImpliedMoveResponse(symbol);
    if (!data) return jsonError(404, "not_found", `Unknown symbol ${symbol}.`);
    return jsonOk(data, { cacheSeconds: CACHE_SECONDS });
  } catch (error) {
    return upstreamError("api/stock/implied-move", error);
  }
}
