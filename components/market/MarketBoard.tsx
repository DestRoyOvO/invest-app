"use client";

import Link from "next/link";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Delta, directionOf } from "@/components/ui/Delta";
import { Sparkline } from "@/components/ui/Sparkline";
import { Skeleton } from "@/components/ui/States";
import { stockPath } from "@/lib/api-client";
import { formatNumber, formatPrice } from "@/lib/format";
import { MARKET_BOARD } from "@/lib/universe";
import type { BoardItem } from "@/types/api";

/** Grid of index, rate, FX, commodity and crypto cells with one-month sparklines. */
export function MarketBoard({ board }: { board: BoardItem[] | undefined }) {
  const { t, lang } = usePrefs();
  return (
    <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-5">
      {MARKET_BOARD.map((def) => {
        const item = board?.find((b) => b.quote.symbol === def.symbol);
        const quote = item?.quote;
        const price = def.kind === "yield" ? formatNumber(quote?.price, 3, lang) : formatPrice(quote?.price, lang);
        return (
          <Link key={def.symbol} href={stockPath(def.symbol)} className="group flex min-w-0 flex-col gap-1 bg-panel px-3 py-2.5 transition-colors hover:bg-hover">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs text-fg-2">{def.label[lang]}</span>
              <span className="label shrink-0">{def.code}</span>
            </div>
            {quote ? (
              <>
                <div className="num text-lg leading-tight text-fg">
                  {price}
                  {def.kind === "yield" ? <span className="text-sm text-fg-3">%</span> : null}
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex gap-2">
                    <Delta value={quote.change} kind="change" lang={lang} />
                    <Delta value={quote.changePercent} />
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Sparkline data={item?.spark ?? []} width={64} height={18} tone={directionOf(quote.changePercent)} />
                    <span className="hidden text-micro text-fg-3 sm:inline">{t.columns.trend}</span>
                  </span>
                </div>
              </>
            ) : board ? (
              // Loaded, but this instrument failed upstream: say so instead of an endless skeleton.
              <>
                <div className="num text-lg leading-tight text-fg-3">—</div>
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
