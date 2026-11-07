import { NextResponse } from "next/server";

import { sessionCookieName, sessionCookieOptions } from "@/lib/server/auth";
import { rejectCrossSite } from "@/lib/server/request-guard";

// POST /api/auth/logout -> 204, clearing the session cookie.
// Sessions are stateless signed tokens: rotating SESSION_SECRET or ACCESS_PASSWORD signs out every session.

export async function POST(request: Request): Promise<Response> {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;

  const response = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  response.cookies.set(sessionCookieName(), "", { ...sessionCookieOptions(), maxAge: 0 });
  return response;
}
