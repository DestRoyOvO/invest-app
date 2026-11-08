// Yahoo's placeholder figures and the decimals of an instrument's prices, shared by the server's quote mappers
// (lib/server/yahoo.ts) and the views that format quotes: a figure Yahoo does not have reads as a dash everywhere, and
// a currency pair keeps its pips wherever its price and its change show.

import { formatNumber, formatPrice } from "@/lib/format";
import type { Lang } from "@/types/api";

import { getWorldSymbol, MARKET_BOARD } from "./universe";

/**
 * A price figure of the session or of the year (open, day low and high, 52-week low and high, previous close, bid,
 * ask), or null for Yahoo's placeholder 0. Nothing trades at exactly zero, yet yields come with an open, a day range
 * and a 52-week low of 0 (^TNX, ^IRX, ^FVX and ^TYX on 2026-11-07). Negative prices are real (WTI futures settled at
 * -37.63 in April 2020) and stay.
 */
export function reportedPrice(value: number | null): number | null {
  return value === 0 ? null : value;
}

/**
 * The day's change and percent change, recomputed from the price and the previous close when Yahoo derived them from a
 * placeholder price of 0. On 2026-11-08 the Treasury yields (^TNX, ^IRX, ^FVX, ^TYX) came with a change of exactly minus
 * the previous close (^TNX at 4.859: -4.837, "-49.89%") next to their real price; a change that implies a price of 0
 * cannot be real (see reportedPrice), and the price minus the previous close is what Yahoo sends otherwise (^TNX an
 * hour earlier: +0.022, +0.45%). Any other change stays as Yahoo sent it, including a crypto pair's, which Yahoo
 * measures against its own 24-hour reference rather than the previous close.
 */
export function reportedChange(
  change: number | null,
  changePercent: number | null,
  price: number | null,
  previousClose: number | null,
): { change: number | null; changePercent: number | null } {
  if (change === null || price === null || previousClose === null || price === 0 || previousClose === 0) return { change, changePercent };
  const impliedPrice = previousClose + change;
  if (Math.abs(impliedPrice) > Math.abs(previousClose) * 1e-6) return { change, changePercent };
  const recomputed = price - previousClose;
  return { change: recomputed, changePercent: (recomputed / previousClose) * 100 };
}

/**
 * Quote types whose volume counts exchange trades, so a 0 can be real: a halted stock, an ETF before its first trade.
 * For every other type Yahoo's 0 stands for a volume it does not report. Seen on 2026-11-07: indices (^TNX, ^VIX,
 * ^RUT, ^N225 and ^FTSE send 0 while ^GSPC, ^DJI and ^NDX send real volumes), currencies (EURUSD=X, USDJPY=X: volume
 * and average volume 0) and mutual funds (VFIAX: no volume, average volume 0). Futures and crypto (CL=F, GC=F, BTC-USD)
 * send real volumes, so a 0 there is a gap too.
 */
const COUNTED_VOLUME: ReadonlySet<string> = new Set(["EQUITY", "ETF"]);

/** A volume or average volume, or null where Yahoo's 0 means it reports none (see COUNTED_VOLUME). */
export function reportedVolume(value: number | null, quoteType: string | null): number | null {
  return value === 0 && quoteType !== null && !COUNTED_VOLUME.has(quoteType) ? null : value;
}

/** Decimals of a yield on the markets board: ^TNX quotes 4.859 (percent), and the board and the ticker strip show 3. */
const YIELD_DIGITS = 3;
/** Decimals of a currency pair that is not on the world board. */
const PAIR_DIGITS = 4;

/**
 * Decimals for an instrument's prices and price changes, or null for formatPrice's own rule (2, or 4 below 1). The
 * world board's instruments keep its digits (EUR/USD 4, USD/JPY 3, copper 4) and the markets board's yields theirs
 * (^TNX 3), so an instrument reads the same on its quote page as on the boards; other currency pairs (quote type
 * CURRENCY, or Yahoo's "=X" symbols before the quote arrives) get 4. A change shown next to the price takes the same
 * decimals: USD/JPY at 158.425 moved +0.770, not +0.77.
 */
export function priceDigits(symbol: string, quoteType: string | null | undefined): number | null {
  const listed = getWorldSymbol(symbol);
  if (listed) return listed.digits;
  if (MARKET_BOARD.some((item) => item.symbol === symbol && item.kind === "yield")) return YIELD_DIGITS;
  return quoteType === "CURRENCY" || symbol.endsWith("=X") ? PAIR_DIGITS : null;
}

/** A price with the instrument's decimals (see priceDigits), or formatPrice's rule without them. */
export function formatQuotePrice(value: number | null | undefined, digits: number | null, lang: Lang): string {
  return digits === null ? formatPrice(value, lang) : formatNumber(value, digits, lang);
}
