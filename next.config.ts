import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Next.js injects inline bootstrap scripts, so script-src needs 'unsafe-inline' unless nonces are used.
// The CSP is only applied in production because the dev server relies on eval for fast refresh.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ...(isProd
    ? [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      ]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // `npm run dev` binds to 127.0.0.1 only; allow both loopback host names for dev assets and HMR.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  // The floating dev indicator sits on top of the nav rail (bottom left) and covers the assistant button.
  // Build and runtime errors still open the error overlay.
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
