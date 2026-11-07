import { jsonError, jsonOk, upstreamError } from "@/lib/server/http";
import { limitPublicRequest } from "@/lib/server/request-guard";
import { getFactorProfile } from "@/lib/server/screener";
import { normalizeSymbol } from "@/lib/symbols";

/** The first profile may build the universe snapshot (daily bars for every universe stock). */
export const maxDuration = 60;

const CACHE_SECONDS = 300;

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** GET /api/stock/[symbol]/factors -> FactorProfile (404 not_found when the symbol has no price history). */
export async function GET(request: Request, ctx: { params: Promise<{ symbol: string }> }): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;

  const { symbol: param } = await ctx.params;
  const symbol = normalizeSymbol(decodeParam(param));
  if (!symbol) return jsonError(400, "bad_request", "Invalid symbol.");

  try {
    const profile = await getFactorProfile(symbol);
    if (!profile) return jsonError(404, "not_found", `No price history for ${symbol}.`);
    return jsonOk(profile, { cacheSeconds: CACHE_SECONDS });
  } catch (error) {
    return upstreamError("api/stock/factors", error);
  }
}
