import type { NextConfig } from "next";

// Build-time configuration. It runs outside the app bundle, so it reads NODE_ENV directly instead of going through
// lib/server/env.ts (which is for runtime settings).
const isProd = process.env.NODE_ENV === "production";

// Pages get a Content-Security-Policy with a per-request nonce from proxy.ts (production only, because the dev server
// relies on eval for fast refresh). API responses are data, never documents, so they get the strictest policy.
const apiContentSecurityPolicy = "default-src 'none'; frame-ancestors 'none'";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Pages opened from here (news articles, issue links) get no handle back to this window.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // `npm run dev` binds to 127.0.0.1 only; allow both loopback host names for dev assets and HMR.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  // The floating dev indicator sits on top of the nav rail (bottom left) and covers the assistant button.
  // Build and runtime errors still open the error overlay.
  devIndicators: false,
  // next dev would otherwise (re)write an AGENTS.md with tool-specific instructions into the repository root.
  agentRules: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: apiContentSecurityPolicy }] },
    ];
  },
};

export default nextConfig;
