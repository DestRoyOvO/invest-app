// Shared contract between the route handlers (app/api/**) and the client.
//
// Conventions
// - Numbers are raw numbers, never pre-formatted strings. Formatting happens on the client (lib/format.ts).
// - Missing values are `null`, never 0 or "-".
// - Percent fields (`changePercent`, `extendedChangePercent`) are in percent units: 1.23 means +1.23%.
// - Ratio fields (roe, margins, growth, dividendYield, winRate, returns, drawdowns) are decimals: 0.25 means 25%.
// - Timestamps are ISO-8601 strings, except chart bars which use epoch milliseconds (`t`).
//
// Endpoints (all GET unless noted; errors use ApiErrorBody with a matching HTTP status)
//   GET  /api/market/overview                -> MarketOverview
//   GET  /api/quotes?symbols=A,B             -> QuotesResponse        (max 50 symbols)
//   GET  /api/sparklines?symbols=A,B         -> Sparklines            (max 50 symbols, ~1 month of daily closes)
//   GET  /api/search?q=apple                 -> SearchResponse
//   GET  /api/news?sector=<SectorKey>        -> NewsResponse
//   GET  /api/stock/[symbol]                 -> StockDetail           (404 not_found for unknown symbols)
//   GET  /api/stock/[symbol]/chart?range=1y  -> ChartData
//   GET  /api/stock/[symbol]/signal          -> SignalReport
//   GET  /api/history?symbols=A,B&range=1y   -> HistoryResponse       (max 25 symbols, aligned daily adjusted closes)
//   GET  /api/screener?universe=stocks       -> ScreenerResponse      (universe: stocks | etfs)
//   GET  /api/stock/[symbol]/factors         -> FactorProfile
//   GET  /api/calendar?symbols=A,B&days=30   -> CalendarResponse      (max 100 symbols; scope=universe adds the stock universe)
//   GET  /api/discover?screen=day_gainers    -> DiscoverResponse      (market-wide Yahoo screens, quality-filtered)
//   POST /api/ai/analyze   AnalyzeRequest    -> text/plain stream (see AI_STREAM_ERROR)
//   POST /api/ai/chat      ChatRequest       -> text/plain stream
//   GET  /api/auth/status                    -> AuthStatus
//   POST /api/auth/login   { password }      -> 204, or 401 unauthorized
//   POST /api/auth/logout                    -> 204
//   GET  /api/health                         -> HealthResponse

export type Lang = "en" | "zh";

export type MarketState = "PREPRE" | "PRE" | "REGULAR" | "POST" | "POSTPOST" | "CLOSED";

export type SectorKey =
  | "technology"
  | "communication"
  | "consumer-discretionary"
  | "consumer-staples"
  | "healthcare"
  | "financials"
  | "industrials"
  | "energy"
  | "materials"
  | "utilities"
  | "real-estate";

// ---------------------------------------------------------------------------
// Quotes and market overview
// ---------------------------------------------------------------------------

export interface Quote {
  symbol: string;
  name: string;
  /** EQUITY | ETF | INDEX | FUTURE | CRYPTOCURRENCY | CURRENCY | MUTUALFUND ... */
  quoteType: string | null;
  currency: string | null;
  /** Human-readable exchange name, e.g. "NasdaqGS". */
  exchange: string | null;
  marketState: MarketState | null;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  /** 3-month average daily volume. */
  avgVolume: number | null;
  marketCap: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  epsTrailingTwelveMonths: number | null;
  /** Decimal, e.g. 0.0045 = 0.45%. */
  dividendYield: number | null;
  /** Pre- or post-market price when that session is active or more recent than the regular close. */
  extendedPrice: number | null;
  extendedChange: number | null;
  extendedChangePercent: number | null;
  extendedSession: "PRE" | "POST" | null;
  /** Time of the last regular-session trade. */
  regularMarketTime: string | null;
  /** 50- and 200-session simple moving averages of the close. */
  fiftyDayAverage: number | null;
  twoHundredDayAverage: number | null;
  /** Price change over the last 52 weeks, in percent units. */
  fiftyTwoWeekChangePercent: number | null;
  priceToBook: number | null;
  /** Analyst consensus EPS for the next fiscal year. */
  forwardEps: number | null;
  /** Forward annual dividend per share. */
  dividendRate: number | null;
  /** Mean analyst rating: 1 = strong buy ... 5 = sell. */
  analystRating: number | null;
  sharesOutstanding: number | null;
  /** Next earnings report (ISO), when Yahoo knows one in the future. */
  nextEarningsDate: string | null;
  /** True when the company has not confirmed nextEarningsDate yet (Yahoo's estimate). */
  earningsDateEstimated: boolean | null;
  /** Most recent earnings report in the past (ISO). */
  lastEarningsDate: string | null;
  /** Next or most recent dividend payment date (ISO); Yahoo often leaves a past date here. */
  dividendDate: string | null;
  /** Ex-date of the announced cash dividend (ISO), from Yahoo's corporate actions; null when none is announced. */
  exDividendDate: string | null;
  /** Cash dividend per share going ex on exDividendDate. */
  dividendAmount: number | null;
  /** Funds: annual net expense ratio (decimal, 0.000945 = 0.0945%). */
  expenseRatio: number | null;
  /** Funds: total net assets. */
  netAssets: number | null;
  /** Funds: year-to-date return in percent units. */
  ytdReturnPercent: number | null;
  /** When the server fetched this quote from Yahoo (ISO). */
  fetchedAt: string | null;
  /** True when the latest refresh failed and an older cached quote (see fetchedAt) is shown instead. */
  stale: boolean;
}

export interface QuotesResponse {
  asOf: string;
  quotes: Quote[];
  /** Requested symbols that Yahoo did not return (unknown or delisted). */
  missing: string[];
}

export interface BoardItem {
  quote: Quote;
  /** About one month of daily closes, oldest first; may be empty. */
  spark: number[];
}

export interface SectorSnapshot {
  key: SectorKey;
  etf: Quote | null;
  /** Market-cap-weighted average change of the constituents, in percent units. */
  changePercent: number | null;
  stocks: Quote[];
}

export interface MarketOverview {
  asOf: string;
  /** Market state of the US cash session, taken from ^GSPC. */
  marketState: MarketState | null;
  /** Indices, rates, FX, commodities and crypto, in the order of MARKET_BOARD (lib/universe.ts). */
  board: BoardItem[];
  /** In the order of SECTORS (lib/universe.ts). */
  sectors: SectorSnapshot[];
  movers: {
    gainers: Quote[];
    losers: Quote[];
    /** Highest dollar volume (price x volume). */
    mostActive: Quote[];
  };
  news: NewsItem[];
  /** Sections that failed upstream and were omitted or served stale, e.g. ["news"]; "quotes_stale" when some quotes are old. */
  warnings: string[];
}

export type Sparklines = Record<string, number[]>;

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string | null;
  type: string | null;
}

export interface SearchResponse {
  results: SymbolSearchResult[];
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

export type NewsProvenance = "company" | "industry" | "macro" | "market" | "sector";

export interface NewsItem {
  /** Yahoo news uuid; stable identifier used by POST /api/ai/analyze { kind: "news" }. */
  id: string;
  title: string;
  publisher: string | null;
  link: string;
  publishedAt: string | null;
  relatedTickers: string[];
  provenance: NewsProvenance;
}

export interface NewsResponse {
  asOf: string;
  news: NewsItem[];
}

// ---------------------------------------------------------------------------
// Stock detail and chart
// ---------------------------------------------------------------------------

export interface StockProfile {
  symbol: string;
  name: string;
  longName: string | null;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  currency: string | null;
  country: string | null;
  website: string | null;
  employees: number | null;
  /** Business summary (English, from Yahoo). */
  summary: string | null;
}

export interface KeyStats {
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  pegRatio: number | null;
  priceToBook: number | null;
  eps: number | null;
  forwardEps: number | null;
  dividendYield: number | null;
  beta: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  avgVolume: number | null;
  sharesOutstanding: number | null;
  roe: number | null;
  /** Net profit margin (decimal). */
  profitMargin: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  /** Latest quarter, year over year (decimal). */
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  /** Debt-to-equity as a ratio (Yahoo reports percent; divided by 100). */
  debtToEquity: number | null;
  totalCash: number | null;
  totalDebt: number | null;
  totalRevenue: number | null;
  freeCashflow: number | null;
  targetMeanPrice: number | null;
  targetHighPrice: number | null;
  targetLowPrice: number | null;
  /** Analyst consensus key from Yahoo: strong_buy | buy | hold | underperform | sell | none. */
  recommendationKey: string | null;
  /** 1 = strong buy ... 5 = sell. */
  recommendationMean: number | null;
  numberOfAnalysts: number | null;
  /** ISO date of the next (or most recent, if no future date is known) earnings report. */
  nextEarningsDate: string | null;
  exDividendDate: string | null;
}

export interface StockDetail {
  asOf: string;
  quote: Quote;
  profile: StockProfile;
  stats: KeyStats;
  /** Scored and de-duplicated: company news first, then industry and macro context. */
  news: NewsItem[];
  warnings: string[];
}

export type ChartRange = "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y";

export interface Bar {
  /** Epoch milliseconds of the session (UTC midnight of the trading day for daily bars). */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
}

export interface ChartData {
  symbol: string;
  range: ChartRange;
  interval: "1d" | "1wk";
  bars: Bar[];
}

export type HistoryRange = "6mo" | "1y" | "2y" | "5y";

/** Daily dividend- and split-adjusted closes of several symbols on one shared session calendar. */
export interface HistoryResponse {
  asOf: string;
  range: HistoryRange;
  /** Session dates (epoch ms, UTC midnight), ascending: the union of the returned symbols' sessions. */
  dates: number[];
  /** Closes per symbol aligned to `dates`; null where the symbol has no bar that session. */
  closes: Record<string, Array<number | null>>;
  /** Requested symbols without any bars in the range (unknown, delisted, or failed upstream). */
  missing: string[];
  /** True when some symbols failed upstream; they are in `missing` and the response is cached only briefly. */
  degraded: boolean;
}

// ---------------------------------------------------------------------------
// Screener and style factors (definitions in lib/factors.ts)
// ---------------------------------------------------------------------------

export type StyleFactorKey = "momentum" | "reversal" | "high52" | "volatility" | "beta";

export type ScreenerUniverse = "stocks" | "etfs";

export interface ScreenerRow {
  symbol: string;
  name: string;
  /** Sector of a universe stock; null for ETFs. */
  sector: SectorKey | null;
  quoteType: string | null;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
  /** Decimal. */
  dividendYield: number | null;
  /** 1 = strong buy ... 5 = sell. */
  analystRating: number | null;
  nextEarningsDate: string | null;
  earningsDateEstimated: boolean | null;
  /** Price over the 52-week high, minus 1 (ratio, at most 0). */
  fromHigh52: number | null;
  /** Price over the 50- and 200-day averages, minus 1 (ratios). */
  vs50d: number | null;
  vs200d: number | null;
  /** Average daily dollar volume over 3 months. */
  dollarVolume: number | null;
  /** Funds only: net expense ratio (decimal), net assets, year-to-date return (percent units). */
  expenseRatio: number | null;
  netAssets: number | null;
  ytdReturnPercent: number | null;
  /** Total returns over 21, 63 and 126 sessions (ratios); null without enough price history. */
  return1m: number | null;
  return3m: number | null;
  return6m: number | null;
  rsi14: number | null;
  /** The model's technical-only reading, 0..100 (see SignalReport.technicalScore). */
  technicalScore: number | null;
  /** Raw style factor values (lib/factors.ts). */
  factors: Record<StyleFactorKey, number | null>;
  /** Percentile of each raw value within the universe, 0..100 (higher = larger raw value). */
  percentiles: Record<StyleFactorKey, number | null>;
}

export interface ScreenerResponse {
  asOf: string;
  universe: ScreenerUniverse;
  rows: ScreenerRow[];
  /** Symbols whose price history failed to load: their bar-based columns are null. */
  partial: string[];
  warnings: string[];
}

export interface FactorProfile {
  symbol: string;
  asOf: string;
  values: Record<StyleFactorKey, number | null>;
  /** Percentile of each value among the stock universe's current values, 0..100. */
  percentiles: Record<StyleFactorKey, number | null>;
  /** Number of universe stocks the percentiles compare against. */
  universeSize: number;
  inUniverse: boolean;
}

// ---------------------------------------------------------------------------
// Discover: market-wide screens
// ---------------------------------------------------------------------------

/** Yahoo's predefined screens (their definitions, not ours) plus Yahoo's trending symbols. */
export type DiscoverScreen =
  | "day_gainers"
  | "day_losers"
  | "most_actives"
  | "undervalued_large_caps"
  | "growth_technology_stocks"
  | "most_shorted_stocks"
  | "trending";

export interface DiscoverResponse {
  asOf: string;
  screen: DiscoverScreen;
  /** Rows after the quality filter (US-listed equities above the market-cap and price floors), in Yahoo's order. */
  quotes: Quote[];
  /** Rows Yahoo returned before the quality filter. */
  scanned: number;
  /** Size of Yahoo's full result set when it reports one. */
  total: number | null;
  /** The market-cap floor applied, in dollars. */
  minMarketCap: number;
}

// ---------------------------------------------------------------------------
// Events calendar
// ---------------------------------------------------------------------------

export type CalendarEventKind = "earnings" | "dividend" | "macro";

export type MacroEventKey = "fomc" | "cpi" | "jobs";

export interface CalendarEvent {
  /** Stable id, e.g. "earnings:AAPL:2027-01-28". */
  id: string;
  kind: CalendarEventKind;
  /** ISO timestamp. Dividend payment dates are dates only (UTC midnight). */
  at: string;
  /** Earnings: reported before the open, after the close or during the session (New York time); null when unknown. */
  timing: "pre" | "post" | "intraday" | null;
  /** The company has not confirmed the date (Yahoo's estimate), or a tentative FOMC date. */
  estimated: boolean;
  /** Earnings and dividends; null for macro releases. */
  symbol: string | null;
  /** Company name; null for macro releases (labelled from `macro`). */
  name: string | null;
  macro: MacroEventKey | null;
  /** Macro: reference period of the data, e.g. "2026-10". */
  period: string | null;
  /** FOMC meeting with new economic projections. */
  projections: boolean;
  /** Dividends: cash dividend per share going ex on this date. */
  amount: number | null;
}

export interface CalendarResponse {
  asOf: string;
  /** Window covered (ISO). */
  from: string;
  to: string;
  /** Sorted by time. */
  events: CalendarEvent[];
  /** Requested symbols Yahoo returned no quote for. */
  missing: string[];
  /** Last macro event on file: the list needs updating after this date. */
  macroCalendarEnds: string;
}

// ---------------------------------------------------------------------------
// Quant signal
// ---------------------------------------------------------------------------

export type FactorKey = "momentum" | "trend" | "rsi" | "volume" | "value" | "quality" | "volatility";

export type SignalCode = "strong_bullish" | "bullish" | "neutral" | "bearish" | "strong_bearish";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface FactorResult {
  key: FactorKey;
  group: "technical" | "fundamental";
  /** 0..100, 50 = neutral, higher = more bullish. */
  score: number;
  /** Weight in the composite, 0..1. Model v4 gives the volatility regime 0: it is reported for risk only. */
  weight: number;
  /** True when the input data was missing and the neutral value 50 was used. */
  imputed: boolean;
  /** The underlying metric shown next to the score (e.g. RSI14, 20-day return, P/E, ROE, volatility percentile). */
  raw: number | null;
  /** How to format `raw`: percent = decimal shown as %, multiple = "x", number = plain. */
  rawUnit: "percent" | "multiple" | "number" | null;
}

export interface BacktestResult {
  holdDays: number;
  /** Number of sessions evaluated. */
  windowDays: number;
  /** Non-overlapping trades opened on bullish signals. */
  trades: number;
  /** 0..1 */
  winRate: number | null;
  /** Wilson 95% interval for winRate. */
  winRateCI: [number, number] | null;
  /** Mean per-trade return, net of costs (decimal). */
  avgReturn: number | null;
  /** Same window, every session, same holding period, same entry and cost rules. */
  baselineWinRate: number | null;
  baselineAvgReturn: number | null;
  /** avgReturn - baselineAvgReturn */
  edge: number | null;
  /**
   * Two-sided circular-shift permutation p-value of the edge: the share of rotations of the label sequence (by at
   * least 20 sessions, same trade rule) whose |edge| is at least as large. Small values mean the timing is hard to get
   * by chance; the UI treats edges with pValue >= 0.01 as indistinguishable from random timing. Null without trades.
   * Absent in reports computed before model v4.
   */
  pValue?: number | null;
  /** Annualized by the observed trade frequency: mean / std * sqrt(trades * 252 / windowDays). */
  sharpe: number | null;
  /** Worst peak-to-trough of the daily marked-to-market equity curve (negative decimal). */
  maxDrawdown: number | null;
  bearishSignals: number;
  /** Fraction of bearish-signal sessions followed by a negative forward return. */
  bearishHitRate: number | null;
  bearishAvgForwardReturn: number | null;
  /** trades < 20: the statistics are not meaningful and the UI greys them out. */
  lowSample: boolean;
}

/** A price range: the last close moved down and up by the same number of standard deviations of the log return. */
export interface PriceRange {
  low: number;
  high: number;
}

/**
 * Forward-looking risk of one symbol (lib/risk-forecast.ts). Unlike the directional score, these numbers have measured
 * calibration: lib/risk-calibration.json holds how often past moves stayed inside the ranges and how often each
 * volatility quintile fell 10% or more within a month. Volatilities are annualized decimals (0.32 = 32%).
 */
export interface SignalRisk {
  /** Forecast of volatility: an equal blend of the 20- and 252-session variance of daily log returns, annualized. */
  forecastVolatility: number | null;
  /** Sessions the ranges cover. */
  horizonDays: number;
  /** Last completed close the ranges are centred on. Prices here keep six significant digits and at least two decimals. */
  price: number | null;
  /** Range over horizonDays at plus/minus one forecast standard deviation (about 68% for normal returns). */
  range1: PriceRange | null;
  /** Range at plus/minus two forecast standard deviations (about 95% for normal returns; real tails are fatter). */
  range2: PriceRange | null;
  /** Percentile (0..100) of the current 20-session volatility among its daily values over the last 252 sessions. */
  ownPercentile: number | null;
  /** Beta of daily returns to SPY over the last 252 sessions, on matching sessions. */
  beta: number | null;
  /** Annualized volatility of the last 63 daily returns (lib/factors.ts), the measure the universe quintiles use. */
  volatility63: number | null;
}

export interface SignalReport {
  symbol: string;
  asOf: string;
  status: "ok" | "insufficient_data";
  /** Human-readable reason when status is insufficient_data. */
  reason?: string;
  code: SignalCode | null;
  /** 0..100 composite. */
  score: number | null;
  /** 0..100 technical-only composite at the last bar: the score the backtest and the universe evaluation measure. */
  technicalScore: number | null;
  /** 0..100 weighted agreement among informative (non-imputed, non-neutral) factors. */
  consensus: number | null;
  /** 0..100 share of factor inputs that were actually available. */
  coverage: number | null;
  confidence: ConfidenceLevel | null;
  factors: FactorResult[];
  backtest: {
    /** The backtest uses technical factors only, because historical fundamentals are not available. */
    technicalOnly: true;
    /** Round-trip cost assumption in basis points. */
    costBps: number;
    results: BacktestResult[];
  } | null;
  /** Risk forecast; null when the history is too short for a report. Absent in reports computed before model v4. */
  risk?: SignalRisk | null;
  meta: {
    bars: number;
    /** True when today's still-forming daily bar was excluded during market hours. */
    droppedPartialBar: boolean;
    lastBarDate: string | null;
  };
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

/** A position the investor entered (stored only in their browser), sent with the watchlist analysis. */
export interface PositionInput {
  symbol: string;
  shares: number;
  /** Average cost per share. */
  cost: number;
}

export type AnalyzeRequest =
  | { kind: "market"; lang: Lang }
  | { kind: "stock"; symbol: string; lang: Lang }
  | { kind: "sector"; sector: SectorKey; lang: Lang }
  /** Optional positions (max 50) let the analysis weigh concentration and risk by position value. */
  | { kind: "watchlist"; symbols: string[]; lang: Lang; positions?: PositionInput[] }
  /** `link` and `title` are only used if the server no longer has the news item cached; the link is checked against an allowlist. */
  | { kind: "news"; newsId: string; lang: Lang; link?: string; title?: string };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  /** The server keeps only the last 10 messages and caps their length. */
  messages: ChatMessage[];
  lang: Lang;
  context: {
    view: "market" | "stock" | "sector" | "watchlist";
    symbol?: string;
    sector?: SectorKey;
    /** The user's watchlist (it lives in the browser), sent when view is "watchlist"; max 50 symbols. */
    symbols?: string[];
  };
}

/**
 * If an AI stream fails after it has started, the server appends this marker followed by an error code
 * (e.g. "[[AI_STREAM_ERROR]]upstream_error") and closes the stream. The client strips it and shows an error.
 */
export const AI_STREAM_ERROR = "[[AI_STREAM_ERROR]]";

/**
 * Appended as the very last chunk when the model stopped at the token limit, so the client can say that the answer
 * may end mid-sentence. The text before it is kept.
 */
export const AI_STREAM_TRUNCATED = "[[AI_STREAM_TRUNCATED]]";

export interface AuthStatus {
  /** DEEPSEEK_API_KEY is set on the server. */
  aiConfigured: boolean;
  /** A password is required before the AI endpoints can be used. */
  authRequired: boolean;
  /** The current request carries a valid session (always true when no password is required). */
  authenticated: boolean;
  /** aiConfigured && (authenticated or no password required) && AI not disabled for this deployment. */
  aiAvailable: boolean;
}

export interface HealthResponse {
  ok: true;
  time: string;
  aiConfigured: boolean;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | "bad_request"
  | "not_found"
  | "upstream_error"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "payload_too_large"
  | "ai_unavailable"
  | "internal_error";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}
