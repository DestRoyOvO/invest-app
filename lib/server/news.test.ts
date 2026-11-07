import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NewsItem } from "@/types/api";

import type { RawNewsItem } from "./yahoo";

vi.mock("server-only", () => ({}));

const searchNews = vi.hoisted(() => vi.fn<(query: string, count?: number) => Promise<RawNewsItem[]>>());
vi.mock("./yahoo", () => ({ searchNews }));

import { clearCache } from "./cache";
import {
  brandToken,
  buildCompanyMatcher,
  buildFeed,
  companyScore,
  containsWord,
  dedupeCandidates,
  findNewsById,
  getCompanyNews,
  getMarketNews,
  getSectorNews,
  industryQueries,
  isSpam,
  macroQuery,
  normalizeTitle,
  planCompanyQueries,
  scoreCompanyCandidate,
  seriesKey,
  shortBrand,
  type CompanyMatcher,
  type NewsCandidate,
} from "./news";

const NOW = Date.parse("2026-11-07T15:00:00.000Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

let sequence = 0;

/** A Yahoo search result published `minutesAgo` before NOW. */
function raw(title: string, overrides: Partial<RawNewsItem> & { minutesAgo?: number } = {}): RawNewsItem {
  sequence += 1;
  const { minutesAgo = sequence, ...rest } = overrides;
  return {
    id: `uuid-${sequence}`,
    title,
    publisher: "Reuters",
    link: `https://finance.yahoo.com/news/story-${sequence}.html`,
    publishedAt: new Date(NOW - minutesAgo * MINUTE).toISOString(),
    relatedTickers: [],
    ...rest,
  };
}

function score(matcher: CompanyMatcher, title: string, extra: Partial<Pick<RawNewsItem, "publisher" | "relatedTickers">> = {}) {
  return companyScore({ title, publisher: "Reuters", relatedTickers: [], ...extra }, matcher);
}

function candidate(item: Partial<NewsItem> & Pick<NewsItem, "id" | "title">, candidateScore: number, time: number): NewsCandidate {
  return {
    item: { publisher: null, link: "https://example.com/a", publishedAt: null, relatedTickers: [], provenance: "macro", ...item },
    score: candidateScore,
    time,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  clearCache();
  searchNews.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("containsWord", () => {
  it("matches whole words only", () => {
    expect(containsWord("Analysts said margins improved", "ai")).toBe(false);
    expect(containsWord("AI demand lifts chip stocks", "ai")).toBe(true);
    expect(containsWord("Nvidia's AI-driven rally continues", "AI")).toBe(true);
    expect(containsWord("Warehouse REITs rally on demand", "war")).toBe(false);
    expect(containsWord("Oil jumps as war fears grow", "war")).toBe(true);
    expect(containsWord("Pineapple prices hit a record", "Apple")).toBe(false);
  });

  it("escapes regular-expression characters and normalizes apostrophes", () => {
    expect(containsWord("AT&T raises its guidance", "AT&T")).toBe(true);
    expect(containsWord("Amazonxcom traffic", "Amazon.com")).toBe(false);
    expect(containsWord("Amazon.com expands same-day delivery", "Amazon.com")).toBe(true);
    expect(containsWord("McDonald’s sales rise", "McDonald's")).toBe(true);
    expect(containsWord("Anything", "  ")).toBe(false);
  });
});

describe("brandToken", () => {
  it.each([
    ["Apple Inc.", "Apple"],
    ["NVIDIA Corporation", "NVIDIA"],
    ["Advanced Micro Devices, Inc.", "Advanced Micro Devices"],
    ["Merck & Co., Inc.", "Merck"],
    ["Eli Lilly and Company", "Eli Lilly"],
    ["JPMorgan Chase & Co.", "JPMorgan Chase"],
    ["Walt Disney Company (The)", "Walt Disney"],
    ["The Home Depot, Inc.", "Home Depot"],
    ["Procter & Gamble Company (The)", "Procter & Gamble"],
    ["Goldman Sachs Group, Inc. (The)", "Goldman Sachs"],
    ["UnitedHealth Group Incorporated", "UnitedHealth"],
    ["Berkshire Hathaway Inc. New", "Berkshire Hathaway"],
    ["Booking Holdings Inc. Common St", "Booking"],
    ["Constellation Energy Corporatio", "Constellation Energy"],
    ["Duke Energy Corporation (Holdin", "Duke Energy"],
    ["Amazon.com, Inc.", "Amazon"],
    ["Alphabet Inc. Class A", "Alphabet"],
    ["Alphabet Inc. Class C Capital Stock", "Alphabet"],
    ["Intercontinental Exchange Inc C", "Intercontinental Exchange"],
    ["Hewlett Packard Enterprise Comp", "Hewlett Packard Enterprise"],
    ["Ford Motor Company", "Ford Motor"],
    ["SLB N.V.", "SLB"],
    ["Linde plc", "Linde"],
    ["AT&T Inc.", "AT&T"],
    ["Lowe's Companies, Inc.", "Lowe's"],
    ["Johnson & Johnson", "Johnson & Johnson"],
  ])("%s -> %s", (name, expected) => {
    expect(brandToken(name)).toBe(expected);
  });
});

describe("shortBrand", () => {
  it("drops a generic trailing descriptor", () => {
    expect(shortBrand("Cisco Systems")).toBe("Cisco");
    expect(shortBrand("Meta Platforms")).toBe("Meta");
    expect(shortBrand("Air Products and Chemicals")).toBe("Air Products");
    expect(shortBrand("T-Mobile US")).toBe("T-Mobile");
    expect(shortBrand("Ford Motor")).toBe("Ford");
  });

  it("returns null when nothing distinctive would remain", () => {
    expect(shortBrand("General Motors")).toBeNull();
    expect(shortBrand("Apple")).toBeNull();
    expect(shortBrand("United Technologies")).toBeNull();
  });
});

describe("companyScore", () => {
  const apple = buildCompanyMatcher("AAPL", ["Apple Inc."]);

  it("counts the brand on word boundaries", () => {
    expect(score(apple, "Apple unveils its new iPhone lineup")).toBe(50);
    expect(score(apple, "Apple’s services revenue hits a record")).toBe(50);
    expect(score(apple, "Pineapple prices jump on weather")).toBe(0);
  });

  it("matches the bare ticker case-sensitively for tickers of three or more letters", () => {
    expect(score(apple, "AAPL slips in premarket trading")).toBe(50);
    expect(score(apple, "Unusual options activity in $AAPL")).toBe(50);
    expect(score(apple, "AAPLX fund rebalances")).toBe(0);

    const lowes = buildCompanyMatcher("LOW", ["Lowe's Companies, Inc."]);
    expect(score(lowes, "Stocks hit a new low as yields climb")).toBe(0);
    expect(score(lowes, "LOW shares rise after earnings")).toBe(50);
    expect(score(lowes, "Lowe’s beats estimates")).toBe(50);
  });

  it("treats relatedTickers containing the symbol as company evidence", () => {
    expect(score(apple, "Uber's robo push", { relatedTickers: ["AAPL", "GOOG", "TSLA", "UBER", "^GSPC"] })).toBe(40);
    expect(score(apple, "Margin pressure at a juice maker", { relatedTickers: ["LSDAF", "AAPL"] })).toBe(40);
    expect(score(apple, "Services revenue keeps climbing", { relatedTickers: ["AAPL", "MSFT"] })).toBe(45);
  });

  it("ignores a brand hit when Yahoo tagged only other companies (namesakes)", () => {
    expect(score(apple, "Apple Hospitality REIT Q3 earnings call highlights", { relatedTickers: ["APLE"] })).toBe(0);
    expect(score(apple, "Apple Hospitality REIT Q3 earnings call highlights", { relatedTickers: ["APLE", "^GSPC"] })).toBe(0);
  });

  it("does not read index, futures or crypto tags as another company", () => {
    expect(score(apple, "Apple leads the tech rebound as the Nasdaq climbs", { relatedTickers: ["^IXIC", "^GSPC"] })).toBe(50);
    expect(score(apple, "Apple slips as oil and bitcoin jump", { relatedTickers: ["CL=F", "BTC-USD"] })).toBe(50);
  });

  it("treats the company's other share classes as the same company", () => {
    // Yahoo tags Alphabet stories with GOOG even when a GOOGL search returns them.
    const alphabet = buildCompanyMatcher("GOOGL", ["Alphabet Inc."]);
    expect(score(alphabet, "Crusoe sells its Wyoming data center project to Google", { relatedTickers: ["CUES.PVT", "GOOG"] })).toBe(50);
    expect(score(alphabet, "Data centers are a key motor of growth", { relatedTickers: ["GOOG", "AMZN", "META", "MSFT"] })).toBe(40);
    expect(score(alphabet, "Search ad growth slows", { relatedTickers: ["GOOG", "META"] })).toBe(45);
    expect(score(alphabet, "Ark loads up on GOOG, AMD and NVDA")).toBe(50);

    const berkshire = buildCompanyMatcher("BRK-B", ["Berkshire Hathaway Inc. New"]);
    expect(score(berkshire, "Buffett trims a stake", { relatedTickers: ["BRK.B"] })).toBe(45);
    expect(score(berkshire, "Is it still a bargain after a 102% run (BRK.A)?")).toBe(50);
  });

  it("does not trust tags from publishers that tag their disclosure lists", () => {
    expect(score(apple, "Axon plunged to a 2-year low", { publisher: "Motley Fool", relatedTickers: ["AXON", "AAPL"] })).toBe(0);
    expect(score(apple, "Apple Hospitality (APLE) Q3 call transcript", { publisher: "Motley Fool", relatedTickers: ["APLE"] })).toBe(0);
  });

  it("only accepts one- and two-letter tickers in explicit forms or tags", () => {
    const att = buildCompanyMatcher("T", ["AT&T Inc."]);
    expect(score(att, "T-Mobile tops subscriber estimates")).toBe(0);
    expect(score(att, "Plan T: what the new rules mean")).toBe(0);
    expect(score(att, "AT&T (T) raises its dividend")).toBe(50);
    expect(score(att, "Unusual options activity in $T")).toBe(50);
    expect(score(att, "Telecom giant (NYSE: T) prices notes")).toBe(50);
    expect(score(att, "Better dividend stock: Verizon vs. AT&T")).toBe(50);
    expect(score(att, "Telecom stocks fall as SpaceX eyes spectrum", { relatedTickers: ["SPCX", "T", "VZ"] })).toBe(40);
    expect(score(att, "Wireless price war heats up", { relatedTickers: ["T", "VZ"] })).toBe(45);

    const philipMorris = buildCompanyMatcher("PM", ["Philip Morris International Inc"]);
    expect(score(philipMorris, "Markets close higher at 4 PM ET")).toBe(0);
    expect(score(philipMorris, "Philip Morris raises its outlook")).toBe(50);

    const c3 = buildCompanyMatcher("AI", ["C3.ai, Inc."]);
    expect(score(c3, "Analysts said AI stocks are stretched")).toBe(0);
    expect(score(c3, "C3.ai (AI) jumps on a federal contract")).toBe(50);
  });

  it("recognizes the short brand of a carmaker with a one-letter ticker", () => {
    const ford = buildCompanyMatcher("F", ["Ford Motor Company"]);
    expect(score(ford, "Ford recalls 500,000 SUVs")).toBe(50);
    expect(score(ford, "F-150 sales jump")).toBe(0);
  });

  it("needs Yahoo's tag before counting a brand that is an everyday word", () => {
    const visa = buildCompanyMatcher("V", ["Visa Inc."]);
    expect(score(visa, "White House raises H-1B visa fees")).toBe(0);
    expect(score(visa, "Visa raises its dividend 16%", { relatedTickers: ["V"] })).toBe(50);
    expect(score(visa, "Visa (V) Q4 earnings beat estimates")).toBe(50);
  });

  it("recognizes share-class ticker spellings", () => {
    const berkshire = buildCompanyMatcher("BRK-B", ["Berkshire Hathaway Inc. New"]);
    expect(score(berkshire, "Berkshire (BRK.B) adds to its Chevron stake")).toBe(50);
    expect(score(berkshire, "Berkshire Hathaway trims its Apple position")).toBe(50);
  });

  it("does not match a brand inside a longer word", () => {
    const meta = buildCompanyMatcher("META", ["Meta Platforms, Inc."]);
    expect(score(meta, "Metals rally as the dollar slips")).toBe(0);
    expect(score(meta, "Meta lifts its AI spending forecast")).toBe(50);
  });
});

describe("buildCompanyMatcher search term", () => {
  it("prefers the long name and skips ambiguous or ticker-like brands", () => {
    expect(buildCompanyMatcher("AAPL", ["Apple Inc."]).searchTerm).toBe("Apple");
    expect(buildCompanyMatcher("CSCO", ["Cisco Systems, Inc."]).searchTerm).toBe("Cisco");
    expect(buildCompanyMatcher("BKNG", ["Booking Holdings Inc.", "Booking Holdings Inc. Common St"]).searchTerm).toBe(
      "Booking Holdings",
    );
    expect(buildCompanyMatcher("RTX", ["RTX Corporation"]).searchTerm).toBe("Raytheon");
    expect(buildCompanyMatcher("META", ["Meta Platforms, Inc."]).searchTerm).toBe("Meta Platforms");
    expect(buildCompanyMatcher("V", ["Visa Inc."]).searchTerm).toBeNull();
  });
});

describe("isSpam", () => {
  it.each([
    "3 Stocks to Buy Before Earnings",
    "Top 10 Dividend Stocks for 2027",
    "Is Nvidia Stock a Buy Now?",
    "This AI Stock Could Soar 50%",
    "A Millionaire-Maker Stock for Patient Investors",
    "Better Stock Split to Buy: Meta Platforms vs. Sandisk",
    "5 Latest Jim Cramer Stock Picks on Twitter",
    "AT&T Stock Falls 11.8% in a Year: Should You Buy the Dip?",
    "It's a No-Brainer for Income Investors",
    "How Much Passive Income $800,000 in AT&T Pays Each Year",
    "Prediction: Berkshire Hathaway Stock Tops $700 a Share Before 2030",
    "Buy This Stock Before It Soars",
    "2 Stocks That Could Double",
    "Is Visa a Buy Right Now?",
    "3 Things You Need to Know About Apple",
    "Not Alphabet. Not Meta. This Is the Digital Advertising Stock I’d Buy Right Now.",
    "I Just Bought More of This Dividend Stock",
  ])("flags %s", (title) => {
    expect(isSpam(title)).toBe(true);
  });

  it.each([
    "Nvidia agrees to buy startup for $2 billion",
    "Stock market today: Nasdaq rebounds as chip stocks recover",
    "These 4 Trump-backed chip stocks have seen steeper losses",
    "Goldman reiterates buy rating on Apple",
    "3M shares fall after guidance cut",
    "S&P 500 stocks slide as yields climb",
    // Ordinary market news that broader patterns used to drop from the market and sector feeds.
    "Dow could top 50,000 by year-end, strategists say",
    "Nvidia could top 5 trillion in market value",
    "Treasury yields skyrocket after a hot jobs report",
    "Steel tariffs could double costs for automakers",
    "5 things to know before the stock market opens Monday",
    "5 things investors should know about the Fed meeting",
    "Shoppers rush to buy before tariffs hit",
    "Millionaire tax proposal advances in Congress",
    "Apple to spend $100 billion on shares to buy back",
  ])("keeps %s", (title) => {
    expect(isSpam(title)).toBe(false);
  });
});

describe("normalizeTitle", () => {
  it("collapses punctuation, apostrophes and wire decorations", () => {
    expect(normalizeTitle("UPDATE 2-Nvidia rallies on AI demand - Reuters")).toBe("nvidia rallies on ai demand");
    expect(normalizeTitle("Nvidia’s Rally!")).toBe(normalizeTitle("nvidia's rally"));
  });
});

describe("scoreCompanyCandidate", () => {
  const apple = buildCompanyMatcher("AAPL", ["Apple Inc."]);

  it("drops results of the company searches that are not about the company", () => {
    expect(scoreCompanyCandidate(raw("Dow futures slip ahead of jobs data"), "company", apple, NOW)).toBeNull();
  });

  it("gives context stories their track's baseline", () => {
    const industry = scoreCompanyCandidate(raw("Smartphone sales slump to a record low"), "industry", apple, NOW);
    expect(industry).toMatchObject({ score: 20, item: { provenance: "industry" } });
    const macro = scoreCompanyCandidate(raw("Tech earnings face a show-me moment"), "macro", apple, NOW);
    expect(macro).toMatchObject({ score: 15, item: { provenance: "macro" } });
  });

  it("promotes context stories that name the company", () => {
    const promoted = scoreCompanyCandidate(raw("Can Apple turn tech earnings around?"), "macro", apple, NOW);
    expect(promoted).toMatchObject({ score: 50, item: { provenance: "company" } });
  });

  it("ranks company clickbait below all context and drops context clickbait", () => {
    const spam = scoreCompanyCandidate(raw("Is Apple Stock a Buy Now?"), "company", apple, NOW);
    expect(spam?.item.provenance).toBe("company");
    expect(spam?.score).toBeLessThan(15);
    expect(scoreCompanyCandidate(raw("3 Smartphone Stocks to Buy Now"), "industry", apple, NOW)).toBeNull();
  });

  it("drops stale context but keeps old company stories", () => {
    const old = 40 * DAY / MINUTE;
    expect(scoreCompanyCandidate(raw("Smartphone sales slump", { minutesAgo: old }), "industry", apple, NOW)).toBeNull();
    expect(scoreCompanyCandidate(raw("Apple opens a new campus", { minutesAgo: old }), "company", apple, NOW)).not.toBeNull();
  });

  it("lets fresh tag-only mentions pass company headlines older than two weeks", () => {
    const aged = scoreCompanyCandidate(raw("Apple opens a new campus", { minutesAgo: 20 * DAY / MINUTE }), "company", apple, NOW);
    const fresh = scoreCompanyCandidate(raw("Services revenue keeps climbing", { relatedTickers: ["AAPL"] }), "company", apple, NOW);
    expect(aged).toMatchObject({ score: 40, item: { provenance: "company" } });
    expect(fresh?.score).toBe(45);
  });

  it("rejects non-http links and sanitizes related tickers", () => {
    expect(scoreCompanyCandidate(raw("Apple news", { link: "javascript:alert(1)" }), "company", apple, NOW)).toBeNull();
    const scored = scoreCompanyCandidate(
      raw("Apple news", { relatedTickers: ["AAPL", "forecast", "SPCX\nNASDAQ", "AAPL"] }),
      "company",
      apple,
      NOW,
    );
    expect(scored?.item.relatedTickers).toEqual(["AAPL"]);
  });
});

describe("dedupeCandidates", () => {
  it("prefers company provenance for the same id", () => {
    const result = dedupeCandidates([
      candidate({ id: "a", title: "Chip stocks rebound", provenance: "macro" }, 15, 2),
      candidate({ id: "a", title: "Chip stocks rebound", provenance: "company" }, 40, 1),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].item.provenance).toBe("company");
  });

  it("collapses syndicated copies with the same normalized headline", () => {
    const result = dedupeCandidates([
      candidate({ id: "a", title: "Nvidia rallies on AI demand", provenance: "industry" }, 20, 5),
      candidate({ id: "b", title: "NVIDIA Rallies on AI Demand!", provenance: "company" }, 50, 1),
      candidate({ id: "c", title: "Something else entirely", provenance: "macro" }, 15, 3),
    ]);
    expect(result.map((c) => c.item.id)).toEqual(["b", "c"]);
  });

  it("keeps the higher score, then the newer story, within the same provenance", () => {
    const higher = dedupeCandidates([
      candidate({ id: "a", title: "Same story", provenance: "company" }, 40, 9),
      candidate({ id: "b", title: "Same story", provenance: "company" }, 50, 1),
    ]);
    expect(higher[0].item.id).toBe("b");
    const newer = dedupeCandidates([
      candidate({ id: "a", title: "Same story", provenance: "market" }, 0, 1),
      candidate({ id: "b", title: "Same story", provenance: "market" }, 0, 9),
    ]);
    expect(newer[0].item.id).toBe("b");
  });

  it("keeps one copy when a story's headline changed between searches", () => {
    const result = dedupeCandidates([
      candidate({ id: "a", title: "Old headline", provenance: "macro" }, 15, 1),
      candidate({ id: "b", title: "New headline", provenance: "industry" }, 20, 2),
      candidate({ id: "a", title: "New headline", provenance: "company" }, 50, 3),
    ]);
    expect(result.map((c) => [c.item.id, c.item.title, c.item.provenance])).toEqual([["a", "New headline", "company"]]);
  });
});

describe("seriesKey and buildFeed", () => {
  it("identifies a publisher's running series by the multi-word prefix before a colon", () => {
    expect(seriesKey({ title: "Sector Update: Tech Stocks Rise", publisher: "MT Newswires" })).toBe("mt newswires|sector update");
    expect(seriesKey({ title: "Update: Nasdaq rebounds", publisher: "MT Newswires" })).toBeNull();
    expect(seriesKey({ title: "Sector Update: Tech", publisher: null })).toBeNull();
    expect(seriesKey({ title: "No colon here", publisher: "Reuters" })).toBeNull();
  });

  it("keeps only the latest installment of a series, newest first", () => {
    const feed = buildFeed(
      [
        raw("Sector Update: Tech Stocks Rise Premarket", { publisher: "MT Newswires", minutesAgo: 300 }),
        raw("Sector Update: Tech Stocks Gain Late Afternoon", { publisher: "MT Newswires", minutesAgo: 20 }),
        raw("Sector Update: Tech", { publisher: "Other Wire", minutesAgo: 40 }),
        raw("Chipmakers rebound after rout", { minutesAgo: 30 }),
      ],
      "sector",
      NOW,
    );
    expect(feed.map((n) => n.title)).toEqual([
      "Sector Update: Tech Stocks Gain Late Afternoon",
      "Chipmakers rebound after rout",
      "Sector Update: Tech",
    ]);
    expect(feed.every((n) => n.provenance === "sector")).toBe(true);
  });
});

describe("search plans", () => {
  it("maps Yahoo industries to short context searches", () => {
    expect(industryQueries("Semiconductors")).toEqual(["chip stocks", "AI chips"]);
    expect(industryQueries("Semiconductor Equipment & Materials")).toEqual(["chip equipment", "chip stocks"]);
    expect(industryQueries("Banks - Diversified")).toEqual(["bank earnings", "interest rates"]);
    expect(industryQueries("Oil & Gas Integrated")).toEqual(["oil prices", "oil majors"]);
    expect(industryQueries("Utilities - Renewable")).toEqual(["clean energy", "power demand"]);
    expect(industryQueries("Waste Management")).toEqual(["Waste Management"]);
    expect(industryQueries("Staffing & Employment Services")).toEqual(["Staffing Employment"]);
    expect(industryQueries(null)).toEqual([]);
  });

  it("picks a macro search the plan does not already use", () => {
    expect(macroQuery("Technology", new Set())).toBe("tech earnings");
    expect(macroQuery("Energy", new Set(["oil prices"]))).toBe("OPEC");
    expect(macroQuery(null, new Set())).toBe("stock market");
  });

  it("plans ticker, brand, industry and macro searches without repeats", () => {
    const apple = buildCompanyMatcher("AAPL", ["Apple Inc."]);
    expect(planCompanyQueries(apple, { industry: "Consumer Electronics", sector: "Technology" })).toEqual([
      { term: "AAPL", track: "company", count: 20 },
      { term: "Apple", track: "company", count: 20 },
      { term: "smartphone sales", track: "industry" },
      { term: "consumer electronics", track: "industry" },
      { term: "tech earnings", track: "macro" },
    ]);

    const exxon = buildCompanyMatcher("XOM", ["ExxonMobil Holdings Corporation"]);
    const exxonPlan = planCompanyQueries(exxon, { industry: "Oil & Gas Integrated", sector: "Energy" });
    expect(exxonPlan.map((q) => q.term)).toEqual(["XOM", "ExxonMobil", "oil prices", "oil majors", "OPEC"]);

    const visa = buildCompanyMatcher("V", ["Visa Inc."]);
    expect(planCompanyQueries(visa, null).map((q) => q.term)).toEqual(["V", "stock market"]);
  });
});

describe("getCompanyNews", () => {
  const profile = {
    symbol: "AAPL",
    name: "Apple Inc.",
    longName: "Apple Inc.",
    sector: "Technology",
    industry: "Consumer Electronics",
    exchange: "NasdaqGS",
    currency: "USD",
    country: "United States",
    website: null,
    employees: null,
    summary: null,
  };

  it("scores, de-duplicates, ranks and registers company and context news", async () => {
    const named = raw("Apple unveils a cheaper iPhone", { relatedTickers: ["AAPL"], minutesAgo: 30 });
    const namedCopy = { ...named, relatedTickers: ["AAPL"] };
    const tagged = raw("Big Tech sell-off deepens", { relatedTickers: ["AAPL", "MSFT", "NVDA", "GOOG"], minutesAgo: 5 });
    const namesake = raw("Apple Hospitality REIT Q3 earnings call highlights", { relatedTickers: ["APLE"], minutesAgo: 1 });
    const clickbait = raw("Is Apple Stock a Buy Now?", { relatedTickers: ["AAPL"], minutesAgo: 2 });
    const context = raw("AI boom triggers record slump in smartphone sales", { minutesAgo: 60 });
    const staleContext = raw("PC and smartphone sales to decline", { minutesAgo: 60 * DAY / MINUTE });
    const promoted = raw("Tech earnings: can Apple turn things around?", { relatedTickers: ["AAPL", "MSFT", "INTC"], minutesAgo: 10 });

    const responses: Record<string, RawNewsItem[]> = {
      AAPL: [named, tagged, namesake, clickbait],
      Apple: [namedCopy, namesake],
      "smartphone sales": [context, staleContext],
      "tech earnings": [promoted],
    };
    searchNews.mockImplementation(async (query) => {
      if (query === "consumer electronics") throw new Error("Yahoo timeout");
      return responses[query] ?? [];
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const news = await getCompanyNews("AAPL", "Apple Inc.", profile);

    expect(news.map((n) => [n.title, n.provenance])).toEqual([
      ["Tech earnings: can Apple turn things around?", "company"],
      ["Apple unveils a cheaper iPhone", "company"],
      ["Big Tech sell-off deepens", "company"],
      ["AI boom triggers record slump in smartphone sales", "industry"],
      ["Is Apple Stock a Buy Now?", "company"],
    ]);
    expect(searchNews).toHaveBeenCalledWith("AAPL", 20);
    expect(searchNews).toHaveBeenCalledWith("Apple", 20);
    expect(findNewsById(named.id)).toEqual(news[1]);
    expect(findNewsById(context.id)?.provenance).toBe("industry");
  });

  it("keeps Alphabet stories that Yahoo files under the other share class", async () => {
    const story = raw("Google buys a Wyoming data center site", { relatedTickers: ["CUES.PVT", "GOOG", "MSFT"] });
    const unrelated = raw("Crusoe raises new funding", { relatedTickers: ["CUES.PVT"] });
    searchNews.mockImplementation(async (query) => (query === "GOOGL" ? [story, unrelated] : []));

    const news = await getCompanyNews("GOOGL", "Alphabet Inc.", null);

    expect(news.map((n) => [n.title, n.provenance])).toEqual([[story.title, "company"]]);
  });

  it("returns at most twelve items", async () => {
    searchNews.mockImplementation(async (query) =>
      query === "AAPL" ? Array.from({ length: 20 }, (_, i) => raw(`Apple story number ${i + 1}`)) : [],
    );
    expect(await getCompanyNews("AAPL", "Apple Inc.", profile)).toHaveLength(12);
  });

  it("fails only when every search fails", async () => {
    searchNews.mockRejectedValue(new Error("Yahoo is down"));
    await expect(getCompanyNews("AAPL", "Apple Inc.", null)).rejects.toThrow("All news searches failed");
  });
});

describe("getMarketNews", () => {
  it("merges the searches newest first without clickbait, stale stories or duplicates", async () => {
    const recap = raw("Stock market today: Nasdaq rebounds", { relatedTickers: ["^IXIC"], minutesAgo: 10 });
    const fed = raw("Fed's Daly says further hikes may be needed", { minutesAgo: 30 });
    const responses: Record<string, RawNewsItem[]> = {
      "stock market": [recap, raw("5 Stocks to Buy Before the Fed Meets", { minutesAgo: 1 })],
      inflation: [raw("Stock Market Today: Nasdaq Rebounds!", { id: "copy", minutesAgo: 12 }), fed],
      "Federal Reserve": [raw("What the Fed did in 2025", { minutesAgo: 90 * DAY / MINUTE })],
    };
    searchNews.mockImplementation(async (query) => {
      if (query === "Treasury yields") throw new Error("timeout");
      return responses[query] ?? [];
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const news = await getMarketNews();

    expect(news.map((n) => n.title)).toEqual(["Stock market today: Nasdaq rebounds", "Fed's Daly says further hikes may be needed"]);
    expect(news.every((n) => n.provenance === "market")).toBe(true);
    expect(findNewsById(recap.id)?.title).toBe(recap.title);
  });

  it("caps the feed at twelve items", async () => {
    searchNews.mockImplementation(async (query) => Array.from({ length: 8 }, (_, i) => raw(`${query} headline ${i + 1}`)));
    expect(await getMarketNews()).toHaveLength(12);
  });
});

describe("getSectorNews", () => {
  it("searches the sector's queries and its ETF ticker", async () => {
    searchNews.mockImplementation(async (query) => [raw(`Sector story for ${query}`)]);
    const news = await getSectorNews("technology");
    expect(searchNews.mock.calls.map(([query]) => query)).toEqual(["semiconductor stocks", "tech earnings", "XLK"]);
    expect(news).toHaveLength(3);
    expect(news.every((n) => n.provenance === "sector")).toBe(true);
  });
});

describe("findNewsById", () => {
  it("returns undefined for unknown or oversized ids", () => {
    expect(findNewsById("missing")).toBeUndefined();
    expect(findNewsById("x".repeat(200))).toBeUndefined();
    expect(findNewsById("")).toBeUndefined();
  });
});
