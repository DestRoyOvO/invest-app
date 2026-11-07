"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Delta } from "@/components/ui/Delta";
import { useOverview } from "@/hooks/useApi";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatNumber, formatPrice } from "@/lib/format";
import { MARKET_BOARD } from "@/lib/universe";
import type { BoardItem } from "@/types/api";

/** Applies a one-shot flash class when the price changes between refreshes. */
function useTickFlash(price: number | null): string {
  const previous = useRef<number | null>(price);
  const [flash, setFlash] = useState("");
  useEffect(() => {
    const before = previous.current;
    previous.current = price;
    if (before === null || price === null || before === price) return;
    setFlash(price > before ? "flash-up" : "flash-down");
    const id = window.setTimeout(() => setFlash(""), 950);
    return () => window.clearTimeout(id);
  }, [price]);
  return flash;
}

function StripItem({ item }: { item: BoardItem }) {
  const { lang } = usePrefs();
  const def = MARKET_BOARD.find((b) => b.symbol === item.quote.symbol);
  const flash = useTickFlash(item.quote.price);
  const price = def?.kind === "yield" ? formatNumber(item.quote.price, 3, lang) : formatPrice(item.quote.price, lang);
  return (
    <Link
      href={stockPath(item.quote.symbol)}
      className={cn("flex h-full shrink-0 items-center gap-2 border-r border-line px-3 text-xs hover:bg-hover", flash)}
      title={def ? def.label[lang] : item.quote.name}
    >
      <span className="num text-fg-3">{def?.code ?? item.quote.symbol}</span>
      <span className="num text-fg">{price}</span>
      <Delta value={item.quote.changePercent} />
    </Link>
  );
}

export function TickerStrip() {
  const { data } = useOverview();
  return (
    <div className="no-scrollbar flex h-8 shrink-0 overflow-x-auto border-b border-line bg-panel" aria-label="Markets">
      {data
        ? data.board.map((item) => <StripItem key={item.quote.symbol} item={item} />)
        : MARKET_BOARD.map((b) => (
            <div key={b.symbol} className="flex h-full shrink-0 items-center gap-2 border-r border-line px-3 text-xs">
              <span className="num text-fg-3">{b.code}</span>
              <span className="num text-fg-3">—</span>
            </div>
          ))}
    </div>
  );
}
