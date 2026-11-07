import type { NewsResponse } from "@/types/api";
import { jsonError, jsonOk, upstreamError } from "@/lib/server/http";
import { limitPublicRequest } from "@/lib/server/request-guard";
import { getSectorNews } from "@/lib/server/news";
import { getSector, SECTOR_KEYS } from "@/lib/universe";

export async function GET(request: Request): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;

  const sector = getSector(new URL(request.url).searchParams.get("sector") ?? "");
  if (!sector) return jsonError(400, "bad_request", `The sector parameter must be one of: ${SECTOR_KEYS.join(", ")}.`);

  try {
    const body: NewsResponse = { asOf: new Date().toISOString(), news: await getSectorNews(sector.key) };
    return jsonOk(body, { cacheSeconds: 120 });
  } catch (error) {
    return upstreamError("api/news", error);
  }
}
