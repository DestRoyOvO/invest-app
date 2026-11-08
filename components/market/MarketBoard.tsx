"use client";

import Link from "next/link";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Delta, directionOf } from "@/components/ui/Delta";
import { Sparkline } from "@/components/ui/Sparkline";
import { Skeleton } from "@/components/ui/States";
import { TickNumber } from "@/components/ui/TickNumber";
import { stockPath } from "@/lib/api-client";
import { formatNumber, formatPrice } from "@/lib/format";
import { MARKET_BOARD } from "@/lib/universe";
import type { BoardItem } from "@/types/api";

/**
 * Index, rate, FX, commodity and crypto cells with one-month sparklines: one horizontally scrolling row on phones and
 * small tablets, five across from md (two full rows, no empty cells). Each cell is a size container, so the absolute
 * change and the "1M" tag appear only where they fit beside the percentage and the line.
 */
export function MarketBoard({ board }: { board: BoardItem[] | undefined }) {
  const { t, lang } = usePrefs();
  // The tag beside the sparkline: "1M" needs less room than "近1月".
  const trendTag = lang === "zh" ? "hidden @min-[9.75rem]:inline" : "hidden @min-[8.75rem]:inline";
  return (
    <div className="no-scrollbar flex snap-x gap-px overflow-x-auto bg-line md:grid md:grid-cols-5 md:overflow-visible">
      {MARKET_BOARD.map((def) => {
        const item = board?.find((b) => b.quote.symbol === def.symbol);
        const quote = item?.quote;
        const price = def.kind === "yield" ? formatNumber(quote?.price, 3, lang) : formatPrice(quote?.price, lang);
        return (
          <Link
            key={def.symbol}
            href={stockPath(def.symbol)}
            className="group @container flex w-[9.75rem] min-w-0 shrink-0 snap-start flex-col gap-1 bg-panel px-3 py-2.5 transition-colors hover:bg-hover md:w-auto"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs text-fg-2">{def.label[lang]}</span>
              <span className="mono shrink-0 text-micro text-fg-3">{def.code}</span>
            </div>
            {quote ? (
              <>
                <div className="num text-figure text-fg">
                  <TickNumber value={quote.price}>{price}</TickNumber>
                  {def.kind === "yield" ? <span className="text-sm text-fg-3">%</span> : null}
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 gap-2">
                    {/* The absolute change needs a wide cell; narrow ones keep the percentage and the sparkline. */}
                    <Delta value={quote.change} kind="change" lang={lang} className="hidden @min-[12rem]:inline" />
                    <Delta value={quote.changePercent} />
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Sparkline data={item?.spark ?? []} width={56} height={18} tone={directionOf(quote.changePercent)} />
                    <span className={`${trendTag} text-micro text-fg-3`}>{t.columns.trend}</span>
                  </span>
                </div>
              </>
            ) : board ? (
              // Loaded, but this instrument failed upstream: say so instead of an endless skeleton.
              <>
                <div className="num text-figure text-fg-3">—</div>
                <div className="text-xs text-fg-3">{t.common.dataUnavailable}</div>
              </>
            ) : (
              <>
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-4 w-full" />
              </>
            )}
          </Link>
        );
      })}
    </div>
  );
}
