import { ChartCandlestick, Layers, LayoutGrid, Star, type LucideIcon } from "lucide-react";

import type { Messages } from "@/lib/i18n/messages";

export interface NavItem {
  key: "market" | "watchlist" | "sectors" | "quote";
  href: string;
  icon: LucideIcon;
  label: (t: Messages) => string;
  isActive: (pathname: string) => boolean;
  /** Second key of the "g" keyboard shortcut. */
  shortcut: string;
}

export function navItems(lastSymbolHref: string): NavItem[] {
  return [
    { key: "market", href: "/", icon: LayoutGrid, label: (t) => t.nav.market, isActive: (p) => p === "/", shortcut: "m" },
    { key: "watchlist", href: "/watchlist", icon: Star, label: (t) => t.nav.watchlist, isActive: (p) => p.startsWith("/watchlist"), shortcut: "w" },
    { key: "sectors", href: "/sector/technology", icon: Layers, label: (t) => t.nav.sectors, isActive: (p) => p.startsWith("/sector"), shortcut: "s" },
    { key: "quote", href: lastSymbolHref, icon: ChartCandlestick, label: (t) => t.nav.quote, isActive: (p) => p.startsWith("/stock"), shortcut: "q" },
  ];
}
