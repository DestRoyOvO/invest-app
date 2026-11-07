import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as status } from "@/app/api/auth/status/route";
import type { AuthStatus } from "@/types/api";

import {
  checkAiAccess,
  createSessionToken,
  getAuthStatus,
  isLoopbackHost,
  passwordMatches,
  readAuthConfig,
  readCookie,
  SECURE_SESSION_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieName,
  sessionCookieOptions,
  verifySessionToken,
} from "./auth";
import { RATE_LIMITS, resetRateLimits } from "./rate-limit";

const SECRET = "0123456789abcdef0123456789abcdef-test";
const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

function requestWith(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/auth/status", { headers });
}

function sessionCookie(token: string): Record<string, string> {
  return { cookie: `theme=dark; ${SESSION_COOKIE}=${token}; other=1` };
}

describe("session tokens", () => {
  it("round-trips a freshly created token", () => {
    const token = createSessionToken(SECRET, NOW);
    expect(token).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(verifySessionToken(token, SECRET, NOW)).toBe(true);
  });

  it("creates unique tokens", () => {
    expect(createSessionToken(SECRET, NOW)).not.toBe(createSessionToken(SECRET, NOW));
  });

  it("expires after the TTL", () => {
    const token = createSessionToken(SECRET, NOW);
    expect(verifySessionToken(token, SECRET, NOW + (SESSION_TTL_SECONDS - 1) * 1000)).toBe(true);
    expect(verifySessionToken(token, SECRET, NOW + SESSION_TTL_SECONDS * 1000)).toBe(false);
  });

  it("rejects tokens whose expiry is further away than the TTL allows", () => {
    const token = createSessionToken(SECRET, NOW, SESSION_TTL_SECONDS * 2);
    expect(verifySessionToken(token, SECRET, NOW)).toBe(false);
  });

  it("rejects tampered tokens", () => {
    const token = createSessionToken(SECRET, NOW);
    const [version, expiry, nonce, signature] = token.split(".");
    const flipped = (signature.startsWith("A") ? "B" : "A") + signature.slice(1);
    expect(verifySessionToken([version, expiry, nonce, flipped].join("."), SECRET, NOW)).toBe(false);
    expect(verifySessionToken([version, String(Number(expiry) + 60), nonce, signature].join("."), SECRET, NOW)).toBe(false);
    expect(verifySessionToken([version, expiry, `${nonce.slice(0, -1)}x`, signature].join("."), SECRET, NOW)).toBe(false);
    expect(verifySessionToken(["v2", expiry, nonce, signature].join("."), SECRET, NOW)).toBe(false);
  });

  it("accepts only the canonical signature encoding", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (let i = 0; i < 20; i += 1) {
      const token = createSessionToken(SECRET, NOW);
      const last = token.at(-1) ?? "A";
      // Flipping the lowest bit of the final character only touches padding bits: same bytes, different string.
      const variant = token.slice(0, -1) + alphabet[alphabet.indexOf(last) ^ 1];
      expect(Buffer.from(variant.split(".")[3], "base64url")).toEqual(Buffer.from(token.split(".")[3], "base64url"));
      expect(verifySessionToken(variant, SECRET, NOW)).toBe(false);
    }
  });

  it("rejects tokens signed with another key", () => {
    const token = createSessionToken(`${SECRET}-other`, NOW);
    expect(verifySessionToken(token, SECRET, NOW)).toBe(false);
  });

  it("rejects malformed input", () => {
    for (const bad of [null, undefined, "", "abc", "v1.1.2", "v1.a.b.c.d", `v1.${"9".repeat(13)}.nonce-nonce-nonce1.${"A".repeat(43)}`, "x".repeat(300)]) {
      expect(verifySessionToken(bad, SECRET, NOW)).toBe(false);
    }
  });
});

describe("passwordMatches", () => {
  it("compares in constant time over digests", () => {
    expect(passwordMatches("correct horse", "correct horse")).toBe(true);
    expect(passwordMatches("correct horse", "correct horsE")).toBe(false);
    expect(passwordMatches("short", "a much longer password")).toBe(false);
    expect(passwordMatches("", "x")).toBe(false);
    expect(passwordMatches("密码🔑", "密码🔑")).toBe(true);
  });
});

describe("readCookie", () => {
  it("finds one cookie among several", () => {
    expect(readCookie("a=1; is_session=abc.def; b=2", "is_session")).toBe("abc.def");
    expect(readCookie("is_session_old=zzz; is_session=yes", "is_session")).toBe("yes");
    expect(readCookie("a=1", "is_session")).toBeNull();
    expect(readCookie(null, "is_session")).toBeNull();
  });
});

describe("auth modes", () => {
  it("uses password mode when ACCESS_PASSWORD is set", () => {
    const config = readAuthConfig({ ACCESS_PASSWORD: "pw", SESSION_SECRET: SECRET, NODE_ENV: "production" });
    expect(config.mode).toBe("password");
    expect(config.sessionKey).not.toBeNull();
  });

  it("refuses to derive a session key from a missing or short secret", () => {
    expect(readAuthConfig({ ACCESS_PASSWORD: "pw" }).sessionKey).toBeNull();
    expect(readAuthConfig({ ACCESS_PASSWORD: "pw", SESSION_SECRET: "too-short" }).sessionKey).toBeNull();
  });

  it("is open in development and disabled in production without a password", () => {
    expect(readAuthConfig({ NODE_ENV: "development" }).mode).toBe("open");
    expect(readAuthConfig({}).mode).toBe("open");
    expect(readAuthConfig({ NODE_ENV: "production" }).mode).toBe("disabled");
    expect(readAuthConfig({ NODE_ENV: "production", ACCESS_PASSWORD: "   " }).mode).toBe("disabled");
  });

  it("signs every session out when the password changes", () => {
    const before = readAuthConfig({ ACCESS_PASSWORD: "old", SESSION_SECRET: SECRET });
    const after = readAuthConfig({ ACCESS_PASSWORD: "new", SESSION_SECRET: SECRET });
    const token = createSessionToken(before.sessionKey as Buffer);
    expect(verifySessionToken(token, before.sessionKey as Buffer)).toBe(true);
    expect(verifySessionToken(token, after.sessionKey as Buffer)).toBe(false);
  });

  it("reports the status for each mode", () => {
    const open = readAuthConfig({ NODE_ENV: "development" });
    expect(getAuthStatus(requestWith(), open, true)).toEqual<AuthStatus>({
      aiConfigured: true,
      authRequired: false,
      authenticated: true,
      aiAvailable: true,
    });
    expect(getAuthStatus(requestWith(), open, false).aiAvailable).toBe(false);

    const disabled = readAuthConfig({ NODE_ENV: "production" });
    expect(getAuthStatus(requestWith(), disabled, true)).toMatchObject({ authRequired: false, aiAvailable: false });

    const password = readAuthConfig({ ACCESS_PASSWORD: "pw", SESSION_SECRET: SECRET });
    expect(getAuthStatus(requestWith(), password, true)).toMatchObject({ authRequired: true, authenticated: false, aiAvailable: false });
    const token = createSessionToken(password.sessionKey as Buffer);
    expect(getAuthStatus(requestWith(sessionCookie(token)), password, true)).toMatchObject({ authenticated: true, aiAvailable: true });
    expect(getAuthStatus(requestWith(sessionCookie(token)), password, false)).toMatchObject({ authenticated: true, aiAvailable: false });
  });

  it("decides AI access per mode", () => {
    const password = readAuthConfig({ ACCESS_PASSWORD: "pw", SESSION_SECRET: SECRET });
    const token = createSessionToken(password.sessionKey as Buffer);

    expect(checkAiAccess(requestWith(), readAuthConfig({ NODE_ENV: "production" }), true)).toMatchObject({ status: 403, code: "ai_unavailable" });
    expect(checkAiAccess(requestWith(), password, true)).toMatchObject({ status: 401, code: "unauthorized" });
    expect(checkAiAccess(requestWith(sessionCookie(token)), password, true)).toBeNull();
    expect(checkAiAccess(requestWith(sessionCookie(token)), password, false)).toMatchObject({ status: 403, code: "ai_unavailable" });
    expect(checkAiAccess(requestWith(), readAuthConfig({ ACCESS_PASSWORD: "pw" }), true)).toMatchObject({ status: 403 });
    expect(checkAiAccess(requestWith(), readAuthConfig({ NODE_ENV: "development" }), true)).toBeNull();
    expect(checkAiAccess(requestWith(), readAuthConfig({ NODE_ENV: "development" }), false)).toMatchObject({ status: 403 });
  });

  it("answers open-mode AI requests only on loopback host names", () => {
    const open = readAuthConfig({ NODE_ENV: "development" });
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "app.localhost"]) {
      expect(checkAiAccess(requestWith({ host }), open, true)).toBeNull();
    }
    for (const host of ["evil.example:3000", "192.168.1.20:3000", "127.0.0.1.evil.example"]) {
      expect(checkAiAccess(requestWith({ host }), open, true)).toMatchObject({ status: 403, code: "forbidden" });
    }
    expect(isLoopbackHost(null)).toBe(false);
  });

  it("names the cookie __Host-is_session in production, so subdomains cannot plant one", () => {
    expect(sessionCookieName({ isProduction: true })).toBe(SECURE_SESSION_COOKIE);
    expect(SECURE_SESSION_COOKIE).toBe("__Host-is_session");
    expect(sessionCookieName({ isProduction: false })).toBe(SESSION_COOKIE);

    const production = readAuthConfig({ ACCESS_PASSWORD: "pw", SESSION_SECRET: SECRET, NODE_ENV: "production" });
    expect(production.cookieName).toBe(SECURE_SESSION_COOKIE);
    const token = createSessionToken(production.sessionKey as Buffer);
    expect(getAuthStatus(requestWith({ cookie: `${SECURE_SESSION_COOKIE}=${token}` }), production, true).authenticated).toBe(true);
    // The development name is not read in production.
    expect(getAuthStatus(requestWith({ cookie: `${SESSION_COOKIE}=${token}` }), production, true).authenticated).toBe(false);
  });

  it("sets secure cookies only in production", () => {
    expect(sessionCookieOptions({ NODE_ENV: "production" })).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    expect(sessionCookieOptions({ NODE_ENV: "development" }).secure).toBe(false);
  });
});

describe("auth routes", () => {
  const PASSWORD = "correct horse battery staple";

  function loginRequest(body: unknown, headers: Record<string, string> = {}): Request {
    return new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    resetRateLimits();
    vi.stubEnv("ACCESS_PASSWORD", PASSWORD);
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test-not-real");
    // These tests identify clients by X-Forwarded-For, which is only trusted behind a configured proxy.
    vi.stubEnv("TRUST_PROXY", "1");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("logs in with the right password and the cookie authenticates later requests", async () => {
    const response = await login(loginRequest({ password: PASSWORD }));
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(new RegExp(`^${SESSION_COOKIE}=v1\\.`));
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(new RegExp(`Max-Age=${SESSION_TTL_SECONDS}`));

    const token = /is_session=([^;]+)/.exec(setCookie)?.[1] ?? "";
    const statusResponse = await status(requestWith(sessionCookie(token)));
    expect(statusResponse.headers.get("cache-control")).toBe("no-store");
    expect(await statusResponse.json()).toEqual<AuthStatus>({
      aiConfigured: true,
      authRequired: true,
      authenticated: true,
      aiAvailable: true,
    });
  });

  it("rejects a wrong password with a generic 401 and no cookie", async () => {
    const response = await login(loginRequest({ password: "wrong" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({ error: { code: "unauthorized", message: "Incorrect password." } });
  });

  it("rate limits sign-in attempts", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login(loginRequest({ password: "wrong" }))).status).toBe(401);
    }
    const limited = await login(loginRequest({ password: PASSWORD }));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("caps sign-in attempts across all clients, so rotating addresses does not help", async () => {
    for (let i = 0; i < RATE_LIMITS.loginGlobal.limit; i += 1) {
      expect((await login(loginRequest({ password: "wrong" }, { "x-forwarded-for": `198.51.100.${i}` }))).status).toBe(401);
    }
    const limited = await login(loginRequest({ password: PASSWORD }, { "x-forwarded-for": "203.0.113.200" }));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(limited.headers.get("set-cookie")).toBeNull();
  });

  it("treats every address in one IPv6 /64 as the same client", async () => {
    for (let i = 1; i <= RATE_LIMITS.login.limit; i += 1) {
      expect((await login(loginRequest({ password: "wrong" }, { "x-forwarded-for": `2001:db8:1:2::${i}` }))).status).toBe(401);
    }
    expect((await login(loginRequest({ password: PASSWORD }, { "x-forwarded-for": "2001:db8:1:2:ffff::1" }))).status).toBe(429);
    expect((await login(loginRequest({ password: PASSWORD }, { "x-forwarded-for": "2001:db8:1:3::1" }))).status).toBe(204);
  });

  it("rejects cross-site sign-in", async () => {
    const response = await login(loginRequest({ password: PASSWORD }, { "sec-fetch-site": "cross-site" }));
    expect(response.status).toBe(403);
  });

  it("validates the body", async () => {
    expect((await login(loginRequest({}))).status).toBe(400);
    expect((await login(loginRequest({ password: "" }))).status).toBe(400);
    const wrongType = new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "content-type": "text/plain", "sec-fetch-site": "same-origin" },
      body: "password",
    });
    expect((await login(wrongType)).status).toBe(415);
  });

  it("refuses to sign in when SESSION_SECRET is too short", async () => {
    vi.stubEnv("SESSION_SECRET", "short");
    const response = await login(loginRequest({ password: PASSWORD }));
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("answers 400 when no password is configured", async () => {
    vi.stubEnv("ACCESS_PASSWORD", "");
    expect((await login(loginRequest({ password: PASSWORD }))).status).toBe(400);
  });

  it("sets the __Host- cookie with Secure and no Domain in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await login(loginRequest({ password: PASSWORD }));
    expect(response.status).toBe(204);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^__Host-is_session=v1\./);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).not.toMatch(/Domain=/i);

    const logoutResponse = await logout(
      new Request("http://localhost:3000/api/auth/logout", { method: "POST", headers: { "sec-fetch-site": "same-origin" } }),
    );
    expect(logoutResponse.headers.get("set-cookie") ?? "").toMatch(/^__Host-is_session=;.*Max-Age=0/i);
  });

  it("logs a structured line when sign-in is unavailable", async () => {
    vi.stubEnv("SESSION_SECRET", "short");
    await login(loginRequest({ password: PASSWORD }));
    const line = JSON.parse(String(vi.mocked(console.error).mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(line).toMatchObject({ level: "error", event: "auth.sign_in_unavailable" });
    expect(JSON.stringify(line)).not.toContain(PASSWORD);
  });

  it("logs out by expiring the cookie", async () => {
    const response = await logout(
      new Request("http://localhost:3000/api/auth/logout", { method: "POST", headers: { "sec-fetch-site": "same-origin" } }),
    );
    expect(response.status).toBe(204);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(new RegExp(`^${SESSION_COOKIE}=;`));
    expect(setCookie).toMatch(/Max-Age=0/);
    const crossSite = await logout(
      new Request("http://localhost:3000/api/auth/logout", { method: "POST", headers: { origin: "https://evil.example" } }),
    );
    expect(crossSite.status).toBe(403);
  });
});
