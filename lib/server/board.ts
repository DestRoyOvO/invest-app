import "server-only";

import type { BoardResponse } from "@/types/shell";
import { MARKET_STATE_SYMBOL } from "@/lib/universe";

import { cached, isFresh } from "./cache";
import { BOARD_SYMBOLS, buildBoard, loadBoardSparks, oldestStaleFetch } from "./market";
import { getQuotes, hasCachedSparkline, hasFreshQuote } from "./yahoo";

// The ticker strip, the status bar and the overview's markets board need the 10 board instruments and the market
// state, not the whole market overview (about 80 KB with every heatmap quote). This payload is about 13 KB (full Quote
// objects) and is assembled at most once per 10 seconds for every visitor: one batched quote request (each quote
// cached 15 s while trading) plus the cached sparklines. The board items and sparklines come from the same helpers as
// the overview's (lib/server/market.ts).

const BOARD_KEY = "market:board";
const BOARD_TTL_MS = 10_000;

export { BOARD_SYMBOLS };

async function loadBoard(): Promise<BoardResponse> {
  const [quotesResult, sparksResult] = await Promise.allSettled([getQuotes([...BOARD_SYMBOLS]), loadBoardSparks()]);
  if (quotesResult.status === "rejected") throw quotesResult.reason;
  const quotes = quotesResult.value;
  if (quotes.size === 0) throw new Error("Market board: Yahoo returned no quotes");

  const warnings: string[] = [];
  const sparks = sparksResult.status === "fulfilled" ? sparksResult.value.sparks : new Map<string, number[]>();
  if (sparksResult.status === "rejected" || sparksResult.value.failed) warnings.push("sparklines");

  const board = buildBoard(quotes, sparks);
  if (board.length < BOARD_SYMBOLS.length) warnings.push("board");
  if (board.some((item) => item.quote.stale)) warnings.push("quotes_stale");
  const staleSince = oldestStaleFetch(board.map((item) => item.quote));

  return {
    asOf: new Date().toISOString(),
    marketState: quotes.get(MARKET_STATE_SYMBOL)?.marketState ?? null,
    board,
    warnings,
    staleSince,
    quotesAsOf: staleSince,
  };
}

/** The board for the shell and the overview. Throws only when no quote at all can be loaded. */
export function getBoard(): Promise<BoardResponse> {
  return cached(BOARD_KEY, { ttlMs: BOARD_TTL_MS }, loadBoard);
}

/** Yahoo calls a board request is about to make: none while the board is cached, else the quote batch and sparklines. */
export function uncachedBoardCalls(): number {
  if (isFresh(BOARD_KEY)) return 0;
  const quoteBatch = BOARD_SYMBOLS.some((symbol) => !hasFreshQuote(symbol)) ? 1 : 0;
  return quoteBatch + BOARD_SYMBOLS.filter((symbol) => !hasCachedSparkline(symbol)).length;
}
