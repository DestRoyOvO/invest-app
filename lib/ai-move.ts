// "Why is it moving?": how much of a symbol's move the market, its sector and its peers explain, and how unusual the
// move is against the symbol's own recent volatility. Pure; lib/server/ai-context.ts loads the quotes, bars and news.
//
// Attribution order (the prompt asks for the same): the market first (beta times the S&P 500 move), then the sector
// ETF and peers, and only then company news. What is left after the market and the sector is the part company news
// would have to explain.

import type { DailyBar } from "@/lib/bars";
import { beta as betaOf } from "@/lib/risk";
import { median, sampleStd } from "@/lib/stats";
import type { Quote } from "@/types/api";

import { cleanInline, fmtChangePercent, fmtNumber, fmtPoints, fmtPrice, fmtRatio, isFiniteNumber } from "./ai-format";

/** Sessions of daily returns behind the "how unusual" z-score. */
export const VOLATILITY_WINDOW = 60;
/** Sessions of daily returns behind the fallback beta. */
export const BETA_WINDOW = 252;
export const MAX_PEERS = 5;

/** New York calendar date (YYYY-MM-DD) of an ISO timestamp. */
export function newYorkDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function cleanBars(bars: readonly DailyBar[]): DailyBar[] {
  return [...bars].filter((bar) => Number.isFinite(bar.t) && isFiniteNumber(bar.adjClose) && bar.adjClose > 0).sort((a, b) => a.t - b.t);
}

/**
 * Sample standard deviation of the last `window` daily returns that ended before the session of the move (a decimal,
 * 0.021 = 2.1% a day). The bar of the move's own session, and anything after it, is left out so the move does not
 * inflate its own baseline. Null with fewer than `window` returns.
 */
export function dailyVolatility(bars: readonly DailyBar[], moveDate: string | null, window = VOLATILITY_WINDOW): number | null {
  let series = cleanBars(bars);
  if (moveDate) {
    const cutoff = Date.parse(`${moveDate}T00:00:00Z`);
    if (!Number.isNaN(cutoff)) series = series.filter((bar) => bar.t < cutoff);
  }
  const closes = series.map((bar) => bar.adjClose);
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) returns.push(closes[i] / closes[i - 1] - 1);
  if (returns.length < window) return null;
  return sampleStd(returns.slice(-window));
}

/** Beta of daily returns to a benchmark over the last `window` sessions both have (null with too few). */
export function trailingBeta(stockBars: readonly DailyBar[], benchmarkBars: readonly DailyBar[], window = BETA_WINDOW): number | null {
  const stock = new Map(cleanBars(stockBars).map((bar) => [bar.t, bar.adjClose]));
  const bench = new Map(cleanBars(benchmarkBars).map((bar) => [bar.t, bar.adjClose]));
  const dates = [...stock.keys()].filter((t) => bench.has(t)).sort((a, b) => a - b);
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    x.push((stock.get(dates[i]) as number) / (stock.get(dates[i - 1]) as number) - 1);
    y.push((bench.get(dates[i]) as number) / (bench.get(dates[i - 1]) as number) - 1);
  }
  return betaOf(x.slice(-window), y.slice(-window));
}

/**
 * Up to `n` peers nearest in market cap (by the ratio of caps, so a $4T and a $1T company are as far apart as a $40B
 * and a $10B one), excluding the symbol itself and quotes without a cap or a change.
 */
export function nearestPeers(symbol: string, marketCap: number | null, candidates: readonly Quote[], n = MAX_PEERS): Quote[] {
  const usable = candidates.filter(
    (quote) => quote.symbol !== symbol && isFiniteNumber(quote.changePercent) && isFiniteNumber(quote.marketCap) && (quote.marketCap ?? 0) > 0,
  );
  if (!isFiniteNumber(marketCap) || marketCap <= 0) return [...usable].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)).slice(0, n);
  const distance = (quote: Quote) => Math.abs(Math.log((quote.marketCap as number) / marketCap));
  return [...usable].sort((a, b) => distance(a) - distance(b) || a.symbol.localeCompare(b.symbol)).slice(0, n);
}

export interface MoveInput {
  quote: Quote;
  /** The S&P 500 quote (^GSPC). */
  market: Quote | undefined;
  /** Universe sector label, e.g. "Information Technology"; null for symbols without a sector. */
  sectorLabel: string | null;
  sectorEtf: Quote | undefined;
  /** Related ETFs other than the sector ETF. */
  relatedEtfs: readonly Quote[];
  peers: readonly Quote[];
  beta: { value: number; source: "risk report" | "daily bars" } | null;
  /** Daily standard deviation of the last 60 returns before the move (decimal). */
  dailyVolatility: number | null;
  /** "today" or "in the latest session (2026-11-06)". */
  session: string;
}

export interface MoveFacts {
  /** Percent units. */
  change: number | null;
  marketChange: number | null;
  /** Beta times the market change, percent units. */
  impliedMove: number | null;
  /** change - impliedMove, in points. */
  beyondMarket: number | null;
  sectorChange: number | null;
  /** change - sector ETF change, in points. */
  vsSector: number | null;
  peerMedian: number | null;
  /** change - peer median, in points. */
  vsPeers: number | null;
  relativeVolume: number | null;
  /** The move in standard deviations of the 60-session daily returns. */
  zScore: number | null;
}

export function moveFacts(input: MoveInput): MoveFacts {
  const change = input.quote.changePercent;
  const marketChange = input.market?.changePercent ?? null;
  const impliedMove = input.beta && isFiniteNumber(marketChange) ? input.beta.value * marketChange : null;
  const sectorChange = input.sectorEtf?.changePercent ?? null;
  const peerChanges = input.peers.map((peer) => peer.changePercent).filter(isFiniteNumber);
  const peerMedian = peerChanges.length > 0 ? median(peerChanges) : null;
  const { volume, avgVolume } = input.quote;
  const relativeVolume = isFiniteNumber(volume) && isFiniteNumber(avgVolume) && avgVolume > 0 ? volume / avgVolume : null;
  const diff = (a: number | null, b: number | null) => (isFiniteNumber(a) && isFiniteNumber(b) ? a - b : null);
  return {
    change,
    marketChange,
    impliedMove,
    beyondMarket: diff(change, impliedMove),
    sectorChange,
    vsSector: diff(change, sectorChange),
    peerMedian,
    vsPeers: diff(change, peerMedian),
    relativeVolume,
    zScore: isFiniteNumber(change) && isFiniteNumber(input.dailyVolatility) && input.dailyVolatility > 0 ? change / 100 / input.dailyVolatility : null,
  };
}

/** "unusually large" from 2.5 standard deviations, "large" from 1.5, otherwise "within the usual range". */
export function describeZ(z: number): string {
  const size = Math.abs(z);
  if (size >= 2.5) return "an unusually large move for this stock";
  if (size >= 1.5) return "a large move for this stock";
  return "within its usual daily range";
}

/**
 * The precomputed move breakdown: what moved, the market and beta-implied move, the sector ETF, related ETFs and
 * peers with the residuals, relative and extended-hours volume, and the move as a z-score of its 60-session volatility.
 */
export function moveBlock(input: MoveInput): string {
  const { quote, session } = input;
  const facts = moveFacts(input);
  const live = quote.marketState === "REGULAR";
  const lines = [`Move breakdown for ${quote.symbol} ${session} (precomputed from quotes and daily bars; attribute in this order):`];

  const volume = isFiniteNumber(facts.relativeVolume) ? `; volume ${facts.relativeVolume.toFixed(2)}x the 3-month daily average${live ? " so far in the session" : ""}` : "";
  lines.push(`- What moved: ${quote.symbol} ${fmtChangePercent(facts.change)} to ${fmtPrice(quote.price)}${volume}`);
  if (quote.extendedSession && isFiniteNumber(quote.extendedPrice)) {
    lines.push(`- ${quote.extendedSession === "PRE" ? "pre-market" : "after hours"}: ${fmtPrice(quote.extendedPrice)} (${fmtChangePercent(quote.extendedChangePercent)} from the close)`);
  }

  if (isFiniteNumber(facts.marketChange)) {
    if (input.beta && isFiniteNumber(facts.impliedMove)) {
      lines.push(
        `- Market: S&P 500 ${fmtChangePercent(facts.marketChange)}; with a beta of ${fmtNumber(input.beta.value)} (252 sessions against SPY, from the ${input.beta.source}) the market alone implies ${fmtChangePercent(facts.impliedMove)}, which leaves ${fmtPoints(facts.beyondMarket)} beyond the market`,
      );
    } else {
      lines.push(`- Market: S&P 500 ${fmtChangePercent(facts.marketChange)}; beta not available, so no market-implied move`);
    }
  } else {
    lines.push("- Market: S&P 500 change not available");
  }

  if (input.sectorEtf && isFiniteNumber(facts.sectorChange)) {
    const related = input.relatedEtfs.filter((etf) => isFiniteNumber(etf.changePercent)).map((etf) => `${etf.symbol} ${fmtChangePercent(etf.changePercent)}`);
    lines.push(
      `- Sector (${input.sectorLabel ?? "sector"}): ${input.sectorEtf.symbol} ${fmtChangePercent(facts.sectorChange)}, so ${quote.symbol} moved ${fmtPoints(facts.vsSector)} against its sector ETF${related.length > 0 ? `; related ETFs: ${related.join(", ")}` : ""}`,
    );
  } else {
    lines.push(`- Sector: ${input.sectorLabel ? `${input.sectorLabel}, ETF change not available` : "not classified in the tracked sectors"}`);
  }

  if (input.peers.length > 0) {
    const peers = input.peers.map((peer) => `${peer.symbol} ${fmtChangePercent(peer.changePercent)}`).join(", ");
    lines.push(`- Peers nearest in market cap: ${peers}; peer median ${fmtChangePercent(facts.peerMedian)}, so ${quote.symbol} moved ${fmtPoints(facts.vsPeers)} against them`);
  }

  if (isFiniteNumber(facts.zScore) && isFiniteNumber(input.dailyVolatility)) {
    lines.push(
      `- How unusual: daily volatility over the previous 60 sessions ${fmtRatio(input.dailyVolatility, 2)}, so the move is ${fmtNumber(facts.zScore, 1)} standard deviations, ${describeZ(facts.zScore)}`,
    );
  } else {
    lines.push("- How unusual: not enough daily history to compare");
  }
  return lines.join("\n");
}

/** A short "Company: NVIDIA Corporation, Semiconductors" header line for the move context. */
export function moveHeader(symbol: string, name: string, industry: string | null): string {
  const details = cleanInline(industry, 60);
  return `Symbol: ${symbol} (${cleanInline(name, 80) || symbol})${details ? `; industry ${details}` : ""}.`;
}
