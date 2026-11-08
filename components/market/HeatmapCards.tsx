"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Delta } from "@/components/ui/Delta";
import { formatCompact, formatPrice, tpl } from "@/lib/format";
import { chineseNameOf } from "@/lib/names-zh";
import { getSector } from "@/lib/universe";
import type { OverviewQuote, SectorKey, SectorSnapshot } from "@/types/api";

import { rangePosition, relativeVolume } from "./metrics";

/** Hover and focus card of a heatmap tile: the quote, its size and trading, and where it sits in its 52-week range. */
export function StockCard({ quote, sector }: { quote: OverviewQuote; sector: SectorKey }) {
  const { t, lang } = usePrefs();
  const name = (lang === "zh" ? chineseNameOf(quote.symbol) : undefined) ?? quote.name;
  const position = rangePosition(quote);
  const rel = relativeVolume(quote);
  return (
    <div className="space-y-2.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="mono text-base font-semibold text-fg">{quote.symbol}</span>
        <span className="min-w-0 truncate text-xs text-fg-2">{name}</span>
        <span className="ml-auto shrink-0 text-micro text-fg-3">{getSector(sector)?.short[lang]}</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="num text-figure text-fg">{formatPrice(quote.price, lang)}</span>
        <Delta value={quote.change} kind="change" lang={lang} />
        <Delta value={quote.changePercent} />
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <div className="min-w-0">
          <dt className="col-head">{t.markets.heatmap.marketCap}</dt>
          <dd className="num text-data text-fg">{formatCompact(quote.marketCap, lang)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="col-head">{t.markets.heatmap.volume}</dt>
          <dd className="num text-data text-fg">
            {formatCompact(quote.volume, lang)}
            {rel !== null ? <span className="ml-1.5 text-micro text-fg-3">{tpl(t.markets.heatmap.relVolume, { x: `${rel.toFixed(1)}×` })}</span> : null}
          </dd>
        </div>
      </dl>
      <div>
        <div className="col-head">{t.markets.heatmap.range52w}</div>
        <div aria-hidden className="relative mt-2 h-1 bg-line-2">
          {position !== null ? <span className="absolute -inset-y-1 w-0.5 -translate-x-1/2 bg-fg" style={{ left: `${position}%` }} /> : null}
        </div>
        <div className="num mt-1.5 flex justify-between text-micro text-fg-3">
          <span>{formatPrice(quote.fiftyTwoWeekLow, lang)}</span>
          <span>{formatPrice(quote.fiftyTwoWeekHigh, lang)}</span>
        </div>
      </div>
    </div>
  );
}

/** Hover and focus card of a sector header strip: the full name, the cap-weighted change and the advance-decline count. */
export function SectorCard({ sector }: { sector: SectorSnapshot }) {
  const { t, lang } = usePrefs();
  const up = sector.stocks.filter((q) => (q.changePercent ?? 0) > 0).length;
  const down = sector.stocks.filter((q) => (q.changePercent ?? 0) < 0).length;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium text-fg">{getSector(sector.key)?.label[lang] ?? sector.key}</span>
        <Delta value={sector.changePercent} />
      </div>
      <div className="text-xs text-fg-2">
        {tpl(t.markets.heatmap.stocks, { n: sector.stocks.length })} · {tpl(t.markets.heatmap.upDown, { up, down })}
      </div>
      <div className="text-micro text-fg-3">{t.markets.heatmap.openSector}</div>
    </div>
  );
}
