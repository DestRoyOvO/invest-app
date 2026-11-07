"use client";

import { useMemo } from "react";

import { useQuotes } from "@/hooks/useApi";
import { useAgendaFeed } from "@/hooks/useCalendarApi";
import { useHoldings } from "@/hooks/useHoldings";
import { useWatchlist } from "@/hooks/useWatchlist";
import type { AgendaInput, PriceLike } from "@/lib/events";
import { UNIVERSE_STOCKS } from "@/lib/universe";

const UNIVERSE = new Set(UNIVERSE_STOCKS);

/**
 * Everything the calendar and the week-ahead panel need: holdings and watchlist from this browser, their events (plus
 * the stock universe when asked) and the latest prices of held symbols for position values. The feed waits until the
 * browser lists are read, so the page never requests an empty list first.
 */
export function useAgendaData(days: number, includeUniverse: boolean) {
  const { holdings } = useHoldings();
  const { symbols: watchlist, hydrated } = useWatchlist();
  const held = useMemo(() => Object.keys(holdings), [holdings]);
  const symbols = useMemo(() => (hydrated ? [...new Set([...held, ...watchlist])] : null), [hydrated, held, watchlist]);
  const feed = useAgendaFeed(symbols, days, includeUniverse);
  const quotes = useQuotes(held);
  const prices = useMemo(() => {
    const map = new Map<string, PriceLike>();
    for (const quote of quotes.data?.quotes ?? []) map.set(quote.symbol, { price: quote.price, currency: quote.currency });
    return map;
  }, [quotes.data]);
  const input = useMemo<AgendaInput>(() => ({ holdings, watchlist, universe: UNIVERSE, prices }), [holdings, watchlist, prices]);
  return { feed, input, hydrated, held, watchlist, quotes: quotes.data?.quotes ?? null };
}
