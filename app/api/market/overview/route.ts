import { jsonOk, upstreamError } from "@/lib/server/http";
import { limitPublicRequest } from "@/lib/server/request-guard";
import { getMarketOverview } from "@/lib/server/market";
import { isSessionActive } from "@/lib/server/yahoo";

export async function GET(request: Request): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;

  try {
    const overview = await getMarketOverview();
    return jsonOk(overview, { cacheSeconds: isSessionActive(overview.marketState) ? 15 : 60 });
  } catch (error) {
    return upstreamError("api/market/overview", error);
  }
}
