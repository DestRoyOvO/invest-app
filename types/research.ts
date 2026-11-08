// Contract for the quote page research tabs (financials, dividends, ownership), served by lib/server/research.ts
// through /api/stock/[symbol]/financials, /dividends and /ownership. Conventions follow types/api.ts: raw numbers,
// null when missing, ratios as decimals, dates as ISO strings (YYYY-MM-DD for period ends and ex-dates).

// ---------------------------------------------------------------------------
// Financials (Yahoo fundamentalsTimeSeries)
// ---------------------------------------------------------------------------

export interface FinancialPeriod {
  /** Fiscal period end date, YYYY-MM-DD. */
  end: string;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  /** Margins over revenue (decimals); null when either side is missing (banks have no gross profit). */
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  dilutedEps: number | null;
  ebitda: number | null;
  operatingCashFlow: number | null;
  /** Capital expenditure as reported: negative for cash spent. */
  capitalExpenditure: number | null;
  /** Operating cash flow minus capital spending; null when either is missing. */
  freeCashFlow: number | null;
  /** Share repurchases as reported: negative for cash spent. */
  buybacks: number | null;
  /** Dividends paid as reported: negative for cash paid out. */
  dividendsPaid: number | null;
}

export interface FinancialStatements {
  symbol: string;
  asOf: string;
  /** Currency of the statements, which can differ from the trading currency (0700.HK: CNY figures, HKD price). */
  currency: string | null;
  /** Up to four fiscal years, oldest first. Yahoo's partial "stub" periods are dropped. */
  annual: FinancialPeriod[];
  /** Up to five quarters, oldest first. */
  quarterly: FinancialPeriod[];
}

// ---------------------------------------------------------------------------
// Dividends (chart dividend events and the quote)
// ---------------------------------------------------------------------------

export interface DividendPayment {
  /** Ex-dividend date, YYYY-MM-DD in the exchange's time zone. */
  exDate: string;
  /** Cash per share, adjusted for later splits. */
  amount: number;
}

export interface DividendYear {
  year: number;
  total: number;
  payments: number;
  /** The current calendar year, still in progress. */
  partial: boolean;
}

export type DividendFrequency = "monthly" | "quarterly" | "semiannual" | "annual" | "irregular";

export interface DividendHistory {
  symbol: string;
  asOf: string;
  /** Currency of the payments (the trading currency). */
  currency: string | null;
  /** Payments over the last ten years, oldest first. Empty when the stock pays none. */
  payments: DividendPayment[];
  /** Calendar-year totals, oldest first. */
  years: DividendYear[];
  /** Sum of the payments with an ex-date in the last 365 days. */
  trailingAnnual: number | null;
  /** Compound annual growth of the yearly total over the last five full years (decimal). */
  growth5y: number | null;
  frequency: DividendFrequency | null;
  /** Forward annual dividend per share as Yahoo reports it. */
  forwardAnnual: number | null;
  /** Forward annual dividend over the price, or the trailing one when no forward rate is known (decimal). */
  yield: number | null;
  /** How `yield` was found: the forward rate or the last 12 months over the price, or Yahoo's reported figure. */
  yieldBasis: "forward" | "trailing" | "reported" | null;
  /** The announced next ex-date and amount, when Yahoo lists one. */
  next: { exDate: string; amount: number | null } | null;
  /** Next payment date, when Yahoo's payment date is in the future. */
  nextPayDate: string | null;
}

// ---------------------------------------------------------------------------
// Ownership (quoteSummary insiderTransactions, netSharePurchaseActivity, majorHoldersBreakdown, institutionOwnership)
// ---------------------------------------------------------------------------

export type InsiderTradeKind = "buy" | "sale" | "award" | "gift" | "option" | "other";

export interface InsiderTrade {
  /** Transaction date, YYYY-MM-DD. */
  date: string | null;
  name: string;
  /** Officer, Director, General Counsel ... */
  relation: string | null;
  kind: InsiderTradeKind;
  shares: number | null;
  value: number | null;
  /** Price per share parsed from Yahoo's text ("Sale at price 222.19 - 223.75 per share."); a range uses value / shares. */
  price: number | null;
  /** D = direct, I = indirect (through a trust or family member). */
  ownership: "D" | "I" | null;
}

/** Yahoo's insider purchase and sale summary. Its "purchases" also count awards and option exercises. */
export interface InsiderSummary {
  /** Period covered, e.g. "6m". */
  period: string | null;
  buyCount: number | null;
  buyShares: number | null;
  sellCount: number | null;
  sellShares: number | null;
  /** buyShares - sellShares. */
  netShares: number | null;
  /** Net shares over the insiders' total holdings (decimal). */
  netPercent: number | null;
  totalInsiderShares: number | null;
}

export interface HolderBreakdown {
  /** Share of shares outstanding held by insiders (decimal). */
  insiders: number | null;
  institutions: number | null;
  /** Institutional holdings over the float (decimal). */
  institutionsFloat: number | null;
  institutionsCount: number | null;
}

export interface InstitutionHolder {
  name: string;
  /** Date of the filing the position comes from, YYYY-MM-DD. Filings lag by up to a quarter. */
  reportDate: string | null;
  /** Share of shares outstanding (decimal). */
  pctHeld: number | null;
  shares: number | null;
  value: number | null;
  /** Change in the position since the previous filing (decimal). */
  pctChange: number | null;
}

export interface OwnershipData {
  symbol: string;
  asOf: string;
  breakdown: HolderBreakdown | null;
  insiderSummary: InsiderSummary | null;
  /** Latest insider transactions, newest first (at most 20). */
  insiderTrades: InsiderTrade[];
  /** Largest institutional holders (at most 10), largest share first. */
  institutions: InstitutionHolder[];
}
