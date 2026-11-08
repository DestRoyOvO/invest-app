"use client";

import { useMemo } from "react";

import { useQuotes } from "@/hooks/useApi";
import { AGENDA_MAX_SYMBOLS, useAgendaFeed } from "@/hooks/useCalendarApi";
import { useHoldings } from "@/hooks/useHoldings";
import { useWatchlist } from "@/hooks/useWatchlist";
import type { AgendaInput, PriceLike } from "@/lib/events";
import { UNIVERSE_STOCKS } from "@/lib/universe";

const UNIVERSE = new Set(UNIVERSE_STOCKS);
/** Symbols per /api/quotes request (useQuotes keeps the first 50). */
const QUOTE_BATCH = 50;

/**
 * Everything the calendar and the week-ahead panel need: holdings and watchlist from this browser, their events (plus
 * the stock universe when asked) and the latest prices of held symbols for position values. The feed waits until the
 * browser lists are read, so the page never requests an empty list first. `names` counts the holdings and watchlist
 * names, `namesCovered` those the feed includes (holdings first).
 */
export function useAgendaData(days: number, includeUniverse: boolean) {
  const { holdings } = useHoldings();
  const { symbols: watchlist, hydrated } = useWatchlist();
  const held = useMemo(() => Object.keys(holdings), [holdings]);
  const symbols = useMemo(() => (hydrated ? [...new Set([...held, ...watchlist])] : null), [hydrated, held, watchlist]);
  const feed = useAgendaFeed(symbols, days, includeUniverse);
  // Two batches price every held symbol the feed can include, so no position falls back to its cost for want of a quote.
  const first = useQuotes(held.slice(0, QUOTE_BATCH));
  const second = useQuotes(held.slice(QUOTE_BATCH, AGENDA_MAX_SYMBOLS));
  const prices = useMemo(() => {
    const map = new Map<string, PriceLike>();
    for (const quote of [...(first.data?.quotes ?? []), ...(second.data?.quotes ?? [])]) map.set(quote.symbol, { price: quote.price, currency: quote.currency });
    return map;
  }, [first.data, second.data]);
  const input = useMemo<AgendaInput>(() => ({ holdings, watchlist, universe: UNIVERSE, prices }), [holdings, watchlist, prices]);
  const names = symbols?.length ?? 0;
  return { feed, input, hydrated, held, watchlist, names, namesCovered: Math.min(names, AGENDA_MAX_SYMBOLS) };
}
