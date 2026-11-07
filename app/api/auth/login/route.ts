import { NextResponse } from "next/server";

import { parseLoginRequest } from "@/lib/server/ai-schemas";
import { createSessionToken, passwordMatches, readAuthConfig, sessionCookieOptions } from "@/lib/server/auth";
import { MINUTE } from "@/lib/server/cache";
import { clientIp, jsonError } from "@/lib/server/http";
import { log, logThrottled } from "@/lib/server/log";
import { clientKey, consumeRateLimit, GLOBAL_KEY, RATE_LIMITS } from "@/lib/server/rate-limit";
import { rateLimitedResponse, readJsonRequest, rejectCrossSite } from "@/lib/server/request-guard";

// POST /api/auth/login  { password } -> 204 with the session cookie, 401 for a wrong password.

const MAX_BODY_BYTES = 1024;
const RATE_LIMITED_MESSAGE = "Too many sign-in attempts. Please wait and try again.";

/**
 * 429 for an attempt over the per-client or the server-wide limit. Logged at most once a minute per limit, so that a
 * flood of attempts shows in the logs without filling them.
 */
function signInLimited(scope: "client" | "server", client: string, retryAfterSeconds: number): Response {
  logThrottled(`auth.rate_limited:${scope}`, MINUTE, "warn", "auth.rate_limited", { scope, client, retryAfterSeconds });
  return rateLimitedResponse(retryAfterSeconds, RATE_LIMITED_MESSAGE);
}

export async function POST(request: Request): Promise<Response> {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;

  const config = readAuthConfig();
  if (config.mode !== "password") return jsonError(400, "bad_request", "Sign-in is not enabled on this server.");

  // Counted before the password is checked, so every attempt (right or wrong) uses the budget: first per client,
  // then for the whole server.
  const client = clientKey(clientIp(request));
  const perClient = consumeRateLimit(RATE_LIMITS.login, client);
  if (!perClient.ok) return signInLimited("client", client, perClient.retryAfterSeconds);
  const overall = consumeRateLimit(RATE_LIMITS.loginGlobal, GLOBAL_KEY);
  if (!overall.ok) return signInLimited("server", client, overall.retryAfterSeconds);

  if (!config.sessionKey || !config.password) {
    log("error", "auth.sign_in_unavailable", { reason: "SESSION_SECRET is missing or shorter than 32 characters" });
    return jsonError(503, "ai_unavailable", "Sign-in is temporarily unavailable.");
  }

  const body = await readJsonRequest(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = parseLoginRequest(body.body);
  if (!parsed.ok) return jsonError(400, "bad_request", "A password is required.");

  if (!passwordMatches(parsed.data.password, config.password)) {
    // Every failure is logged: the limits above already cap them at 30 per 15 minutes.
    log("warn", "auth.sign_in_failed", { client });
    return jsonError(401, "unauthorized", "Incorrect password.");
  }

  const response = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  response.cookies.set(config.cookieName, createSessionToken(config.sessionKey), sessionCookieOptions());
  return response;
}
