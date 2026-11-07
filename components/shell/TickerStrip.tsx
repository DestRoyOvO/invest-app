"use client";

import Link from "next/link";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Delta } from "@/components/ui/Delta";
import { TickNumber } from "@/components/ui/TickNumber";
import { useBoard } from "@/hooks/useShellApi";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatNumber, formatPrice } from "@/lib/format";
import { MARKET_BOARD } from "@/lib/universe";
import type { BoardItem } from "@/types/api";

const itemClass = "flex h-full shrink-0 items-center gap-2 border-r border-line px-3 text-xs";

function StripItem({ item }: { item: BoardItem }) {
  const { lang } = usePrefs();
  const def = MARKET_BOARD.find((b) => b.symbol === item.quote.symbol);
  const price = def?.kind === "yield" ? formatNumber(item.quote.price, 3, lang) : formatPrice(item.quote.price, lang);
  return (
    <li className="h-full">
      <Link href={stockPath(item.quote.symbol)} className={cn(itemClass, "hover:bg-hover")} title={def ? def.label[lang] : item.quote.name}>
        <span className="mono text-fg-3">{def?.code ?? item.quote.symbol}</span>
        <TickNumber value={item.quote.price} className="text-fg">
          {price}
        </TickNumber>
        <Delta value={item.quote.changePercent} />
      </Link>
    </li>
  );
}

/** The board instruments in one horizontally scrolling row; dashes until the first board arrives. */
export function TickerStrip() {
  const { t } = usePrefs();
  const { data } = useBoard();
  return (
    <nav aria-label={t.shell.ticker} className="no-scrollbar h-8 shrink-0 overflow-x-auto border-b border-line bg-panel">
      <ul className="flex h-full w-max">
        {data
          ? data.board.map((item) => <StripItem key={item.quote.symbol} item={item} />)
          : MARKET_BOARD.map((b) => (
              <li key={b.symbol} className={itemClass}>
                <span className="mono text-fg-3">{b.code}</span>
                <span className="num text-fg-3">—</span>
              </li>
            ))}
      </ul>
    </nav>
  );
}
