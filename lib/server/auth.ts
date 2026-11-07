import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { AuthStatus } from "@/types/api";

import { isAiConfigured } from "./deepseek";

// Access control for the AI features.
//
// Modes, from the environment:
// - "password": ACCESS_PASSWORD is set. AI requires a signed session cookie obtained via POST /api/auth/login.
//   SESSION_SECRET must be at least 32 characters, otherwise no session can be created or verified.
// - "open":     ACCESS_PASSWORD is unset outside production (local development). AI is open.
// - "disabled": ACCESS_PASSWORD is unset in production. AI is unavailable.
//
// A session token is "v1.<expiry epoch seconds>.<nonce>.<HMAC-SHA256 signature>". The signing key is derived from
// SESSION_SECRET and ACCESS_PASSWORD, so rotating either one signs every existing session out.

export const SESSION_COOKIE = "is_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MIN_SECRET_LENGTH = 32;

const TOKEN_VERSION = "v1";
const MAX_TOKEN_LENGTH = 256;
/** Tolerated clock skew when checking that an expiry is not further away than the TTL allows. */
const EXPIRY_SKEW_SECONDS = 60;

export type AuthMode = "password" | "open" | "disabled";

export interface AuthConfig {
  mode: AuthMode;
  /** ACCESS_PASSWORD in password mode, otherwise null. */
  password: string | null;
  /** Session signing key; null unless in password mode with a valid SESSION_SECRET. */
  sessionKey: Buffer | null;
}

type Env = Readonly<Record<string, string | undefined>>;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function deriveSessionKey(secret: string, password: string): Buffer {
  return createHmac("sha256", secret).update("investseek-session-v1\0").update(sha256(password)).digest();
}

export function readAuthConfig(env: Env = process.env): AuthConfig {
  const password = env.ACCESS_PASSWORD ?? "";
  if (password.trim() === "") {
    return { mode: env.NODE_ENV === "production" ? "disabled" : "open", password: null, sessionKey: null };
  }
  const secret = env.SESSION_SECRET ?? "";
  const sessionKey = secret.length >= MIN_SECRET_LENGTH ? deriveSessionKey(secret, password) : null;
  return { mode: "password", password, sessionKey };
}

/** Compares two passwords in constant time (SHA-256 digests have equal length regardless of the inputs). */
export function passwordMatches(candidate: string, expected: string): boolean {
  return timingSafeEqual(sha256(candidate), sha256(expected));
}

function sign(key: Buffer | string, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function createSessionToken(key: Buffer | string, nowMs: number = Date.now(), ttlSeconds: number = SESSION_TTL_SECONDS): string {
  const expiresAt = Math.floor(nowMs / 1000) + ttlSeconds;
  const payload = `${TOKEN_VERSION}.${expiresAt}.${randomBytes(16).toString("base64url")}`;
  return `${payload}.${sign(key, payload)}`;
}

const EXPIRY_PATTERN = /^\d{1,12}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** True when the token is well formed, signed with `key` and not expired. */
export function verifySessionToken(token: string | null | undefined, key: Buffer | string, nowMs: number = Date.now()): boolean {
  if (!token || token.length > MAX_TOKEN_LENGTH) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [version, expiry, nonce, signature] = parts;
  if (version !== TOKEN_VERSION || !EXPIRY_PATTERN.test(expiry) || !NONCE_PATTERN.test(nonce) || !SIGNATURE_PATTERN.test(signature)) {
    return false;
  }
  // Compare the canonical encodings, not decoded bytes: the last base64url character carries two padding bits, so
  // several strings decode to the same signature and only the canonical one should verify.
  const expected = Buffer.from(sign(key, `${version}.${expiry}.${nonce}`), "ascii");
  const actual = Buffer.from(signature, "ascii");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;

  const nowSeconds = Math.floor(nowMs / 1000);
  const expiresAt = Number(expiry);
  return expiresAt > nowSeconds && expiresAt <= nowSeconds + SESSION_TTL_SECONDS + EXPIRY_SKEW_SECONDS;
}

/** Value of one cookie from a Cookie header, or null. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function hasValidSession(request: Request, config: AuthConfig, nowMs: number = Date.now()): boolean {
  if (config.mode !== "password" || !config.sessionKey) return false;
  return verifySessionToken(readCookie(request.headers.get("cookie"), SESSION_COOKIE), config.sessionKey, nowMs);
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

/** Null when the request may use the AI endpoints, otherwise the error to return. */
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

export function sessionCookieOptions(env: Env = process.env): SessionCookieOptions {
  return { httpOnly: true, sameSite: "lax", secure: env.NODE_ENV === "production", path: "/", maxAge: SESSION_TTL_SECONDS };
}
