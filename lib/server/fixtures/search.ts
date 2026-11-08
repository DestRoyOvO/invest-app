import "server-only";

import { normalizeSymbol } from "@/lib/symbols";

import { FIXTURE_NEWS_PREFIX } from "./article";
import { pick, seedOf } from "./random";
import { isNotFoundSymbol, securityOf, TABLE_SECURITIES, type Security } from "./securities";
import { latestCompletedSession, PROFILES, sessionClose } from "./sessions";

// search() of the fixture data: name and ticker matches from the securities table (plus the ticker itself for any
// well-formed symbol, as Yahoo does) and a few synthetic news stories per query. Story links point at
// https://example.com/fixtures/news/<id>, which the article reader answers from fixture text without a network call.
// Headlines name the company for company searches, so the app's relevance scoring treats them as company news.

export interface FixtureSearchOptions {
  quotesCount?: number;
  newsCount?: number;
}

const HOUR_MS = 3_600_000;

/** Yahoo's display name of an exchange in search results. */
function exchangeDisplay(security: Security): string {
  if (security.exchange === "NMS" || security.exchange === "NGM" || security.exchange === "NAS") return "NASDAQ";
  if (security.type === "INDEX" && security.market === "us_market") return security.exchange === "SNP" ? "S&P" : "Index";
  return security.fullExchangeName;
}

function typeDisplay(security: Security): string {
  switch (security.type) {
    case "EQUITY":
      return "Equity";
    case "ETF":
      return "ETF";
    case "INDEX":
      return "Index";
    case "FUTURE":
      return "Futures";
    case "CURRENCY":
      return "Currency";
    case "CRYPTOCURRENCY":
      return "Cryptocurrency";
    case "MUTUALFUND":
      return "Fund";
  }
}

function searchQuote(security: Security, score: number): Record<string, unknown> {
  const quote: Record<string, unknown> = {
    exchange: security.exchange,
    shortname: security.shortName,
    quoteType: security.type,
    symbol: security.symbol,
    index: "quotes",
    score,
    typeDisp: typeDisplay(security),
    longname: security.name,
    exchDisp: exchangeDisplay(security),
    isYahooFinance: true,
  };
  if (security.sector && security.industry) {
    Object.assign(quote, { sector: security.sector, sectorDisp: security.sector, industry: security.industry, industryDisp: security.industry, dispSecIndFlag: true });
  }
  return quote;
}

/** How well a security matches the query: exact ticker, ticker prefix, a name word prefix, a name substring. */
function matchScore(security: Security, q: string): number {
  const query = q.toLowerCase();
  const symbol = security.symbol.toLowerCase();
  const name = security.name.toLowerCase();
  if (symbol === query) return 1_000_000;
  if (symbol.startsWith(query)) return 500_000 - symbol.length;
  if (name.split(/[^a-z0-9&.]+/).some((word) => word && word.startsWith(query))) return 100_000 - name.length;
  if (query.length >= 3 && name.includes(query)) return 50_000 - name.length;
  return 0;
}

/** The name headlines use: the long name without "The", legal forms and share-class words. */
export function brandOf(security: Security): string {
  let name = security.name.replace(/^The\s+/, "").trim();
  for (;;) {
    const shorter = name
      .replace(/[,.]?\s+(Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.?|plc|Limited|Ltd\.?|N\.V\.|S\.A\.|Holdings?|Group|Trust)$/i, "")
      .replace(/\s*&$/, "")
      .trim();
    if (shorter === name || !shorter) break;
    name = shorter;
  }
  return name.replace(/\.com$/i, "");
}

const PUBLISHERS = ["Example Wire", "Fixture Markets Daily", "Demo Business News", "Sample Street Journal", "Placeholder Financial"];
const MOVES = ["rise", "slip", "edge higher", "trade lower", "hold steady", "climb"];
const TOPICS = ["the demand outlook", "margin trends", "pricing changes", "a new product cycle", "a regulatory review", "capital spending plans"];

const COMPANY_TEMPLATES: ReadonlyArray<(brand: string, symbol: string, topic: string, move: string) => string> = [
  (brand, _symbol, topic, move) => `${brand} shares ${move} as investors weigh ${topic}`,
  (brand, symbol) => `${brand} (${symbol}) outlines plans to expand its main business lines`,
  (brand) => `Analysts revisit ${brand} estimates after the latest quarterly update`,
  (brand) => `${brand} reaches a new supply agreement with regional partners`,
  (brand) => `${brand} names a new head of its largest division`,
  (brand) => `${brand} to present at an industry conference next week`,
  (brand, _symbol, topic) => `How ${topic} could shape ${brand}'s next report`,
  (brand) => `${brand} sets the date for its quarterly results`,
];

const TOPIC_TEMPLATES: ReadonlyArray<(query: string) => string> = [
  (query) => `Markets weigh ${query} ahead of key data`,
  (query) => `${capitalize(query)} in focus as investors assess the outlook`,
  (query) => `Strategists discuss ${query} and the path for interest rates`,
  (query) => `Daily briefing: ${query} and other themes moving markets`,
  (query) => `Investors track ${query} as the session wraps up`,
  (query) => `What a shift in ${query} could mean for portfolios`,
];

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function storyId(...parts: Array<string | number>): string {
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  const a = hex(seedOf(...parts, "a"));
  const b = hex(seedOf(...parts, "b"));
  const c = hex(seedOf(...parts, "c"));
  const d = hex(seedOf(...parts, "d"));
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-8${c.slice(1, 4)}-${c.slice(4)}${d}`;
}

/** The company a news query is about: an exact ticker, or a name the query starts. */
function companyOf(q: string): Security | null {
  const symbol = normalizeSymbol(q);
  const bySymbol = symbol ? TABLE_SECURITIES.find((s) => s.symbol === symbol) : undefined;
  if (bySymbol) return bySymbol;
  const query = q.toLowerCase();
  return TABLE_SECURITIES.find((s) => s.type === "EQUITY" && brandOf(s).toLowerCase() === query) ?? null;
}

function newsItems(q: string, count: number, now: number): Array<Record<string, unknown>> {
  if (count <= 0) return [];
  const latest = latestCompletedSession(PROFILES.us, now);
  const close = sessionClose(PROFILES.us, latest);
  const key = q.toLowerCase();
  const company = companyOf(q);
  const offset = pick(8, key, "template");
  return Array.from({ length: count }, (_, i) => {
    const id = storyId(key, latest, i);
    let title: string;
    let related: string[];
    if (company) {
      const brand = brandOf(company);
      const template = COMPANY_TEMPLATES[(offset + i) % COMPANY_TEMPLATES.length];
      title = template(brand, company.symbol, TOPICS[pick(TOPICS.length, key, "topic", i)], MOVES[pick(MOVES.length, key, "move", i)]);
      related = [company.symbol];
    } else {
      title = TOPIC_TEMPLATES[(offset + i) % TOPIC_TEMPLATES.length](q);
      related = i % 2 === 0 ? ["^GSPC"] : [];
    }
    const published = close - (i * 3 + 1) * HOUR_MS - pick(120, key, "minutes", i) * 60_000;
    return {
      uuid: id,
      title,
      publisher: PUBLISHERS[pick(PUBLISHERS.length, key, "publisher", i)],
      link: `${FIXTURE_NEWS_PREFIX}${id}`,
      providerPublishTime: new Date(published),
      type: "STORY",
      relatedTickers: related,
    };
  });
}

/** search(query, options) in fixture mode. */
export function buildSearch(query: string, options: FixtureSearchOptions | undefined, now: number): Record<string, unknown> {
  const q = query.trim();
  if (!q) throw Object.assign(new Error("Invalid Search Query"), { name: "BadRequestError" });
  const quotesCount = options?.quotesCount ?? 6;
  const newsCount = options?.newsCount ?? 4;
  const unknown = isNotFoundSymbol(q);

  const quotes: Array<Record<string, unknown>> = [];
  if (!unknown && quotesCount > 0) {
    const matches = TABLE_SECURITIES.map((security) => ({ security, score: matchScore(security, q) }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score || a.security.symbol.localeCompare(b.security.symbol));
    // Any well-formed ticker is a listing in the fixture world, so it is found even outside the table: first when the
    // query is typed like a ticker (no lower-case letters), otherwise only when nothing else matches ("apple" finds
    // Apple, not a listing called APPLE).
    const symbol = normalizeSymbol(q);
    if (symbol && !matches.some((match) => match.security.symbol === symbol)) {
      const security = securityOf(symbol);
      if (security && q === q.toUpperCase()) matches.unshift({ security, score: 900_000 });
      else if (security && matches.length === 0) matches.push({ security, score: 10_000 });
    }
    for (const match of matches.slice(0, quotesCount)) quotes.push(searchQuote(match.security, match.score));
  }
  const news = unknown ? [] : newsItems(q, newsCount, now);
  return {
    explains: [],
    count: quotes.length,
    quotes,
    news,
    nav: [],
    lists: [],
    researchReports: [],
    screenerFieldResults: [],
    culturalAssets: [],
    totalTime: 12,
    timeTakenForQuotes: 4,
    timeTakenForNews: 3,
    timeTakenForAlgowatchlist: 0,
    timeTakenForPredefinedScreener: 0,
    timeTakenForCrunchbase: 0,
    timeTakenForNav: 0,
    timeTakenForResearchReports: 0,
    timeTakenForScreenerField: 0,
    timeTakenForCulturalAssets: 0,
    timeTakenForSearchLists: 0,
  };
}
