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

/** The equal-weight and the cap-weighted S&P 500 ETFs whose changes the breadth panels compare. */
export const BREADTH_REFERENCES = { equalWeight: "RSP", capWeight: "SPY" } as const;

export type WorldRegion = "americas" | "europe" | "asia" | "fx" | "commodities" | "crypto";

export const WORLD_REGIONS: readonly WorldRegion[] = ["americas", "europe", "asia", "fx", "commodities", "crypto"];

export interface WorldSymbol {
  symbol: string;
  /** Short terminal-style code. */
  code: string;
  label: { en: string; zh: string };
  region: WorldRegion;
  /** IANA time zone of the exchange, as Yahoo reports it, for the local time of the last trade. */
  timeZone: string;
  /** The place whose clock `timeZone` is, for screen readers and tooltips ("Tokyo time"). */
  place: { en: string; zh: string };
  /** Decimals for the price. */
  digits: number;
  /** One of the Asian and European benchmarks in the overnight summary. */
  overnight?: boolean;
}

const NEW_YORK = { en: "New York", zh: "纽约" };
const LONDON = { en: "London", zh: "伦敦" };

/**
 * World markets page (WEI). Every symbol was checked against a live Yahoo quote on 2026-11-07: name, quote type and
 * exchange time zone match. Yahoo's ^MOVE is a Northern Trust iBoxx index rather than the bond-volatility index, and
 * its 2-year yield future stopped trading, so rates come from the Treasury curve (lib/server/rates.ts) instead.
 */
export const WORLD_BOARD: readonly WorldSymbol[] = [
  { symbol: "^GSPC", code: "SPX", label: { en: "S&P 500", zh: "标普 500" }, region: "americas", timeZone: "America/New_York", place: NEW_YORK, digits: 2 },
  { symbol: "^NDX", code: "NDX", label: { en: "Nasdaq 100", zh: "纳斯达克 100" }, region: "americas", timeZone: "America/New_York", place: NEW_YORK, digits: 2 },
  { symbol: "^DJI", code: "INDU", label: { en: "Dow Jones", zh: "道琼斯" }, region: "americas", timeZone: "America/New_York", place: NEW_YORK, digits: 2 },
  { symbol: "^RUT", code: "RTY", label: { en: "Russell 2000", zh: "罗素 2000" }, region: "americas", timeZone: "America/New_York", place: NEW_YORK, digits: 2 },
  { symbol: "^GSPTSE", code: "SPTSX", label: { en: "S&P/TSX Composite", zh: "多伦多综合" }, region: "americas", timeZone: "America/Toronto", place: { en: "Toronto", zh: "多伦多" }, digits: 2 },
  { symbol: "^STOXX50E", code: "SX5E", label: { en: "Euro Stoxx 50", zh: "欧洲斯托克 50" }, region: "europe", timeZone: "Europe/Zurich", place: { en: "Zurich", zh: "苏黎世" }, digits: 2, overnight: true },
  { symbol: "^FTSE", code: "UKX", label: { en: "FTSE 100", zh: "富时 100" }, region: "europe", timeZone: "Europe/London", place: LONDON, digits: 2, overnight: true },
  { symbol: "^GDAXI", code: "DAX", label: { en: "DAX", zh: "德国 DAX" }, region: "europe", timeZone: "Europe/Berlin", place: { en: "Frankfurt", zh: "法兰克福" }, digits: 2, overnight: true },
  { symbol: "^FCHI", code: "CAC", label: { en: "CAC 40", zh: "法国 CAC 40" }, region: "europe", timeZone: "Europe/Paris", place: { en: "Paris", zh: "巴黎" }, digits: 2 },
  { symbol: "^N225", code: "NKY", label: { en: "Nikkei 225", zh: "日经 225" }, region: "asia", timeZone: "Asia/Tokyo", place: { en: "Tokyo", zh: "东京" }, digits: 2, overnight: true },
  { symbol: "^HSI", code: "HSI", label: { en: "Hang Seng", zh: "恒生指数" }, region: "asia", timeZone: "Asia/Hong_Kong", place: { en: "Hong Kong", zh: "香港" }, digits: 2, overnight: true },
  { symbol: "000001.SS", code: "SHCOMP", label: { en: "Shanghai Composite", zh: "上证指数" }, region: "asia", timeZone: "Asia/Shanghai", place: { en: "Shanghai", zh: "上海" }, digits: 2 },
  // Yahoo quotes CSI 300 but serves almost no daily bars for it (one bar a month on 2026-11-07), so its line is often empty.
  { symbol: "000300.SS", code: "CSI300", label: { en: "CSI 300", zh: "沪深 300" }, region: "asia", timeZone: "Asia/Shanghai", place: { en: "Shanghai", zh: "上海" }, digits: 2, overnight: true },
  { symbol: "399001.SZ", code: "SICOM", label: { en: "SZSE Component", zh: "深证成指" }, region: "asia", timeZone: "Asia/Shanghai", place: { en: "Shenzhen", zh: "深圳" }, digits: 2 },
  { symbol: "^KS11", code: "KOSPI", label: { en: "KOSPI", zh: "韩国综合" }, region: "asia", timeZone: "Asia/Seoul", place: { en: "Seoul", zh: "首尔" }, digits: 2, overnight: true },
  { symbol: "^TWII", code: "TWSE", label: { en: "Taiwan Weighted", zh: "台湾加权" }, region: "asia", timeZone: "Asia/Taipei", place: { en: "Taipei", zh: "台北" }, digits: 2 },
  { symbol: "^AXJO", code: "AS51", label: { en: "S&P/ASX 200", zh: "澳洲 ASX 200" }, region: "asia", timeZone: "Australia/Sydney", place: { en: "Sydney", zh: "悉尼" }, digits: 2 },
  { symbol: "^BSESN", code: "SENSEX", label: { en: "BSE Sensex", zh: "印度 Sensex" }, region: "asia", timeZone: "Asia/Kolkata", place: { en: "Mumbai", zh: "孟买" }, digits: 2 },
  { symbol: "EURUSD=X", code: "EURUSD", label: { en: "EUR/USD", zh: "欧元/美元" }, region: "fx", timeZone: "Europe/London", place: LONDON, digits: 4 },
  { symbol: "USDJPY=X", code: "USDJPY", label: { en: "USD/JPY", zh: "美元/日元" }, region: "fx", timeZone: "Europe/London", place: LONDON, digits: 3 },
  { symbol: "GBPUSD=X", code: "GBPUSD", label: { en: "GBP/USD", zh: "英镑/美元" }, region: "fx", timeZone: "Europe/London", place: LONDON, digits: 4 },
  { symbol: "CNY=X", code: "USDCNY", label: { en: "USD/CNY", zh: "美元/人民币" }, region: "fx", timeZone: "Europe/London", place: LONDON, digits: 4 },
  { symbol: "HKD=X", code: "USDHKD", label: { en: "USD/HKD", zh: "美元/港元" }, region: "fx", timeZone: "Europe/London", place: LONDON, digits: 4 },
  { symbol: "GC=F", code: "GOLD", label: { en: "Gold", zh: "黄金" }, region: "commodities", timeZone: "America/New_York", place: NEW_YORK, digits: 2 },
  { symbol: "SI=F", code: "SILVER", label: { en: "Silver", zh: "白银" }, region: "commodities", timeZone: "America/New_York", place: NEW_YORK, digits: 3 },
  { symbol: "HG=F", code: "COPPER", label: { en: "Copper", zh: "铜" }, region: "commodities", timeZone: "America/New_York", place: NEW_YORK, digits: 4 },
  { symbol: "CL=F", code: "WTI", label: { en: "WTI crude", zh: "WTI 原油" }, region: "commodities", timeZone: "America/New_York", place: NEW_YORK, digits: 2 },
  { symbol: "NG=F", code: "NATGAS", label: { en: "Natural gas", zh: "天然气" }, region: "commodities", timeZone: "America/New_York", place: NEW_YORK, digits: 3 },
  { symbol: "BTC-USD", code: "BTC", label: { en: "Bitcoin", zh: "比特币" }, region: "crypto", timeZone: "UTC", place: { en: "UTC", zh: "UTC" }, digits: 2 },
  { symbol: "ETH-USD", code: "ETH", label: { en: "Ether", zh: "以太坊" }, region: "crypto", timeZone: "UTC", place: { en: "UTC", zh: "UTC" }, digits: 2 },
];

export function getWorldSymbol(symbol: string): WorldSymbol | undefined {
  return WORLD_BOARD.find((item) => item.symbol === symbol);
}

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
