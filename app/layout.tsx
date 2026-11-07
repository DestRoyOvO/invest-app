import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";

import { Providers } from "@/components/providers/Providers";
import { htmlLang, resolvePrefs } from "@/lib/prefs";

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

export const metadata: Metadata = {
  title: { default: "InvestSeek · Market terminal", template: "%s · InvestSeek" },
  description: "A fast, honest market research terminal: live quotes, sector heatmap, quant signals with transparent backtests, and AI research notes.",
  applicationName: "InvestSeek",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#06080b" },
    { media: "(prefers-color-scheme: light)", color: "#e4e8ed" },
  ],
};

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
