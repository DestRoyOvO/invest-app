"use client";

import Link from "next/link";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Delta } from "@/components/ui/Delta";
import { TickNumber } from "@/components/ui/TickNumber";
import { useOverview } from "@/hooks/useApi";
import { stockPath } from "@/lib/api-client";
import { formatNumber, formatPrice } from "@/lib/format";
import { MARKET_BOARD } from "@/lib/universe";
import type { BoardItem } from "@/types/api";

function StripItem({ item }: { item: BoardItem }) {
  const { lang } = usePrefs();
  const def = MARKET_BOARD.find((b) => b.symbol === item.quote.symbol);
  const price = def?.kind === "yield" ? formatNumber(item.quote.price, 3, lang) : formatPrice(item.quote.price, lang);
  return (
    <Link
      href={stockPath(item.quote.symbol)}
      className="flex h-full shrink-0 items-center gap-2 border-r border-line px-3 text-xs hover:bg-hover"
      title={def ? def.label[lang] : item.quote.name}
    >
      <span className="mono text-fg-3">{def?.code ?? item.quote.symbol}</span>
      <TickNumber value={item.quote.price} className="text-fg">
        {price}
      </TickNumber>
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
              <span className="mono text-fg-3">{b.code}</span>
              <span className="num text-fg-3">—</span>
            </div>
          ))}
    </div>
  );
}
