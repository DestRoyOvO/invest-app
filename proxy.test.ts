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

  it("runs on paths with a malformed percent-escape, which it answers itself", () => {
    for (const url of ["/stock/%E0%A4%A", "/stock/%ZZ", "/sector/%E0%A4%A", "/api/stock/%E0%A4%A"]) {
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

describe("proxy on a path with a malformed percent-escape", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("answers an API path with 400 JSON instead of Next.js's plain-text 500", async () => {
    for (const path of ["/api/stock/%E0%A4%A", "/api/stock/%ZZ/chart"]) {
      const response = call(path);
      expect(response.status, path).toBe(400);
      expect(response.headers.get("cache-control"), path).toBe("no-store");
      expect(await response.json(), path).toEqual({ error: { code: "bad_request", message: expect.stringMatching(/malformed/) } });
    }
  });

  it("sends a page to the same path escaped, whose symbol or key cannot exist, and keeps well-formed paths as they are", () => {
    for (const [path, location] of [
      ["/stock/%E0%A4%A", "/stock/%25E0%25A4%25A"],
      ["/stock/%ZZ?tab=earnings", "/stock/%25ZZ?tab=earnings"],
      ["/sector/%E0%A4%A", "/sector/%25E0%25A4%25A"],
      ["/%E0%A4%A", "/%25E0%25A4%25A"],
    ]) {
      const response = call(path);
      expect(response.status, path).toBe(307);
      expect(response.headers.get("location"), path).toBe(`http://localhost:3000${location}`);
      expect(response.headers.get("cache-control"), path).toBe("no-store");
      // The escaped path passes through to its page, which answers with the not-found page and 404.
      expect(call(location).headers.get("x-middleware-next"), location).toBe("1");
    }
    expect(call("/stock/%24%24%24").headers.get("x-middleware-next")).toBe("1");
  });

  it("gives the page it sends the visitor to its own nonce CSP in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(call("/stock/%E0%A4%A").status).toBe(307);
    const policy = call("/stock/%25E0%25A4%25A").headers.get("content-security-policy") ?? "";
    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' 'strict-dynamic'/);
    expect(call("/api/stock/%E0%A4%A").headers.get("content-security-policy")).toBeNull();
  });

  it("leaves a private site's rules first", async () => {
    privateSite();
    const page = call("/stock/%E0%A4%A");
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("http://localhost:3000/unlock?next=%2Fstock%2F%25E0%25A4%25A");
    const api = call("/api/stock/%E0%A4%A");
    expect(api.status).toBe(401);
    expect(await api.json()).toMatchObject({ error: { code: "unauthorized" } });
    // A signed-in visitor gets the answers of a public site, marked noindex.
    const cookie = sessionCookie();
    const signedIn = call("/api/stock/%E0%A4%A", cookie);
    expect(signedIn.status).toBe(400);
    expect(signedIn.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(call("/stock/%E0%A4%A", cookie).headers.get("location")).toBe("http://localhost:3000/stock/%25E0%25A4%25A");
  });
});
