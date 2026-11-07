import { getAuthStatus } from "@/lib/server/auth";
import { jsonOk } from "@/lib/server/http";

// GET /api/auth/status -> AuthStatus (never cached: it depends on the session cookie).

export async function GET(request: Request): Promise<Response> {
  return jsonOk(getAuthStatus(request));
}
