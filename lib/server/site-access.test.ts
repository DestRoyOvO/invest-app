import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  contentSecurityPolicy,
  createNonce,
  decideSiteAccess,
  escapeMalformedSegments,
  hasMalformedEscape,
  isApiPath,
  isOpenPath,
  safeNextPath,
  unlockUrl,
  type SiteRequest,
} from "./site-access";

function request(overrides: Partial<SiteRequest>): SiteRequest {
  return { pathname: "/", search: "", isPrivate: true, authenticated: false, next: null, ...overrides };
}

describe("isOpenPath", () => {
  it("opens health, sign-in, the unlock page, framework assets and root-level static files", () => {
    for (const path of [
      "/api/health",
      "/api/health/",
      "/api/auth/login",
      "/api/auth/status",
      "/api/auth/logout",
      "/unlock",
      "/_next/static/chunks/app.js",
      "/_next/image",
      "/__nextjs_original-stack-frame",
      "/favicon.ico",
      "/icon.svg",
      "/apple-icon.png",
      "/manifest.webmanifest",
      "/robots.txt",
      "/icon",
      "/apple-icon",
      "/apple-icon1",
    ]) {
      expect(isOpenPath(path), path).toBe(true);
    }
  });

  it("keeps pages, data APIs and look-alike paths closed", () => {
    for (const path of [
      "/",
      "/watchlist",
      "/stock/AAPL",
      "/stock/LOGO.PNG",
      "/api/quotes",
      "/api/healthz",
      "/api/health/../stock/AAPL",
      "/api/auth",
      "/api/authx/login",
      "/unlocked",
      "/opengraph-image",
      "/api/auth%2F..%2Fquotes",
      "/icons",
      "/apple-icon/../watchlist",
      "/stock/icon",
    ]) {
      expect(isOpenPath(path), path).toBe(false);
    }
  });

  it("recognises API paths", () => {
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/api/quotes")).toBe(true);
    expect(isApiPath("/apiary")).toBe(false);
  });
});

describe("safeNextPath and unlockUrl", () => {
  it("keeps same-site paths and rejects everything that could leave the site or loop", () => {
    expect(safeNextPath("/stock/NVDA?range=1y")).toBe("/stock/NVDA?range=1y");
    for (const bad of [null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "/\nset-cookie", "stock", "/unlock", "/unlock?next=/"]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });

  it("builds the unlock URL without Next's cache-busting parameter", () => {
    expect(unlockUrl("/", "")).toBe("/unlock");
    expect(unlockUrl("/watchlist", "")).toBe("/unlock?next=%2Fwatchlist");
    expect(unlockUrl("/stock/NVDA", "?_rsc=abc12&range=1y")).toBe("/unlock?next=%2Fstock%2FNVDA%3Frange%3D1y");
  });
});

describe("decideSiteAccess", () => {
  it("lets everything through on a public site", () => {
    expect(decideSiteAccess(request({ isPrivate: false, pathname: "/watchlist" }))).toEqual({ action: "next" });
    expect(decideSiteAccess(request({ isPrivate: false, pathname: "/api/quotes" }))).toEqual({ action: "next" });
  });

  it("sends visitors without a session to the unlock page and answers APIs with 401", () => {
    expect(decideSiteAccess(request({ pathname: "/watchlist" }))).toEqual({ action: "redirect", location: "/unlock?next=%2Fwatchlist" });
    expect(decideSiteAccess(request({ pathname: "/" }))).toEqual({ action: "redirect", location: "/unlock" });
    expect(decideSiteAccess(request({ pathname: "/api/stock/AAPL" }))).toEqual({ action: "unauthorized" });
    expect(decideSiteAccess(request({ pathname: "/api/health" }))).toEqual({ action: "next" });
    expect(decideSiteAccess(request({ pathname: "/api/auth/login" }))).toEqual({ action: "next" });
    expect(decideSiteAccess(request({ pathname: "/unlock" }))).toEqual({ action: "next" });
  });

  it("lets a signed-in visitor through and moves them past the unlock page", () => {
    expect(decideSiteAccess(request({ pathname: "/api/stock/AAPL", authenticated: true }))).toEqual({ action: "next" });
    expect(decideSiteAccess(request({ pathname: "/unlock", authenticated: true, next: "/watchlist" }))).toEqual({ action: "redirect", location: "/watchlist" });
    expect(decideSiteAccess(request({ pathname: "/unlock", authenticated: true, next: "https://evil.example" }))).toEqual({ action: "redirect", location: "/" });
    expect(decideSiteAccess(request({ pathname: "/unlock", isPrivate: false }))).toEqual({ action: "redirect", location: "/" });
  });
});

describe("paths with a malformed percent-escape", () => {
  const MALFORMED = ["/stock/%E0%A4%A", "/stock/%ZZ", "/sector/%E0%A4%A", "/stock/100%", "/%E0%A4%A", "/api/stock/%E0%A4%A", "/api/stock/%ZZ/chart"];

  it("are told apart from well-formed ones", () => {
    for (const path of MALFORMED) expect(hasMalformedEscape(path), path).toBe(true);
    // Escaped symbols, a Chinese segment in UTF-8 and plain paths decode.
    for (const path of ["/", "/stock/AAPL", "/stock/%24%24%24", "/stock/%5EGSPC", "/stock/EURUSD%3DX", "/stock/BRK.B", "/sector/%E4%B8%AD", "/api/stock/AAPL/chart"]) {
      expect(hasMalformedEscape(path), path).toBe(false);
    }
  });

  it("are escaped segment by segment into a well-formed path of the same characters", () => {
    expect(escapeMalformedSegments("/stock/%E0%A4%A")).toBe("/stock/%25E0%25A4%25A");
    expect(escapeMalformedSegments("/stock/%ZZ")).toBe("/stock/%25ZZ");
    expect(escapeMalformedSegments("/stock/100%")).toBe("/stock/100%25");
    // A well-formed segment beside a malformed one keeps its escapes.
    expect(escapeMalformedSegments("/sector/%E4%B8%AD/%ZZ")).toBe("/sector/%E4%B8%AD/%25ZZ");
    expect(escapeMalformedSegments("/stock/%24%24%24")).toBe("/stock/%24%24%24");
    for (const path of MALFORMED) {
      expect(hasMalformedEscape(escapeMalformedSegments(path)), path).toBe(false);
      expect(decodeURIComponent(escapeMalformedSegments(path)), path).toBe(path);
    }
  });

  it("are never sent to another site: leading slashes collapse into one", () => {
    // "//evil.example/..." as a redirect target would be a protocol-relative URL, an open redirect.
    expect(escapeMalformedSegments("//evil.example/%ZZ")).toBe("/evil.example/%25ZZ");
    expect(escapeMalformedSegments("/\\evil.example/%ZZ")).toBe("/evil.example/%25ZZ");
    expect(escapeMalformedSegments("///%ZZ")).toBe("/%25ZZ");
    expect(decideSiteAccess(request({ isPrivate: false, pathname: "//evil.example/%ZZ" }))).toEqual({ action: "redirect", location: "/evil.example/%25ZZ" });
  });

  it("answer 400 on API paths and send pages to the escaped path, which answers with the not-found page", () => {
    for (const isPrivate of [false, true]) {
      const authenticated = isPrivate;
      expect(decideSiteAccess(request({ isPrivate, authenticated, pathname: "/api/stock/%E0%A4%A" }))).toEqual({ action: "bad_request" });
      expect(decideSiteAccess(request({ isPrivate, authenticated, pathname: "/stock/%E0%A4%A" }))).toEqual({ action: "redirect", location: "/stock/%25E0%25A4%25A" });
      expect(decideSiteAccess(request({ isPrivate, authenticated, pathname: "/sector/%ZZ", search: "?tab=news" }))).toEqual({ action: "redirect", location: "/sector/%25ZZ?tab=news" });
    }
    // An open path of a private site is checked too.
    expect(decideSiteAccess(request({ pathname: "/api/auth/%ZZ" }))).toEqual({ action: "bad_request" });
  });

  it("leave a private site's rules first: a visitor without a session goes to the unlock page or gets 401", () => {
    expect(decideSiteAccess(request({ pathname: "/stock/%E0%A4%A" }))).toEqual({ action: "redirect", location: "/unlock?next=%2Fstock%2F%25E0%25A4%25A" });
    expect(decideSiteAccess(request({ pathname: "/api/stock/%E0%A4%A" }))).toEqual({ action: "unauthorized" });
  });

  it("pass well-formed paths through", () => {
    expect(decideSiteAccess(request({ isPrivate: false, pathname: "/stock/%24%24%24" }))).toEqual({ action: "next" });
    expect(decideSiteAccess(request({ isPrivate: false, pathname: "/api/stock/%5EGSPC" }))).toEqual({ action: "next" });
  });
});

describe("content security policy", () => {
  it("allows scripts only with the response's nonce and keeps the other directives tight", () => {
    const policy = contentSecurityPolicy("abc123==");
    expect(policy).toContain("script-src 'self' 'nonce-abc123==' 'strict-dynamic'");
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(policy).not.toContain("unsafe-eval");
    for (const directive of ["default-src 'self'", "style-src 'self' 'unsafe-inline'", "connect-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"]) {
      expect(policy).toContain(directive);
    }
  });

  it("creates a new random nonce every time", () => {
    const nonces = new Set(Array.from({ length: 20 }, () => createNonce()));
    expect(nonces.size).toBe(20);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
