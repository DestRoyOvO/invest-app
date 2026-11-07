import { extraUnits } from "@/lib/server/charging";
import { jsonError, jsonOk, upstreamError } from "@/lib/server/http";
import { getProfiles, MAX_PROFILE_SYMBOLS, uncachedProfileCalls } from "@/lib/server/profiles";
import { chargePublicRequest, limitPublicRequest } from "@/lib/server/request-guard";
import { parseSymbolList } from "@/lib/symbols";

/** Profiles change rarely; the summary cache behind them is fresh for 6 hours. */
const CACHE_SECONDS = 3600;
/** Shorter shared-cache lifetime when some lookups failed, so a Yahoo hiccup is not pinned for long. */
const DEGRADED_CACHE_SECONDS = 60;

/** GET /api/profiles?symbols=A,B -> ProfilesResponse (sector, industry and country for portfolio exposure). */
export async function GET(request: Request): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;

  const { symbols, tooMany } = parseSymbolList(new URL(request.url).searchParams.get("symbols"), MAX_PROFILE_SYMBOLS);
  if (tooMany) return jsonError(400, "bad_request", `Request at most ${MAX_PROFILE_SYMBOLS} symbols at a time.`);
  if (symbols.length === 0) return jsonError(400, "bad_request", "Provide at least one valid symbol, e.g. ?symbols=PLTR,SHOP.");

  // Every uncached profile is one Yahoo call, so it costs one unit of the client's budget beyond the first.
  const charged = chargePublicRequest(request, extraUnits(uncachedProfileCalls(symbols)));
  if (charged) return charged;

  try {
    const body = await getProfiles(symbols);
    return jsonOk(body, { cacheSeconds: body.degraded ? DEGRADED_CACHE_SECONDS : CACHE_SECONDS });
  } catch (error) {
    return upstreamError("api/profiles", error);
  }
}
