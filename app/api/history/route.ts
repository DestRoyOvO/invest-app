import type { HistoryRange } from "@/types/api";
import { getHistory, hasCachedHistory, isHistoryRange } from "@/lib/server/history";
import { jsonError, jsonOk, upstreamError } from "@/lib/server/http";
import { chargePublicRequest, limitPublicRequest } from "@/lib/server/request-guard";
import { parseSymbolList } from "@/lib/symbols";

const MAX_SYMBOLS = 25;
const CACHE_SECONDS = 600;
/** Shorter shared-cache lifetime when some series failed, so a Yahoo hiccup is not pinned for long. */
const DEGRADED_CACHE_SECONDS = 30;

export async function GET(request: Request): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const rangeParam = params.get("range");
  if (rangeParam !== null && !isHistoryRange(rangeParam)) return jsonError(400, "bad_request", "range must be one of 6mo, 1y, 2y, 5y.");
  const range: HistoryRange = rangeParam ?? "1y";

  const { symbols, tooMany } = parseSymbolList(params.get("symbols"), MAX_SYMBOLS);
  if (tooMany) return jsonError(400, "bad_request", `Request at most ${MAX_SYMBOLS} symbols at a time.`);
  if (symbols.length === 0) return jsonError(400, "bad_request", "Provide at least one valid symbol, e.g. ?symbols=AAPL,SPY.");

  // Every uncached series is one Yahoo call, so it costs one unit of the client's budget beyond the first.
  const uncached = symbols.filter((symbol) => !hasCachedHistory(symbol, range)).length;
  const charged = chargePublicRequest(request, Math.max(0, uncached - 1));
  if (charged) return charged;

  try {
    const history = await getHistory(symbols, range);
    return jsonOk(history, { cacheSeconds: history.degraded ? DEGRADED_CACHE_SECONDS : CACHE_SECONDS });
  } catch (error) {
    return upstreamError("api/history", error);
  }
}
