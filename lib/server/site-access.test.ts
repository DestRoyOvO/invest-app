import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { contentSecurityPolicy, createNonce, decideSiteAccess, isApiPath, isOpenPath, safeNextPath, unlockUrl, type SiteRequest } from "./site-access";

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
