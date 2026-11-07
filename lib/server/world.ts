import "server-only";

import type { Quote } from "@/types/api";
import type { WorldMarketsResponse, WorldRow } from "@/types/markets";
import { WORLD_BOARD } from "@/lib/universe";

import { getQuotes, getSparkline, hasCachedSparkline, hasFreshQuote } from "./yahoo";

// The world markets board (WEI): indices, FX, commodities and crypto from one batched quote request, each with about a
// month of daily closes. Quotes and series are cached per symbol by lib/server/yahoo.ts (and shared with every other
// route), so assembling the board again costs nothing until a cache entry expires.

export const WORLD_SYMBOLS: readonly string[] = WORLD_BOARD.map((item) => item.symbol);

/**
 * How long a response waits for series that are not cached yet. A cold start needs one chart request per symbol; the
 * rows go out with the series that arrived in time, and the rest are cached for the next refresh.
 */
export const SPARK_BUDGET_MS = 2_500;

/** Rows in WORLD_BOARD order for the symbols with a quote, and the symbols without one. Pure. */
export function buildWorldRows(
  quotes: ReadonlyMap<string, Quote>,
  sparks: ReadonlyMap<string, readonly number[]>,
): { rows: WorldRow[]; missing: string[] } {
  const rows: WorldRow[] = [];
  const missing: string[] = [];
  for (const symbol of WORLD_SYMBOLS) {
    const quote = quotes.get(symbol);
    if (!quote) {
      missing.push(symbol);
      continue;
    }
    rows.push({
      symbol,
      price: quote.price,
      change: quote.change,
      changePercent: quote.changePercent,
      marketState: quote.marketState,
      time: quote.regularMarketTime,
      spark: [...(sparks.get(symbol) ?? [])],
      stale: quote.stale,
    });
  }
  return { rows, missing };
}

/**
 * Loads the series, waiting at most `budgetMs`. Returns the series that arrived in time and whether every one did;
 * the loads that are still running keep going and land in the sparkline cache.
 */
export async function loadSparks(symbols: readonly string[], budgetMs: number): Promise<{ sparks: Map<string, number[]>; complete: boolean }> {
  const sparks = new Map<string, number[]>();
  let failed = false;
  const loads = symbols.map((symbol) =>
    getSparkline(symbol).then(
      (series) => {
        sparks.set(symbol, series);
      },
      () => {
        failed = true;
      },
    ),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), budgetMs);
  });
  const outcome = await Promise.race([Promise.all(loads).then(() => "done" as const), timeout]);
  clearTimeout(timer);
  return { sparks: new Map(sparks), complete: outcome === "done" && !failed };
}

/** The board with as many series as arrive within the budget. Throws only when no quote at all can be loaded. */
export async function getWorldMarkets(budgetMs = SPARK_BUDGET_MS): Promise<WorldMarketsResponse> {
  const [quotesResult, sparksResult] = await Promise.allSettled([getQuotes([...WORLD_SYMBOLS]), loadSparks(WORLD_SYMBOLS, budgetMs)]);
  if (quotesResult.status === "rejected") throw quotesResult.reason;
  const quotes = quotesResult.value;
  if (quotes.size === 0) throw new Error("World markets: Yahoo returned no quotes");

  const sparks = sparksResult.status === "fulfilled" ? sparksResult.value.sparks : new Map<string, number[]>();
  const { rows, missing } = buildWorldRows(quotes, sparks);
  const warnings: string[] = [];
  if (sparksResult.status === "rejected" || !sparksResult.value.complete) warnings.push("sparklines");
  if (rows.some((row) => row.stale)) warnings.push("quotes_stale");
  return { asOf: new Date().toISOString(), rows, missing, warnings };
}

/** Yahoo calls a request for the board would make now: one batched quote request if any quote expired, plus each uncached series. */
export function uncachedWorldCalls(): number {
  const quoteCall = WORLD_SYMBOLS.some((symbol) => !hasFreshQuote(symbol)) ? 1 : 0;
  return quoteCall + WORLD_SYMBOLS.filter((symbol) => !hasCachedSparkline(symbol)).length;
}
