// Positions from a broker's CSV export or a pasted list, for the holdings store (shares and average cost per symbol),
// and the CSV files the app exports.
//
// Columns are found by header name in English and Chinese, so one generic mapper covers most brokers instead of
// per-broker parsers that break whenever an export changes. Rows that are not positions the app can track (cash, money
// market funds, options, totals, short positions) are skipped with a reason, and missing or invalid values are
// reported per line, so nothing is dropped silently.
//
// Symbol fixes are heuristics, not rules; the import preview shows every rewrite and checks each symbol against a live
// quote before anything is saved:
// - US share classes written with a dot, slash or space get Yahoo's dash: BRK.B, BRK/B and BRK B become BRK-B. Only
//   classes A to C, because one-letter Yahoo exchange suffixes (.L London, .V TSX Venture, .F Frankfurt, .T Tokyo)
//   look the same and are left alone.
// - Hong Kong codes get Yahoo's four-digit form: 00700, 700.HK and 00700.HK become 0700.HK.
// - Six-digit mainland codes get an exchange by their leading digits: 60, 68, 90, 50-58 and 11 are Shanghai (.SS);
//   00, 30, 20, 15, 16 and 12 are Shenzhen (.SZ). Other codes (Beijing 4xxxxx and 8xxxxx) are left for the check.
// - Market prefixes as some brokers and APIs write them (HK.00700, SH.600519, SZ.000001, US.AAPL) and the .SH suffix
//   are rewritten the same way.
// - An exact Chinese company name from lib/names-zh.ts becomes its symbol (苹果 becomes AAPL).

import type { Holdings } from "@/hooks/useHoldings";

import { parseCsv, sniffDelimiter, type CsvCell, type CsvTable } from "./csv";
import { CHINESE_NAMES, hasCjk } from "./names-zh";
import { valuePortfolio, type QuoteLike } from "./portfolio";
import { normalizeSymbol } from "./symbols";

export type ImportField = "symbol" | "quantity" | "avgCost" | "totalCost" | "name" | "assetType" | "currency";

/** Column index per field; a field missing from the file is left out. */
export type ColumnMapping = Partial<Record<ImportField, number>>;

/**
 * Header names per field, normalized (see normalizeHeader). A header matches a synonym when they are equal or, for
 * multi-word Latin synonyms and a few unambiguous words, when the synonym appears in it as whole words. The longest
 * match wins, so "Average Cost Basis" is a cost per share while "Cost Basis Total" is a total. Chinese names must match
 * exactly (after units such as "(元)" are dropped), because Chinese has no word breaks: 持仓数量 is the share count but
 * 持仓市值 is the market value.
 */
const SYNONYMS: Record<ImportField, readonly string[]> = {
  symbol: ["symbol", "ticker", "ticker symbol", "stock symbol", "stock code", "code", "代码", "股票代码", "证券代码", "标的代码"],
  quantity: ["quantity", "qty", "shares", "units", "position", "quantity held", "shares held", "持仓数量", "数量", "股数", "持股数量", "持仓股数", "证券数量", "股票余额", "当前持仓"],
  avgCost: [
    "average cost",
    "avg cost",
    "average cost per share",
    "avg cost per share",
    "cost per share",
    "cost share",
    "average price",
    "avg price",
    "average cost basis",
    "avg cost basis",
    "cost basis per share",
    "unit cost",
    "cost price",
    "average cost price",
    "price paid",
    "purchase price",
    "average purchase price",
    "avg buy price",
    "cost",
    "成本价",
    "均价",
    "成本均价",
    "买入均价",
    "平均成本",
    "持仓成本价",
    "摊薄成本价",
    "参考成本价",
  ],
  totalCost: ["cost basis", "cost basis total", "total cost", "total cost basis", "book cost", "book value", "持仓成本", "总成本", "成本金额", "买入成本"],
  name: ["description", "name", "security description", "security name", "security", "company", "company name", "名称", "股票名称", "证券名称"],
  // Deliberately no bare "type": Fidelity's "Type" column says whether the account is Cash or Margin.
  assetType: ["security type", "asset type", "asset class", "product type", "instrument type", "证券类型", "资产类型"],
  currency: ["currency", "ccy", "币种", "货币", "交易币种"],
};

/** Single Latin words that may match inside a longer header ("Quantity (Shares)", "Symbol/CUSIP"). */
const PARTIAL_WORDS = new Set(["symbol", "ticker", "quantity", "qty", "shares"]);
const EXACT_ONLY_FIELDS = new Set<ImportField>(["name", "assetType", "currency"]);
/** Units and currency codes dropped from the end of a header before matching ("Cost (USD)", "成本价(元)"). */
const UNIT_WORDS = new Set(["usd", "hkd", "cny", "cnh", "rmb", "eur", "gbp", "jpy", "cad", "aud", "sgd", "chf", "元", "股", "港元", "美元", "人民币"]);

interface Synonym {
  field: ImportField;
  text: string;
  partial: boolean;
}

const SYNONYM_LIST: readonly Synonym[] = (Object.keys(SYNONYMS) as ImportField[]).flatMap((field) =>
  SYNONYMS[field].map((text) => ({
    field,
    text,
    partial: !EXACT_ONLY_FIELDS.has(field) && !hasCjk(text) && (text.includes(" ") || PARTIAL_WORDS.has(text)),
  })),
);

/** Lowercases a header, turns punctuation into single spaces and drops trailing units: "Avg. Cost (USD)" becomes "avg cost". */
export function normalizeHeader(text: string): string {
  const words = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (words.length > 1 && UNIT_WORDS.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

function matchHeader(header: string): { field: ImportField; score: number } | null {
  const normalized = normalizeHeader(header);
  if (!normalized) return null;
  let best: { field: ImportField; score: number } | null = null;
  for (const synonym of SYNONYM_LIST) {
    let score = 0;
    if (normalized === synonym.text) score = 1000 + synonym.text.length;
    else if (synonym.partial && ` ${normalized} `.includes(` ${synonym.text} `)) score = synonym.text.length;
    if (score > (best?.score ?? 0)) best = { field: synonym.field, score };
  }
  return best;
}

/** Finds each field's column among the headers; each header serves at most one field, its best match. */
export function detectColumns(headers: readonly string[]): ColumnMapping {
  const best = new Map<ImportField, { index: number; score: number }>();
  headers.forEach((header, index) => {
    const match = matchHeader(header);
    if (!match) return;
    const current = best.get(match.field);
    if (!current || match.score > current.score) best.set(match.field, { index, score: match.score });
  });
  const mapping: ColumnMapping = {};
  for (const [field, { index }] of best) mapping[field] = index;
  return mapping;
}

export interface HeaderDetection {
  /** Index of the header record in the parsed rows. */
  headerRow: number;
  headers: string[];
  mapping: ColumnMapping;
}

/**
 * Finds the header record among the first `scan` records: the one that names a symbol and a quantity column and the
 * most fields. Broker files often start with a title line or account details before the header.
 */
export function detectHeader(rows: readonly string[][], scan = 25): HeaderDetection | null {
  let best: HeaderDetection | null = null;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, scan); i++) {
    const mapping = detectColumns(rows[i]);
    if (mapping.symbol === undefined || mapping.quantity === undefined) continue;
    const score = Object.keys(mapping).length;
    if (score > bestScore) {
      best = { headerRow: i, headers: rows[i], mapping };
      bestScore = score;
    }
  }
  return best;
}

const CURRENCY_MARKS = /(?:US|HK|NZ|A|C|S)?\$|[€£¥₩₹元股]|USD|HKD|CNY|CNH|RMB|EUR|GBP|JPY|CAD|AUD|CHF|SGD|shares?$/gi;

/**
 * Parses a money amount or a share count as brokers write them: "$1,234.50", "(12.30)" and "12.30-" for negatives,
 * a trailing footnote "*", currency signs and codes, "1.234,56" with a decimal comma, and grouping spaces. A single
 * comma followed by exactly three digits ("1,234") is a thousands separator unless `decimalComma` is set (semicolon
 * files from European locales). Returns null for anything else.
 */
export function parseMoney(input: string | null | undefined, options: { decimalComma?: boolean } = {}): number | null {
  if (input === null || input === undefined) return null;
  let text = String(input)
    .normalize("NFKC")
    .replace(/−/g, "-")
    .trim()
    .replace(/\*+$/, "")
    .replace(CURRENCY_MARKS, "")
    .replace(/[\s'   ]/g, "");
  let negative = false;
  const parenthesized = /^\((.*)\)$/.exec(text);
  if (parenthesized) {
    negative = true;
    text = parenthesized[1];
  }
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  } else if (text.endsWith("-")) {
    negative = true;
    text = text.slice(0, -1);
  }
  if (!/^\d[\d.,]*$|^[.,]\d+$/.test(text)) return null;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let plain: string;
  if (lastComma >= 0 && lastDot >= 0) {
    plain = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const commas = text.split(",").length - 1;
    if (commas > 1) plain = /^\d{1,3}(?:,\d{3})+$/.test(text) ? text.replace(/,/g, "") : "invalid";
    else if (!options.decimalComma && /^\d{1,3},\d{3}$/.test(text)) plain = text.replace(",", "");
    else plain = text.replace(",", ".");
  } else if (lastDot >= 0) {
    const dots = text.split(".").length - 1;
    if (dots > 1) plain = /^\d{1,3}(?:\.\d{3})+$/.test(text) ? text.replace(/\./g, "") : "invalid";
    else if (options.decimalComma && /^\d{1,3}\.\d{3}$/.test(text)) plain = text.replace(".", "");
    else plain = text;
  } else {
    plain = text;
  }
  const value = Number(plain);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

export type SymbolFix = "shareClass" | "hongKong" | "shanghai" | "shenzhen" | "prefix" | "chineseName";

const SHANGHAI = new Set(["60", "68", "90", "50", "51", "52", "56", "58", "11"]);
const SHENZHEN = new Set(["00", "30", "20", "15", "16", "12"]);

/** Yahoo writes Hong Kong codes with at least four digits: 0700.HK, 0005.HK, 9988.HK. */
function hongKongSymbol(code: string): string {
  return `${code.replace(/^0+(?=\d{4})/, "").padStart(4, "0")}.HK`;
}

function result(symbol: string, fix: SymbolFix | null): { symbol: string | null; fix: SymbolFix | null } {
  const normalized = normalizeSymbol(symbol);
  return { symbol: normalized, fix: normalized ? fix : null };
}

/**
 * Turns a symbol as a broker or a person writes it into a Yahoo symbol, with the heuristics described at the top of
 * this file. Returns the fix applied (null when the input was already in Yahoo form) and a null symbol when the text
 * cannot be a symbol.
 */
export function fixSymbol(raw: string): { symbol: string | null; fix: SymbolFix | null } {
  let text = raw.normalize("NFKC").trim().replace(/\*+$/, "").replace(/^\$/, "").trim();
  if (!text) return { symbol: null, fix: null };
  if (hasCjk(text)) {
    const match = CHINESE_NAMES.find((entry) => entry.names.some((name) => name === text));
    return match ? result(match.symbol, "chineseName") : { symbol: null, fix: null };
  }
  text = text.toUpperCase().replace(/\s+/g, " ");
  let fix: SymbolFix | null = null;

  const prefixed = /^(HK|SH|SZ|US)\.(\S+)$/.exec(text);
  if (prefixed) {
    const [, market, code] = prefixed;
    if (market === "HK" && /^\d{1,5}$/.test(code)) return result(hongKongSymbol(code), "prefix");
    if (market === "SH" && /^\d{6}$/.test(code)) return result(`${code}.SS`, "prefix");
    if (market === "SZ" && /^\d{6}$/.test(code)) return result(`${code}.SZ`, "prefix");
    if (market === "US") {
      text = code;
      fix = "prefix";
    }
  }

  const hk = /^(\d{1,5})\.HK$/.exec(text);
  if (hk) {
    const symbol = hongKongSymbol(hk[1]);
    return result(symbol, symbol === text ? fix : "hongKong");
  }
  if (/^\d{5}$/.test(text)) return result(hongKongSymbol(text), "hongKong");

  const mainland = /^(\d{6})\.(SS|SH|SZ)$/.exec(text);
  if (mainland) return mainland[2] === "SH" ? result(`${mainland[1]}.SS`, "shanghai") : result(text, fix);
  if (/^\d{6}$/.test(text)) {
    const prefix = text.slice(0, 2);
    if (SHANGHAI.has(prefix)) return result(`${text}.SS`, "shanghai");
    if (SHENZHEN.has(prefix)) return result(`${text}.SZ`, "shenzhen");
  }

  const shareClass = /^([A-Z]{1,5})[./ ]([A-C])$/.exec(text);
  if (shareClass) return result(`${shareClass[1]}-${shareClass[2]}`, "shareClass");
  return result(text, fix);
}

export type SkipReason = "cash" | "moneyMarket" | "option" | "short" | "total";
export type RowError = "format" | "symbol" | "quantity" | "cost";

/** One line of an import, after mapping: a position to save, a skipped row with its reason, or an error. */
export interface ImportRow {
  /** 1-based line in the source text. */
  line: number;
  /** The symbol as written in the source. */
  rawSymbol: string;
  /** Yahoo symbol after the fixes; null when the text is not a plausible symbol (or the row is skipped). */
  symbol: string | null;
  /** The heuristic that rewrote the symbol, if any. */
  fix: SymbolFix | null;
  name: string | null;
  shares: number | null;
  /** Average cost per share. */
  cost: number | null;
  skip: SkipReason | null;
  error: RowError | null;
}

const TOTAL_ROW = /^(?:grand |account |portfolio |sub)?totals?\b|^合计|^总计|^小计/i;
const CASH_ROW = /^(?:cash|cash & cash investments|cash and cash equivalents|cash & sweep|pending activity|现金|资金|可用资金)$/i;
const MONEY_MARKET = /money\s*market|money fund|cash reserves|\bsweep\b|货币基金|货币市场|现金管理/i;
const OPTION_SYMBOLS = [
  /^-?[A-Z]{1,6}\s*\d{6}[CP]\d{8}$/, // OCC: AAPL  250117C00150000
  /^-?[A-Z]{1,6}\d{6}[CP]\d+(?:\.\d+)?$/, // Fidelity: -AAPL250117C150
  /^[A-Z]{1,6} \d{2}\/\d{2}\/\d{4} \d+(?:\.\d+)? [CP]$/, // Schwab: AAPL 01/17/2025 150.00 C
];
const OPTION_NAME = /\b(?:call|put)\b.*\d|\d.*\b(?:call|put)\b|期权|认购|认沽/i;

function skipReason(symbol: string, name: string, assetType: string): SkipReason | null {
  if (TOTAL_ROW.test(symbol) || (!symbol && TOTAL_ROW.test(name))) return "total";
  if (CASH_ROW.test(symbol) || /^cash$/i.test(assetType)) return "cash";
  if (/\*\*$/.test(symbol) || MONEY_MARKET.test(name) || MONEY_MARKET.test(assetType)) return "moneyMarket";
  const upper = symbol.toUpperCase();
  if (OPTION_SYMBOLS.some((pattern) => pattern.test(upper)) || /^options?$/i.test(assetType) || OPTION_NAME.test(name)) return "option";
  return null;
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

interface RowValues {
  line: number;
  rawSymbol: string;
  name: string | null;
  assetType: string;
  shares: string;
  avgCost: string | null;
  totalCost: string | null;
}

function buildRow(values: RowValues, decimalComma: boolean): ImportRow {
  const base: ImportRow = { line: values.line, rawSymbol: values.rawSymbol, symbol: null, fix: null, name: values.name, shares: null, cost: null, skip: null, error: null };
  const skip = skipReason(values.rawSymbol, values.name ?? "", values.assetType);
  if (skip) return { ...base, skip };
  const { symbol, fix } = fixSymbol(values.rawSymbol);
  const shares = parseMoney(values.shares, { decimalComma });
  if (shares !== null && shares < 0) return { ...base, symbol, fix, shares, skip: "short" };
  const avg = values.avgCost === null ? null : parseMoney(values.avgCost, { decimalComma });
  const total = values.totalCost === null ? null : parseMoney(values.totalCost, { decimalComma });
  const cost = avg !== null && avg > 0 ? avg : total !== null && total > 0 && shares !== null && shares > 0 ? total / shares : null;
  const row: ImportRow = { ...base, symbol, fix, shares: shares !== null && shares > 0 ? round(shares, 8) : null, cost: cost === null ? null : round(cost, 6) };
  if (!symbol) return { ...row, error: "symbol" };
  if (row.shares === null) return { ...row, error: "quantity" };
  if (row.cost === null) return { ...row, error: "cost" };
  return row;
}

function cellAt(cells: readonly string[], index: number | undefined): string {
  return index === undefined ? "" : (cells[index] ?? "").trim();
}

/**
 * Maps the records after the header to import rows. Records with neither a symbol nor a share count (disclaimers and
 * notes at the end of a file) are left out; every other record becomes a row, skipped or with an error if need be.
 */
export function mapRows(table: Pick<CsvTable, "rows" | "lines">, headerRow: number, mapping: ColumnMapping, options: { decimalComma?: boolean } = {}): ImportRow[] {
  const out: ImportRow[] = [];
  for (let i = headerRow + 1; i < table.rows.length; i++) {
    const cells = table.rows[i];
    const rawSymbol = cellAt(cells, mapping.symbol);
    const shares = cellAt(cells, mapping.quantity);
    const name = cellAt(cells, mapping.name) || null;
    if (!rawSymbol && !shares && !(name && TOTAL_ROW.test(name))) continue;
    out.push(
      buildRow(
        {
          line: table.lines[i] ?? i + 1,
          rawSymbol,
          name,
          assetType: cellAt(cells, mapping.assetType),
          shares,
          avgCost: mapping.avgCost === undefined ? null : cellAt(cells, mapping.avgCost),
          totalCost: mapping.totalCost === undefined ? null : cellAt(cells, mapping.totalCost),
        },
        options.decimalComma ?? false,
      ),
    );
  }
  return out;
}

export interface CsvImport {
  table: CsvTable;
  /** Null when no header was found; the columns are then read in order (symbol, shares, average cost). */
  detection: HeaderDetection | null;
}

/** Parses a positions file and finds its header and columns. */
export function readPositionsCsv(text: string): CsvImport {
  const table = parseCsv(text);
  return { table, detection: detectHeader(table.rows) };
}

/** The mapping used when a file has no header row: symbol, shares, average cost. */
export const POSITIONAL_MAPPING: ColumnMapping = { symbol: 0, quantity: 1, avgCost: 2 };

/** Splits one pasted line into fields: tabs, then semicolons or ", ", then spaces, then bare commas. */
function splitPasteLine(line: string): string[] {
  const attempts = [line.split("\t"), line.split(/\s*;\s*|,\s+/), line.trim().split(/\s+/), line.split(",")];
  for (const parts of attempts) {
    const fields = parts.map((part) => part.trim()).filter(Boolean);
    if (fields.length >= 3) return fields;
  }
  return line
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Parses pasted positions. Text with a header row (copied from a spreadsheet or a broker's positions page) goes
 * through the column mapper; otherwise each line is "symbol, shares, average cost", separated by commas, semicolons,
 * tabs or spaces ("AAPL, 25, 201.30", "0700.HK 100 320"). Blank lines and lines starting with # are ignored, and a
 * first line such as "Symbol, Shares, Cost" is treated as a header.
 */
export function parsePastedPositions(text: string): ImportRow[] {
  const clean = text.normalize("NFKC").replace(/\r\n?/g, "\n");
  if (!clean.trim()) return [];
  const delimiter = clean.includes("\t") ? "\t" : sniffDelimiter(clean);
  const table = parseCsv(clean, delimiter);
  const detection = detectHeader(table.rows);
  // A plain "Symbol, Shares, Cost" header adds nothing the line format does not already assume, and the lines under
  // it may use any separator, so only richer tables go through the mapper.
  const { symbol, quantity, avgCost, ...others } = detection?.mapping ?? {};
  const plainHeader = symbol === 0 && quantity === 1 && (avgCost === undefined || avgCost === 2) && Object.keys(others).length === 0;
  if (detection && !plainHeader) return mapRows(table, detection.headerRow, detection.mapping, { decimalComma: delimiter === ";" });

  const rows: ImportRow[] = [];
  clean.split("\n").forEach((line, index) => {
    const fields = splitPasteLine(line);
    if (fields.length === 0 || fields[0].startsWith("#")) return;
    const [rawSymbol, shares = "", cost = ""] = fields;
    if (rows.length === 0 && parseMoney(shares) === null && matchHeader(rawSymbol)?.field === "symbol") return;
    if (fields.length < 2) {
      const { symbol, fix } = fixSymbol(rawSymbol);
      rows.push({ line: index + 1, rawSymbol, symbol, fix, name: null, shares: null, cost: null, skip: null, error: "format" });
      return;
    }
    rows.push(buildRow({ line: index + 1, rawSymbol, name: null, assetType: "", shares, avgCost: cost, totalCost: null }, line.includes(";")));
  });
  return rows;
}

export interface PositionInput {
  symbol: string;
  shares: number;
  /** Average cost per share. */
  cost: number;
}

/**
 * Combines positions into holdings. A symbol that appears more than once (several accounts or lots) gets the summed
 * shares and the share-weighted average cost; `combined` lists those symbols.
 */
export function combinePositions(inputs: readonly PositionInput[]): { holdings: Holdings; combined: string[] } {
  const totals = new Map<string, { shares: number; basis: number; count: number }>();
  for (const { symbol, shares, cost } of inputs) {
    if (!(shares > 0) || !(cost > 0)) continue;
    const current = totals.get(symbol) ?? { shares: 0, basis: 0, count: 0 };
    totals.set(symbol, { shares: current.shares + shares, basis: current.basis + shares * cost, count: current.count + 1 });
  }
  const holdings: Holdings = {};
  const combined: string[] = [];
  for (const [symbol, { shares, basis, count }] of totals) {
    holdings[symbol] = { shares: round(shares, 8), cost: round(basis / shares, 6) };
    if (count > 1) combined.push(symbol);
  }
  return { holdings, combined };
}

/** Column heads of the positions CSV. English on purpose: a file format, read by spreadsheets and by this importer. */
export const POSITIONS_CSV_HEADER = ["Symbol", "Shares", "Average cost", "Currency", "Last", "Value", "Weight %", "Unrealized P&L", "Unrealized P&L %"] as const;
export const WATCHLIST_CSV_HEADER = ["Symbol", "Name", "Currency", "Last", "Change %"] as const;

/**
 * Rows of the positions CSV. With quotes, positions in the base currency come first (largest value first, with their
 * weight), then other currencies, then positions without a price; without quotes, only shares and cost are filled in.
 */
export function positionsCsvRows(holdings: Holdings, quotes: ReadonlyMap<string, QuoteLike> | null): CsvCell[][] {
  const entries = Object.entries(holdings);
  if (!quotes) return [[...POSITIONS_CSV_HEADER], ...entries.map(([symbol, p]) => [symbol, p.shares, p.cost, null, null, null, null, null, null])];
  const portfolio = valuePortfolio(
    entries.map(([symbol, p]) => ({ symbol, shares: p.shares, cost: p.cost })),
    (symbol) => quotes.get(symbol),
  );
  const priced = [...portfolio.rows, ...portfolio.foreign].map((row) => [
    row.symbol,
    row.shares,
    row.cost,
    row.currency,
    round(row.price, 4),
    round(row.value, 2),
    row.weight === null ? null : round(row.weight * 100, 2),
    round(row.pnl, 2),
    row.pnlPct === null ? null : round(row.pnlPct * 100, 2),
  ]);
  const unpriced = portfolio.unpriced.map((p) => [p.symbol, p.shares, p.cost, quotes.get(p.symbol)?.currency ?? null, null, null, null, null, null]);
  return [[...POSITIONS_CSV_HEADER], ...priced, ...unpriced];
}

export interface WatchlistQuote {
  name: string | null;
  currency: string | null;
  price: number | null;
  changePercent: number | null;
}

/** Rows of the watchlist CSV, in watchlist order; market columns stay empty without quotes. */
export function watchlistCsvRows(symbols: readonly string[], quotes: ReadonlyMap<string, WatchlistQuote> | null): CsvCell[][] {
  return [
    [...WATCHLIST_CSV_HEADER],
    ...symbols.map((symbol) => {
      const quote = quotes?.get(symbol);
      return [
        symbol,
        quote?.name ?? null,
        quote?.currency ?? null,
        quote?.price === null || quote?.price === undefined ? null : round(quote.price, 4),
        quote?.changePercent === null || quote?.changePercent === undefined ? null : round(quote.changePercent, 2),
      ];
    }),
  ];
}

/** A small file with the columns the importer reads and three example rows. */
export const POSITIONS_TEMPLATE_ROWS: CsvCell[][] = [
  ["Symbol", "Shares", "Average cost"],
  ["AAPL", "25", "201.30"],
  ["MSFT", "10", "415.00"],
  ["0700.HK", "100", "320.00"],
];
