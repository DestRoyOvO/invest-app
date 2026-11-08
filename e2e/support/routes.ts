import { expect, type Page, type StoredData } from "./test";

// Every page of the app with representative parameters, shared by the route sweep (e2e/specs/routes.spec.ts) and the
// accessibility checks (e2e/specs/a11y.spec.ts). Each case knows how to tell that its page has loaded its data, with
// web-first assertions on roles and accessible names (panels are regions named by their title), so the checks that
// follow look at a settled page rather than at skeletons.
//
// The sweep fails when a page.tsx under app/ has no case here, so a new page needs one.

/**
 * What the sweep and the accessibility checks keep in the browser: a watchlist with a fund and a crypto pair, four
 * positions (one a fund, one a stock outside the heatmap universe, whose sector the exposure tab looks up) and a thesis
 * note, so the personal pages (watchlist, portfolio, notes, data) show their tables and the quote pages their position
 * lines, instead of empty states.
 */
export const SAMPLE_DATA = {
  watchlist: ["NVDA", "AAPL", "MSFT", "SPY", "BTC-USD"],
  holdings: { AAPL: { shares: 10, cost: 150 }, MSFT: { shares: 5, cost: 300 }, SPY: { shares: 3, cost: 400 }, PLTR: { shares: 20, cost: 25 } },
  notes: {
    AAPL: {
      thesis: "Services keep growing faster than hardware.",
      conviction: 4,
      target: 340,
      stop: 260,
      reviewBy: "2026-12-01",
      tags: ["quality"],
      entries: [{ at: "2026-11-02T15:00:00.000Z", price: 305.2, text: "Raised the target after the services numbers.", kind: "note" }],
      updatedAt: "2026-11-02T15:00:00.000Z",
    },
  },
} satisfies StoredData;

/** Expected noise, matched against the console line ("text (url)") or the response ("status METHOD url"). */
export interface Allowance {
  pattern: RegExp;
  reason: string;
}

export interface RouteCase {
  /** Path and query to open. */
  path: string;
  /** Status of the document (default 200). */
  status?: number;
  /** The path the page ends on when it redirects. */
  finalPath?: string;
  /** Passes once the page's main panel shows its data. */
  ready: (page: Page) => Promise<void>;
  /**
   * API routes (paths, without the query) the page must have loaded with status 200, so the sweep is known to reach
   * every data route of the page, e.g. each panel route of the quote page. Left out where pending work may change
   * which route a page reads.
   */
  apis?: readonly string[];
  /** Console errors this page logs on purpose. */
  console?: Allowance[];
  /** Same-origin responses with a status of 400 or more that this page gets on purpose. */
  responses?: Allowance[];
  /**
   * An app bug that answers this route with another document status, accepted for this route alone until its owner
   * fixes it (the test then notes that the allowance can go).
   */
  knownStatus?: { status: number; reason: string };
}

/** A price as the app formats it: 1,234.56 (FX quotes keep four decimals). */
const PRICE = /\d{1,3}(?:,\d{3})*\.\d{2}/;
/** A change in percent with its sign: +0.39%, −0.36%, 0.00%. */
const CHANGE = String.raw`[+−]?\d+\.\d{2}%`;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function region(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

/** The quote header (a region named by the symbol, once the quote is in) and the chart's text summary of its bars. */
async function quoteReady(page: Page, symbol: string): Promise<void> {
  await expect(region(page, symbol)).toContainText(PRICE);
  // The summary is for screen readers (sr-only), so it is attached rather than visible.
  await expect(region(page, "Price").getByText(new RegExp(`^${escapeRegExp(symbol)} \\S+: low [\\d,.]+, high [\\d,.]+, last [\\d,.]+ on `))).toBeAttached();
}

/** The first data row of a table inside a panel (row 0 is the header). */
async function firstRow(page: Page, panel: string, table?: string | RegExp): Promise<void> {
  const scope = table === undefined ? region(page, panel) : region(page, panel).getByRole("table", { name: table });
  await expect(scope.getByRole("row").nth(1)).toBeVisible();
}

const overviewReady = async (page: Page) => {
  await expect(region(page, "Markets").getByRole("link", { name: new RegExp(`^S&P 500 SPX [\\d,]+\\.\\d{2} ${CHANGE}$`) })).toBeVisible();
};

/** Every panel of a quote page asks its own route, and each answers 404 for a symbol the data source does not know. */
const UNKNOWN_SYMBOL = "The stock API and its panel routes answer 404 for a symbol the data source does not know.";

export const ROUTES: readonly RouteCase[] = [
  // Markets
  { path: "/", ready: overviewReady },
  {
    path: "/markets",
    ready: async (page) => {
      await expect(region(page, "US Treasury curve").getByRole("table", { name: "Key tenors" }).getByRole("row", { name: /^10Y \d+\.\d{2}% / })).toBeVisible();
      const nikkei = region(page, "World markets").getByRole("row").filter({ has: page.getByRole("link", { name: "NKY Nikkei 225" }) });
      await expect(nikkei).toContainText(PRICE);
    },
    apis: ["/api/markets/world", "/api/rates/curve"],
  },
  {
    path: "/sector/technology",
    ready: async (page) => {
      await expect(region(page, "Constituents").getByRole("row", { name: new RegExp(`^NVDA\\b.*?[\\d,]+\\.\\d{2} ${CHANGE}`) })).toBeVisible();
    },
    apis: ["/api/quotes", "/api/news", "/api/history"],
  },
  {
    path: "/screener",
    ready: async (page) => {
      await expect(region(page, "Results").getByRole("table", { name: /^Screener results/ }).getByRole("link", { name: "NVDA", exact: true })).toBeVisible();
    },
    apis: ["/api/screener"],
  },
  { path: "/screener?tab=discover", ready: (page) => firstRow(page, "Market movers", /^Gainers/), apis: ["/api/discover"] },

  // Portfolio
  {
    path: "/watchlist",
    ready: async (page) => {
      await expect(region(page, "Watchlist").getByRole("row", { name: new RegExp(`^BTC-USD .*[\\d,]+\\.\\d{2} .*${CHANGE}`) })).toBeVisible();
      // Ten shares and their profit since the 150.00 cost, which needs the quote.
      await expect(region(page, "Positions").getByRole("row", { name: /^AAPL 10\b.*[+−][\d,]+\.\d{2}/ })).toBeVisible();
    },
  },
  {
    path: "/portfolio",
    ready: async (page) => {
      // The chart of today's holdings over the range needs the price history of every position.
      await expect(region(page, "Portfolio analytics").getByRole("img", { name: /^Today's holdings [+−]?\d/ })).toBeVisible();
    },
    apis: ["/api/quotes", "/api/history"],
  },
  {
    path: "/portfolio?tab=exposure",
    ready: async (page) => {
      await expect(region(page, "Portfolio analytics").getByRole("list", { name: "Sector" }).getByRole("listitem").first()).toBeVisible();
    },
    // PLTR is outside the heatmap universe, so its sector comes from its profile.
    apis: ["/api/history", "/api/profiles"],
  },
  { path: "/portfolio?tab=risk", ready: (page) => firstRow(page, "Portfolio analytics", "Risk by position") },
  {
    path: "/portfolio?tab=correlation",
    ready: async (page) => {
      await expect(region(page, "Correlation of daily returns").getByRole("row", { name: /^AAPL 1 / })).toBeVisible();
    },
  },
  {
    path: "/calendar",
    ready: async (page) => {
      // The filter chips count the events once the feed is in.
      await expect(region(page, "Events calendar").getByRole("button", { name: /^Watchlist \d+ events?$/ })).toBeVisible();
    },
    apis: ["/api/calendar"],
  },
  {
    path: "/alerts",
    ready: async (page) => {
      await expect(region(page, "Rules").getByRole("list", { name: "Create an alert for" }).getByRole("button", { name: "BTC-USD" })).toBeVisible();
    },
  },
  {
    path: "/notes",
    ready: async (page) => {
      // The distance of the target from the last price needs the quote.
      await expect(region(page, "Notes").getByRole("row", { name: /^AAPL Services keep growing .*\d\.\d{2}[+−]\d+\.\d%/ })).toBeVisible();
    },
  },

  // Research
  {
    path: "/stock/AAPL",
    ready: async (page) => {
      await quoteReady(page, "AAPL");
      await expect(region(page, "Key statistics")).toContainText("Market cap");
    },
    // Every panel of the overview reads a route of its own; AAPL reports within 30 days, so the implied move is read too.
    apis: ["", "/chart", "/signal", "/factors", "/news", "/earnings", "/analysts", "/implied-move"].map((part) => `/api/stock/AAPL${part}`),
  },
  {
    path: "/stock/AAPL?tab=financials",
    ready: async (page) => {
      await expect(region(page, "Financials").getByRole("row", { name: /^Revenue [\d.]+[KMBT] / })).toBeVisible();
    },
    apis: ["/api/stock/AAPL/financials"],
  },
  {
    path: "/stock/AAPL?tab=earnings",
    ready: async (page) => {
      await expect(region(page, "Earnings").getByRole("table", { name: "Reported quarters" }).getByRole("row", { name: /^[1-4]Q\d{4}/ }).first()).toBeVisible();
    },
    apis: ["/api/stock/AAPL/earnings", "/api/stock/AAPL/implied-move"],
  },
  { path: "/stock/AAPL?tab=analysts", ready: (page) => firstRow(page, "Analysts", "Recent actions"), apis: ["/api/stock/AAPL/analysts"] },
  { path: "/stock/AAPL?tab=dividends", ready: (page) => firstRow(page, "Recent payments"), apis: ["/api/stock/AAPL/dividends"] },
  { path: "/stock/AAPL?tab=ownership", ready: (page) => firstRow(page, "Top institutions"), apis: ["/api/stock/AAPL/ownership"] },
  // A fund: only the overview and dividends tabs.
  { path: "/stock/SPY", ready: (page) => quoteReady(page, "SPY"), apis: ["/api/stock/SPY", "/api/stock/SPY/chart"] },
  { path: "/stock/SPY?tab=dividends", ready: (page) => firstRow(page, "Recent payments"), apis: ["/api/stock/SPY/dividends"] },
  // An index, a crypto pair, a currency pair, a future and a Hong Kong listing: the overview only.
  { path: "/stock/%5EGSPC", ready: (page) => quoteReady(page, "^GSPC") },
  { path: "/stock/BTC-USD", ready: (page) => quoteReady(page, "BTC-USD") },
  { path: "/stock/EURUSD%3DX", ready: (page) => quoteReady(page, "EURUSD=X") },
  { path: "/stock/GC%3DF", ready: (page) => quoteReady(page, "GC=F") },
  { path: "/stock/0700.HK", ready: (page) => quoteReady(page, "0700.HK") },
  {
    path: "/stock/ZZZZ",
    status: 404,
    knownStatus: {
      status: 200,
      reason:
        "soft 404: app/(terminal)/stock/[symbol]/page.tsx (int/pages) answers 200 and StockView shows the not-found view only after /api/stock/ZZZZ answers 404",
    },
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 1, name: "No match for ZZZZ" })).toBeVisible();
    },
    console: [{ pattern: /status of 404 \(Not Found\) \(http:\/\/[^/]+\/api\/stock\/ZZZZ(?:[/?][^)]*)?\)$/, reason: UNKNOWN_SYMBOL }],
    responses: [{ pattern: /^404 GET http:\/\/[^/]+\/api\/stock\/ZZZZ(?:[/?]\S*)?$/, reason: UNKNOWN_SYMBOL }],
  },

  // Tools
  {
    path: "/lab",
    ready: (page) => firstRow(page, "Factor tests", "Rank IC of each pre-registered factor at each horizon"),
  },
  {
    path: "/data",
    ready: async (page) => {
      await expect(region(page, "Stored in this browser").getByRole("row", { name: /^Watchlist 5 / })).toBeVisible();
    },
  },
  {
    path: "/help",
    ready: async (page) => {
      await expect(region(page, "Keyboard shortcuts").getByRole("listitem").first()).toBeVisible();
    },
  },
  // A public site has nothing to unlock: the page sends visitors home.
  { path: "/unlock", finalPath: "/", ready: overviewReady },
  {
    path: "/no-such-page",
    status: 404,
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 1, name: /^ERR 404/ })).toBeVisible();
    },
    console: [{ pattern: /status of 404 \(Not Found\) \(http:\/\/[^/]+\/no-such-page\)$/, reason: "The document of an unknown path answers 404." }],
    responses: [{ pattern: /^404 GET http:\/\/[^/]+\/no-such-page$/, reason: "The document of an unknown path answers 404." }],
  },
];

/** The case for a path; throws for a path the catalog does not have. */
export function routeCase(path: string): RouteCase {
  const found = ROUTES.find((route) => route.path === path);
  if (!found) throw new Error(`No route case for ${path} in e2e/support/routes.ts`);
  return found;
}
