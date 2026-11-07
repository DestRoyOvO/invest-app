import { NextResponse } from "next/server";

import { parseLoginRequest } from "@/lib/server/ai-schemas";
import { createSessionToken, passwordMatches, readAuthConfig, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/auth";
import { clientIp, jsonError } from "@/lib/server/http";
import { clientKey, consumeRateLimit, GLOBAL_KEY, RATE_LIMITS } from "@/lib/server/rate-limit";
import { rateLimitedResponse, readJsonRequest, rejectCrossSite } from "@/lib/server/request-guard";

// POST /api/auth/login  { password } -> 204 with the session cookie, 401 for a wrong password.

const MAX_BODY_BYTES = 1024;
const RATE_LIMITED_MESSAGE = "Too many sign-in attempts. Please wait and try again.";

export async function POST(request: Request): Promise<Response> {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;

  const config = readAuthConfig();
  if (config.mode !== "password") return jsonError(400, "bad_request", "Sign-in is not enabled on this server.");

  // Counted before the password is checked, so every attempt (right or wrong) uses the budget: first per client,
  // then for the whole server.
  const perClient = consumeRateLimit(RATE_LIMITS.login, clientKey(clientIp(request)));
  if (!perClient.ok) return rateLimitedResponse(perClient.retryAfterSeconds, RATE_LIMITED_MESSAGE);
  const overall = consumeRateLimit(RATE_LIMITS.loginGlobal, GLOBAL_KEY);
  if (!overall.ok) return rateLimitedResponse(overall.retryAfterSeconds, RATE_LIMITED_MESSAGE);

  if (!config.sessionKey || !config.password) {
    console.error("[auth] SESSION_SECRET is missing or shorter than 32 characters; refusing to create sessions.");
    return jsonError(503, "ai_unavailable", "Sign-in is temporarily unavailable.");
  }

  const body = await readJsonRequest(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = parseLoginRequest(body.body);
  if (!parsed.ok) return jsonError(400, "bad_request", "A password is required.");

  if (!passwordMatches(parsed.data.password, config.password)) {
    return jsonError(401, "unauthorized", "Incorrect password.");
  }

  const response = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, createSessionToken(config.sessionKey), sessionCookieOptions());
  return response;
}
