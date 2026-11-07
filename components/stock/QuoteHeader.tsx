"use client";

import { Star } from "lucide-react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { StateDot } from "@/components/shell/MarketClock";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Delta } from "@/components/ui/Delta";
import { formatCompact, formatPrice, formatTime } from "@/lib/format";
import type { StockDetail } from "@/types/api";

import { RangeBar } from "./RangeBar";

interface QuoteHeaderProps {
  detail: StockDetail;
  inWatchlist: boolean;
  onToggleWatchlist: () => void;
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-panel px-3 py-2">
      <div className="label truncate">{label}</div>
      <div className="num mt-0.5 truncate text-sm text-fg">{children}</div>
    </div>
  );
}

export function QuoteHeader({ detail, inWatchlist, onToggleWatchlist }: QuoteHeaderProps) {
  const { t, lang } = usePrefs();
  const { quote, profile } = detail;
  const state = quote.marketState;
  const stateLabel = state ? t.shell.marketState[state] : t.shell.marketState.unknown;

  return (
    <section aria-label={quote.symbol} className="bg-panel">
      <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="mono text-xl font-semibold tracking-tight text-fg">{quote.symbol}</h1>
            <span className="min-w-0 truncate text-sm text-fg-2">{profile.longName ?? quote.name}</span>
            {quote.exchange ? <Badge>{quote.exchange}</Badge> : null}
            {quote.currency && quote.currency !== "USD" ? <Badge tone="info">{quote.currency}</Badge> : null}
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="num text-3xl leading-none font-medium text-fg">{formatPrice(quote.price, lang)}</span>
            <Delta value={quote.change} kind="change" lang={lang} className="text-base" />
            <Delta value={quote.changePercent} arrow className="text-base" />
            <span className="flex items-center gap-1.5 text-xs text-fg-3">
              <StateDot state={state} />
              {stateLabel}
              {quote.regularMarketTime ? <span className="num">· {formatTime(quote.regularMarketTime, lang, "America/New_York")} ET</span> : null}
            </span>
          </div>
          {quote.extendedSession && quote.extendedPrice !== null ? (
            <div className="mt-1 flex items-baseline gap-2 text-sm text-fg-3">
              <span>{quote.extendedSession === "PRE" ? t.stock.preMarket : t.stock.afterHours}</span>
              <span className="num text-fg-2">{formatPrice(quote.extendedPrice, lang)}</span>
              <Delta value={quote.extendedChangePercent} />
            </div>
          ) : null}
        </div>
        <Button onClick={onToggleWatchlist} aria-pressed={inWatchlist} variant={inWatchlist ? "secondary" : "primary"}>
          <Star aria-hidden className="size-4" strokeWidth={1.75} fill={inWatchlist ? "currentColor" : "none"} />
          {inWatchlist ? t.stock.inWatchlist : t.stock.addToWatchlist}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={t.stock.stats.open}>{formatPrice(quote.open, lang)}</Stat>
        <Stat label={t.stock.stats.prevClose}>{formatPrice(quote.previousClose, lang)}</Stat>
        <Stat label={t.stock.stats.volume}>{formatCompact(quote.volume, lang)}</Stat>
        <Stat label={t.stock.stats.marketCap}>{formatCompact(quote.marketCap, lang)}</Stat>
        <div className="min-w-0 bg-panel px-3 py-2">
          <div className="label truncate">{t.stock.stats.dayRange}</div>
          <RangeBar low={quote.dayLow} high={quote.dayHigh} value={quote.price} lang={lang} />
        </div>
        <div className="min-w-0 bg-panel px-3 py-2">
          <div className="label truncate">{t.stock.stats.range52w}</div>
          <RangeBar low={quote.fiftyTwoWeekLow} high={quote.fiftyTwoWeekHigh} value={quote.price} lang={lang} />
        </div>
      </div>
    </section>
  );
}
