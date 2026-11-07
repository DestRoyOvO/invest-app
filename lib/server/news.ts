import "server-only";

import type { NewsItem, NewsProvenance, SectorKey, StockProfile } from "@/types/api";
import { normalizeSymbol } from "@/lib/symbols";
import { getSector } from "@/lib/universe";

import { HOUR, peek, put } from "./cache";
import { log } from "./log";
import { searchNews, type RawNewsItem } from "./yahoo";

// Headlines for the overview, sector and stock pages, built from short Yahoo news searches.
// Yahoo returns little for long queries, so every list merges several 1-3 word searches, drops
// clickbait, collapses syndicated copies and, for companies, scores how relevant each story is.

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const MAX_ITEMS = 12;
/** Served items stay resolvable by id (POST /api/ai/analyze { kind: "news" }) for this long. */
const REGISTRY_TTL_MS = 24 * HOUR;
/** Market, sector and context stories older than this are dropped; old company stories only rank lower. */
const MAX_CONTEXT_AGE_MS = 30 * 24 * HOUR;
/** Company stories older than this lose SCORE.agePenalty, so fresh tag-only mentions can pass them. */
const COMPANY_AGING_MS = 14 * 24 * HOUR;
/** Company searches ask for more results because many of them are filtered out as unrelated. */
const COMPANY_RESULT_COUNT = 20;

// "Wall Street" is deliberately absent: it mostly matches single-company "vs. Wall Street estimates" pieces.
const MARKET_QUERIES = ["stock market", "Federal Reserve", "Treasury yields", "inflation"];

const SCORE = {
  /** The headline names the company (a distinctive brand name or an explicit ticker). */
  named: 50,
  /** Yahoo lists the symbol in relatedTickers. */
  tagged: 40,
  /** Extra weight when the symbol is the first of at most three tags (the story's subject, not a roundup). */
  focused: 5,
  /** Minimum company evidence for "company" provenance. */
  company: 40,
  /** Subtracted from company stories older than COMPANY_AGING_MS. */
  agePenalty: 10,
  /** Baselines for stories from the context searches; Yahoo already matched them to a targeted query. */
  industry: 20,
  macro: 15,
  /** Clickbait about the company is kept but ranks after every other story. */
  spamPenalty: 100,
} as const;

/** De-duplication preference when the same story arrives through several searches. */
const PROVENANCE_RANK: Record<NewsProvenance, number> = { company: 0, industry: 1, macro: 2, sector: 3, market: 4 };

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function plainQuotes(text: string): string {
  return text.replace(/[\u2018\u2019\u0060\u00b4]/g, "'");
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}

// \b only knows ASCII word characters; these edges also treat letters such as "é" as part of a word.
const EDGE_BEFORE = "(?<![\\p{L}\\p{N}])";
const EDGE_AFTER = "(?![\\p{L}\\p{N}])";

function wordPattern(terms: readonly string[], flags: "u" | "iu"): RegExp | null {
  if (terms.length === 0) return null;
  return new RegExp(`${EDGE_BEFORE}(?:${terms.map(escapeRegExp).join("|")})${EDGE_AFTER}`, flags);
}

/** True when `term` occurs in `text` as a whole word, ignoring case ("ai" is not found in "said"). */
export function containsWord(text: string, term: string): boolean {
  const trimmed = plainQuotes(term.trim());
  if (!trimmed) return false;
  return wordPattern([trimmed], "iu")?.test(plainQuotes(text)) ?? false;
}

/** Key that collapses syndicated copies: lower case, no punctuation, no "UPDATE 2-" or "- Reuters" decorations. */
export function normalizeTitle(title: string): string {
  return plainQuotes(title)
    .toLowerCase()
    .replace(/^\s*update\s*\d*\s*[:-]\s*/, "")
    .replace(/\s+[-\u2013\u2014|]\s+(?:bloomberg|reuters|wsj|cnbc|ft|report)\s*$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** Keeps well-formed upper-case Yahoo symbols (Yahoo occasionally leaks words such as "forecast" into the list). */
function sanitizeTickers(tickers: readonly string[]): string[] {
  const out: string[] = [];
  for (const ticker of tickers) {
    if (normalizeSymbol(ticker) === ticker && !out.includes(ticker)) out.push(ticker);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Clickbait
// ---------------------------------------------------------------------------

// Listicles, promotional pieces and "should you buy" questions, matched against the headline. Market and sector
// feeds drop every match, so each pattern must leave ordinary news alone ("Treasury yields skyrocket",
// "Dow could top 50,000", "Tariffs could double steel costs", "5 things to know before the market opens").
const SPAM_PATTERNS: readonly RegExp[] = [
  /^(?:the\s+)?\d{1,2}\s+(?:[\w'&.-]+\s+){0,3}(?:stocks?|picks|etfs?|shares)\b/i,
  /\btop\s+\d{1,2}(?![\d,.%])(?!\s+(?:thousand|million|billion|trillion)\b)/i,
  /\bbest\s+(?:[\w'-]+\s+){0,2}(?:stocks?|etfs?|shares|picks)\b/i,
  /\b(?:stocks?|shares|etfs?)\s+to\s+(?:buy|own)\b(?!\s+back)/i,
  /\b\d{1,2}\s+(?:reasons?\s+(?:to|you|why)|things?\s+(?:you|every|smart))\b/i,
  /\bmotley\s+fool\b/i,
  /\bcould\s+(?:soar|skyrocket|explode)\b/i,
  /\b(?:stocks?|shares)\s+(?:that\s+)?could\s+(?:double|triple)\b/i,
  /\bno[-\s]brainer\b/i,
  /\bmillionaire(?!s?\s+tax)/i,
  /\b(?:get|retire)\s+rich\b/i,
  /\bmust[-\s](?:buy|own)\b/i,
  /\bcan'?t[-\s]miss\b/i,
  /\bhidden\s+gems?\b/i,
  /\bnext\s+big\s+thing\b/i,
  /\bmassive\s+upside\b/i,
  /\bbuy\b.{0,40}\bbefore\s+(?:it|they|the\s+split)\b/i,
  /\b(?:time|reasons?)\s+to\s+buy\b/i,
  /\bshould\s+you\s+buy\b/i,
  /\bI(?:'d|'m|\s+would|\s+just)\s+(?:buy|buying|bought)\b/i,
  /\bbetter\s+(?:[\w'-]+\s+){0,2}(?:to\s+)?buy\b/i,
  /\ba\s+(?:strong\s+)?buy(?:\s+right)?(?:\s+now)?\s*\?/i,
  /\bhand\s+over\s+fist\b/i,
  /\bpassive\s+income\b/i,
  /\bforever\s+(?:stocks?|holds?)\b/i,
  /^prediction\s*:/i,
];

export function isSpam(title: string): boolean {
  const text = plainQuotes(title);
  return SPAM_PATTERNS.some((pattern) => pattern.test(text));
}

// ---------------------------------------------------------------------------
// Company matching
// ---------------------------------------------------------------------------

// Legal forms and listing words at the end of a company name ("Apple Inc." -> "Apple").
const NAME_SUFFIXES = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "companies", "ltd", "limited", "llc", "lp", "plc",
  "holding", "holdings", "group", "nv", "sa", "se", "ag", "spa", "new", "common", "stock", "shares", "ordinary",
  "adr", "ads",
]);

// Generic trailing words that headlines usually leave out ("Cisco Systems" -> "Cisco").
const NAME_DESCRIPTORS = new Set([
  "systems", "platforms", "communications", "technologies", "technology", "laboratories", "scientific",
  "pharmaceuticals", "therapeutics", "wholesale", "chemicals", "international", "worldwide", "manufacturing",
  "motor", "motors", "automotive", "us", "usa", "usd",
]);

const CONNECTORS = new Set(["&", "and"]);

/** Yahoo cuts short names at 31 characters ("Constellation Energy Corporatio"). */
const SHORT_NAME_LIMIT = 31;

/** Single-word brands that are also everyday words; a headline hit only counts when Yahoo tags the ticker too. */
const AMBIGUOUS_BRANDS = new Set([
  "visa", "target", "southern", "booking", "general", "american", "united", "first", "national", "progressive",
  "gap", "block", "snap", "ball", "shell", "duke", "constellation", "dominion", "regions", "citizens", "discover",
  "match", "unity",
]);

/** Names used by headlines that cannot be derived from Yahoo's company name. */
const BRAND_ALIASES: Readonly<Record<string, readonly string[]>> = {
  GOOGL: ["Google"],
  GOOG: ["Google"],
  META: ["Facebook"],
  "BRK-A": ["Berkshire"],
  "BRK-B": ["Berkshire"],
  JPM: ["JPMorgan"],
  XOM: ["Exxon", "ExxonMobil"],
  NEE: ["NextEra"],
  DIS: ["Disney"],
  KO: ["Coke"],
  PG: ["P&G"],
  JNJ: ["J&J"],
  LLY: ["Lilly"],
  BAC: ["BofA"],
  GS: ["Goldman"],
  LMT: ["Lockheed"],
  RTX: ["Raytheon"],
  BKNG: ["Booking Holdings", "Booking.com"],
  SO: ["Southern Company", "Southern Co"],
  TSM: ["TSMC"],
};

function nameKey(token: string): string {
  return token.toLowerCase().replace(/[^\p{L}\p{N}&]/gu, "");
}

function isCutSuffix(key: string): boolean {
  if (key.length === 0) return false;
  for (const suffix of NAME_SUFFIXES) {
    if (suffix.length > key.length && suffix.startsWith(key)) return true;
  }
  return false;
}

/**
 * The name headlines use for a company: Yahoo's name without legal suffixes, share classes and parentheses.
 * "Merck & Co., Inc." -> "Merck", "Walt Disney Company (The)" -> "Walt Disney", "Amazon.com, Inc." -> "Amazon".
 */
export function brandToken(companyName: string): string {
  const raw = plainQuotes(companyName).trim();
  const text = raw
    .replace(/\([^)]*\)?/g, " ") // "(The)", or a parenthesis cut off by truncation: "(Holdin"
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/i, "")
    // Security descriptions in exchange listings: "Class A", "Class C Capital Stock", "Preferred Stock".
    .replace(/[\s,]+(?:class|cl|series)\s+[a-z]\b.*$/i, "")
    .replace(/[\s,]+(?:capital|common|ordinary|preferred)\s+(?:stock|shares?)\b.*$/i, "");
  const tokens = text.split(" ").filter(Boolean);
  if (raw.length >= SHORT_NAME_LIMIT && tokens.length > 1 && isCutSuffix(nameKey(tokens[tokens.length - 1]))) {
    tokens.pop();
  }
  while (tokens.length > 1) {
    const key = nameKey(tokens[tokens.length - 1]);
    if (key !== "" && !NAME_SUFFIXES.has(key) && !CONNECTORS.has(key)) break;
    tokens.pop();
  }
  return tokens
    .join(" ")
    .replace(/[\s,.;:]+$/, "")
    .replace(/^(.{3,})\.com$/i, "$1");
}

function isAmbiguousBrand(term: string): boolean {
  return AMBIGUOUS_BRANDS.has(term.toLowerCase());
}

/** The brand without a generic trailing descriptor ("Meta Platforms" -> "Meta"), or null if nothing distinctive is left. */
export function shortBrand(brand: string): string | null {
  const tokens = brand.split(" ");
  if (tokens.length < 2 || !NAME_DESCRIPTORS.has(tokens[tokens.length - 1].toLowerCase())) return null;
  tokens.pop();
  while (tokens.length > 1 && CONNECTORS.has(tokens[tokens.length - 1].toLowerCase())) tokens.pop();
  const short = tokens.join(" ");
  return short.length >= 3 && !isAmbiguousBrand(short) ? short : null;
}

export interface CompanyMatcher {
  symbol: string;
  /** The symbol and the company's other share classes, as canonicalTicker() spells them. */
  tickers: ReadonlySet<string>;
  /**
   * $T, (T), "NYSE: T" and, for tickers of three or more characters, the bare ticker (case-sensitive),
   * for every share class.
   */
  ticker: RegExp;
  /** Distinctive brand names, matched case-insensitively on word boundaries. */
  brand: RegExp | null;
  /** Brands that are everyday words ("Visa", "Southern"); they need Yahoo's ticker tag to count. */
  weakBrand: RegExp | null;
  /** Brand term for the company news search, or null when the ticker search alone is safer. */
  searchTerm: string | null;
}

const EXCHANGES = "NYSE American|NYSE Arca|NYSEARCA|NYSE|NASDAQ|Nasdaq|AMEX|Amex";

/** Other share classes Yahoo files a company's stories under: Alphabet news is tagged GOOG, almost never GOOGL. */
const SHARE_CLASS_SIBLINGS: Readonly<Record<string, readonly string[]>> = {
  GOOGL: ["GOOG"],
  GOOG: ["GOOGL"],
  FOXA: ["FOX"],
  FOX: ["FOXA"],
  NWSA: ["NWS"],
  NWS: ["NWSA"],
  UAA: ["UA"],
  UA: ["UAA"],
};

/** Comparison key for tickers: Yahoo writes share classes with a dash (BRK-B), other sources with a dot or a slash. */
function canonicalTicker(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/[./]/g, "-");
}

/** The symbol and its other share classes, canonicalized ("GOOGL" -> GOOGL, GOOG; "BRK-B" -> BRK-B, BRK-A). */
function companyTickers(symbol: string): string[] {
  const canonical = canonicalTicker(symbol);
  const tickers = new Set([canonical, ...(SHARE_CLASS_SIBLINGS[canonical] ?? [])]);
  const shareClass = /^([A-Z]{1,5})-[A-Z]$/.exec(canonical);
  if (shareClass) {
    tickers.add(`${shareClass[1]}-A`);
    tickers.add(`${shareClass[1]}-B`);
  }
  return [...tickers];
}

/** How headlines spell a ticker: BRK-B, BRK.B or BRK/B. */
function tickerForms(ticker: string): string[] {
  return [ticker, ticker.replace(/[-.]/g, "-"), ticker.replace(/[-.]/g, "."), ticker.replace(/[-.]/g, "/")];
}

function alternation(terms: readonly string[]): string {
  return `(?:${[...new Set(terms)].map(escapeRegExp).join("|")})`;
}

function tickerPattern(tickers: readonly string[]): RegExp {
  const forms = alternation(tickers.flatMap(tickerForms));
  const patterns = [`\\$${forms}${EDGE_AFTER}`, `\\(${forms}\\)`, `\\b(?:${EXCHANGES})\\s*:\\s*${forms}${EDGE_AFTER}`];
  // One- and two-letter tickers (T, V, MA, PM) are everyday words or initials, so they only count in explicit forms.
  const bare = tickers.filter((ticker) => ticker.length >= 3).flatMap(tickerForms);
  if (bare.length > 0) patterns.push(`${EDGE_BEFORE}${alternation(bare)}${EDGE_AFTER}`);
  return new RegExp(patterns.join("|"), "u");
}

function isUsableSearchTerm(term: string, symbol: string): boolean {
  return term.length >= 3 && term.toUpperCase() !== symbol && !isAmbiguousBrand(term) && term.split(" ").length <= 3;
}

/** Builds the matcher from the company's names, most reliable first (Yahoo's long name is never truncated). */
export function buildCompanyMatcher(symbol: string, names: ReadonlyArray<string | null | undefined>): CompanyMatcher {
  const upper = symbol.trim().toUpperCase();
  const tickers = companyTickers(upper);
  const strong = new Set<string>();
  const weak = new Set<string>();
  const searchCandidates: string[] = [];

  const addAlias = (alias: string | null) => {
    // An upper-case alias equal to the ticker ("RTX") is already covered by the case-sensitive ticker pattern.
    if (!alias || alias.length < 3 || alias === upper) return;
    (isAmbiguousBrand(alias) ? weak : strong).add(alias);
  };
  for (const name of names) {
    if (!name?.trim()) continue;
    const brand = brandToken(name);
    const short = shortBrand(brand);
    addAlias(brand);
    addAlias(short);
    if (short) searchCandidates.push(short);
    searchCandidates.push(brand);
  }
  const aliases = BRAND_ALIASES[canonicalTicker(upper)] ?? [];
  aliases.forEach(addAlias);
  searchCandidates.push(...aliases);

  return {
    symbol: upper,
    tickers: new Set(tickers),
    ticker: tickerPattern([upper, ...tickers]),
    brand: wordPattern([...strong], "iu"),
    weakBrand: wordPattern([...weak], "iu"),
    searchTerm: searchCandidates.find((term) => isUsableSearchTerm(term, upper)) ?? null,
  };
}

/** Publishers that attach their disclosure-list tickers to every story, so their tags are not evidence. */
const UNRELIABLE_TAG_PUBLISHERS = new Set(["motley fool", "the motley fool"]);

/** Index, futures, currency and crypto tags (^GSPC, CL=F, EURUSD=X, BTC-USD) mark market context, not a company. */
function isMarketSymbol(ticker: string): boolean {
  return ticker.startsWith("^") || ticker.includes("=") || ticker.endsWith("-USD");
}

/**
 * How strongly a story is about the company: SCORE.named when the headline names it, SCORE.tagged (plus the
 * focus bonus) when only Yahoo's relatedTickers do, 0 otherwise.
 */
export function companyScore(
  item: Pick<RawNewsItem, "title" | "publisher" | "relatedTickers">,
  matcher: CompanyMatcher,
): number {
  const title = plainQuotes(item.title);
  const tags = item.relatedTickers.map(canonicalTicker);
  const tagged = tags.some((tag) => matcher.tickers.has(tag));
  const tagReliable = tagged && !UNRELIABLE_TAG_PUBLISHERS.has((item.publisher ?? "").toLowerCase());
  // Tagged with other companies only: a brand hit is probably a namesake ("Apple Hospitality REIT" for AAPL).
  const taggedElsewhere = !tagged && tags.some((tag) => !isMarketSymbol(tag));

  const named =
    matcher.ticker.test(title) ||
    (!taggedElsewhere && (matcher.brand?.test(title) ?? false)) ||
    (tagReliable && (matcher.weakBrand?.test(title) ?? false));
  if (named) return SCORE.named;
  // Yahoo lists a story's subject first, so a short list led by the company is a story about the company.
  if (tagReliable) return SCORE.tagged + (matcher.tickers.has(tags[0]) && tags.length <= 3 ? SCORE.focused : 0);
  return 0;
}

// ---------------------------------------------------------------------------
// Candidates, scoring and de-duplication
// ---------------------------------------------------------------------------

export interface NewsCandidate {
  item: NewsItem;
  score: number;
  /** Publish time in epoch ms; 0 when unknown (sorts last). */
  time: number;
}

type CompanyTrack = Extract<NewsProvenance, "company" | "industry" | "macro">;

function toCandidate(raw: RawNewsItem, provenance: NewsProvenance): NewsCandidate | null {
  if (!raw.id || !raw.title || !isHttpUrl(raw.link)) return null;
  const time = raw.publishedAt ? Date.parse(raw.publishedAt) : Number.NaN;
  return {
    item: {
      id: raw.id,
      title: raw.title,
      publisher: raw.publisher,
      link: raw.link,
      publishedAt: raw.publishedAt,
      relatedTickers: sanitizeTickers(raw.relatedTickers),
      provenance,
    },
    score: 0,
    time: Number.isFinite(time) ? time : 0,
  };
}

function isOlderThan(time: number, now: number, ageMs: number): boolean {
  return time > 0 && now - time > ageMs;
}

/**
 * Scores one search result for a company page. Stories with company evidence become "company" news whichever
 * search found them; context stories get their track's baseline; unrelated results of the company searches,
 * stale context and context clickbait are dropped (null).
 */
export function scoreCompanyCandidate(
  raw: RawNewsItem,
  track: CompanyTrack,
  matcher: CompanyMatcher,
  now: number,
): NewsCandidate | null {
  const candidate = toCandidate(raw, track);
  if (!candidate) return null;
  const evidence = companyScore(candidate.item, matcher);
  const spam = isSpam(raw.title);

  if (evidence >= SCORE.company) {
    const aged = isOlderThan(candidate.time, now, COMPANY_AGING_MS) ? SCORE.agePenalty : 0;
    return {
      ...candidate,
      item: { ...candidate.item, provenance: "company" },
      score: evidence - aged - (spam ? SCORE.spamPenalty : 0),
    };
  }
  if (track === "company" || spam || isOlderThan(candidate.time, now, MAX_CONTEXT_AGE_MS)) return null;
  return { ...candidate, score: track === "industry" ? SCORE.industry : SCORE.macro };
}

function isBetter(a: NewsCandidate, b: NewsCandidate): boolean {
  const rank = PROVENANCE_RANK[a.item.provenance] - PROVENANCE_RANK[b.item.provenance];
  if (rank !== 0) return rank < 0;
  if (a.score !== b.score) return a.score > b.score;
  return a.time > b.time;
}

/** The best candidate per key, in first-seen order (Map.set on an existing key keeps its position). */
function keepBest(candidates: readonly NewsCandidate[], keyOf: (candidate: NewsCandidate) => string): NewsCandidate[] {
  const best = new Map<string, NewsCandidate>();
  for (const candidate of candidates) {
    const key = keyOf(candidate);
    const current = best.get(key);
    if (!current || isBetter(candidate, current)) best.set(key, candidate);
  }
  return [...best.values()];
}

/**
 * Collapses stories with the same id, then syndicated copies with the same headline, preferring company provenance,
 * then the higher score. Two passes, so a story whose headline changed between searches cannot survive twice.
 */
export function dedupeCandidates(candidates: readonly NewsCandidate[]): NewsCandidate[] {
  const byId = keepBest(candidates, (candidate) => candidate.item.id);
  return keepBest(byId, (candidate) => {
    const title = normalizeTitle(candidate.item.title);
    return title ? `title:${title}` : `id:${candidate.item.id}`;
  });
}

function byScoreThenRecency(a: NewsCandidate, b: NewsCandidate): number {
  return b.score - a.score || b.time - a.time;
}

/**
 * Publisher plus headline prefix of a running series ("Sector Update: Tech ...", "Stock Market Today, Nov. 6: ..."),
 * or null when the headline has no multi-word prefix before a colon.
 */
export function seriesKey(item: Pick<NewsItem, "title" | "publisher">): string | null {
  const colon = item.title.indexOf(":");
  if (!item.publisher || colon <= 0) return null;
  const prefix = normalizeTitle(item.title.slice(0, colon));
  return prefix.includes(" ") ? `${item.publisher.toLowerCase()}|${prefix}` : null;
}

/**
 * Market and sector feeds: no clickbait, nothing stale, one copy per story and only the latest installment of a
 * publisher's running series, newest first.
 */
export function buildFeed(raws: readonly RawNewsItem[], provenance: "market" | "sector", now: number): NewsItem[] {
  const candidates: NewsCandidate[] = [];
  for (const raw of raws) {
    if (isSpam(raw.title)) continue;
    const candidate = toCandidate(raw, provenance);
    if (candidate && !isOlderThan(candidate.time, now, MAX_CONTEXT_AGE_MS)) candidates.push(candidate);
  }
  const series = new Set<string>();
  const feed: NewsItem[] = [];
  for (const { item } of dedupeCandidates(candidates).sort(byScoreThenRecency)) {
    const key = seriesKey(item);
    if (key !== null && series.has(key)) continue;
    if (key !== null) series.add(key);
    feed.push(item);
    if (feed.length === MAX_ITEMS) break;
  }
  return feed;
}

// ---------------------------------------------------------------------------
// Search plans
// ---------------------------------------------------------------------------

// Yahoo industry (lower-case substring) -> short context searches. Specific entries precede general ones.
const INDUSTRY_QUERIES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["semiconductor equipment", ["chip equipment", "chip stocks"]],
  ["semiconductor", ["chip stocks", "AI chips"]],
  ["software - infrastructure", ["cloud computing", "cybersecurity"]],
  ["software - application", ["enterprise software", "SaaS stocks"]],
  ["information technology services", ["IT services", "AI spending"]],
  ["consumer electronics", ["smartphone sales", "consumer electronics"]],
  ["computer hardware", ["PC shipments", "AI servers"]],
  ["communication equipment", ["networking equipment", "AI data centers"]],
  ["electronic components", ["electronic components"]],
  ["internet content", ["digital advertising", "social media"]],
  ["internet retail", ["e-commerce", "online shopping"]],
  ["telecom", ["telecom stocks", "wireless carriers"]],
  ["electronic gaming", ["video games"]],
  ["entertainment", ["streaming", "box office"]],
  ["advertising", ["ad spending"]],
  ["auto manufacturers", ["EV sales", "auto tariffs"]],
  ["auto parts", ["auto parts", "auto tariffs"]],
  ["home improvement", ["home improvement", "housing market"]],
  ["restaurants", ["restaurant stocks", "fast food"]],
  ["travel services", ["travel demand", "online travel"]],
  ["lodging", ["hotel stocks", "travel demand"]],
  ["resorts & casinos", ["casino stocks", "Las Vegas"]],
  ["gambling", ["sports betting", "casino stocks"]],
  ["airlines", ["airline stocks", "jet fuel"]],
  ["apparel", ["apparel retail", "tariffs"]],
  ["footwear", ["sneakers", "consumer spending"]],
  ["discount stores", ["retail sales", "consumer spending"]],
  ["department stores", ["retail sales"]],
  ["specialty retail", ["retail sales"]],
  ["grocery", ["grocery prices", "food prices"]],
  ["household & personal products", ["consumer staples", "consumer goods"]],
  ["beverages", ["beverage stocks"]],
  ["tobacco", ["tobacco stocks"]],
  ["confectioners", ["cocoa prices", "snack makers"]],
  ["packaged foods", ["packaged food", "food prices"]],
  ["drug manufacturers", ["pharma stocks", "drug pricing"]],
  ["biotechnology", ["biotech stocks", "FDA approval"]],
  ["healthcare plans", ["health insurers", "Medicare Advantage"]],
  ["medical devices", ["medtech", "medical devices"]],
  ["medical instruments", ["medtech", "medical devices"]],
  ["diagnostics & research", ["life sciences", "lab tools"]],
  ["medical care facilities", ["hospital stocks"]],
  ["pharmaceutical retailers", ["pharmacy"]],
  ["health information", ["health tech"]],
  ["banks", ["bank earnings", "interest rates"]],
  ["credit services", ["card spending", "payments"]],
  ["capital markets", ["investment banking", "trading revenue"]],
  ["asset management", ["asset managers", "ETF flows"]],
  ["insurance", ["insurance stocks", "insurers"]],
  ["financial data", ["financial data"]],
  ["mortgage finance", ["mortgage rates"]],
  ["aerospace & defense", ["defense spending", "aerospace"]],
  ["farm & heavy construction machinery", ["farm equipment", "construction spending"]],
  ["railroads", ["railroads", "freight volumes"]],
  ["trucking", ["trucking", "freight market"]],
  ["integrated freight", ["freight market", "shipping"]],
  ["marine shipping", ["shipping rates"]],
  ["conglomerates", ["industrial stocks"]],
  ["specialty industrial machinery", ["industrial stocks", "manufacturing"]],
  ["building products", ["construction spending", "housing starts"]],
  ["residential construction", ["homebuilders", "housing starts"]],
  ["engineering & construction", ["infrastructure spending"]],
  ["oil & gas integrated", ["oil prices", "oil majors"]],
  ["oil & gas e&p", ["oil prices", "shale"]],
  ["oil & gas equipment", ["oilfield services", "oil prices"]],
  ["oil & gas midstream", ["natural gas", "pipelines"]],
  ["oil & gas refining", ["refining margins", "gasoline prices"]],
  ["uranium", ["uranium", "nuclear power"]],
  ["coal", ["coal prices"]],
  ["solar", ["solar stocks", "clean energy"]],
  ["utilities - renewable", ["clean energy", "power demand"]],
  ["utilities", ["utility stocks", "power demand"]],
  ["chemicals", ["chemical stocks"]],
  ["gold", ["gold prices"]],
  ["silver", ["silver prices"]],
  ["copper", ["copper prices"]],
  ["steel", ["steel prices", "tariffs"]],
  ["aluminum", ["aluminum prices", "tariffs"]],
  ["industrial metals", ["metal prices"]],
  ["agricultural inputs", ["fertilizer prices"]],
  ["lumber", ["lumber prices"]],
  ["reit - industrial", ["industrial REIT", "warehouse demand"]],
  ["reit - specialty", ["data centers", "REIT"]],
  ["reit - retail", ["retail REIT", "mall traffic"]],
  ["reit - residential", ["apartment rents"]],
  ["reit - office", ["office REIT", "office vacancy"]],
  ["reit - healthcare", ["healthcare REIT"]],
  ["reit", ["REIT"]],
  ["real estate", ["real estate market", "commercial real estate"]],
];

const GENERIC_INDUSTRY_WORDS = new Set(["specialty", "other", "general", "diversified", "services", "products", "equipment", "and"]);

/** One or two short searches for the company's industry context. */
export function industryQueries(industry: string | null): string[] {
  const trimmed = industry?.trim();
  if (!trimmed) return [];
  const key = trimmed.toLowerCase();
  const known = INDUSTRY_QUERIES.find(([pattern]) => key.includes(pattern));
  if (known) return known[1].slice(0, 2);
  // Unknown industry: its first meaningful words ("Waste Management", "Staffing stocks").
  const words = trimmed
    .split(" - ")[0]
    .split(/[\s&,/]+/)
    .filter((word) => word.length > 2 && !GENERIC_INDUSTRY_WORDS.has(word.toLowerCase()));
  if (words.length === 0) return [];
  return [words.length === 1 ? `${words[0]} stocks` : `${words[0]} ${words[1]}`];
}

// Yahoo sector (lower case) -> macro searches in order of preference; the first one not already used is taken.
const SECTOR_MACRO_QUERIES: Readonly<Record<string, readonly string[]>> = {
  technology: ["tech earnings", "tech stocks"],
  "communication services": ["digital advertising", "media stocks"],
  "consumer cyclical": ["consumer spending", "retail sales"],
  "consumer defensive": ["consumer staples", "inflation"],
  healthcare: ["healthcare stocks", "drug pricing"],
  "financial services": ["Federal Reserve", "interest rates"],
  industrials: ["manufacturing", "tariffs"],
  energy: ["oil prices", "OPEC"],
  "basic materials": ["commodity prices", "metal prices"],
  utilities: ["power demand", "utility stocks"],
  "real estate": ["mortgage rates", "commercial real estate"],
};

const DEFAULT_MACRO_QUERIES = ["stock market", "Wall Street"];

/** One macro search for the sector, avoiding terms the plan already uses (lower-case keys in `used`). */
export function macroQuery(sector: string | null, used: ReadonlySet<string>): string {
  const candidates = (sector && SECTOR_MACRO_QUERIES[sector.trim().toLowerCase()]) || DEFAULT_MACRO_QUERIES;
  return candidates.find((term) => !used.has(term.toLowerCase())) ?? candidates[0];
}

export interface NewsQuery<T extends NewsProvenance = NewsProvenance> {
  term: string;
  track: T;
  /** Results requested from Yahoo; searchNews' default when omitted. */
  count?: number;
}

/** Company track (ticker, then brand), one or two industry searches and one macro search, without repeats. */
export function planCompanyQueries(
  matcher: CompanyMatcher,
  profile: Pick<StockProfile, "industry" | "sector"> | null,
): NewsQuery<CompanyTrack>[] {
  const queries: NewsQuery<CompanyTrack>[] = [];
  const used = new Set<string>();
  const add = (term: string | null, track: CompanyTrack, count?: number) => {
    const key = term?.trim().toLowerCase();
    if (!term || !key || used.has(key)) return;
    used.add(key);
    queries.push(count === undefined ? { term, track } : { term, track, count });
  };
  add(matcher.symbol, "company", COMPANY_RESULT_COUNT);
  add(matcher.searchTerm, "company", COMPANY_RESULT_COUNT);
  for (const term of industryQueries(profile?.industry ?? null)) add(term, "industry");
  add(macroQuery(profile?.sector ?? null, used), "macro");
  return queries;
}

interface QueryResult<T extends NewsProvenance> {
  track: T;
  items: RawNewsItem[];
}

/** Runs the searches in parallel; one failed search does not fail the list, but all of them failing does. */
async function runQueries<T extends NewsProvenance>(queries: readonly NewsQuery<T>[]): Promise<QueryResult<T>[]> {
  const settled = await Promise.allSettled(queries.map((query) => searchNews(query.term, query.count)));
  const results: QueryResult<T>[] = [];
  const errors: unknown[] = [];
  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") results.push({ track: queries[i].track, items: outcome.value });
    else errors.push(outcome.reason);
  });
  if (errors.length > 0 && results.length === 0) throw new Error("All news searches failed", { cause: errors[0] });
  if (errors.length > 0) log("warn", "news.searches_failed", { failed: errors.length, total: queries.length, error: errors[0] });
  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function registryKey(id: string): string {
  return `news:${id}`;
}

/** Indexes served items by id so the AI routes can resolve a headline the client picked. */
function register(items: NewsItem[]): NewsItem[] {
  for (const item of items) put(registryKey(item.id), item, { ttlMs: REGISTRY_TTL_MS });
  return items;
}

/** Broad market headlines for the overview page (each underlying search is cached for 10 minutes). */
export async function getMarketNews(): Promise<NewsItem[]> {
  const results = await runQueries(MARKET_QUERIES.map((term) => ({ term, track: "market" as const })));
  return register(buildFeed(results.flatMap((r) => r.items), "market", Date.now()));
}

/** Headlines for one sector, using the sector's short news queries from lib/universe.ts. */
export async function getSectorNews(sector: SectorKey): Promise<NewsItem[]> {
  const def = getSector(sector);
  if (!def) throw new Error(`Unknown sector: ${sector}`);
  // The SPDR ticker brings the wire services' "Sector Update" stories that keyword searches miss.
  const terms = [...def.newsQueries, def.etf];
  const results = await runQueries(terms.map((term) => ({ term, track: "sector" as const })));
  return register(buildFeed(results.flatMap((r) => r.items), "sector", Date.now()));
}

/**
 * Company news plus industry and macro context, scored for relevance and de-duplicated.
 * `profile` may be null when Yahoo has no summary for the symbol.
 */
export async function getCompanyNews(symbol: string, companyName: string, profile: StockProfile | null): Promise<NewsItem[]> {
  const matcher = buildCompanyMatcher(symbol, [profile?.longName, companyName, profile?.name]);
  const results = await runQueries(planCompanyQueries(matcher, profile));
  const now = Date.now();
  const candidates: NewsCandidate[] = [];
  for (const { track, items } of results) {
    for (const raw of items) {
      const candidate = scoreCompanyCandidate(raw, track, matcher, now);
      if (candidate) candidates.push(candidate);
    }
  }
  const ranked = dedupeCandidates(candidates).sort(byScoreThenRecency).slice(0, MAX_ITEMS);
  return register(ranked.map((c) => c.item));
}

/** Looks up a news item previously returned by any of the functions above (kept for ~24 hours). */
export function findNewsById(id: string): NewsItem | undefined {
  if (!id || id.length > 128) return undefined;
  return peek<NewsItem>(registryKey(id));
}
