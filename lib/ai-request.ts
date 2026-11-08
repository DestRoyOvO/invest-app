// What the chat sends with each question (pure): which view the open page maps to, which of the investor's positions
// go along (only while "Include my positions" is on), and how the page is labelled in the conversation.

import { getSector, MAX_WATCHLIST } from "@/lib/universe";
import type { ChatIntentInput, ChatRequest, Lang, PositionInput, SectorKey } from "@/types/api";

import type { ChatContextRef } from "./ai-store";
import { normalizeSymbol } from "./symbols";

export type ChatView = ChatRequest["context"]["view"];

export interface PageContext {
  view: ChatView;
  symbol?: string;
  sector?: SectorKey;
  /** The portfolio page: the watchlist view with every position. */
  portfolio?: boolean;
}

export type HoldingsLike = Readonly<Record<string, { shares: number; cost: number }>>;

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The chat view for a path: quote pages, sector pages, the watchlist and portfolio, or the market for anything else. */
export function pageContextFromPath(pathname: string): PageContext {
  const stock = /^\/stock\/([^/?#]+)/.exec(pathname);
  if (stock) {
    const symbol = normalizeSymbol(decode(stock[1]));
    if (symbol) return { view: "stock", symbol };
  }
  const sector = /^\/sector\/([^/?#]+)/.exec(pathname);
  if (sector && getSector(sector[1])) return { view: "sector", sector: sector[1] as SectorKey };
  if (pathname.startsWith("/watchlist")) return { view: "watchlist" };
  if (pathname.startsWith("/portfolio")) return { view: "watchlist", portfolio: true };
  return { view: "market" };
}

/** Positions for an AI request: the largest by cost basis, at most the schema's limit. */
export function positionsForAi(holdings: HoldingsLike, limit: number = MAX_WATCHLIST): PositionInput[] {
  return Object.entries(holdings)
    .map(([symbol, position]) => ({ symbol, shares: position.shares, cost: position.cost }))
    .filter((position) => position.shares > 0 && position.cost > 0)
    .sort((a, b) => b.shares * b.cost - a.shares * a.cost || a.symbol.localeCompare(b.symbol))
    .slice(0, limit);
}

export interface ChatContextInput {
  page: PageContext;
  watchlist: readonly string[];
  holdings: HoldingsLike;
  includePositions: boolean;
  intent?: ChatIntentInput;
}

/**
 * The context of a chat request. Positions go along only when allowed: all of them on the watchlist, market and
 * sector views (the server turns them into a portfolio summary on the last two), only the symbol's own position on the
 * stock view.
 */
export function chatRequestContext({ page, watchlist, holdings, includePositions, intent }: ChatContextInput): ChatRequest["context"] {
  const all = includePositions ? positionsForAi(holdings) : [];
  const withPositions = <T extends object>(context: T, positions: PositionInput[]) => (positions.length > 0 ? { ...context, positions } : context);
  let context: ChatRequest["context"];
  if (page.view === "stock" && page.symbol) {
    const own = includePositions ? all.filter((position) => position.symbol === page.symbol) : [];
    context = withPositions({ view: "stock" as const, symbol: page.symbol }, own);
  } else if (page.view === "sector" && page.sector) {
    context = withPositions({ view: "sector" as const, sector: page.sector }, all);
  } else if (page.view === "watchlist") {
    context = withPositions({ view: "watchlist" as const, symbols: watchlist.slice(0, MAX_WATCHLIST) }, all);
  } else {
    context = withPositions({ view: "market" as const }, all);
  }
  return intent ? { ...context, intent } : context;
}

export interface ContextLabels {
  market: string;
  watchlist: string;
  portfolio: string;
}

/** A stable key and a reader-facing label for the page, used for the "Now viewing" divider. */
export function contextRef(page: PageContext, lang: Lang, labels: ContextLabels): ChatContextRef {
  if (page.view === "stock" && page.symbol) return { key: `stock:${page.symbol}`, label: page.symbol };
  if (page.view === "sector" && page.sector) return { key: `sector:${page.sector}`, label: getSector(page.sector)?.label[lang] ?? page.sector };
  if (page.view === "watchlist") return page.portfolio ? { key: "portfolio", label: labels.portfolio } : { key: "watchlist", label: labels.watchlist };
  return { key: "market", label: labels.market };
}
