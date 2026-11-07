import "server-only";

import type { BoardItem, Quote } from "@/types/api";
import type { BoardResponse } from "@/types/shell";
import { MARKET_BOARD, MARKET_STATE_SYMBOL } from "@/lib/universe";

import { cached, isFresh } from "./cache";
import { getQuotes, getSparkline, hasCachedSparkline, hasFreshQuote } from "./yahoo";

// The ticker strip and the status bar need the 10 board instruments and the market state, not the whole market overview
// (about 80 KB with every heatmap quote). This payload is about 8 KB and is assembled at most once per 10 seconds for
// every visitor: one batched quote request (each quote cached 15 s while trading) plus the cached sparklines.

const BOARD_KEY = "market:board";
const BOARD_TTL_MS = 10_000;
export const BOARD_SYMBOLS: readonly string[] = MARKET_BOARD.map((item) => item.symbol);

/** Board items in MARKET_BOARD order; symbols without a quote are left out. */
export function boardItems(quotes: ReadonlyMap<string, Quote>, sparks: ReadonlyMap<string, number[]>): BoardItem[] {
  return BOARD_SYMBOLS.flatMap((symbol) => {
    const quote = quotes.get(symbol);
    return quote ? [{ quote, spark: sparks.get(symbol) ?? [] }] : [];
  });
}

/** The oldest fetchedAt among stale quotes; null when none is stale (or a stale one lacks the time). */
export function staleSince(items: readonly BoardItem[]): { stale: boolean; since: string | null } {
  let stale = false;
  let since: string | null = null;
  for (const { quote } of items) {
    if (!quote.stale) continue;
    stale = true;
    if (quote.fetchedAt && (since === null || quote.fetchedAt < since)) since = quote.fetchedAt;
  }
  return { stale, since };
}

async function loadSparks(): Promise<{ sparks: Map<string, number[]>; failed: boolean }> {
  const settled = await Promise.allSettled(BOARD_SYMBOLS.map((symbol) => getSparkline(symbol)));
  const sparks = new Map<string, number[]>();
  let failed = false;
  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") sparks.set(BOARD_SYMBOLS[i], outcome.value);
    else failed = true;
  });
  return { sparks, failed };
}

async function buildBoard(): Promise<BoardResponse> {
  const [quotesResult, sparksResult] = await Promise.allSettled([getQuotes([...BOARD_SYMBOLS]), loadSparks()]);
  if (quotesResult.status === "rejected") throw quotesResult.reason;
  const quotes = quotesResult.value;
  if (quotes.size === 0) throw new Error("Market board: Yahoo returned no quotes");

  const warnings: string[] = [];
  const sparks = sparksResult.status === "fulfilled" ? sparksResult.value.sparks : new Map<string, number[]>();
  if (sparksResult.status === "rejected" || sparksResult.value.failed) warnings.push("sparklines");

  const board = boardItems(quotes, sparks);
  if (board.length < BOARD_SYMBOLS.length) warnings.push("board");
  const { stale, since } = staleSince(board);
  if (stale) warnings.push("quotes_stale");

  return {
    asOf: new Date().toISOString(),
    marketState: quotes.get(MARKET_STATE_SYMBOL)?.marketState ?? null,
    board,
    warnings,
    quotesAsOf: since,
  };
}

/** The board for the shell. Throws only when no quote at all can be loaded. */
export function getBoard(): Promise<BoardResponse> {
  return cached(BOARD_KEY, { ttlMs: BOARD_TTL_MS }, buildBoard);
}

/** Yahoo calls a board request is about to make: none while the board is cached, else the quote batch and sparklines. */
export function uncachedBoardCalls(): number {
  if (isFresh(BOARD_KEY)) return 0;
  const quoteBatch = BOARD_SYMBOLS.some((symbol) => !hasFreshQuote(symbol)) ? 1 : 0;
  return quoteBatch + BOARD_SYMBOLS.filter((symbol) => !hasCachedSparkline(symbol)).length;
}
