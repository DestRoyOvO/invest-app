import type { QuotesResponse } from "@/types/api";
import { jsonError, jsonOk, upstreamError } from "@/lib/server/http";
import { limitPublicRequest } from "@/lib/server/request-guard";
import { getQuotes } from "@/lib/server/yahoo";
import { parseSymbolList } from "@/lib/symbols";

const MAX_SYMBOLS = 50;

export async function GET(request: Request): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;

  const { symbols, tooMany } = parseSymbolList(new URL(request.url).searchParams.get("symbols"), MAX_SYMBOLS);
  if (tooMany) return jsonError(400, "bad_request", `Request at most ${MAX_SYMBOLS} symbols at a time.`);
  if (symbols.length === 0) return jsonError(400, "bad_request", "Provide at least one valid symbol, e.g. ?symbols=AAPL,MSFT.");

  try {
    const quotes = await getQuotes(symbols);
    const body: QuotesResponse = {
      asOf: new Date().toISOString(),
      quotes: symbols.flatMap((symbol) => {
        const quote = quotes.get(symbol);
        return quote ? [quote] : [];
      }),
      missing: symbols.filter((symbol) => !quotes.has(symbol)),
    };
    return jsonOk(body, { cacheSeconds: 10 });
  } catch (error) {
    return upstreamError("api/quotes", error);
  }
}
