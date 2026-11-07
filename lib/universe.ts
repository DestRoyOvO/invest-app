// Static market universe shared by the client and the server.
// Sector constituents are large US caps chosen for the heatmap; market caps and prices come from live quotes.

import type { SectorKey } from "@/types/api";

export interface BoardSymbol {
  symbol: string;
  /** Short terminal-style code shown in the ticker strip. */
  code: string;
  label: { en: string; zh: string };
  /** How to format the price: index points, a yield in percent, or a currency price. */
  kind: "index" | "yield" | "price";
}

export const MARKET_BOARD: BoardSymbol[] = [
  { symbol: "^GSPC", code: "SPX", label: { en: "S&P 500", zh: "标普 500" }, kind: "index" },
  { symbol: "^NDX", code: "NDX", label: { en: "Nasdaq 100", zh: "纳斯达克 100" }, kind: "index" },
  { symbol: "^DJI", code: "INDU", label: { en: "Dow Jones", zh: "道琼斯" }, kind: "index" },
  { symbol: "^RUT", code: "RTY", label: { en: "Russell 2000", zh: "罗素 2000" }, kind: "index" },
  { symbol: "^VIX", code: "VIX", label: { en: "Volatility", zh: "波动率指数" }, kind: "index" },
  { symbol: "^TNX", code: "US10Y", label: { en: "US 10Y Yield", zh: "美债 10 年收益率" }, kind: "yield" },
  { symbol: "DX-Y.NYB", code: "DXY", label: { en: "US Dollar", zh: "美元指数" }, kind: "index" },
  { symbol: "GC=F", code: "GOLD", label: { en: "Gold", zh: "黄金" }, kind: "price" },
  { symbol: "CL=F", code: "WTI", label: { en: "WTI Crude", zh: "WTI 原油" }, kind: "price" },
  { symbol: "BTC-USD", code: "BTC", label: { en: "Bitcoin", zh: "比特币" }, kind: "price" },
];

/** Symbol used to read the US market session state. */
export const MARKET_STATE_SYMBOL = "^GSPC";

export interface SectorDef {
  key: SectorKey;
  label: { en: string; zh: string };
  /** Short label for dense layouts such as treemap tiles. */
  short: { en: string; zh: string };
  /** SPDR sector ETF. */
  etf: string;
  /** Related ETFs shown on the sector page. */
  relatedEtfs: string[];
  stocks: string[];
  /** Short Yahoo search terms used for sector news (Yahoo returns little for long queries). */
  newsQueries: string[];
}

export const SECTORS: SectorDef[] = [
  {
    key: "technology",
    label: { en: "Information Technology", zh: "信息技术" },
    short: { en: "Tech", zh: "科技" },
    etf: "XLK",
    relatedEtfs: ["XLK", "SMH", "IGV"],
    stocks: ["NVDA", "MSFT", "AAPL", "AVGO", "ORCL", "AMD", "CRM", "ADBE", "CSCO", "QCOM"],
    newsQueries: ["semiconductor stocks", "tech earnings"],
  },
  {
    key: "communication",
    label: { en: "Communication Services", zh: "通信服务" },
    short: { en: "Comm", zh: "通信" },
    etf: "XLC",
    relatedEtfs: ["XLC", "VOX"],
    stocks: ["GOOGL", "META", "NFLX", "DIS", "TMUS", "VZ", "T", "CMCSA"],
    newsQueries: ["streaming", "digital advertising"],
  },
  {
    key: "consumer-discretionary",
    label: { en: "Consumer Discretionary", zh: "可选消费" },
    short: { en: "Cons Disc", zh: "可选消费" },
    etf: "XLY",
    relatedEtfs: ["XLY", "VCR"],
    stocks: ["AMZN", "TSLA", "HD", "MCD", "BKNG", "LOW", "TJX", "NKE", "SBUX"],
    newsQueries: ["consumer spending", "retail sales"],
  },
  {
    key: "consumer-staples",
    label: { en: "Consumer Staples", zh: "必需消费" },
    short: { en: "Staples", zh: "必需消费" },
    etf: "XLP",
    relatedEtfs: ["XLP", "VDC"],
    stocks: ["WMT", "COST", "PG", "KO", "PEP", "PM", "MDLZ"],
    newsQueries: ["consumer staples", "food prices"],
  },
  {
    key: "healthcare",
    label: { en: "Health Care", zh: "医疗保健" },
    short: { en: "Health", zh: "医疗" },
    etf: "XLV",
    relatedEtfs: ["XLV", "IBB"],
    stocks: ["LLY", "UNH", "JNJ", "ABBV", "MRK", "TMO", "ABT", "AMGN", "PFE"],
    newsQueries: ["FDA approval", "biotech"],
  },
  {
    key: "financials",
    label: { en: "Financials", zh: "金融" },
    short: { en: "Fin", zh: "金融" },
    etf: "XLF",
    relatedEtfs: ["XLF", "KBE"],
    stocks: ["BRK-B", "JPM", "V", "MA", "BAC", "WFC", "GS", "MS", "BLK"],
    newsQueries: ["Federal Reserve", "bank earnings"],
  },
  {
    key: "industrials",
    label: { en: "Industrials", zh: "工业" },
    short: { en: "Indu", zh: "工业" },
    etf: "XLI",
    relatedEtfs: ["XLI", "ITA"],
    stocks: ["GE", "CAT", "RTX", "UNP", "HON", "BA", "DE", "LMT"],
    newsQueries: ["manufacturing", "defense stocks"],
  },
  {
    key: "energy",
    label: { en: "Energy", zh: "能源" },
    short: { en: "Energy", zh: "能源" },
    etf: "XLE",
    relatedEtfs: ["XLE", "XOP"],
    stocks: ["XOM", "CVX", "COP", "SLB", "EOG"],
    newsQueries: ["oil prices", "OPEC"],
  },
  {
    key: "materials",
    label: { en: "Materials", zh: "原材料" },
    short: { en: "Mat", zh: "原材料" },
    etf: "XLB",
    relatedEtfs: ["XLB", "GDX"],
    stocks: ["LIN", "SHW", "APD", "FCX", "NEM"],
    newsQueries: ["copper prices", "gold prices"],
  },
  {
    key: "utilities",
    label: { en: "Utilities", zh: "公用事业" },
    short: { en: "Util", zh: "公用" },
    etf: "XLU",
    relatedEtfs: ["XLU"],
    stocks: ["NEE", "SO", "DUK", "CEG"],
    newsQueries: ["utilities", "power demand"],
  },
  {
    key: "real-estate",
    label: { en: "Real Estate", zh: "房地产" },
    short: { en: "RE", zh: "地产" },
    etf: "XLRE",
    relatedEtfs: ["XLRE", "VNQ"],
    stocks: ["PLD", "AMT", "EQIX", "SPG"],
    newsQueries: ["REIT", "mortgage rates"],
  },
];

export const SECTOR_KEYS: SectorKey[] = SECTORS.map((s) => s.key);

export function getSector(key: string): SectorDef | undefined {
  return SECTORS.find((s) => s.key === key);
}

/** Sector of a universe stock, if it belongs to one. */
export function sectorOfSymbol(symbol: string): SectorDef | undefined {
  return SECTORS.find((s) => s.stocks.includes(symbol));
}

export const UNIVERSE_STOCKS: string[] = SECTORS.flatMap((s) => s.stocks);

export const BROAD_ETFS = ["SPY", "QQQ", "DIA", "IWM"];

export const DEFAULT_WATCHLIST = ["NVDA", "AAPL", "MSFT", "GOOGL", "AMZN"];

export const MAX_WATCHLIST = 50;
