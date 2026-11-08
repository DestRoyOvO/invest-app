// Page-aware questions for the chat: starters when a conversation is empty and two or three follow-ups after an
// answer. They are built from data the page already has (no extra requests) and are always questions about facts,
// never advice ("Why is NVDA down 3.1% today?", never "Should I sell NVDA?"). Pure; the strings come from lib/i18n.

import { daysUntil } from "@/lib/ai-format";
import { displayedSign, formatShortDate, tpl } from "@/lib/format";
import { getSector, sectorOfSymbol } from "@/lib/universe";
import type { ChatIntentInput, Lang } from "@/types/api";

import type { PageContext } from "./ai-request";

export interface SuggestionMessages {
  whyMove: string;
  whatMoved: string;
  up: string;
  down: string;
  today: string;
  lastSession: string;
  earnings: string;
  position: string;
  bullBear: string;
  compare: string;
  and: string;
  risk: string;
  changeView: string;
  portfolioDay: string;
  concentration: string;
  reports: string;
  watchlistReports: string;
  portfolioRisk: string;
  riskContributor: string;
  watchlistDay: string;
  watchlistMix: string;
  marketDay: string;
  rotation: string;
  headlines: string;
  marketRisks: string;
  portfolioOnMarket: string;
  sectorDay: string;
  sectorLeaders: string;
  sectorVsMarket: string;
  sectorRisks: string;
}

export interface Suggestion {
  text: string;
  /** Sent with the question so the server loads the matching data (a move breakdown, the earnings blocks, a comparison). */
  intent?: ChatIntentInput;
}

export interface SuggestionData {
  page: PageContext;
  lang: Lang;
  /** The US session is trading, so "today" is accurate; otherwise "in the last session". */
  live: boolean;
  /** From the quote page's data, when it has loaded. */
  changePercent?: number | null;
  relativeVolume?: number | null;
  nextEarningsDate?: string | null;
  /** The investor holds the open symbol. */
  held?: boolean;
  /** The investor has positions and allows sending them. */
  hasPositions: boolean;
  now: Date;
}

/** Earnings within this many days get their own question. */
const EARNINGS_DAYS = 21;
/** A move at least this large (percent) or volume this much above average is called out with its size. */
const NOTABLE_MOVE = 1.5;
const NOTABLE_VOLUME = 1.5;

function when(data: SuggestionData, m: SuggestionMessages): string {
  return data.live ? m.today : m.lastSession;
}

/** Two same-sector names to compare with, from the universe's size order. */
export function comparePeers(symbol: string): string[] {
  const sector = sectorOfSymbol(symbol);
  return sector ? sector.stocks.filter((s) => s !== symbol).slice(0, 2) : [];
}

function moveQuestion(symbol: string, data: SuggestionData, m: SuggestionMessages): Suggestion {
  const change = data.changePercent;
  // A move that prints as 0.00% has no direction to ask about, whatever the volume.
  const notable = typeof change === "number" && Number.isFinite(change) && (Math.abs(change) >= NOTABLE_MOVE || (data.relativeVolume ?? 0) >= NOTABLE_VOLUME) && displayedSign(change, 2) !== 0;
  const text = notable
    ? tpl(m.whyMove, { symbol, direction: (change as number) > 0 ? m.up : m.down, pct: `${Math.abs(change as number).toFixed(2)}%`, when: when(data, m) })
    : tpl(m.whatMoved, { symbol, when: when(data, m) });
  return { text, intent: { kind: "move", symbol } };
}

function earningsQuestion(symbol: string, data: SuggestionData, m: SuggestionMessages): Suggestion | null {
  if (!data.nextEarningsDate) return null;
  const days = daysUntil(data.nextEarningsDate, data.now);
  if (days === null || days < 0 || days > EARNINGS_DAYS) return null;
  return { text: tpl(m.earnings, { date: formatShortDate(data.nextEarningsDate, data.lang, "America/New_York") }), intent: { kind: "earnings", symbol } };
}

function compareQuestion(symbol: string, data: SuggestionData, m: SuggestionMessages): Suggestion | null {
  const peers = comparePeers(symbol);
  if (peers.length < 2) return null;
  // Tickers are Latin in both languages, so the joiner keeps spaces around it in Chinese too ("MSFT 和 AAPL").
  return { text: tpl(m.compare, { symbol, peers: peers.join(` ${m.and} `) }), intent: { kind: "compare", symbols: [symbol, ...peers] } };
}

function sectorLabel(data: SuggestionData): string {
  return data.page.sector ? (getSector(data.page.sector)?.label[data.lang] ?? data.page.sector) : "";
}

/** Up to four starter questions for an empty chat on the open page. */
export function suggestedQuestions(data: SuggestionData, m: SuggestionMessages): Suggestion[] {
  const { page } = data;
  const out: Array<Suggestion | null> = [];
  if (page.view === "stock" && page.symbol) {
    const symbol = page.symbol;
    out.push(moveQuestion(symbol, data, m), earningsQuestion(symbol, data, m));
    out.push(data.held ? { text: tpl(m.position, { symbol }) } : { text: tpl(m.bullBear, { symbol }) });
    out.push(compareQuestion(symbol, data, m));
    out.push({ text: tpl(m.risk, { symbol }) });
  } else if (page.view === "watchlist") {
    if (data.hasPositions) {
      out.push({ text: tpl(m.portfolioDay, { when: when(data, m) }) }, { text: m.concentration }, { text: m.reports }, { text: m.portfolioRisk });
    } else {
      out.push({ text: tpl(m.watchlistDay, { when: when(data, m) }) }, { text: m.watchlistMix }, { text: m.watchlistReports });
    }
  } else if (page.view === "sector" && page.sector) {
    const sector = sectorLabel(data);
    out.push({ text: tpl(m.sectorDay, { sector, when: when(data, m) }) }, { text: tpl(m.sectorLeaders, { sector }) }, { text: tpl(m.sectorVsMarket, { sector }) });
  } else {
    out.push({ text: tpl(m.marketDay, { when: when(data, m) }) }, { text: tpl(m.rotation, { when: when(data, m) }) }, { text: m.headlines });
    if (data.hasPositions) out.push({ text: tpl(m.portfolioOnMarket, { when: when(data, m) }) });
  }
  return out.filter((s): s is Suggestion => s !== null).slice(0, 4);
}

/** Two or three follow-ups after an answer, leaving out questions already asked in the conversation. */
export function followUpQuestions(data: SuggestionData, m: SuggestionMessages, asked: readonly string[]): Suggestion[] {
  const { page } = data;
  const pool: Array<Suggestion | null> = [];
  if (page.view === "stock" && page.symbol) {
    const symbol = page.symbol;
    pool.push(
      { text: tpl(m.changeView, { symbol }) },
      earningsQuestion(symbol, data, m),
      { text: tpl(m.risk, { symbol }) },
      moveQuestion(symbol, data, m),
      compareQuestion(symbol, data, m),
      { text: tpl(m.bullBear, { symbol }) },
    );
  } else if (page.view === "watchlist") {
    pool.push(
      data.hasPositions ? { text: m.riskContributor } : { text: m.watchlistMix },
      { text: data.hasPositions ? m.reports : m.watchlistReports },
      data.hasPositions ? { text: m.portfolioRisk } : { text: tpl(m.watchlistDay, { when: when(data, m) }) },
      data.hasPositions ? { text: m.concentration } : null,
    );
  } else if (page.view === "sector" && page.sector) {
    const sector = sectorLabel(data);
    pool.push({ text: tpl(m.sectorRisks, { sector }) }, { text: tpl(m.sectorLeaders, { sector }) }, { text: tpl(m.sectorVsMarket, { sector }) });
  } else {
    pool.push({ text: m.marketRisks }, { text: m.headlines }, { text: tpl(m.rotation, { when: when(data, m) }) });
    if (data.hasPositions) pool.push({ text: tpl(m.portfolioOnMarket, { when: when(data, m) }) });
  }
  const seen = new Set(asked.map((text) => text.trim().toLowerCase()));
  return pool.filter((s): s is Suggestion => s !== null && !seen.has(s.text.trim().toLowerCase())).slice(0, 3);
}
