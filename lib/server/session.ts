import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { authModeOf, MIN_SESSION_SECRET_LENGTH, readEnv, type AuthMode, type RawEnv, type ServerEnv } from "./env";

// Session tokens and the access configuration they depend on. Kept apart from auth.ts, which also knows about the AI
// provider, so that proxy.ts can check the session on every request without bundling the OpenAI SDK.
//
// A session token is "v1.<expiry epoch seconds>.<nonce>.<HMAC-SHA256 signature>". The signing key is derived from
// SESSION_SECRET and ACCESS_PASSWORD, so rotating either one signs every existing session out.

export type { AuthMode } from "./env";

export const SESSION_COOKIE = "is_session";
/**
 * The production cookie name. Browsers only accept a __Host- cookie that is Secure, has Path=/ and no Domain, so a
 * page on a sibling subdomain cannot plant or overwrite the session.
 */
export const SECURE_SESSION_COOKIE = `__Host-${SESSION_COOKIE}`;
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MIN_SECRET_LENGTH = MIN_SESSION_SECRET_LENGTH;

const TOKEN_VERSION = "v1";
const MAX_TOKEN_LENGTH = 256;
/** Tolerated clock skew when checking that an expiry is not further away than the TTL allows. */
const EXPIRY_SKEW_SECONDS = 60;

export interface AuthConfig {
  mode: AuthMode;
  /** ACCESS_PASSWORD in password mode, otherwise null. */
  password: string | null;
  /** Session signing key; null unless in password mode with a valid SESSION_SECRET. */
  sessionKey: Buffer | null;
  /** Name of the session cookie (see sessionCookieName). */
  cookieName: string;
}

export function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function deriveSessionKey(secret: string, password: string): Buffer {
  return createHmac("sha256", secret).update("investseek-session-v1\0").update(sha256(password)).digest();
}

/** __Host-is_session in production, where cookies are Secure; is_session on the plain-http development server. */
export function sessionCookieName(env: Pick<ServerEnv, "isProduction"> = readEnv()): string {
  return env.isProduction ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
}

/** The access configuration, from process.env unless a record is given (as tests do). */
export function readAuthConfig(source?: RawEnv): AuthConfig {
  const env = readEnv(source);
  const mode = authModeOf(env);
  const cookieName = sessionCookieName(env);
  if (env.accessPassword === null) return { mode, password: null, sessionKey: null, cookieName };
  const sessionKey = env.sessionSecret === null ? null : deriveSessionKey(env.sessionSecret, env.accessPassword);
  return { mode, password: env.accessPassword, sessionKey, cookieName };
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

/** True when the request carries a valid session cookie for this configuration. */
export function hasValidSession(request: Request, config: AuthConfig, nowMs: number = Date.now()): boolean {
  if (config.mode !== "password" || !config.sessionKey) return false;
  return verifySessionToken(readCookie(request.headers.get("cookie"), config.cookieName), config.sessionKey, nowMs);
}
