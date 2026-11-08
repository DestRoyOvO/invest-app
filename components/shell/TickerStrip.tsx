"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";
import { Delta } from "@/components/ui/Delta";
import { TickNumber } from "@/components/ui/TickNumber";
import { useBoard } from "@/hooks/useShellApi";
import { stockPath } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatNumber, formatPrice } from "@/lib/format";
import { MARKET_BOARD } from "@/lib/universe";
import type { BoardItem } from "@/types/api";

import { boardNotice } from "./board-status";
import { useNow } from "./clock";

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

/**
 * The board instruments in one horizontally scrolling row. Dashes until the first board arrives; a warning with a
 * retry when it cannot load; and on phones, which have no status bar, a "Delayed since 13:05 ET" lead while older
 * quotes are shown. The status bar announces both states to screen readers.
 */
export function TickerStrip() {
  const { t, lang } = usePrefs();
  const { data, error, mutate } = useBoard();
  const now = useNow("halfMinute");
  const notice = boardNotice(t, data, Boolean(error), lang, now);

  let items;
  if (data) {
    items = (
      <>
        {notice ? (
          <li className={cn(itemClass, "text-warn md:hidden")} title={notice.text}>
            <AlertTriangle aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
            {notice.short}
          </li>
        ) : null}
        {data.board.map((item) => (
          <StripItem key={item.quote.symbol} item={item} />
        ))}
      </>
    );
  } else if (notice) {
    items = (
      <li className="flex h-full shrink-0 items-center gap-2 px-3 text-xs">
        <AlertTriangle aria-hidden className="size-3.5 shrink-0 text-warn" strokeWidth={1.75} />
        <span className="text-warn">{notice.text}</span>
        <Button size="sm" touchTarget={false} className="ml-1 h-6" onClick={() => void mutate()}>
          {t.common.retry}
        </Button>
      </li>
    );
  } else {
    items = MARKET_BOARD.map((b) => (
      <li key={b.symbol} className={itemClass}>
        <span className="mono text-fg-3">{b.code}</span>
        <span className="num text-fg-3">—</span>
      </li>
    ));
  }

  return (
    <nav aria-label={t.shell.ticker} className="no-scrollbar h-8 shrink-0 overflow-x-auto border-b border-line bg-panel">
      <ul className="flex h-full w-max">{items}</ul>
    </nav>
  );
}
