import type { Sparklines } from "@/types/api";
import { jsonError, jsonOk, upstreamError } from "@/lib/server/http";
import { chargePublicRequest, limitPublicRequest } from "@/lib/server/request-guard";
import { getSparkline, hasCachedSparkline } from "@/lib/server/yahoo";
import { parseSymbolList } from "@/lib/symbols";

const MAX_SYMBOLS = 50;
const CACHE_SECONDS = 300;
/** Shorter shared-cache lifetime when some series failed, so a Yahoo hiccup is not pinned for long. */
const DEGRADED_CACHE_SECONDS = 30;

export async function GET(request: Request): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;

  const { symbols, tooMany } = parseSymbolList(new URL(request.url).searchParams.get("symbols"), MAX_SYMBOLS);
  if (tooMany) return jsonError(400, "bad_request", `Request at most ${MAX_SYMBOLS} symbols at a time.`);
  if (symbols.length === 0) return jsonError(400, "bad_request", "Provide at least one valid symbol, e.g. ?symbols=AAPL,MSFT.");

  // Every uncached series is one Yahoo call, so it costs one unit of the client's budget beyond the first.
  const uncached = symbols.filter((symbol) => !hasCachedSparkline(symbol)).length;
  const charged = chargePublicRequest(request, Math.max(0, uncached - 1));
  if (charged) return charged;

  try {
    const settled = await Promise.allSettled(symbols.map((symbol) => getSparkline(symbol)));
    const failed = settled.some((outcome) => outcome.status === "rejected");
    const body: Sparklines = Object.fromEntries(
      symbols.map((symbol, i) => {
        const outcome = settled[i];
        return [symbol, outcome.status === "fulfilled" ? outcome.value : []];
      }),
    );
    return jsonOk(body, { cacheSeconds: failed ? DEGRADED_CACHE_SECONDS : CACHE_SECONDS });
  } catch (error) {
    return upstreamError("api/sparklines", error);
  }
}
