"use client";

import { Info } from "lucide-react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import type { QuoteTab } from "@/components/stock/quote-utils";
import { tpl } from "@/lib/format";

import { landingReason } from "./landing";

/**
 * One line under the quote tabs when a function or link asked for a tab this quote does not have (FA on SPY): the page
 * shows the overview, and this says why instead of switching silently.
 */
export function TabLandingNote({ symbol, tab, quoteType }: { symbol: string; tab: QuoteTab; quoteType: string | null }) {
  const { t } = usePrefs();
  return (
    <p role="status" className="flex items-start gap-2 bg-panel px-3 py-2 text-sm text-fg-2">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-3" strokeWidth={1.75} />
      <span>{tpl(t.help.landing[landingReason(quoteType)], { symbol, tab: t.stock.tabs[tab] })}</span>
    </p>
  );
}
