import { NextResponse, type NextRequest } from "next/server";

import { readEnv } from "@/lib/server/env";
import { hasValidSession, readAuthConfig } from "@/lib/server/session";
import { contentSecurityPolicy, createNonce, decideSiteAccess, isApiPath } from "@/lib/server/site-access";
import type { ApiErrorBody } from "@/types/api";

// Runs before every page and API route (the matcher below leaves out build assets and root-level static files).
// - SITE_ACCESS=private: a request without a valid session goes to the unlock page (pages) or gets 401 JSON (APIs),
//   except the health check, sign-in and the unlock page itself. Every response is marked noindex.
// - Production: each page gets a Content-Security-Policy with a fresh nonce, so inline scripts need no allowance.
// The rules live in lib/server/site-access.ts; this file only applies them.

export function proxy(request: NextRequest): NextResponse {
  const env = readEnv();
  const { pathname, search, searchParams } = request.nextUrl;
  const isPrivate = env.siteAccess === "private";
  const decision = decideSiteAccess({
    pathname,
    search,
    isPrivate,
    authenticated: isPrivate && hasValidSession(request, readAuthConfig()),
    next: searchParams.get("next"),
  });

  let response: NextResponse;
  if (decision.action === "unauthorized") {
    const body: ApiErrorBody = { error: { code: "unauthorized", message: "This site is private. Sign in to continue." } };
    response = NextResponse.json(body, { status: 401, headers: { "Cache-Control": "no-store" } });
  } else if (decision.action === "redirect") {
    response = NextResponse.redirect(new URL(decision.location, request.url), 307);
    response.headers.set("Cache-Control", "no-store");
  } else if (env.isProduction && !isApiPath(pathname)) {
    const nonce = createNonce();
    const policy = contentSecurityPolicy(nonce);
    // Next.js reads the nonce from the request's CSP header while rendering and puts it on its scripts.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("Content-Security-Policy", policy);
    requestHeaders.set("x-nonce", nonce);
    response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", policy);
  } else {
    response = NextResponse.next();
  }

  if (isPrivate) response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: [
    // Everything except Next's build assets and root-level static files (icons, manifest, robots.txt, public/).
    "/((?!_next/|__nextjs|[^/]+\\.(?:ico|png|svg|jpg|jpeg|gif|webp|avif|txt|xml|webmanifest|woff2?)$).*)",
  ],
};
