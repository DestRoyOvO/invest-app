"use client";

import { useCallback } from "react";

import { useT } from "@/components/providers/PrefsProvider";
import { useToast } from "@/components/ui/Toast";
import { useWatchlist } from "@/hooks/useWatchlist";
import { tpl } from "@/lib/format";
import { MAX_WATCHLIST } from "@/lib/universe";

/** Watchlist membership for the screener's stars: toggles a symbol and says so when the list is full. */
export function useWatchToggle() {
  const t = useT();
  const toast = useToast();
  const { symbols, hydrated, add, remove } = useWatchlist();

  const toggle = useCallback(
    (symbol: string) => {
      if (symbols.includes(symbol)) {
        remove(symbol);
        return;
      }
      if (add(symbol) === "full") toast.show({ message: tpl(t.watchlist.full, { n: MAX_WATCHLIST }) });
    },
    [symbols, add, remove, toast, t],
  );

  return { watchlist: symbols, hydrated, toggle, add, remove };
}
