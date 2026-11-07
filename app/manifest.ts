import type { MetadataRoute } from "next";

import { BRAND_COLORS } from "@/components/ui/brand";

/** Web app manifest: installable as a standalone window, with shortcuts to the watchlist and the market overview. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "InvestSeek",
    short_name: "InvestSeek",
    description: "A market terminal for individual investors: live quotes, sector heatmap, risk and factor research, and AI notes.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: BRAND_COLORS.background,
    theme_color: BRAND_COLORS.background,
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
    shortcuts: [
      { name: "Watchlist", short_name: "WL", description: "Your watchlist and positions", url: "/watchlist" },
      { name: "Market overview", short_name: "MKT", description: "Indices, sector heatmap and movers", url: "/" },
    ],
  };
}
