"use client";

import { Star } from "lucide-react";

import { useT } from "@/components/providers/PrefsProvider";
import { IconButton } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { tpl } from "@/lib/format";

/** Watchlist star for a table row: filled when the symbol is in the watchlist. Neutral ink, never a buy color. */
export function WatchStar({ symbol, active, onToggle }: { symbol: string; active: boolean; onToggle: (symbol: string) => void }) {
  const t = useT();
  return (
    <IconButton
      size="sm"
      label={tpl(active ? t.screener.star.remove : t.screener.star.add, { symbol })}
      icon={<Star aria-hidden className={cn("size-3.5", active ? "text-fg" : "text-fg-3")} strokeWidth={1.75} fill={active ? "currentColor" : "none"} />}
      onClick={() => onToggle(symbol)}
    />
  );
}
