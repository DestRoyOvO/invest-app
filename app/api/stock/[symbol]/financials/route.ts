import { extraUnits, uncachedFinancialsCalls } from "@/lib/server/charging";
import { jsonError, jsonOk, upstreamError } from "@/lib/server/http";
import { chargePublicRequest, limitPublicRequest } from "@/lib/server/request-guard";
import { getFinancials } from "@/lib/server/research";
import { normalizeSymbol } from "@/lib/symbols";

/** Statements change after a report, so a shared cache may keep them for an hour (the server keeps them a day). */
const CACHE_SECONDS = 3600;

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** GET /api/stock/[symbol]/financials -> FinancialStatements (404 not_found without statements, e.g. for funds). */
export async function GET(request: Request, ctx: { params: Promise<{ symbol: string }> }): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;

  const symbol = normalizeSymbol(decodeParam((await ctx.params).symbol));
  if (!symbol) return jsonError(400, "bad_request", "Invalid symbol.");

  // An uncached load makes up to 5 Yahoo calls (four statements and the summary): each one beyond the first costs a unit.
  const charged = chargePublicRequest(request, extraUnits(uncachedFinancialsCalls(symbol)));
  if (charged) return charged;

  try {
    const data = await getFinancials(symbol);
    if (!data) return jsonError(404, "not_found", `No financial statements for ${symbol}.`);
    return jsonOk(data, { cacheSeconds: CACHE_SECONDS });
  } catch (error) {
    return upstreamError("api/stock/financials", error);
  }
}
