import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";

import { Providers } from "@/components/providers/Providers";
import { themeColorFor } from "@/components/ui/brand";
import { MESSAGES } from "@/lib/i18n/messages";
import { htmlAttributes, resolvePrefs } from "@/lib/prefs";
import { readEnv } from "@/lib/server/env";

import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

/**
 * The default title (the overview has no title of its own), the title template every page title goes through, the
 * description and the social card text, in the reader's language. The template keeps the product name in both.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { siteUrl } = readEnv();
  const { meta } = MESSAGES[(await requestPrefs()).lang];
  return {
    // Social cards need absolute URLs; without SITE_URL, Next falls back to localhost (or the Vercel URL).
    metadataBase: siteUrl ? new URL(siteUrl) : undefined,
    title: { default: meta.title, template: "%s · InvestSeek" },
    description: meta.description,
    applicationName: "InvestSeek",
    // No `icons` here on purpose: app/icon.svg and app/apple-icon.tsx emit their own tags with sizes and cache-busting
    // hashes, and an `icons` entry would replace those tags with unhashed ones. app/opengraph-image.tsx adds og:image and
    // twitter:image the same way.
    openGraph: { type: "website", siteName: "InvestSeek", title: meta.title, description: meta.tagline },
    twitter: { card: "summary_large_image", title: meta.title, description: meta.tagline },
  };
}

async function requestPrefs() {
  const cookieStore = await cookies();
  const headerStore = await headers();
  return resolvePrefs((name) => cookieStore.get(name)?.value, headerStore.get("accept-language"));
}

/**
 * The browser bar follows the theme the page renders in: one color for Dark or Light, a color per color scheme for
 * System (the default). PrefsProvider updates the tag when the theme changes.
 */
export async function generateViewport(): Promise<Viewport> {
  const { theme } = await requestPrefs();
  return { themeColor: themeColorFor(theme) };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const prefs = await requestPrefs();

  return (
    <html {...htmlAttributes(prefs)} className={`${plexSans.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <body>
        <Providers prefs={prefs}>{children}</Providers>
      </body>
    </html>
  );
}
