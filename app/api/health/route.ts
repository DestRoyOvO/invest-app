import { readEnv } from "@/lib/server/env";
import { buildHealth } from "@/lib/server/health";
import { jsonOk } from "@/lib/server/http";
import { hasValidSession, readAuthConfig } from "@/lib/server/session";

// GET /api/health          -> HealthResponse, 200 while the server runs (liveness; no upstream calls).
// GET /api/health?ready=1  -> adds the Yahoo call statistics; 503 after sustained upstream failure (readiness).
// Open in SITE_ACCESS=private mode too (see proxy.ts), so uptime monitors and the Docker HEALTHCHECK can reach it;
// there only a signed-in caller sees the times of the latest Yahoo calls.

/** ?ready, ?ready=1 and ?ready=true ask for readiness. */
function wantsReadiness(request: Request): boolean {
  const value = new URL(request.url).searchParams.get("ready");
  return value !== null && ["", "1", "true"].includes(value.trim().toLowerCase());
}

export async function GET(request: Request): Promise<Response> {
  const activity = readEnv().siteAccess !== "private" || hasValidSession(request, readAuthConfig());
  const { status, body } = buildHealth({ ready: wantsReadiness(request), activity });
  return jsonOk(body, { status });
}
