import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createSessionToken, readAuthConfig } from "@/lib/server/session";

import { config, proxy } from "./proxy";

const SECRET = "0123456789abcdef0123456789abcdef-test";
const PASSWORD = "correct horse battery staple";

function call(path: string, headers: Record<string, string> = {}) {
  return proxy(new NextRequest(new URL(path, "http://localhost:3000"), { headers }));
}

function privateSite(): void {
  vi.stubEnv("SITE_ACCESS", "private");
  vi.stubEnv("ACCESS_PASSWORD", PASSWORD);
  vi.stubEnv("SESSION_SECRET", SECRET);
}

function sessionCookie(): Record<string, string> {
  const auth = readAuthConfig();
  return { cookie: `${auth.cookieName}=${createSessionToken(auth.sessionKey as Buffer)}` };
}

describe("proxy matcher", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  it("runs on pages and API routes, including symbols with dots", () => {
    for (const url of ["/", "/watchlist", "/stock/AAPL", "/stock/BRK.B", "/stock/LOGO.PNG", "/sector/technology", "/api/quotes?symbols=AAPL", "/api/health", "/api/auth/login", "/unlock?next=%2F"]) {
      expect(matches(url), url).toBe(true);
    }
  });

  it("skips build assets and root-level static files", () => {
    for (const url of ["/_next/static/chunks/main.js", "/_next/image?url=%2Fa.png&w=64&q=75", "/favicon.ico", "/icon.svg", "/apple-icon.png", "/manifest.webmanifest", "/robots.txt"]) {
      expect(matches(url), url).toBe(false);
    }
  });
});

describe("proxy on a public site", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("passes requests through without noindex, and has no unlock page", () => {
    const page = call("/watchlist");
    expect(page.headers.get("x-middleware-next")).toBe("1");
    expect(page.headers.get("x-robots-tag")).toBeNull();
    const unlock = call("/unlock?next=%2Fwatchlist");
    expect(unlock.status).toBe(307);
    expect(unlock.headers.get("location")).toBe("http://localhost:3000/watchlist");
  });

  it("adds no CSP in development, where React needs eval", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(call("/").headers.get("content-security-policy")).toBeNull();
  });
});

describe("proxy on a private site", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("redirects pages to the unlock page and answers APIs with 401 JSON", async () => {
    privateSite();
    const page = call("/stock/NVDA?range=1y");
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://localhost:3000/unlock?next=%2Fstock%2FNVDA%3Frange%3D1y");
    expect(page.headers.get("x-robots-tag")).toBe("noindex, nofollow");

    const api = call("/api/quotes?symbols=AAPL");
    expect(api.status).toBe(401);
    expect(api.headers.get("cache-control")).toBe("no-store");
    expect(await api.json()).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("keeps the health check, sign-in, the unlock page and generated icons open", () => {
    privateSite();
    for (const path of ["/api/health?ready=1", "/api/auth/status", "/api/auth/login", "/unlock?next=%2F", "/apple-icon?3c6e1a2b"]) {
      const response = call(path);
      expect(response.headers.get("x-middleware-next"), path).toBe("1");
      expect(response.headers.get("x-robots-tag"), path).toBe("noindex, nofollow");
    }
  });

  it("lets a signed-in visitor through and moves them past the unlock page", () => {
    privateSite();
    const cookie = sessionCookie();
    expect(call("/watchlist", cookie).headers.get("x-middleware-next")).toBe("1");
    expect(call("/api/quotes?symbols=AAPL", cookie).headers.get("x-middleware-next")).toBe("1");
    const unlock = call("/unlock?next=%2Fwatchlist", cookie);
    expect(unlock.status).toBe(307);
    expect(unlock.headers.get("location")).toBe("http://localhost:3000/watchlist");
  });

  it("rejects forged, expired and foreign session cookies", () => {
    privateSite();
    const auth = readAuthConfig();
    const expired = createSessionToken(auth.sessionKey as Buffer, Date.now() - 31 * 24 * 3600 * 1000);
    const foreign = createSessionToken("another-secret-another-secret-another");
    for (const value of ["v1.123.abc.def", expired, foreign]) {
      expect(call("/api/quotes", { cookie: `${auth.cookieName}=${value}` }).status).toBe(401);
    }
  });

  it("stays locked when the password or secret is missing, instead of failing open", () => {
    vi.stubEnv("SITE_ACCESS", "private");
    expect(call("/watchlist").status).toBe(307);
    expect(call("/api/quotes").status).toBe(401);
  });
});

describe("proxy in production", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("gives every page its own nonce CSP and passes it on to the renderer", () => {
    vi.stubEnv("NODE_ENV", "production");
    const first = call("/");
    const policy = first.headers.get("content-security-policy") ?? "";
    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' 'strict-dynamic'/);
    // NextResponse.next({ request: { headers } }) forwards overridden request headers under x-middleware-request-*.
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
    expect(call("/").headers.get("content-security-policy")).not.toBe(policy);
  });

  it("leaves API responses to the static API policy from next.config.ts", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(call("/api/quotes?symbols=AAPL").headers.get("content-security-policy")).toBeNull();
  });

  it("reads the __Host- session cookie on a private production site", () => {
    vi.stubEnv("NODE_ENV", "production");
    privateSite();
    const cookie = sessionCookie();
    expect(cookie.cookie.startsWith("__Host-is_session=")).toBe(true);
    expect(call("/watchlist", cookie).headers.get("x-middleware-next")).toBe("1");
  });
});
