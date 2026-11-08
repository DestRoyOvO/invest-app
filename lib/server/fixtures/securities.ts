import "server-only";

import type { SectorKey } from "@/types/api";

import { between, pick } from "./random";
import { parseDayKey, PROFILES, type MarketProfile, type ProfileKey } from "./sessions";

// The securities the fixture data knows. Tickers, names, sectors and rough sizes are facts, so a table covers the
// app's universe (lib/universe.ts, lib/names-zh.ts, the sector and broad ETFs and the world board); everything else is
// derived from the symbol: every well-formed symbol is known, with a stable synthetic name, except the reserved
// not-found prefix "ZZ", which behaves like a symbol Yahoo has never heard of. Sizes and price levels are approximate
// values for the anchor date (2026-01-02), not live data.

export type QuoteType = "EQUITY" | "ETF" | "INDEX" | "FUTURE" | "CURRENCY" | "CRYPTOCURRENCY" | "MUTUALFUND";

/** walk: geometric random walk; vix: mean-reverting volatility index; rate: a point on the Treasury curve. */
export type PriceModelKind = "walk" | "vix" | "rate";

/** Symbols starting with this prefix are unknown to the fixture data, like an unlisted symbol is to Yahoo. */
export const NOT_FOUND_PREFIX = "ZZ";

/**
 * Symbols reserved for AI scenarios of the end-to-end suite (e2e/mock-llm.mjs reads them in the prompt): a note on
 * E2ELEN ends at the token limit, on E2EERR fails mid-stream, on E2ESLOW streams slowly, and on E2EKEY is answered as
 * if the API key were rejected. Their market data is ordinary.
 */
export const RESERVED_SCENARIO_SYMBOLS = ["E2ELEN", "E2EERR", "E2ESLOW", "E2EKEY"] as const;

export interface FundInfo {
  category: string;
  family: string;
  /** Annual report expense ratio as a fraction (0.0009 is 0.09%). */
  expenseRatio: number;
  /** What the fund holds: a universe sector, the broad market, or a theme. */
  focus: SectorKey | "broad" | "growth" | "smallcap" | "gold" | "bonds" | "china";
}

export interface Security {
  symbol: string;
  name: string;
  shortName: string;
  type: QuoteType;
  profile: MarketProfile;
  exchange: string;
  fullExchangeName: string;
  market: string;
  currency: string;
  /** Yahoo's sector and industry names (stocks only). */
  sector: string | null;
  industry: string | null;
  /** Universe sector whose daily factor moves this security (stocks and sector funds). */
  sectorKey: SectorKey | null;
  country: string | null;
  model: PriceModelKind;
  /** Price at the anchor date; the mean level for "vix"; unused for "rate". */
  anchorPrice: number;
  /** Annualized volatility and drift of daily log returns. */
  vol: number;
  drift: number;
  /** Loadings on the shared market and sector factors (the rest is the security's own noise). */
  marketLoading: number;
  sectorLoading: number;
  /** Seed of the security's own noise: funds that track an index share the index's, so they move together. */
  seedKey: string;
  /** Maturity in years for "rate" symbols (Treasury yields). */
  tenorYears: number | null;
  /** Market cap (stocks), net assets (funds) or market value (crypto) at the anchor price; null otherwise. */
  sizeAtAnchor: number | null;
  /** Dividend yield at the anchor price, as a fraction. */
  dividendYield: number;
  /** Trailing P/E at the anchor price; null for companies without earnings and for non-stocks. */
  trailingPE: number | null;
  /** Typical daily volume. */
  baseVolume: number;
  fund: FundInfo | null;
  /** The name was generated from the symbol. */
  synthetic: boolean;
}

export const YAHOO_SECTORS: Readonly<Record<SectorKey, string>> = {
  technology: "Technology",
  communication: "Communication Services",
  "consumer-discretionary": "Consumer Cyclical",
  "consumer-staples": "Consumer Defensive",
  healthcare: "Healthcare",
  financials: "Financial Services",
  industrials: "Industrials",
  energy: "Energy",
  materials: "Basic Materials",
  utilities: "Utilities",
  "real-estate": "Real Estate",
};

const SECTOR_KEYS = Object.keys(YAHOO_SECTORS) as SectorKey[];

interface Venue {
  exchange: string;
  fullExchangeName: string;
  market: string;
  currency: string;
  profile: ProfileKey;
  country: string;
}

const VENUES = {
  NMS: { exchange: "NMS", fullExchangeName: "NasdaqGS", market: "us_market", currency: "USD", profile: "us", country: "United States" },
  NGM: { exchange: "NGM", fullExchangeName: "NasdaqGM", market: "us_market", currency: "USD", profile: "us", country: "United States" },
  NYQ: { exchange: "NYQ", fullExchangeName: "NYSE", market: "us_market", currency: "USD", profile: "us", country: "United States" },
  PCX: { exchange: "PCX", fullExchangeName: "NYSEArca", market: "us_market", currency: "USD", profile: "us", country: "United States" },
  BTS: { exchange: "BTS", fullExchangeName: "Cboe US", market: "us_market", currency: "USD", profile: "us", country: "United States" },
  NAS: { exchange: "NAS", fullExchangeName: "Nasdaq", market: "us_market", currency: "USD", profile: "us", country: "United States" },
  HKG: { exchange: "HKG", fullExchangeName: "HKSE", market: "hk_market", currency: "HKD", profile: "hongkong", country: "Hong Kong" },
  SHH: { exchange: "SHH", fullExchangeName: "Shanghai", market: "cn_market", currency: "CNY", profile: "shanghai", country: "China" },
  SHZ: { exchange: "SHZ", fullExchangeName: "Shenzhen", market: "cn_market", currency: "CNY", profile: "shanghai", country: "China" },
  JPX: { exchange: "JPX", fullExchangeName: "Tokyo", market: "jp_market", currency: "JPY", profile: "tokyo", country: "Japan" },
  LSE: { exchange: "LSE", fullExchangeName: "LSE", market: "gb_market", currency: "GBp", profile: "london", country: "United Kingdom" },
  GER: { exchange: "GER", fullExchangeName: "XETRA", market: "de_market", currency: "EUR", profile: "frankfurt", country: "Germany" },
  PAR: { exchange: "PAR", fullExchangeName: "Paris", market: "fr_market", currency: "EUR", profile: "paris", country: "France" },
  TOR: { exchange: "TOR", fullExchangeName: "Toronto", market: "ca_market", currency: "CAD", profile: "toronto", country: "Canada" },
  KSC: { exchange: "KSC", fullExchangeName: "KSE", market: "kr_market", currency: "KRW", profile: "seoul", country: "South Korea" },
  TAI: { exchange: "TAI", fullExchangeName: "Taiwan", market: "tw_market", currency: "TWD", profile: "taipei", country: "Taiwan" },
  ASX: { exchange: "ASX", fullExchangeName: "ASX", market: "au_market", currency: "AUD", profile: "sydney", country: "Australia" },
  NSI: { exchange: "NSI", fullExchangeName: "NSE", market: "in_market", currency: "INR", profile: "mumbai", country: "India" },
} as const satisfies Record<string, Venue>;

type VenueCode = keyof typeof VENUES;

/** Listing suffixes Yahoo uses outside the US. */
const SUFFIX_VENUES: Readonly<Record<string, VenueCode>> = {
  HK: "HKG",
  SS: "SHH",
  SZ: "SHZ",
  T: "JPX",
  L: "LSE",
  DE: "GER",
  F: "GER",
  PA: "PAR",
  TO: "TOR",
  KS: "KSC",
  TW: "TAI",
  AX: "ASX",
  NS: "NSI",
  BO: "NSI",
};

// ---------------------------------------------------------------------------
// Table: stocks
// ---------------------------------------------------------------------------

/** symbol, name, sector, industry, market cap ($B, local currency outside the US), price, dividend yield %, P/E, volatility, venue, country */
type StockRow = readonly [string, string, SectorKey, string, number, number, number, number | null, number, VenueCode, string?];

const STOCKS: readonly StockRow[] = [
  // Universe: technology
  ["NVDA", "NVIDIA Corporation", "technology", "Semiconductors", 4500, 185, 0.02, 50, 0.45, "NMS"],
  ["MSFT", "Microsoft Corporation", "technology", "Software - Infrastructure", 3700, 495, 0.7, 36, 0.24, "NMS"],
  ["AAPL", "Apple Inc.", "technology", "Consumer Electronics", 4000, 270, 0.4, 36, 0.26, "NMS"],
  ["AVGO", "Broadcom Inc.", "technology", "Semiconductors", 1600, 340, 0.7, 80, 0.42, "NMS"],
  ["ORCL", "Oracle Corporation", "technology", "Software - Infrastructure", 600, 210, 0.9, 45, 0.4, "NYQ"],
  ["AMD", "Advanced Micro Devices, Inc.", "technology", "Semiconductors", 350, 215, 0, 110, 0.5, "NMS"],
  ["CRM", "Salesforce, Inc.", "technology", "Software - Application", 240, 250, 0.7, 38, 0.32, "NYQ"],
  ["ADBE", "Adobe Inc.", "technology", "Software - Application", 150, 350, 0, 22, 0.32, "NMS"],
  ["CSCO", "Cisco Systems, Inc.", "technology", "Communication Equipment", 290, 74, 2.2, 28, 0.22, "NMS"],
  ["QCOM", "QUALCOMM Incorporated", "technology", "Semiconductors", 185, 170, 2.1, 17, 0.32, "NMS"],
  // Universe: communication services
  ["GOOGL", "Alphabet Inc.", "communication", "Internet Content & Information", 3800, 315, 0.3, 30, 0.3, "NMS"],
  ["META", "Meta Platforms, Inc.", "communication", "Internet Content & Information", 1650, 650, 0.3, 28, 0.36, "NMS"],
  ["NFLX", "Netflix, Inc.", "communication", "Entertainment", 400, 94, 0, 40, 0.34, "NMS"],
  ["DIS", "The Walt Disney Company", "communication", "Entertainment", 200, 112, 0.9, 17, 0.26, "NYQ"],
  ["TMUS", "T-Mobile US, Inc.", "communication", "Telecom Services", 230, 205, 1.8, 20, 0.22, "NMS"],
  ["VZ", "Verizon Communications Inc.", "communication", "Telecom Services", 170, 40, 6.8, 9, 0.18, "NYQ"],
  ["T", "AT&T Inc.", "communication", "Telecom Services", 175, 25, 4.5, 8, 0.2, "NYQ"],
  ["CMCSA", "Comcast Corporation", "communication", "Telecom Services", 110, 29, 4.5, 5, 0.26, "NMS"],
  // Universe: consumer discretionary
  ["AMZN", "Amazon.com, Inc.", "consumer-discretionary", "Internet Retail", 2450, 230, 0, 33, 0.3, "NMS"],
  ["TSLA", "Tesla, Inc.", "consumer-discretionary", "Auto Manufacturers", 1450, 450, 0, 200, 0.58, "NMS"],
  ["HD", "The Home Depot, Inc.", "consumer-discretionary", "Home Improvement Retail", 345, 345, 2.7, 24, 0.22, "NYQ"],
  ["MCD", "McDonald's Corporation", "consumer-discretionary", "Restaurants", 220, 305, 2.4, 26, 0.17, "NYQ"],
  ["BKNG", "Booking Holdings Inc.", "consumer-discretionary", "Travel Services", 175, 5400, 0.7, 35, 0.28, "NMS"],
  ["LOW", "Lowe's Companies, Inc.", "consumer-discretionary", "Home Improvement Retail", 135, 240, 2, 20, 0.24, "NYQ"],
  ["TJX", "The TJX Companies, Inc.", "consumer-discretionary", "Apparel Retail", 170, 152, 1.1, 34, 0.2, "NYQ"],
  ["NKE", "NIKE, Inc.", "consumer-discretionary", "Footwear & Accessories", 95, 64, 2.5, 30, 0.34, "NYQ"],
  ["SBUX", "Starbucks Corporation", "consumer-discretionary", "Restaurants", 97, 85, 2.9, 50, 0.3, "NMS"],
  // Universe: consumer staples
  ["WMT", "Walmart Inc.", "consumer-staples", "Discount Stores", 880, 110, 0.9, 38, 0.2, "NMS"],
  ["COST", "Costco Wholesale Corporation", "consumer-staples", "Discount Stores", 390, 880, 0.6, 48, 0.2, "NMS"],
  ["PG", "The Procter & Gamble Company", "consumer-staples", "Household & Personal Products", 340, 145, 2.9, 21, 0.16, "NYQ"],
  ["KO", "The Coca-Cola Company", "consumer-staples", "Beverages - Non-Alcoholic", 300, 70, 3, 23, 0.15, "NYQ"],
  ["PEP", "PepsiCo, Inc.", "consumer-staples", "Beverages - Non-Alcoholic", 200, 146, 3.9, 27, 0.18, "NMS"],
  ["PM", "Philip Morris International Inc.", "consumer-staples", "Tobacco", 250, 160, 3.6, 23, 0.24, "NYQ"],
  ["MDLZ", "Mondelez International, Inc.", "consumer-staples", "Confectioners", 72, 56, 3.6, 21, 0.2, "NMS"],
  // Universe: health care
  ["LLY", "Eli Lilly and Company", "healthcare", "Drug Manufacturers - General", 950, 1060, 0.6, 52, 0.32, "NYQ"],
  ["UNH", "UnitedHealth Group Incorporated", "healthcare", "Healthcare Plans", 300, 330, 2.7, 17, 0.32, "NYQ"],
  ["JNJ", "Johnson & Johnson", "healthcare", "Drug Manufacturers - General", 500, 207, 2.5, 20, 0.16, "NYQ"],
  ["ABBV", "AbbVie Inc.", "healthcare", "Drug Manufacturers - General", 400, 228, 3, 100, 0.22, "NYQ"],
  ["MRK", "Merck & Co., Inc.", "healthcare", "Drug Manufacturers - General", 260, 104, 3.1, 13, 0.24, "NYQ"],
  ["TMO", "Thermo Fisher Scientific Inc.", "healthcare", "Diagnostics & Research", 220, 580, 0.3, 33, 0.24, "NYQ"],
  ["ABT", "Abbott Laboratories", "healthcare", "Medical Devices", 220, 126, 1.9, 16, 0.2, "NYQ"],
  ["AMGN", "Amgen Inc.", "healthcare", "Drug Manufacturers - General", 175, 325, 3, 26, 0.24, "NMS"],
  ["PFE", "Pfizer Inc.", "healthcare", "Drug Manufacturers - General", 145, 25, 6.8, 14, 0.22, "NYQ"],
  // Universe: financials
  ["BRK-B", "Berkshire Hathaway Inc.", "financials", "Insurance - Diversified", 1080, 500, 0, 16, 0.16, "NYQ"],
  ["JPM", "JPMorgan Chase & Co.", "financials", "Banks - Diversified", 880, 320, 1.9, 16, 0.24, "NYQ"],
  ["V", "Visa Inc.", "financials", "Credit Services", 680, 350, 0.7, 34, 0.2, "NYQ"],
  ["MA", "Mastercard Incorporated", "financials", "Credit Services", 520, 570, 0.6, 37, 0.21, "NYQ"],
  ["BAC", "Bank of America Corporation", "financials", "Banks - Diversified", 400, 55, 2, 14, 0.27, "NYQ"],
  ["WFC", "Wells Fargo & Company", "financials", "Banks - Diversified", 290, 93, 1.9, 15, 0.28, "NYQ"],
  ["GS", "The Goldman Sachs Group, Inc.", "financials", "Capital Markets", 270, 880, 1.8, 17, 0.3, "NYQ"],
  ["MS", "Morgan Stanley", "financials", "Capital Markets", 280, 177, 2.3, 18, 0.3, "NYQ"],
  ["BLK", "BlackRock, Inc.", "financials", "Asset Management", 165, 1070, 2, 27, 0.26, "NYQ"],
  // Universe: industrials
  ["GE", "GE Aerospace", "industrials", "Aerospace & Defense", 330, 310, 0.5, 40, 0.3, "NYQ"],
  ["CAT", "Caterpillar Inc.", "industrials", "Farm & Heavy Construction Machinery", 270, 575, 1.1, 29, 0.3, "NYQ"],
  ["RTX", "RTX Corporation", "industrials", "Aerospace & Defense", 245, 183, 1.5, 37, 0.22, "NYQ"],
  ["UNP", "Union Pacific Corporation", "industrials", "Railroads", 140, 231, 2.4, 20, 0.22, "NYQ"],
  ["HON", "Honeywell International Inc.", "industrials", "Conglomerates", 125, 195, 2.4, 21, 0.22, "NMS"],
  ["BA", "The Boeing Company", "industrials", "Aerospace & Defense", 165, 217, 0, null, 0.36, "NYQ"],
  ["DE", "Deere & Company", "industrials", "Farm & Heavy Construction Machinery", 126, 466, 1.4, 25, 0.26, "NYQ"],
  ["LMT", "Lockheed Martin Corporation", "industrials", "Aerospace & Defense", 112, 483, 2.8, 27, 0.22, "NYQ"],
  // Universe: energy
  ["XOM", "Exxon Mobil Corporation", "energy", "Oil & Gas Integrated", 500, 120, 3.4, 17, 0.24, "NYQ"],
  ["CVX", "Chevron Corporation", "energy", "Oil & Gas Integrated", 300, 152, 4.5, 21, 0.24, "NYQ"],
  ["COP", "ConocoPhillips", "energy", "Oil & Gas E&P", 115, 92, 3.5, 13, 0.3, "NYQ"],
  ["SLB", "SLB N.V.", "energy", "Oil & Gas Equipment & Services", 57, 38, 3, 15, 0.34, "NYQ"],
  ["EOG", "EOG Resources, Inc.", "energy", "Oil & Gas E&P", 58, 105, 3.9, 10, 0.3, "NYQ"],
  // Universe: materials
  ["LIN", "Linde plc", "materials", "Specialty Chemicals", 200, 425, 1.4, 30, 0.2, "NMS"],
  ["SHW", "The Sherwin-Williams Company", "materials", "Specialty Chemicals", 83, 330, 0.9, 32, 0.26, "NYQ"],
  ["APD", "Air Products and Chemicals, Inc.", "materials", "Specialty Chemicals", 55, 247, 2.9, 35, 0.26, "NYQ"],
  ["FCX", "Freeport-McMoRan Inc.", "materials", "Copper", 70, 48, 1.3, 33, 0.42, "NYQ"],
  ["NEM", "Newmont Corporation", "materials", "Gold", 110, 100, 1, 15, 0.4, "NYQ"],
  // Universe: utilities
  ["NEE", "NextEra Energy, Inc.", "utilities", "Utilities - Regulated Electric", 165, 80, 2.8, 26, 0.24, "NYQ"],
  ["SO", "The Southern Company", "utilities", "Utilities - Regulated Electric", 95, 87, 3.4, 21, 0.18, "NYQ"],
  ["DUK", "Duke Energy Corporation", "utilities", "Utilities - Regulated Electric", 92, 118, 3.6, 19, 0.17, "NYQ"],
  ["CEG", "Constellation Energy Corporation", "utilities", "Utilities - Renewable", 110, 355, 0.4, 37, 0.5, "NMS"],
  // Universe: real estate
  ["PLD", "Prologis, Inc.", "real-estate", "REIT - Industrial", 120, 128, 3.2, 37, 0.24, "NYQ"],
  ["AMT", "American Tower Corporation", "real-estate", "REIT - Specialty", 82, 176, 3.9, 30, 0.24, "NYQ"],
  ["EQIX", "Equinix, Inc.", "real-estate", "REIT - Specialty", 75, 765, 2.4, 75, 0.26, "NMS"],
  ["SPG", "Simon Property Group, Inc.", "real-estate", "REIT - Retail", 60, 185, 4.6, 28, 0.24, "NYQ"],
  // Other widely followed US listings
  ["TSM", "Taiwan Semiconductor Manufacturing Company Limited", "technology", "Semiconductors", 1500, 290, 1.2, 27, 0.36, "NYQ", "Taiwan"],
  ["INTC", "Intel Corporation", "technology", "Semiconductors", 170, 37, 0, null, 0.5, "NMS"],
  ["MU", "Micron Technology, Inc.", "technology", "Semiconductors", 300, 270, 0.2, 25, 0.5, "NMS"],
  ["ASML", "ASML Holding N.V.", "technology", "Semiconductor Equipment & Materials", 400, 1050, 0.7, 37, 0.38, "NMS", "Netherlands"],
  ["ARM", "Arm Holdings plc", "technology", "Semiconductors", 120, 110, 0, 140, 0.6, "NMS", "United Kingdom"],
  ["PLTR", "Palantir Technologies Inc.", "technology", "Software - Infrastructure", 420, 180, 0, 400, 0.6, "NMS"],
  ["IBM", "International Business Machines Corporation", "technology", "Information Technology Services", 280, 300, 2.2, 35, 0.26, "NYQ"],
  ["UBER", "Uber Technologies, Inc.", "technology", "Software - Application", 170, 82, 0, 15, 0.38, "NYQ"],
  ["ABNB", "Airbnb, Inc.", "consumer-discretionary", "Travel Services", 82, 135, 0, 33, 0.38, "NMS"],
  ["SMCI", "Super Micro Computer, Inc.", "technology", "Computer Hardware", 18, 30, 0, 22, 0.75, "NMS"],
  ["MRVL", "Marvell Technology, Inc.", "technology", "Semiconductors", 75, 87, 0.3, null, 0.55, "NMS"],
  ["COIN", "Coinbase Global, Inc.", "financials", "Financial Data & Stock Exchanges", 62, 230, 0, 22, 0.65, "NMS"],
  ["MSTR", "Strategy Inc", "technology", "Software - Application", 45, 160, 0, null, 0.8, "NMS"],
  ["HOOD", "Robinhood Markets, Inc.", "financials", "Capital Markets", 105, 115, 0, 50, 0.7, "NMS"],
  ["SHOP", "Shopify Inc.", "technology", "Software - Application", 210, 160, 0, 110, 0.5, "NMS", "Canada"],
  ["PYPL", "PayPal Holdings, Inc.", "financials", "Credit Services", 57, 59, 0.8, 12, 0.36, "NMS"],
  // US-listed Chinese companies
  ["BABA", "Alibaba Group Holding Limited", "consumer-discretionary", "Internet Retail", 350, 150, 0.7, 20, 0.45, "NYQ", "China"],
  ["PDD", "PDD Holdings Inc.", "consumer-discretionary", "Internet Retail", 160, 113, 0, 12, 0.5, "NMS", "Ireland"],
  ["JD", "JD.com, Inc.", "consumer-discretionary", "Internet Retail", 45, 29, 3.4, 9, 0.45, "NMS", "China"],
  ["BIDU", "Baidu, Inc.", "communication", "Internet Content & Information", 42, 125, 0, 12, 0.45, "NMS", "China"],
  ["NTES", "NetEase, Inc.", "communication", "Electronic Gaming & Multimedia", 88, 138, 1.9, 18, 0.35, "NMS", "China"],
  ["TCOM", "Trip.com Group Limited", "consumer-discretionary", "Travel Services", 47, 71, 0.4, 18, 0.4, "NMS", "Singapore"],
  ["BILI", "Bilibili Inc.", "communication", "Internet Content & Information", 11, 26, 0, null, 0.55, "NMS", "China"],
  ["NIO", "NIO Inc.", "consumer-discretionary", "Auto Manufacturers", 11, 5, 0, null, 0.7, "NYQ", "China"],
  ["XPEV", "XPeng Inc.", "consumer-discretionary", "Auto Manufacturers", 18, 20, 0, null, 0.7, "NYQ", "China"],
  ["LI", "Li Auto Inc.", "consumer-discretionary", "Auto Manufacturers", 18, 18, 0, 20, 0.55, "NMS", "China"],
  ["BEKE", "KE Holdings Inc.", "real-estate", "Real Estate Services", 20, 17, 2, 30, 0.45, "NYQ", "China"],
  ["TME", "Tencent Music Entertainment Group", "communication", "Internet Content & Information", 27, 18, 0.8, 22, 0.45, "NYQ", "China"],
  ["FUTU", "Futu Holdings Limited", "financials", "Capital Markets", 23, 170, 0, 18, 0.6, "NMS", "Hong Kong"],
  ["TAL", "TAL Education Group", "consumer-staples", "Education & Training Services", 6.5, 11, 0, 50, 0.6, "NYQ", "China"],
  ["EDU", "New Oriental Education & Technology Group Inc.", "consumer-staples", "Education & Training Services", 8.5, 54, 1, 22, 0.45, "NYQ", "China"],
  ["VIPS", "Vipshop Holdings Limited", "consumer-discretionary", "Internet Retail", 9, 19, 2.5, 8, 0.4, "NYQ", "China"],
  // Hong Kong (sizes in HKD)
  ["0700.HK", "Tencent Holdings Limited", "communication", "Internet Content & Information", 5900, 620, 0.7, 24, 0.32, "HKG"],
  ["9988.HK", "Alibaba Group Holding Limited", "consumer-discretionary", "Internet Retail", 2800, 150, 0.7, 20, 0.45, "HKG"],
  ["3690.HK", "Meituan", "consumer-discretionary", "Internet Retail", 600, 100, 0, 25, 0.48, "HKG"],
  ["1810.HK", "Xiaomi Corporation", "technology", "Consumer Electronics", 1100, 42, 0, 28, 0.5, "HKG"],
  ["1211.HK", "BYD Company Limited", "consumer-discretionary", "Auto Manufacturers", 900, 98, 1.3, 20, 0.42, "HKG"],
  ["9618.HK", "JD.com, Inc.", "consumer-discretionary", "Internet Retail", 360, 115, 3.4, 9, 0.45, "HKG"],
  ["2318.HK", "Ping An Insurance (Group) Company of China, Ltd.", "financials", "Insurance - Life", 1100, 57, 4.5, 8, 0.3, "HKG"],
  ["0005.HK", "HSBC Holdings plc", "financials", "Banks - Diversified", 1900, 112, 5.5, 10, 0.22, "HKG"],
];

// ---------------------------------------------------------------------------
// Table: funds
// ---------------------------------------------------------------------------

/** symbol, name, net assets ($B), price, yield %, expense ratio %, category, family, focus, venue, tracked index */
type FundRow = readonly [string, string, number, number, number, number, string, string, FundInfo["focus"], VenueCode, string?];

const SPDR = "SPDR State Street Global Advisors";

const FUNDS: readonly FundRow[] = [
  ["SPY", "SPDR S&P 500 ETF Trust", 700, 685, 1.1, 0.0945, "Large Blend", SPDR, "broad", "PCX", "^GSPC"],
  ["QQQ", "Invesco QQQ Trust, Series 1", 400, 615, 0.5, 0.2, "Large Growth", "Invesco", "growth", "NGM", "^NDX"],
  ["DIA", "SPDR Dow Jones Industrial Average ETF Trust", 40, 481, 1.5, 0.16, "Large Value", SPDR, "broad", "PCX", "^DJI"],
  ["IWM", "iShares Russell 2000 ETF", 70, 248, 1, 0.19, "Small Blend", "iShares", "smallcap", "PCX", "^RUT"],
  ["RSP", "Invesco S&P 500 Equal Weight ETF", 75, 190, 1.6, 0.2, "Large Blend", "Invesco", "broad", "PCX"],
  ["XLK", "Technology Select Sector SPDR Fund", 90, 290, 0.6, 0.08, "Technology", SPDR, "technology", "PCX"],
  ["XLC", "Communication Services Select Sector SPDR Fund", 25, 118, 0.9, 0.08, "Communications", SPDR, "communication", "PCX"],
  ["XLY", "Consumer Discretionary Select Sector SPDR Fund", 23, 240, 0.8, 0.08, "Consumer Cyclical", SPDR, "consumer-discretionary", "PCX"],
  ["XLP", "Consumer Staples Select Sector SPDR Fund", 16, 79, 2.7, 0.08, "Consumer Defensive", SPDR, "consumer-staples", "PCX"],
  ["XLV", "Health Care Select Sector SPDR Fund", 37, 155, 1.6, 0.08, "Health", SPDR, "healthcare", "PCX"],
  ["XLF", "Financial Select Sector SPDR Fund", 54, 55, 1.4, 0.08, "Financial", SPDR, "financials", "PCX"],
  ["XLI", "Industrial Select Sector SPDR Fund", 23, 155, 1.2, 0.08, "Industrials", SPDR, "industrials", "PCX"],
  ["XLE", "Energy Select Sector SPDR Fund", 27, 90, 3.3, 0.08, "Equity Energy", SPDR, "energy", "PCX"],
  ["XLB", "Materials Select Sector SPDR Fund", 5, 89, 1.9, 0.08, "Natural Resources", SPDR, "materials", "PCX"],
  ["XLU", "Utilities Select Sector SPDR Fund", 21, 84, 2.8, 0.08, "Utilities", SPDR, "utilities", "PCX"],
  ["XLRE", "Real Estate Select Sector SPDR Fund", 8, 41, 3.3, 0.08, "Real Estate", SPDR, "real-estate", "PCX"],
  ["SMH", "VanEck Semiconductor ETF", 35, 360, 0.4, 0.35, "Technology", "VanEck", "technology", "NMS"],
  ["IGV", "iShares Expanded Tech-Software Sector ETF", 9, 110, 0, 0.39, "Technology", "iShares", "technology", "BTS"],
  ["VOX", "Vanguard Communication Services ETF", 6, 185, 0.9, 0.09, "Communications", "Vanguard", "communication", "PCX"],
  ["VCR", "Vanguard Consumer Discretionary ETF", 7, 390, 0.8, 0.09, "Consumer Cyclical", "Vanguard", "consumer-discretionary", "PCX"],
  ["VDC", "Vanguard Consumer Staples ETF", 8, 215, 2.2, 0.09, "Consumer Defensive", "Vanguard", "consumer-staples", "PCX"],
  ["IBB", "iShares Biotechnology ETF", 7, 165, 0.3, 0.44, "Health", "iShares", "healthcare", "NMS"],
  ["KBE", "SPDR S&P Bank ETF", 2, 60, 2.4, 0.35, "Financial", SPDR, "financials", "PCX"],
  ["ITA", "iShares U.S. Aerospace & Defense ETF", 9, 215, 0.6, 0.38, "Industrials", "iShares", "industrials", "BTS"],
  ["XOP", "SPDR S&P Oil & Gas Exploration & Production ETF", 2, 125, 2.5, 0.35, "Equity Energy", SPDR, "energy", "PCX"],
  ["GDX", "VanEck Gold Miners ETF", 25, 80, 0.6, 0.51, "Equity Precious Metals", "VanEck", "materials", "PCX"],
  ["VNQ", "Vanguard Real Estate Index Fund ETF Shares", 34, 90, 4, 0.13, "Real Estate", "Vanguard", "real-estate", "PCX"],
  ["KWEB", "KraneShares CSI China Internet ETF", 7, 36, 2, 0.69, "China Region", "Krane Funds", "china", "PCX"],
  ["FXI", "iShares China Large-Cap ETF", 6, 39, 2.2, 0.74, "China Region", "iShares", "china", "PCX"],
  ["GLD", "SPDR Gold Shares", 130, 395, 0, 0.4, "Commodities Focused", SPDR, "gold", "PCX", "GC=F"],
  ["TLT", "iShares 20+ Year Treasury Bond ETF", 50, 88, 4.4, 0.15, "Long Government", "iShares", "bonds", "NMS"],
];

// ---------------------------------------------------------------------------
// Table: indices, rates, currencies, futures and crypto
// ---------------------------------------------------------------------------

interface MarketRow {
  symbol: string;
  name: string;
  shortName?: string;
  type: QuoteType;
  level: number;
  vol: number;
  drift?: number;
  marketLoading?: number;
  sectorKey?: SectorKey;
  sectorLoading?: number;
  model?: PriceModelKind;
  tenorYears?: number;
  exchange: string;
  fullExchangeName: string;
  market: string;
  currency: string;
  profile: ProfileKey;
  volume: number;
  /** Market value at the anchor price (crypto). */
  size?: number;
}

function us(symbol: string, name: string, level: number, vol: number, exchange: string, fullExchangeName: string, volume: number, extra: Partial<MarketRow> = {}): MarketRow {
  return { symbol, name, type: "INDEX", level, vol, exchange, fullExchangeName, market: "us_market", currency: "USD", profile: "us", volume, marketLoading: 0.97, ...extra };
}

function world(symbol: string, name: string, level: number, vol: number, profile: ProfileKey, exchange: string, fullExchangeName: string, market: string, currency: string): MarketRow {
  return { symbol, name, type: "INDEX", level, vol, exchange, fullExchangeName, market, currency, profile, volume: 0, marketLoading: 0.35 };
}

function fx(symbol: string, name: string, level: number, vol: number, currency: string): MarketRow {
  return { symbol, name, shortName: name, type: "CURRENCY", level, vol, drift: 0, marketLoading: 0, exchange: "CCY", fullExchangeName: "CCY", market: "ccy_market", currency, profile: "fx", volume: 0 };
}

function future(symbol: string, name: string, level: number, vol: number, exchange: string, fullExchangeName: string, volume: number, marketLoading = 0.1): MarketRow {
  return { symbol, name, type: "FUTURE", level, vol, drift: 0.02, marketLoading, exchange, fullExchangeName, market: "us24_market", currency: "USD", profile: "futures", volume };
}

const MARKETS: readonly MarketRow[] = [
  us("^GSPC", "S&P 500", 6850, 0.16, "SNP", "SNP", 5_000_000_000),
  us("^NDX", "NASDAQ 100", 25300, 0.21, "NIM", "Nasdaq GIDS", 0, { marketLoading: 0.85, sectorKey: "technology", sectorLoading: 0.45 }),
  us("^IXIC", "NASDAQ Composite", 23300, 0.2, "NIM", "Nasdaq GIDS", 9_000_000_000, { marketLoading: 0.88, sectorKey: "technology", sectorLoading: 0.4 }),
  us("^DJI", "Dow Jones Industrial Average", 48100, 0.15, "DJI", "DJI", 550_000_000, { marketLoading: 0.95 }),
  us("^RUT", "Russell 2000", 2500, 0.22, "WCB", "Chicago Options", 0, { marketLoading: 0.85 }),
  us("^VIX", "CBOE Volatility Index", 17, 1.1, "WCB", "Chicago Options", 0, { model: "vix", marketLoading: -0.7, drift: 0 }),
  us("^IRX", "13 WEEK TREASURY BILL", 0, 0, "WCB", "Chicago Options", 0, { model: "rate", tenorYears: 0.25 }),
  us("^FVX", "Treasury Yield 5 Years", 0, 0, "WCB", "Chicago Options", 0, { model: "rate", tenorYears: 5 }),
  us("^TNX", "CBOE Interest Rate 10 Year T No", 0, 0, "WCB", "Chicago Options", 0, { model: "rate", tenorYears: 10 }),
  us("^TYX", "Treasury Yield 30 Years", 0, 0, "WCB", "Chicago Options", 0, { model: "rate", tenorYears: 30 }),
  us("DX-Y.NYB", "US Dollar Index", 98.5, 0.07, "NYB", "ICE Futures", 0, { marketLoading: -0.1, drift: 0 }),
  world("^GSPTSE", "S&P/TSX Composite index", 31500, 0.13, "toronto", "TOR", "Toronto", "ca_market", "CAD"),
  world("^STOXX50E", "EURO STOXX 50", 5800, 0.16, "zurich", "STU", "Stuttgart", "eu_market", "EUR"),
  world("^FTSE", "FTSE 100", 9900, 0.13, "london", "FGI", "FTSE Index", "gb_market", "GBP"),
  world("^GDAXI", "DAX PERFORMANCE-INDEX", 24400, 0.17, "frankfurt", "GER", "XETRA", "de_market", "EUR"),
  world("^FCHI", "CAC 40", 8100, 0.16, "paris", "PAR", "Paris", "fr_market", "EUR"),
  world("^N225", "Nikkei 225", 50000, 0.2, "tokyo", "OSA", "Osaka", "jp_market", "JPY"),
  world("^HSI", "HANG SENG INDEX", 25800, 0.22, "hongkong", "HKG", "HKSE", "hk_market", "HKD"),
  world("000001.SS", "SSE Composite Index", 3950, 0.18, "shanghai", "SHH", "Shanghai", "cn_market", "CNY"),
  world("000300.SS", "CSI 300 Index", 4600, 0.19, "shanghai", "SHH", "Shanghai", "cn_market", "CNY"),
  world("399001.SZ", "Shenzhen Index", 13300, 0.22, "shanghai", "SHZ", "Shenzhen", "cn_market", "CNY"),
  world("^KS11", "KOSPI Composite Index", 4100, 0.22, "seoul", "KSC", "KSE", "kr_market", "KRW"),
  world("^TWII", "TSEC CAPITALIZATION WEIGHTED STOCK INDEX", 27500, 0.2, "taipei", "TAI", "Taiwan", "tw_market", "TWD"),
  world("^AXJO", "S&P/ASX 200", 8700, 0.13, "sydney", "ASX", "ASX", "au_market", "AUD"),
  world("^BSESN", "S&P BSE SENSEX", 85000, 0.14, "mumbai", "BSE", "BSE", "in_market", "INR"),
  fx("EURUSD=X", "EUR/USD", 1.17, 0.07, "USD"),
  fx("USDJPY=X", "USD/JPY", 156, 0.09, "JPY"),
  fx("GBPUSD=X", "GBP/USD", 1.34, 0.07, "USD"),
  fx("CNY=X", "USD/CNY", 7.0, 0.03, "CNY"),
  fx("HKD=X", "USD/HKD", 7.78, 0.005, "HKD"),
  future("GC=F", "Gold", 4300, 0.18, "CMX", "COMEX", 150_000, 0),
  future("SI=F", "Silver", 70, 0.3, "CMX", "COMEX", 60_000, 0),
  future("HG=F", "Copper", 5.5, 0.24, "CMX", "COMEX", 40_000),
  future("CL=F", "Crude Oil", 58, 0.35, "NYM", "NY Mercantile", 300_000, 0.15),
  future("NG=F", "Natural Gas", 3.8, 0.6, "NYM", "NY Mercantile", 150_000, 0),
  {
    symbol: "BTC-USD", name: "Bitcoin USD", shortName: "Bitcoin USD", type: "CRYPTOCURRENCY", level: 90000, vol: 0.55, drift: 0.25, marketLoading: 0.25,
    exchange: "CCC", fullExchangeName: "CCC", market: "ccc_market", currency: "USD", profile: "crypto", volume: 40_000_000_000, size: 1_790_000_000_000,
  },
  {
    symbol: "ETH-USD", name: "Ethereum USD", shortName: "Ethereum USD", type: "CRYPTOCURRENCY", level: 3000, vol: 0.7, drift: 0.2, marketLoading: 0.25,
    exchange: "CCC", fullExchangeName: "CCC", market: "ccc_market", currency: "USD", profile: "crypto", volume: 20_000_000_000, size: 362_000_000_000,
  },
];

// ---------------------------------------------------------------------------
// First trading days
// ---------------------------------------------------------------------------

/**
 * First trading day of the listings that started after their calendar's first day (2000 for US stocks and funds):
 * no bars, dividends or charts before it, and the quote's firstTradeDate. Approximate days, as Yahoo lists them.
 */
const LISTED: Readonly<Record<string, string>> = {
  META: "2012-05-18",
  TSLA: "2010-06-29",
  GOOGL: "2004-08-19",
  V: "2008-03-19",
  MA: "2006-05-25",
  PYPL: "2015-07-20",
  ABBV: "2013-01-02",
  PM: "2008-03-17",
  TMUS: "2007-04-19",
  CRM: "2004-06-23",
  AVGO: "2009-08-06",
  NFLX: "2002-05-23",
  MDLZ: "2001-06-13",
  CEG: "2022-02-02",
  MRVL: "2000-06-27",
  SMCI: "2007-03-29",
  UBER: "2019-05-10",
  ABNB: "2020-12-10",
  PLTR: "2020-09-30",
  ARM: "2023-09-14",
  COIN: "2021-04-14",
  HOOD: "2021-07-29",
  SHOP: "2015-05-21",
  BABA: "2014-09-19",
  PDD: "2018-07-26",
  JD: "2014-05-22",
  BIDU: "2005-08-05",
  NTES: "2000-06-30",
  TCOM: "2003-12-09",
  BILI: "2018-03-28",
  NIO: "2018-09-12",
  XPEV: "2020-08-27",
  LI: "2020-07-30",
  BEKE: "2020-08-13",
  TME: "2018-12-12",
  FUTU: "2019-03-08",
  TAL: "2010-10-20",
  EDU: "2006-09-07",
  VIPS: "2012-03-23",
  "0700.HK": "2004-06-16",
  "9988.HK": "2019-11-26",
  "3690.HK": "2018-09-20",
  "1810.HK": "2018-07-09",
  "1211.HK": "2002-07-31",
  "9618.HK": "2020-06-18",
  "2318.HK": "2004-06-24",
  XLC: "2018-06-19",
  XLRE: "2015-10-08",
  IGV: "2001-07-13",
  VOX: "2004-09-29",
  VCR: "2004-01-30",
  VDC: "2004-01-30",
  KBE: "2005-11-15",
  ITA: "2006-05-05",
  XOP: "2006-06-22",
  GDX: "2006-05-22",
  VNQ: "2004-09-29",
  KWEB: "2013-08-01",
  FXI: "2004-10-08",
  GLD: "2004-11-18",
  TLT: "2002-07-30",
  RSP: "2003-05-01",
  IWM: "2000-05-26",
  IBB: "2001-02-09",
  "ETH-USD": "2017-11-09",
};

// ---------------------------------------------------------------------------
// Headcounts
// ---------------------------------------------------------------------------

/**
 * Approximate full-time employees of the table's companies (rounded, as published around 2025), for the Company panel.
 * Companies outside the table get a headcount from their revenue (company.ts).
 */
const EMPLOYEES: Readonly<Record<string, number>> = {
  NVDA: 36_000, MSFT: 228_000, AAPL: 164_000, AVGO: 37_000, ORCL: 162_000, AMD: 28_000, CRM: 76_000, ADBE: 30_000, CSCO: 90_000, QCOM: 49_000,
  GOOGL: 183_000, META: 76_000, NFLX: 14_000, DIS: 233_000, TMUS: 70_000, VZ: 100_000, T: 141_000, CMCSA: 182_000,
  AMZN: 1_556_000, TSLA: 125_000, HD: 470_000, MCD: 150_000, BKNG: 24_000, LOW: 300_000, TJX: 349_000, NKE: 79_000, SBUX: 361_000,
  WMT: 2_100_000, COST: 333_000, PG: 108_000, KO: 69_000, PEP: 318_000, PM: 83_000, MDLZ: 91_000,
  LLY: 47_000, UNH: 400_000, JNJ: 138_000, ABBV: 55_000, MRK: 74_000, TMO: 125_000, ABT: 114_000, AMGN: 28_000, PFE: 81_000,
  "BRK-B": 392_000, JPM: 317_000, V: 31_000, MA: 35_000, BAC: 213_000, WFC: 217_000, GS: 46_000, MS: 80_000, BLK: 21_000,
  GE: 53_000, CAT: 112_000, RTX: 186_000, UNP: 32_000, HON: 102_000, BA: 172_000, DE: 75_000, LMT: 121_000,
  XOM: 61_000, CVX: 45_000, COP: 11_800, SLB: 110_000, EOG: 3_100,
  LIN: 66_000, SHW: 63_000, APD: 21_000, FCX: 28_000, NEM: 22_000,
  NEE: 17_000, SO: 28_000, DUK: 27_000, CEG: 14_000,
  PLD: 2_700, AMT: 4_700, EQIX: 13_000, SPG: 3_300,
  TSM: 77_000, INTC: 108_000, MU: 48_000, ASML: 44_000, ARM: 7_100, PLTR: 4_000, IBM: 270_000, UBER: 31_000, ABNB: 7_300, SMCI: 5_700,
  MRVL: 6_500, COIN: 4_000, MSTR: 1_500, HOOD: 2_300, SHOP: 8_100, PYPL: 24_000,
  BABA: 125_000, PDD: 23_000, JD: 570_000, BIDU: 31_000, NTES: 21_000, TCOM: 41_000, BILI: 8_000, NIO: 32_000, XPEV: 16_000, LI: 32_000,
  BEKE: 130_000, TME: 5_200, FUTU: 3_300, TAL: 21_000, EDU: 75_000, VIPS: 7_000,
  "0700.HK": 110_000, "9988.HK": 125_000, "3690.HK": 100_000, "1810.HK": 43_000, "1211.HK": 900_000, "9618.HK": 570_000, "2318.HK": 290_000, "0005.HK": 211_000,
};

/** The approximate headcount of a company of the table, or null for any other symbol. */
export function employeesOf(symbol: string): number | null {
  return EMPLOYEES[symbol] ?? null;
}

/** The market profile of a listing: its calendar, starting on its first trading day when it listed later. */
function listedProfile(symbol: string, key: ProfileKey): MarketProfile {
  const profile: MarketProfile = PROFILES[key];
  const listed = LISTED[symbol];
  return listed ? { ...profile, epoch: Math.max(profile.epoch, parseDayKey(listed)) } : profile;
}

// ---------------------------------------------------------------------------
// Building the records
// ---------------------------------------------------------------------------

/** Yahoo's short name: the long name without a trailing legal form, at most 31 characters. */
function shortNameOf(name: string): string {
  return name.length <= 31 ? name : name.slice(0, 31);
}

function stockRecord(row: StockRow): Security {
  const [symbol, name, sectorKey, industry, capB, price, yieldPercent, pe, vol, venueCode, country] = row;
  const venue: Venue = VENUES[venueCode];
  return {
    symbol,
    name,
    shortName: shortNameOf(name),
    type: "EQUITY",
    profile: listedProfile(symbol, venue.profile),
    exchange: venue.exchange,
    fullExchangeName: venue.fullExchangeName,
    market: venue.market,
    currency: venue.currency,
    sector: YAHOO_SECTORS[sectorKey],
    industry,
    sectorKey,
    country: country ?? venue.country,
    model: "walk",
    anchorPrice: price,
    vol,
    drift: between(0.02, 0.15, symbol, "drift"),
    marketLoading: 0.55,
    sectorLoading: 0.45,
    seedKey: symbol,
    tenorYears: null,
    sizeAtAnchor: capB * 1e9,
    dividendYield: yieldPercent / 100,
    trailingPE: pe,
    baseVolume: Math.round(((capB * 1e9) / price) * between(0.003, 0.01, symbol, "turnover")),
    fund: null,
    synthetic: false,
  };
}

const FOCUS_SECTOR: Partial<Record<FundInfo["focus"], SectorKey>> = { growth: "technology" };

function fundRecord(row: FundRow): Security {
  const [symbol, name, assetsB, price, yieldPercent, expensePercent, category, family, focus, venueCode, tracks] = row;
  const venue: Venue = VENUES[venueCode];
  const tracked = tracks ? MARKETS.find((m) => m.symbol === tracks) : undefined;
  const sectorKey = SECTOR_KEYS.includes(focus as SectorKey) ? (focus as SectorKey) : (FOCUS_SECTOR[focus] ?? null);
  const broad = focus === "broad" || focus === "smallcap";
  return {
    symbol,
    name,
    shortName: shortNameOf(name),
    type: "ETF",
    profile: listedProfile(symbol, "us"),
    exchange: venue.exchange,
    fullExchangeName: venue.fullExchangeName,
    market: venue.market,
    currency: venue.currency,
    sector: null,
    industry: null,
    sectorKey,
    country: null,
    model: "walk",
    anchorPrice: price,
    // A fund that tracks an index moves exactly like it: same noise, volatility and loadings.
    vol: tracked?.vol ?? (broad ? 0.16 : focus === "gold" ? 0.18 : focus === "bonds" ? 0.14 : focus === "china" ? 0.3 : 0.2),
    drift: tracked?.drift ?? (focus === "bonds" ? 0.02 : 0.07),
    marketLoading: tracked?.marketLoading ?? (broad ? 0.95 : sectorKey ? 0.77 : focus === "china" ? 0.4 : 0.1),
    sectorLoading: tracked?.sectorLoading ?? (sectorKey ? 0.63 : 0),
    seedKey: tracked?.symbol ?? symbol,
    tenorYears: null,
    sizeAtAnchor: assetsB * 1e9,
    dividendYield: yieldPercent / 100,
    trailingPE: null,
    baseVolume: Math.round(((assetsB * 1e9) / price) * (symbol === "SPY" || symbol === "QQQ" ? 0.07 : 0.03)),
    fund: { category, family, expenseRatio: expensePercent / 100, focus },
    synthetic: false,
  };
}

function marketRecord(row: MarketRow): Security {
  return {
    symbol: row.symbol,
    name: row.name,
    shortName: row.shortName ?? shortNameOf(row.name),
    type: row.type,
    profile: listedProfile(row.symbol, row.profile),
    exchange: row.exchange,
    fullExchangeName: row.fullExchangeName,
    market: row.market,
    currency: row.currency,
    sector: null,
    industry: null,
    sectorKey: row.sectorKey ?? null,
    country: null,
    model: row.model ?? "walk",
    anchorPrice: row.level,
    vol: row.vol,
    drift: row.drift ?? 0.07,
    marketLoading: row.marketLoading ?? 0,
    sectorLoading: row.sectorLoading ?? 0,
    seedKey: row.symbol,
    tenorYears: row.tenorYears ?? null,
    sizeAtAnchor: row.size ?? null,
    dividendYield: 0,
    trailingPE: null,
    baseVolume: row.volume,
    fund: null,
    synthetic: false,
  };
}

function reservedRecord(symbol: string, name: string): Security {
  return stockRecord([symbol, name, "technology", "Software - Application", 12, 40, 0, 25, 0.35, "NMS"]);
}

const TABLE = new Map<string, Security>();
for (const row of STOCKS) TABLE.set(row[0], stockRecord(row));
for (const row of FUNDS) TABLE.set(row[0], fundRecord(row));
for (const row of MARKETS) TABLE.set(row.symbol, marketRecord(row));
TABLE.set("E2ELEN", reservedRecord("E2ELEN", "E2E Length Scenario Inc."));
TABLE.set("E2EERR", reservedRecord("E2EERR", "E2E Stream Error Scenario Inc."));
TABLE.set("E2ESLOW", reservedRecord("E2ESLOW", "E2E Slow Stream Scenario Inc."));
TABLE.set("E2EKEY", reservedRecord("E2EKEY", "E2E Rejected Key Scenario Inc."));

/** Every security of the table, in table order (search and the screens read it). */
export const TABLE_SECURITIES: readonly Security[] = [...TABLE.values()];

const RESERVED = new Set<string>(RESERVED_SCENARIO_SYMBOLS);

/** US stocks of the table, the pool the market-wide screens draw from (the reserved scenario symbols excluded). */
export const SCREEN_POOL: readonly Security[] = TABLE_SECURITIES.filter(
  (security) => security.type === "EQUITY" && security.market === "us_market" && !RESERVED.has(security.symbol),
);

// ---------------------------------------------------------------------------
// Symbols outside the table
// ---------------------------------------------------------------------------

const NAME_HEADS = [
  "Apex", "Beacon", "Cobalt", "Delta", "Ember", "Falcon", "Granite", "Harbor", "Iris", "Juniper", "Keystone", "Lumen",
  "Meridian", "Nimbus", "Orion", "Pioneer", "Quartz", "Redwood", "Summit", "Tidal", "Unity", "Vertex", "Willow", "Zenith",
];
const NAME_TAILS = ["Dynamics", "Systems", "Holdings", "Labs", "Networks", "Industries", "Therapeutics", "Energy", "Logistics", "Materials", "Software", "Brands"];
const NAME_FORMS = ["Inc.", "Corp.", "Group", "Co."];

/** A stable made-up company name for a symbol, e.g. "Harbor Networks Inc.". */
export function syntheticName(symbol: string): string {
  return `${NAME_HEADS[pick(NAME_HEADS.length, symbol, "head")]} ${NAME_TAILS[pick(NAME_TAILS.length, symbol, "tail")]} ${NAME_FORMS[pick(NAME_FORMS.length, symbol, "form")]}`;
}

/** A log-uniform number in [min, max) for a key (price levels and sizes spread over orders of magnitude). */
function logBetween(min: number, max: number, ...parts: string[]): number {
  return Math.exp(between(Math.log(min), Math.log(max), ...parts));
}

function syntheticStock(symbol: string, venue: Venue): Security {
  const sectorKey = SECTOR_KEYS[pick(SECTOR_KEYS.length, symbol, "sector")];
  const capB = logBetween(0.5, 80, symbol, "cap");
  const price = logBetween(5, 400, symbol, "price");
  const row: StockRow = [symbol, syntheticName(symbol), sectorKey, "Specialty Business Services", capB, price, unitPercent(symbol), between(8, 45, symbol, "pe"), between(0.25, 0.6, symbol, "vol"), "NMS"];
  return { ...stockRecord(row), ...venueFields(venue), profile: PROFILES[venue.profile], country: venue.country, synthetic: true };
}

/** About half of the synthetic companies pay a dividend of up to 4%. */
function unitPercent(symbol: string): number {
  const draw = between(-4, 4, symbol, "dividend");
  return draw > 0 ? Math.round(draw * 10) / 10 : 0;
}

function venueFields(venue: Venue): Pick<Security, "exchange" | "fullExchangeName" | "market" | "currency"> {
  return { exchange: venue.exchange, fullExchangeName: venue.fullExchangeName, market: venue.market, currency: venue.currency };
}

function synthesize(symbol: string): Security {
  if (symbol.startsWith("^")) {
    return marketRecord(us(symbol, `${symbol.slice(1)} Index`, logBetween(500, 20000, symbol, "level"), between(0.14, 0.25, symbol, "vol"), "WCB", "Chicago Options", 0, { marketLoading: 0.8 }));
  }
  const currency = /^([A-Z]{3})?([A-Z]{3})=X$/.exec(symbol);
  if (currency) {
    const base = currency[1] ?? "USD";
    const quote = currency[2];
    return { ...marketRecord(fx(symbol, `${base}/${quote}`, logBetween(0.5, 150, symbol, "level"), between(0.04, 0.12, symbol, "vol"), quote)), synthetic: true };
  }
  if (symbol.endsWith("=F")) {
    return { ...marketRecord(future(symbol, `${symbol.slice(0, -2)} Futures`, logBetween(5, 2000, symbol, "level"), between(0.2, 0.45, symbol, "vol"), "NYM", "NY Mercantile", 50_000)), synthetic: true };
  }
  const crypto = /^([A-Z0-9]{2,10})-(USD|USDT|EUR|GBP|JPY|BTC)$/.exec(symbol);
  if (crypto) {
    return {
      ...marketRecord({
        symbol, name: `${crypto[1]} ${crypto[2]}`, type: "CRYPTOCURRENCY", level: logBetween(0.05, 500, symbol, "level"), vol: between(0.6, 1.1, symbol, "vol"), drift: 0.1,
        marketLoading: 0.2, exchange: "CCC", fullExchangeName: "CCC", market: "ccc_market", currency: crypto[2] === "USDT" ? "USD" : crypto[2], profile: "crypto",
        volume: Math.round(logBetween(1e6, 1e9, symbol, "volume")),
      }),
      synthetic: true,
    };
  }
  const suffix = /\.([A-Z]{1,2})$/.exec(symbol)?.[1];
  const venue: Venue = suffix && SUFFIX_VENUES[suffix] ? VENUES[SUFFIX_VENUES[suffix]] : VENUES[pick(2, symbol, "venue") === 0 ? "NMS" : "NYQ"];
  if (!suffix && /^[A-Z]{4}X$/.test(symbol)) {
    const fund = syntheticStock(symbol, VENUES.NAS);
    return { ...fund, type: "MUTUALFUND", name: `${NAME_HEADS[pick(NAME_HEADS.length, symbol, "head")]} Growth Fund`, sector: null, industry: null, trailingPE: null, vol: 0.15, marketLoading: 0.9, sectorLoading: 0, fund: { category: "Large Blend", family: "Synthetic Funds", expenseRatio: 0.004, focus: "broad" } };
  }
  return syntheticStock(symbol, venue);
}

/** True for symbols the fixture data treats as unknown (the reserved prefix "ZZ"). */
export function isNotFoundSymbol(symbol: string): boolean {
  return symbol.trim().toUpperCase().startsWith(NOT_FOUND_PREFIX);
}

const synthesized = new Map<string, Security>();

/** The security behind a symbol, or null for the reserved not-found prefix (and blank input). */
export function securityOf(input: string): Security | null {
  const symbol = input.trim().toUpperCase();
  if (!symbol || isNotFoundSymbol(symbol)) return null;
  const known = TABLE.get(symbol);
  if (known) return known;
  let made = synthesized.get(symbol);
  if (!made) {
    made = synthesize(symbol);
    if (synthesized.size > 2000) synthesized.clear();
    synthesized.set(symbol, made);
  }
  return made;
}

/** The universe sector key of a Yahoo sector name. */
export function sectorKeyOfYahoo(name: string | null): SectorKey | null {
  if (!name) return null;
  return SECTOR_KEYS.find((key) => YAHOO_SECTORS[key] === name) ?? null;
}
