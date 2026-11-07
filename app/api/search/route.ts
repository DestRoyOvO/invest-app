import { z } from "zod";

import type { SearchResponse } from "@/types/api";
import { jsonError, jsonOk, upstreamError } from "@/lib/server/http";
import { limitPublicRequest } from "@/lib/server/request-guard";
import { searchSymbols } from "@/lib/server/yahoo";

const querySchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[^\p{Cc}]+$/u);

export async function GET(request: Request): Promise<Response> {
  const limited = limitPublicRequest(request);
  if (limited) return limited;

  const parsed = querySchema.safeParse(new URL(request.url).searchParams.get("q") ?? "");
  if (!parsed.success) return jsonError(400, "bad_request", "The q parameter must be 1 to 40 characters.");

  try {
    const body: SearchResponse = { results: await searchSymbols(parsed.data) };
    return jsonOk(body, { cacheSeconds: 3600 });
  } catch (error) {
    return upstreamError("api/search", error);
  }
}
