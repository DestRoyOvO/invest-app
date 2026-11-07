import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";

import { Providers } from "@/components/providers/Providers";
import { themeColorFor } from "@/components/ui/brand";
import { htmlLang, resolvePrefs } from "@/lib/prefs";
import { parseSiteUrl } from "@/lib/site";

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

const TITLE = "InvestSeek · Market terminal";
const TAGLINE = "The market terminal that publishes its own track record.";

export const metadata: Metadata = {
  // Social cards need absolute URLs; without SITE_URL, Next falls back to localhost (or the Vercel URL).
  metadataBase: parseSiteUrl(process.env.SITE_URL),
  title: { default: TITLE, template: "%s · InvestSeek" },
  description: "A fast, honest market research terminal: live quotes, sector heatmap, quant signals with transparent backtests, and AI research notes.",
  applicationName: "InvestSeek",
  // No `icons` here on purpose: app/icon.svg and app/apple-icon.tsx emit their own tags with sizes and cache-busting
  // hashes, and an `icons` entry would replace those tags with unhashed ones. app/opengraph-image.tsx adds og:image and
  // twitter:image the same way.
  openGraph: { type: "website", siteName: "InvestSeek", title: TITLE, description: TAGLINE },
  twitter: { card: "summary_large_image", title: TITLE, description: TAGLINE },
};

/** The browser bar follows the theme the page renders in, not only the OS setting. */
export async function generateViewport(): Promise<Viewport> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const { theme } = resolvePrefs((name) => cookieStore.get(name)?.value, headerStore.get("accept-language"));
  return { themeColor: themeColorFor(theme) };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const prefs = resolvePrefs((name) => cookieStore.get(name)?.value, headerStore.get("accept-language"));

  return (
    <html
      lang={htmlLang(prefs.lang)}
      data-theme={prefs.theme}
      data-updown={prefs.updown}
      className={`${plexSans.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <Providers prefs={prefs}>{children}</Providers>
      </body>
    </html>
  );
}
