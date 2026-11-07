// Portfolio valuation shared by the watchlist panel and the AI context.
//
// Amounts are never converted between currencies. Positions quoted in the base currency (the most common currency
// among priced positions, USD on a tie) make up the totals and weights. Positions in another currency are valued on
// their own, and positions without a usable price are listed separately, so no position disappears silently.

export interface PositionLike {
  symbol: string;
  shares: number;
  /** Average cost per share, in the quote currency. */
  cost: number;
}

export interface QuoteLike {
  price: number | null;
  change: number | null;
  currency: string | null;
}

export interface ValuedPosition extends PositionLike {
  price: number;
  /** Quote currency as Yahoo reports it (for example "USD", "JPY" or "GBp" for pence). */
  currency: string;
  value: number;
  costBasis: number;
  pnl: number;
  pnlPct: number | null;
  dayPnl: number | null;
  /** Share of the base-currency total; null for a position in another currency. */
  weight: number | null;
}

export interface PortfolioTotals {
  value: number;
  costBasis: number;
  dayPnl: number;
  pnl: number;
  pnlPct: number | null;
}

export interface Portfolio {
  baseCurrency: string;
  /** Base-currency positions, largest value first. The totals and weights cover these only. */
  rows: ValuedPosition[];
  /** Priced positions in another currency, largest cost basis first. Not converted, so not in the totals. */
  foreign: ValuedPosition[];
  /** Positions without a usable price (no quote, or a missing or non-positive price), in input order. */
  unpriced: PositionLike[];
  totals: PortfolioTotals;
}

export const DEFAULT_CURRENCY = "USD";

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** The most common currency; ties prefer USD, then alphabetical order. */
export function pickBaseCurrency(currencies: readonly string[]): string {
  if (currencies.length === 0) return DEFAULT_CURRENCY;
  const counts = new Map<string, number>();
  for (const currency of currencies) counts.set(currency, (counts.get(currency) ?? 0) + 1);
  const ranked = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || Number(b[0] === DEFAULT_CURRENCY) - Number(a[0] === DEFAULT_CURRENCY) || a[0].localeCompare(b[0]),
  );
  return ranked[0][0];
}

export function valuePortfolio(positions: readonly PositionLike[], quoteOf: (symbol: string) => QuoteLike | undefined): Portfolio {
  const priced: ValuedPosition[] = [];
  const unpriced: PositionLike[] = [];
  for (const { symbol, shares, cost } of positions) {
    const quote = quoteOf(symbol);
    const price = quote?.price;
    if (!quote || !isFiniteNumber(price) || price <= 0) {
      unpriced.push({ symbol, shares, cost });
      continue;
    }
    const value = shares * price;
    const costBasis = shares * cost;
    priced.push({
      symbol,
      shares,
      cost,
      price,
      currency: quote.currency || DEFAULT_CURRENCY,
      value,
      costBasis,
      pnl: value - costBasis,
      pnlPct: costBasis > 0 ? (value - costBasis) / costBasis : null,
      dayPnl: isFiniteNumber(quote.change) ? shares * quote.change : null,
      weight: null,
    });
  }

  const baseCurrency = pickBaseCurrency(priced.map((position) => position.currency));
  const rows = priced.filter((position) => position.currency === baseCurrency).sort((a, b) => b.value - a.value);
  const foreign = priced.filter((position) => position.currency !== baseCurrency).sort((a, b) => b.costBasis - a.costBasis);
  const value = rows.reduce((sum, row) => sum + row.value, 0);
  const costBasis = rows.reduce((sum, row) => sum + row.costBasis, 0);
  for (const row of rows) row.weight = value > 0 ? row.value / value : null;

  return {
    baseCurrency,
    rows,
    foreign,
    unpriced,
    totals: {
      value,
      costBasis,
      dayPnl: rows.reduce((sum, row) => sum + (row.dayPnl ?? 0), 0),
      pnl: value - costBasis,
      pnlPct: costBasis > 0 ? (value - costBasis) / costBasis : null,
    },
  };
}
