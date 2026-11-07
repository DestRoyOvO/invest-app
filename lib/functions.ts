// The function registry: every page and panel that the command bar, the navigation, the keyboard and /help can reach,
// each with a Bloomberg-style code ("WL", "NVDA GP"). Pure, so the parser is unit tested and shared by the shell, the
// help page and the 404 page. Labels and descriptions live in lib/i18n/help.ts under help.functions[labelKey].
//
// Grammar accepted by parseCommand:
//   CODE            a global function ("PORT"), or a security function for the last viewed symbol ("GP")
//   TICKER CODE     a security function for that symbol ("NVDA GP"); CODE TICKER works too ("GP NVDA")
//   COMP A B C      compare A with B and C on the chart of A
//   ?question       ask the assistant
// A token can be a code, an alias ("chart", "图表", "EXPORT") or, for symbols, a Chinese company name ("英伟达").

import { stockPath } from "@/lib/api-client";
import type { helpMessages } from "@/lib/i18n/help";
import { CHINESE_NAMES, hasCjk } from "@/lib/names-zh";
import { normalizeSymbol } from "@/lib/symbols";
import { SECTOR_KEYS } from "@/lib/universe";

export type FunctionScope = "global" | "security";
export type FunctionGroup = "markets" | "portfolio" | "research" | "tools";
export type FunctionLabelKey = keyof typeof helpMessages.en.functions;

export const FUNCTION_GROUPS: readonly FunctionGroup[] = ["markets", "portfolio", "research", "tools"];

/** The symbol security functions fall back to when nothing was viewed yet (matches hooks/useLastSymbol.ts). */
export const DEFAULT_SYMBOL = "AAPL";
export const DEFAULT_SECTOR = "technology";

export interface HrefContext {
  /** Symbols to compare with the first one (COMP). */
  compare?: readonly string[];
  /** The last sector the reader opened (SECT). */
  lastSector?: string | null;
}

export interface FunctionDef {
  /** 2 to 4 capital letters, typed into the command bar and shown in panel headers. */
  code: string;
  /** English and Chinese words that also name the function, matched case-insensitively. */
  aliases: readonly string[];
  /** Security functions need a symbol and fall back to the last viewed one. */
  scope: FunctionScope;
  group: FunctionGroup;
  /** Unique key; the label and description are help.functions[labelKey] in the messages. */
  labelKey: FunctionLabelKey;
  /** Keyboard sequence, e.g. "g p". */
  shortcut?: string;
  href: (symbol?: string, context?: HrefContext) => string;
}

function sectorKey(value: string | null | undefined): string {
  return value && (SECTOR_KEYS as readonly string[]).includes(value) ? value : DEFAULT_SECTOR;
}

const stock =
  (suffix = "") =>
  (symbol: string = DEFAULT_SYMBOL) =>
    `${stockPath(symbol)}${suffix}`;
const page = (path: string) => () => path;

const NOTE_ALIASES = ["notes", "note", "thesis", "journal", "笔记", "投资笔记", "论点"];

/** Every function, in the order /help lists them within a group. */
export const FUNCTIONS: readonly FunctionDef[] = [
  // Markets
  { code: "MKT", labelKey: "mkt", scope: "global", group: "markets", shortcut: "g m", href: page("/"), aliases: ["market", "home", "overview", "市场", "总览", "首页", "大盘"] },
  {
    code: "WEI",
    labelKey: "wei",
    scope: "global",
    group: "markets",
    shortcut: "g x",
    href: page("/markets"),
    aliases: ["world", "world markets", "global", "indices", "全球", "全球市场", "指数"],
  },
  {
    code: "GC",
    labelKey: "gc",
    scope: "global",
    group: "markets",
    shortcut: "g r",
    href: page("/markets#rates"),
    aliases: ["rates", "yields", "curve", "yield curve", "treasury", "bonds", "利率", "收益率", "收益率曲线", "国债"],
  },
  {
    code: "SECT",
    labelKey: "sect",
    scope: "global",
    group: "markets",
    shortcut: "g s",
    href: (_symbol, context) => `/sector/${sectorKey(context?.lastSector)}`,
    aliases: ["sectors", "sector", "板块", "行业"],
  },
  {
    code: "EQS",
    labelKey: "eqs",
    scope: "global",
    group: "markets",
    shortcut: "g f",
    href: page("/screener"),
    aliases: ["screener", "screen", "filter", "筛选", "筛选器", "选股"],
  },
  {
    code: "MOST",
    labelKey: "most",
    scope: "global",
    group: "markets",
    shortcut: "g t",
    href: page("/screener?tab=discover"),
    aliases: ["movers", "most active", "gainers", "losers", "discover", "trending", "异动", "涨幅榜", "跌幅榜", "热门", "发现"],
  },
  // Portfolio
  { code: "WL", labelKey: "wl", scope: "global", group: "portfolio", shortcut: "g w", href: page("/watchlist"), aliases: ["watchlist", "watch", "自选", "自选股", "关注"] },
  {
    code: "PORT",
    labelKey: "port",
    scope: "global",
    group: "portfolio",
    shortcut: "g p",
    href: page("/portfolio"),
    aliases: ["portfolio", "positions", "holdings", "组合", "持仓", "组合分析"],
  },
  { code: "CORR", labelKey: "corr", scope: "global", group: "portfolio", href: page("/portfolio?tab=correlation"), aliases: ["correlation", "correlations", "相关性", "相关"] },
  {
    code: "EVTS",
    labelKey: "evts",
    scope: "global",
    group: "portfolio",
    shortcut: "g e",
    href: page("/calendar"),
    aliases: ["events", "calendar", "earnings calendar", "日历", "财经日历", "事件"],
  },
  { code: "ALRT", labelKey: "alrt", scope: "global", group: "portfolio", shortcut: "g a", href: page("/alerts"), aliases: ["alerts", "alert", "alarm", "提醒", "预警"] },
  { code: "NOTE", labelKey: "notes", scope: "global", group: "portfolio", shortcut: "g n", href: page("/notes"), aliases: NOTE_ALIASES },
  // Research
  { code: "QT", labelKey: "qt", scope: "security", group: "research", shortcut: "g q", href: stock(), aliases: ["quote", "个股", "报价"] },
  { code: "DES", labelKey: "des", scope: "security", group: "research", href: stock(), aliases: ["description", "company", "profile", "公司", "简介", "概况"] },
  { code: "GP", labelKey: "gp", scope: "security", group: "research", href: stock("#chart"), aliases: ["chart", "graph", "price chart", "图表", "走势", "k线"] },
  {
    code: "FA",
    labelKey: "fa",
    scope: "security",
    group: "research",
    href: stock("?tab=financials"),
    aliases: ["financials", "fundamentals", "statements", "财务", "财务数据", "基本面"],
  },
  { code: "ERN", labelKey: "ern", scope: "security", group: "research", href: stock("?tab=earnings"), aliases: ["earnings", "eps", "财报", "业绩"] },
  {
    code: "ANR",
    labelKey: "anr",
    scope: "security",
    group: "research",
    href: stock("?tab=analysts"),
    aliases: ["analysts", "ratings", "targets", "分析师", "评级", "目标价"],
  },
  { code: "DVD", labelKey: "dvd", scope: "security", group: "research", href: stock("?tab=dividends"), aliases: ["dividends", "dividend", "股息", "分红", "派息"] },
  {
    code: "HDS",
    labelKey: "hds",
    scope: "security",
    group: "research",
    href: stock("?tab=ownership"),
    aliases: ["holders", "ownership", "insiders", "institutions", "持股", "股东", "机构持股", "内部人"],
  },
  { code: "RISK", labelKey: "risk", scope: "security", group: "research", href: stock("#risk"), aliases: ["risk", "volatility", "beta", "风险", "波动", "波动率"] },
  { code: "NOTE", labelKey: "noteSymbol", scope: "security", group: "research", href: stock("#notes"), aliases: NOTE_ALIASES },
  {
    code: "COMP",
    labelKey: "comp",
    scope: "security",
    group: "research",
    href: (symbol = DEFAULT_SYMBOL, context) => {
      const others = (context?.compare ?? []).filter((s) => s !== symbol);
      return others.length > 0 ? `${stockPath(symbol)}?compare=${others.map(encodeURIComponent).join(",")}` : `${stockPath(symbol)}#chart`;
    },
    aliases: ["compare", "comparison", "vs", "对比", "比较"],
  },
  {
    code: "LAB",
    labelKey: "lab",
    scope: "global",
    group: "research",
    shortcut: "g l",
    href: page("/lab"),
    aliases: ["lab", "factors", "factor lab", "backtest", "实验室", "因子", "回测"],
  },
  // Tools
  {
    code: "DATA",
    labelKey: "data",
    scope: "global",
    group: "tools",
    shortcut: "g d",
    href: page("/data"),
    aliases: ["EXPORT", "IMPORT", "BACKUP", "data", "restore", "csv", "数据", "导出", "导入", "备份", "恢复"],
  },
  {
    code: "HELP",
    labelKey: "help",
    scope: "global",
    group: "tools",
    shortcut: "g h",
    href: page("/help"),
    aliases: ["help", "docs", "manual", "shortcuts", "帮助", "说明", "快捷键"],
  },
];

/** The navigation rail: the functions each group shows, in order. */
export const NAV_LAYOUT: Readonly<Record<FunctionGroup, readonly FunctionLabelKey[]>> = {
  markets: ["mkt", "wei", "sect", "eqs"],
  portfolio: ["wl", "port", "evts", "alrt", "notes"],
  research: ["qt", "lab"],
  tools: ["data", "help"],
};

const BY_KEY = new Map(FUNCTIONS.map((fn) => [fn.labelKey, fn]));

export function functionByKey(key: FunctionLabelKey): FunctionDef {
  const fn = BY_KEY.get(key);
  if (!fn) throw new Error(`Unknown function ${key}`);
  return fn;
}

const aliasKey = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
const compactKey = (text: string) => aliasKey(text).replace(/\s+/g, "");

const BY_CODE = new Map<string, FunctionDef[]>();
const BY_ALIAS = new Map<string, FunctionDef[]>();
for (const fn of FUNCTIONS) {
  BY_CODE.set(fn.code, [...(BY_CODE.get(fn.code) ?? []), fn]);
  for (const alias of fn.aliases) {
    const key = aliasKey(alias);
    const list = BY_ALIAS.get(key) ?? [];
    if (!list.includes(fn)) BY_ALIAS.set(key, [...list, fn]);
  }
}

/** The functions a code names: one, or two for NOTE (all notes, or the notes of one symbol). */
export function functionsByCode(code: string): readonly FunctionDef[] {
  return BY_CODE.get(code.trim().toUpperCase()) ?? [];
}

/** "g p" -> ["G", "P"], for key caps. */
export function shortcutKeys(shortcut: string | undefined): string[] {
  return shortcut ? shortcut.split(" ").filter(Boolean).map((key) => key.toUpperCase()) : [];
}

/** Second key of each "g" sequence -> its function. */
export const GO_SHORTCUTS: ReadonlyMap<string, FunctionDef> = new Map(
  FUNCTIONS.flatMap((fn) => {
    const [first, second] = fn.shortcut?.split(" ") ?? [];
    return first === "g" && second ? [[second, fn] as const] : [];
  }),
);

/** Path part of a route ("/portfolio?tab=correlation" -> "/portfolio"; security functions -> "/stock"). */
export function functionBasePath(fn: FunctionDef): string {
  if (fn.scope === "security") return "/stock";
  if (fn.labelKey === "sect") return "/sector";
  return fn.href().split(/[?#]/)[0] || "/";
}

/** True when the pathname is the page of the function (the active navigation item). */
export function isFunctionActive(fn: FunctionDef, pathname: string): boolean {
  const base = functionBasePath(fn);
  if (base === "/") return pathname === "/";
  return pathname === base || pathname.startsWith(`${base}/`);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export interface ParseContext {
  /** Symbol for a security code typed alone. */
  lastSymbol: string;
  lastSector?: string | null;
  /** Symbols known to exist (search results, the universe, the watchlist): a code that is also one offers both. */
  isKnownTicker?: (symbol: string) => boolean;
}

/** How a function was named: 0 exact code or grammar, 1 exact alias, 2 code prefix, 3 alias prefix, 4 alias substring. */
export type MatchRank = 0 | 1 | 2 | 3 | 4;

export interface FunctionMatch {
  kind: "function";
  fn: FunctionDef;
  /** The subject of a security function; null for global functions. */
  symbol: string | null;
  /** Further symbols for COMP. */
  compare: string[];
  /** True when the symbol is the last viewed one, not one that was typed. */
  usesLastSymbol: boolean;
  rank: MatchRank;
  href: string;
}

export interface SymbolMatch {
  kind: "symbol";
  symbol: string;
}

export interface AskMatch {
  kind: "ask";
  question: string;
}

export type CommandMatch = FunctionMatch | SymbolMatch | AskMatch;

const CHINESE_EXACT = new Map<string, string>();
for (const entry of CHINESE_NAMES) {
  for (const name of entry.names) {
    const key = compactKey(name);
    if (hasCjk(key) && !CHINESE_EXACT.has(key)) CHINESE_EXACT.set(key, entry.symbol);
  }
}

/** A typed symbol, or the symbol behind an exact Chinese company name ("英伟达" -> NVDA). */
export function symbolOfToken(token: string): string | null {
  if (hasCjk(token)) return CHINESE_EXACT.get(compactKey(token)) ?? null;
  return normalizeSymbol(token);
}

interface Named {
  defs: readonly FunctionDef[];
  rank: 0 | 1;
}

function named(token: string): Named | null {
  const byCode = BY_CODE.get(token.trim().toUpperCase());
  if (byCode) return { defs: byCode, rank: 0 };
  const byAlias = BY_ALIAS.get(aliasKey(token));
  return byAlias ? { defs: byAlias, rank: 1 } : null;
}

/** A function as a command-bar candidate: its href for the symbol (or the last one) and how it was named. */
export function functionMatch(fn: FunctionDef, rank: MatchRank, ctx: ParseContext, symbol: string | null, compare: string[] = []): FunctionMatch {
  if (fn.scope === "global") {
    return { kind: "function", fn, symbol: null, compare: [], usesLastSymbol: false, rank, href: fn.href(undefined, { lastSector: ctx.lastSector }) };
  }
  const subject = symbol ?? ctx.lastSymbol;
  return {
    kind: "function",
    fn,
    symbol: subject,
    compare,
    usesLastSymbol: symbol === null,
    rank,
    href: fn.href(subject, { compare, lastSector: ctx.lastSector }),
  };
}

/** A name typed alone: global functions as they are, security functions for the last symbol (global wins for NOTE). */
function standalone(match: Named, ctx: ParseContext): FunctionMatch[] {
  const globals = match.defs.filter((fn) => fn.scope === "global");
  const chosen = globals.length > 0 ? globals : match.defs;
  return chosen.map((fn) => functionMatch(fn, match.rank, ctx, null));
}

function partialMatches(token: string, ctx: ParseContext, symbol: string | null): FunctionMatch[] {
  const code = token.toUpperCase();
  const word = aliasKey(token);
  const out: FunctionMatch[] = [];
  for (const fn of FUNCTIONS) {
    if (symbol !== null && fn.scope === "global") continue;
    let rank: MatchRank | null = null;
    if (/^[A-Z]{1,4}$/.test(code) && fn.code.startsWith(code)) rank = 2;
    else if (word.length >= 2 && fn.aliases.some((alias) => aliasKey(alias).startsWith(word))) rank = 3;
    else if (word.length >= 3 && fn.aliases.some((alias) => aliasKey(alias).includes(word))) rank = 4;
    if (rank !== null) out.push(functionMatch(fn, rank, ctx, symbol));
  }
  return out;
}

function sameMatch(a: CommandMatch, b: CommandMatch): boolean {
  if (a.kind === "function" && b.kind === "function") return a.fn === b.fn && a.href === b.href;
  if (a.kind === "symbol" && b.kind === "symbol") return a.symbol === b.symbol;
  return false;
}

function rankOf(match: CommandMatch): number {
  // A known ticker that is also a code comes right after the exact function matches.
  return match.kind === "function" ? match.rank : match.kind === "symbol" ? 0.5 : -1;
}

/**
 * Turns command-bar input into ranked candidates: functions first (exact codes and the TICKER CODE grammar, then exact
 * aliases, then partial matches), plus the ticker itself when a code is also a known ticker ("LAB"). Symbol search
 * and the watchlist actions are left to the command bar.
 */
export function parseCommand(input: string, ctx: ParseContext): CommandMatch[] {
  const text = input.trim();
  if (!text) return [];
  if (text.startsWith("?") || text.startsWith("？")) {
    const question = text.slice(1).trim();
    return question ? [{ kind: "ask", question }] : [];
  }

  const tokens = text.split(/[\s,，]+/).filter(Boolean);
  const out: Array<{ match: CommandMatch; order: number }> = [];
  let order = 0;
  const push = (match: CommandMatch, weight = 0) => out.push({ match, order: weight * 1000 + order++ });

  const whole = tokens.length > 1 ? BY_ALIAS.get(aliasKey(text)) : undefined;
  if (tokens.length === 1 || whole) {
    const match = whole ? { defs: whole, rank: 1 as const } : named(tokens[0]);
    if (match) {
      for (const fn of standalone(match, ctx)) push(fn);
      const symbol = tokens.length === 1 ? normalizeSymbol(tokens[0]) : null;
      if (symbol && match.rank === 0 && ctx.isKnownTicker?.(symbol)) push({ kind: "symbol", symbol });
    } else {
      for (const fn of partialMatches(tokens[0], ctx, null)) push(fn);
    }
  } else {
    // One token names the function and the others are symbols. TICKER CODE (code last) ranks before CODE TICKER.
    tokens.forEach((token, index) => {
      const match = named(token);
      if (!match) return;
      const symbols = tokens.filter((_, i) => i !== index).map(symbolOfToken);
      if (symbols.some((symbol) => symbol === null)) return;
      const [subject, ...rest] = symbols as string[];
      const security = match.defs.find((fn) => fn.scope === "security");
      const fn = security ?? match.defs[0];
      const weight = index === tokens.length - 1 ? 0 : 1;
      push(functionMatch(fn, match.rank, ctx, security ? subject : null, security?.code === "COMP" ? rest : []), weight);
    });
    // Still typing the code after a ticker: "NVDA F" offers FA and the other F codes for NVDA.
    if (out.length === 0 && tokens.length === 2) {
      const subject = symbolOfToken(tokens[0]);
      if (subject) for (const fn of partialMatches(tokens[1], ctx, subject)) push(fn);
    }
  }

  const ranked = out.sort((a, b) => rankOf(a.match) - rankOf(b.match) || a.order - b.order).map((entry) => entry.match);
  return ranked.filter((match, index) => ranked.findIndex((other) => sameMatch(match, other)) === index);
}

// ---------------------------------------------------------------------------
// Suggestions for an unknown path (the 404 page)
// ---------------------------------------------------------------------------

/** Levenshtein distance, giving up early (returns cap + 1) once the strings are further apart than the cap. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      best = Math.min(best, current[j]);
    }
    if (best > cap) return cap + 1;
    previous = current;
  }
  return Math.min(previous[b.length], cap + 1);
}

export interface PathSuggestions {
  functions: FunctionMatch[];
  /** A ticker-like path segment ("/nvda"), offered as "Open NVDA". */
  symbol: string | null;
}

const FALLBACK_SUGGESTIONS: readonly FunctionLabelKey[] = ["mkt", "wl", "help"];

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** 0 when the word names the function, 1 to 3 when it is close to its route, code or an alias, Infinity otherwise. */
function pathScore(word: string, fn: FunctionDef): number {
  const names = [functionBasePath(fn).slice(1), fn.code.toLowerCase(), ...fn.aliases.map(aliasKey)].filter((name) => name.length >= 2 && !name.includes(" "));
  let best = Infinity;
  for (const name of names) {
    if (name === word) return 0;
    if (word.length >= 3 && (name.startsWith(word) || word.startsWith(name))) best = Math.min(best, 1);
    const distance = editDistance(word, name, 2);
    // One edit for short names, two from 8 letters (editDistance returns 3 for anything further).
    if (distance <= Math.min(2, Math.max(1, Math.floor(name.length / 4)))) best = Math.min(best, 1 + distance);
  }
  return best;
}

/**
 * For an unknown path: functions whose route, code or alias is close to one of its segments, best first (the market,
 * watchlist and help when nothing is close), and a ticker-like segment to offer as a quote ("/nvda").
 */
export function suggestForPath(pathname: string, ctx: ParseContext, limit = 4): PathSuggestions {
  const segments = pathname.split("/").filter(Boolean).map(safeDecode).slice(0, 3);
  const scored = new Map<FunctionDef, number>();
  for (const segment of segments) {
    const word = segment.toLowerCase();
    if (word.length < 2) continue;
    for (const fn of FUNCTIONS) {
      if (fn.scope === "security" && fn.labelKey !== "qt") continue;
      const score = pathScore(word, fn);
      if (score < (scored.get(fn) ?? Infinity)) scored.set(fn, score);
    }
  }
  const functions = [...scored]
    .filter(([, score]) => Number.isFinite(score))
    .sort((a, b) => a[1] - b[1] || FUNCTIONS.indexOf(a[0]) - FUNCTIONS.indexOf(b[0]))
    .slice(0, limit)
    .map(([fn]) => functionMatch(fn, 2, ctx, null));

  // A short segment that is not itself a function name reads as a ticker ("/nvda", "/stocks/aapl").
  const tickerLike = [...segments]
    .reverse()
    .find((segment) => /^[A-Za-z][A-Za-z0-9.-]{0,5}$/.test(segment) && FUNCTIONS.every((fn) => pathScore(segment.toLowerCase(), fn) > 0));
  return {
    functions: functions.length > 0 ? functions : FALLBACK_SUGGESTIONS.map((key) => functionMatch(functionByKey(key), 2, ctx, null)),
    symbol: tickerLike ? normalizeSymbol(tickerLike) : null,
  };
}
