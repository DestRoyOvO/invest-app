import { getCalendar } from "@/lib/server/calendar";
import { extraUnits, uncachedQuoteCalls } from "@/lib/server/charging";
import { jsonError, jsonOk, upstreamError } from "@/lib/server/http";
import { chargePublicRequest, limitPublicRequest } from "@/lib/server/request-guard";
import { parseSymbolList } from "@/lib/symbols";
import { UNIVERSE_STOCKS } from "@/lib/universe";

const MAX_SYMBOLS = 100;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const CACHE_SECONDS = 300;

/** GET /api/calendar?symbols=A,B&days=30[&scope=universe] -> CalendarResponse */
export async function GET(request: Request): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const daysParam = params.get("days");
  const days = daysParam === null ? DEFAULT_DAYS : Number(daysParam);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return jsonError(400, "bad_request", `days must be an integer from 1 to ${MAX_DAYS}.`);

  const scope = params.get("scope");
  if (scope !== null && scope !== "universe") return jsonError(400, "bad_request", "scope must be universe.");
  const { symbols, tooMany } = parseSymbolList(params.get("symbols"), MAX_SYMBOLS);
  if (tooMany) return jsonError(400, "bad_request", `Request at most ${MAX_SYMBOLS} symbols at a time.`);
  const all = scope === "universe" ? [...new Set([...symbols, ...UNIVERSE_STOCKS])] : symbols;

  // One unit per uncached Yahoo call beyond the first, like /api/sparklines: the universe added to a long list passes
  // 100 symbols, and getQuotes then sends a second batch.
  const charged = chargePublicRequest(request, extraUnits(uncachedQuoteCalls(all)));
  if (charged) return charged;

  try {
    return jsonOk(await getCalendar(all, days), { cacheSeconds: CACHE_SECONDS });
  } catch (error) {
    return upstreamError("api/calendar", error);
  }
}
