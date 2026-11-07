import "server-only";

import { timingSafeEqual } from "node:crypto";

import type { AuthStatus } from "@/types/api";

import { isAiConfigured } from "./deepseek";
import { readEnv, type RawEnv } from "./env";
import { hasValidSession, readAuthConfig, SESSION_TTL_SECONDS, sha256, type AuthConfig } from "./session";

// Access control for the AI features.
//
// Modes, from the environment (see lib/server/env.ts):
// - "password": ACCESS_PASSWORD is set. AI requires a signed session cookie obtained via POST /api/auth/login.
//   SESSION_SECRET must be at least 32 characters, otherwise no session can be created or verified.
// - "open":     ACCESS_PASSWORD is unset outside production (local development). AI is open.
// - "disabled": ACCESS_PASSWORD is unset in production. AI is unavailable.
//
// Session tokens and the cookie name live in session.ts, which proxy.ts also uses for SITE_ACCESS=private.

export {
  createSessionToken,
  hasValidSession,
  MIN_SECRET_LENGTH,
  readAuthConfig,
  readCookie,
  SECURE_SESSION_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieName,
  verifySessionToken,
  type AuthConfig,
  type AuthMode,
} from "./session";

/** Compares two passwords in constant time (SHA-256 digests have equal length regardless of the inputs). */
export function passwordMatches(candidate: string, expected: string): boolean {
  return timingSafeEqual(sha256(candidate), sha256(expected));
}

export function getAuthStatus(
  request: Request,
  config: AuthConfig = readAuthConfig(),
  aiConfigured: boolean = isAiConfigured(),
): AuthStatus {
  switch (config.mode) {
    case "open":
      return { aiConfigured, authRequired: false, authenticated: true, aiAvailable: aiConfigured };
    case "disabled":
      return { aiConfigured, authRequired: false, authenticated: true, aiAvailable: false };
    case "password": {
      const authenticated = hasValidSession(request, config);
      return { aiConfigured, authRequired: true, authenticated, aiAvailable: aiConfigured && authenticated };
    }
  }
}

export interface AiAccessDenied {
  status: 401 | 403;
  code: "unauthorized" | "ai_unavailable" | "forbidden";
  message: string;
}

/** True for localhost, *.localhost, 127.x.x.x and [::1], with or without a port. */
export function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${host.trim()}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "[::1]") return true;
  const parts = hostname.split(".");
  return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^[0-9]{1,3}$/.test(part));
}

/** Null when the request may use the AI endpoints, otherwise the error to return. */
export function checkAiAccess(
  request: Request,
  config: AuthConfig = readAuthConfig(),
  aiConfigured: boolean = isAiConfigured(),
): AiAccessDenied | null {
  if (config.mode === "disabled") {
    return { status: 403, code: "ai_unavailable", message: "AI features are disabled on this deployment." };
  }
  if (config.mode === "open" && !isLoopbackHost(request.headers.get("host") ?? new URL(request.url).host)) {
    // Open mode is for local development only. Refusing other host names also stops DNS-rebinding pages, which reach
    // the local server under their own name.
    return { status: 403, code: "forbidden", message: "Without ACCESS_PASSWORD, AI features only answer on localhost." };
  }
  if (config.mode === "password") {
    if (!config.sessionKey) {
      return { status: 403, code: "ai_unavailable", message: "AI features are temporarily unavailable." };
    }
    if (!hasValidSession(request, config)) {
      return { status: 401, code: "unauthorized", message: "Sign in to use the AI features." };
    }
  }
  if (!aiConfigured) {
    return { status: 403, code: "ai_unavailable", message: "AI is not configured on this server." };
  }
  return null;
}

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
}

/** Cookie attributes for the session cookie; Secure in production, which the __Host- name also requires. */
export function sessionCookieOptions(source?: RawEnv): SessionCookieOptions {
  return { httpOnly: true, sameSite: "lax", secure: readEnv(source).isProduction, path: "/", maxAge: SESSION_TTL_SECONDS };
}
