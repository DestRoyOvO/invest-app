import { isAiConfigured } from "@/lib/server/deepseek";
import { jsonOk } from "@/lib/server/http";
import type { HealthResponse } from "@/types/api";

// GET /api/health -> HealthResponse (liveness probe; no upstream calls).

export async function GET(): Promise<Response> {
  const body: HealthResponse = { ok: true, time: new Date().toISOString(), aiConfigured: isAiConfigured() };
  return jsonOk(body);
}
