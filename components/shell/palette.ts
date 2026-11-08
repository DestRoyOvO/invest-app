// What the command bar lists for a query, as plain data (the component maps items to icons, labels and actions).
// Pure, so the ranking is unit tested.
//
// Empty query: recent symbols, the watchlist, then every function. Otherwise: exact function matches (codes, aliases
// and the TICKER CODE grammar) lead; an exact symbol gets its actions (open, watchlist, position, alert, why is it
// moving), or only "open" when it is also a function code (GP, LAB); then other symbols (Yahoo search, or local
// Chinese names), partial function matches, sectors and settings.

import { FUNCTIONS, functionByKey, functionMatch, parseCommand, symbolOfToken, type FunctionMatch } from "@/lib/functions";
import { CHINESE_NAMES, chineseNameOf, hasCjk, searchChineseNames } from "@/lib/names-zh";
import type { Density, Theme, UpDown } from "@/lib/prefs";
import { normalizeSymbol } from "@/lib/symbols";
import { BROAD_ETFS, MARKET_BOARD, SECTORS, UNIVERSE_STOCKS } from "@/lib/universe";
import type { SectorKey, SymbolSearchResult } from "@/types/api";

export type PaletteSection = "ask" | "functions" | "actions" | "symbols" | "recents" | "watchlist" | "sectors" | "settings";
export type SymbolAction = "open" | "watch" | "unwatch" | "position" | "alert" | "why";
export type SettingChoice = { kind: "lang" } | { kind: "theme"; value: Theme } | { kind: "updown"; value: UpDown } | { kind: "density"; value: Density };

export type PaletteItem =
  | { id: string; section: "ask"; kind: "ask"; question: string }
  | { id: string; section: "functions"; kind: "function"; match: FunctionMatch }
  | { id: string; section: "actions"; kind: "action"; action: SymbolAction; symbol: string; name: string | null }
  | { id: string; section: "symbols" | "recents" | "watchlist"; kind: "symbol"; symbol: string; name: string | null; detail: string | null }
  | { id: string; section: "sectors"; kind: "sector"; key: SectorKey }
  | { id: string; section: "settings"; kind: "setting"; choice: SettingChoice };

export interface PaletteInput {
  query: string;
  lastSymbol: string;
  lastSector: string | null;
  recents: readonly string[];
  watchlist: readonly string[];
  /** Yahoo results for exactly this query; null while loading or when the query is not searched. */
  results: readonly SymbolSearchResult[] | null;
}

export const MAX_PALETTE_RECENTS = 8;
export const MAX_PALETTE_WATCHLIST = 10;

/** Symbols the app knows exist without asking Yahoo: the stock universe, broad ETFs, the board and named stocks. */
const LOCAL_SYMBOLS: ReadonlySet<string> = new Set([
  ...UNIVERSE_STOCKS,
  ...BROAD_ETFS,
  ...SECTORS.map((s) => s.etf),
  ...MARKET_BOARD.map((b) => b.symbol),
  ...CHINESE_NAMES.map((entry) => entry.symbol),
]);

const SETTINGS: ReadonlyArray<{ choice: SettingChoice; aliases: readonly string[] }> = [
  { choice: { kind: "lang" }, aliases: ["language", "lang", "english", "chinese", "中文", "英文", "语言"] },
  { choice: { kind: "theme", value: "dark" }, aliases: ["theme", "dark", "主题", "深色", "暗色"] },
  { choice: { kind: "theme", value: "light" }, aliases: ["theme", "light", "主题", "浅色", "亮色"] },
  { choice: { kind: "theme", value: "system" }, aliases: ["theme", "system", "auto", "主题", "跟随系统", "系统"] },
  { choice: { kind: "updown", value: "intl" }, aliases: ["colors", "green up", "颜色", "涨跌颜色", "绿涨"] },
  { choice: { kind: "updown", value: "cn" }, aliases: ["colors", "red up", "颜色", "涨跌颜色", "红涨"] },
  { choice: { kind: "updown", value: "cb" }, aliases: ["colors", "color-blind", "colorblind", "颜色", "涨跌颜色", "色弱"] },
  { choice: { kind: "density", value: "comfortable" }, aliases: ["density", "comfortable", "密度", "舒适"] },
  { choice: { kind: "density", value: "compact" }, aliases: ["density", "compact", "密度", "紧凑"] },
];

function settingId(choice: SettingChoice): string {
  return choice.kind === "lang" ? "set:lang" : `set:${choice.kind}:${choice.value}`;
}

function aliasMatches(query: string, aliases: readonly string[]): boolean {
  const q = query.toLowerCase();
  return aliases.some((alias) => {
    const a = alias.toLowerCase();
    return a.startsWith(q) || (q.length >= 3 && a.includes(q));
  });
}

function functionItem(match: FunctionMatch): PaletteItem {
  return { id: `fn:${match.fn.labelKey}:${match.symbol ?? ""}:${match.compare.join(",")}`, section: "functions", kind: "function", match };
}

/** True when the query should go to Yahoo search: Latin text that is not a question or a code with symbols. */
export function shouldSearch(query: string): boolean {
  const q = query.trim();
  if (!q || q.startsWith("?") || q.startsWith("？") || hasCjk(q)) return false;
  const tokens = q.split(/[\s,，]+/).filter(Boolean);
  if (tokens.length < 2) return true;
  // "NVDA GP" or "COMP AAPL MSFT": the parser handles it, a company-name search would only add noise.
  return !parseCommand(q, { lastSymbol: "" }).some((match) => match.kind === "function" && match.rank <= 1);
}

function emptyQuery(input: PaletteInput): PaletteItem[] {
  const items: PaletteItem[] = [];
  const recents = input.recents.slice(0, MAX_PALETTE_RECENTS);
  for (const symbol of recents) items.push({ id: `recent:${symbol}`, section: "recents", kind: "symbol", symbol, name: null, detail: null });
  for (const symbol of input.watchlist.filter((s) => !recents.includes(s)).slice(0, MAX_PALETTE_WATCHLIST)) {
    items.push({ id: `wl:${symbol}`, section: "watchlist", kind: "symbol", symbol, name: null, detail: null });
  }
  const ctx = { lastSymbol: input.lastSymbol, lastSector: input.lastSector };
  const quote = functionByKey("qt");
  for (const fn of FUNCTIONS) {
    if (fn.scope === "global" || fn === quote) items.push(functionItem(functionMatch(fn, 0, ctx, null)));
  }
  return items;
}

/** The items for a query, in display order. */
export function buildPalette(input: PaletteInput): PaletteItem[] {
  const query = input.query.trim();
  if (!query) return emptyQuery(input);

  const results = input.results ?? [];
  const known = (symbol: string) => LOCAL_SYMBOLS.has(symbol) || input.watchlist.includes(symbol) || input.recents.includes(symbol) || results.some((r) => r.symbol === symbol);
  const matches = parseCommand(query, { lastSymbol: input.lastSymbol, lastSector: input.lastSector, isKnownTicker: known });

  const ask = matches.find((match) => match.kind === "ask");
  if (ask) return [{ id: "ask", section: "ask", kind: "ask", question: ask.question }];

  const functions = matches.filter((match): match is FunctionMatch => match.kind === "function");
  const exactFunctions = functions.filter((match) => match.rank <= 1);
  const partialFunctions = functions.filter((match) => match.rank >= 2);

  // The symbol the query names exactly: a search hit, a known ticker that is not only a function code, or a Chinese name.
  const single = query.split(/[\s,，]+/).filter(Boolean).length === 1;
  const typed = single ? normalizeSymbol(query) : null;
  let exact: { symbol: string; name: string | null } | null = null;
  if (single && hasCjk(query)) {
    const symbol = symbolOfToken(query);
    if (symbol) exact = { symbol, name: chineseNameOf(symbol) ?? null };
  } else if (typed) {
    const hit = results.find((r) => r.symbol === typed);
    if (hit) exact = { symbol: typed, name: hit.name };
    else if (known(typed) && exactFunctions.length === 0) exact = { symbol: typed, name: null };
  }

  // A ticker that is also a function code only gets "open" under the function: enough to offer both readings.
  const target = exact;
  const actions: readonly SymbolAction[] = !target
    ? []
    : exactFunctions.length > 0
      ? ["open"]
      : ["open", input.watchlist.includes(target.symbol) ? "unwatch" : "watch", "position", "alert", "why"];
  const actionItems: PaletteItem[] = target
    ? actions.map((action) => ({
        id: `act:${action}:${target.symbol}`,
        section: "actions" as const,
        kind: "action" as const,
        action,
        symbol: target.symbol,
        name: action === "open" ? target.name : null,
      }))
    : [];

  const symbolItems: PaletteItem[] = [];
  const exactSymbol = exact?.symbol;
  if (hasCjk(query)) {
    for (const hit of searchChineseNames(query, 8)) {
      if (hit.symbol !== exactSymbol) symbolItems.push({ id: `sym:${hit.symbol}`, section: "symbols", kind: "symbol", symbol: hit.symbol, name: hit.name, detail: null });
    }
  } else {
    for (const hit of results) {
      if (hit.symbol === exactSymbol) continue;
      const detail = [hit.exchange, hit.type].filter(Boolean).join(" · ") || null;
      symbolItems.push({ id: `sym:${hit.symbol}`, section: "symbols", kind: "symbol", symbol: hit.symbol, name: hit.name, detail });
    }
    // A plausible ticker nobody has confirmed yet: open it directly while the search runs, or when the search found
    // nothing (the bar then also says there is no match). Once Yahoo lists other symbols, the typed text is left out.
    if (typed && !exact && exactFunctions.length === 0 && results.length === 0) {
      symbolItems.push({ id: `sym:${typed}`, section: "symbols", kind: "symbol", symbol: typed, name: null, detail: null });
    }
  }

  const sectorItems: PaletteItem[] =
    query.length >= 2
      ? SECTORS.filter((sector) => aliasMatches(query, [sector.key, sector.label.en, sector.label.zh, sector.short.en, sector.short.zh, sector.etf])).map(
          (sector) => ({ id: `sector:${sector.key}`, section: "sectors" as const, kind: "sector" as const, key: sector.key }),
        )
      : [];

  const settingItems: PaletteItem[] =
    query.length >= 2
      ? SETTINGS.filter((setting) => aliasMatches(query, setting.aliases)).map((setting) => ({
          id: settingId(setting.choice),
          section: "settings" as const,
          kind: "setting" as const,
          choice: setting.choice,
        }))
      : [];

  const exactItems = exactFunctions.map(functionItem);
  const partialItems = partialFunctions.map(functionItem);
  const ordered =
    exactItems.length > 0
      ? [...exactItems, ...partialItems, ...actionItems, ...symbolItems]
      : exact
        ? [...actionItems, ...symbolItems, ...partialItems]
        : [...partialItems, ...symbolItems];
  const all = [...ordered, ...sectorItems, ...settingItems];
  return all.filter((item, index) => all.findIndex((other) => other.id === item.id) === index);
}
