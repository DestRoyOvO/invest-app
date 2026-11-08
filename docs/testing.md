# Testing InvestSeek

Three layers, none of which calls Yahoo or DeepSeek:

- **Unit tests** (Vitest): pure functions, server modules, the fixture data generator and the mock model.
- **End-to-end tests** (Playwright): the production build in a real browser, with synthetic market data
  (`MARKET_DATA_SOURCE=fixtures`), a mock model behind the AI features, no network access for the server and a
  pinned clock.
- **Accessibility checks** (axe-core): part of the end-to-end suite.

The live Yahoo contract is covered separately by the canary (`scripts/smoke-yahoo.ts`, see
[docs/deployment.md](deployment.md#yahoo-canary)).

- [Unit tests](#unit-tests)
- [Fixture mode](#fixture-mode)
- [Reserved symbols and AI scenarios](#reserved-symbols-and-ai-scenarios)
- [End-to-end tests](#end-to-end-tests)
- [Accessibility](#accessibility)
- [CI](#ci)
- [Current state](#current-state)
- [Screenshots](#screenshots)

## Unit tests

```bash
npm test            # once
npm run test:watch  # while editing
npm run check       # lint, typecheck and unit tests, as CI runs them
```

Tests live next to the code as `*.test.ts`. Server modules import `server-only`, so their tests start with
`vi.mock("server-only", () => ({}))`. A test that needs market data either spies on the shared `yf` client
(`vi.spyOn(yf, "quote")`) or switches the whole data source to fixtures with `vi.stubEnv("MARKET_DATA_SOURCE", "fixtures")`
and runs the app's real getters, as `lib/server/fixtures/app-data.test.ts` does. AI code is tested against a mocked
OpenAI SDK or against the mock model (`e2e/mock-llm.test.ts`).

The fixture generator has its own tests in `lib/server/fixtures`:

| Test | Checks |
|---|---|
| `schema.test.ts` | Every method's output passes yahoo-finance2's own result schemas, and the library's validator would not coerce any value (Dates where it returns Dates, numbers where it returns numbers). |
| `client.test.ts` | The unknown-symbol answers of every method, compared with what yahoo-finance2 itself makes of Yahoo's error answers (fed through a stub fetch); module availability per quote type; dispatch at call time. |
| `company.test.ts` | Sweeps every session of two years: earnings schedules report consecutive quarters, each at least 15 days after it ended, the last before now and the next after it; past dividends lie before the latest session; the quote and quoteSummary show the same trailing EPS and P/E before the open, during the session and after the close. |
| `sessions.test.ts` | NYSE holidays against the published calendars, special closures, session times across daylight saving time, the FX week from Sunday to Friday 17:00 New York time, the latest completed session, the market state. |
| `prices.test.ts` | A bar never changes once its session closed, OHLC consistency, long histories within 20 times the anchor price, first trading days of later listings, ^VIX and yields in range, the dollar index against ICE's published formula over its six currencies, funds that move with their index, intraday bars that match their daily bar, extended-hours trades that match the chart (and none for indices). |
| `app-data.test.ts` | The data through the app's own getters and mappers, with content checks rather than presence: quotes, summaries, bars, search, news (market, sector, company, stock; instrument headlines rather than press releases for funds, indices, yields, crypto, currencies and futures), the overview and the shell's board, screens and every discover screen, the stock and ETF screeners, factor profiles, the calendar, the signal, the earnings detail (its quarters sum to the quote's trailing EPS), analyst activity (actions on trading days during New York business hours, each firm starting from its previous grade), options for US listings only, the implied move, financial statements (for every stock of the universe: net, operating and gross margins in that order, moving between periods, earnings that follow revenue, the dividend history paid out in the cash flow), dividends, ownership (the trades of the company's own officers on trading days), headcounts, insider holdings, leverage and betas that agree with the balance sheet and the price history, the 1d, 5d, ytd, 5y and max chart ranges, the Treasury curve through `getYieldCurve()`'s default fetch (its 10-year agrees with ^TNX), the world board, aligned history, profiles and every kind of AI context. `fetch` and `node:https` are stubbed and the file fails if any getter reached for the network. |
| `treasury.test.ts` | The Treasury CSV columns, its agreement with ^TNX and ^IRX, and `treasuryFetch` choosing the fixture or the network by data source. |

## Fixture mode

`MARKET_DATA_SOURCE=fixtures` makes the server answer every market data request from a deterministic generator
(`lib/server/fixtures`) instead of Yahoo. It exists for the end-to-end tests and for screenshots; never use it for a real
deployment, because the prices are made up.

How it works: every Yahoo call goes through the shared `yf` client of `lib/server/yahoo.ts`. That client is wrapped
(`lib/server/fixtures/client.ts`) so that each method (`quote`, `chart`, `quoteSummary`, `search`, `screener`,
`trendingSymbols`, `options`, `fundamentalsTimeSeries`) decides at call time, from `MARKET_DATA_SOURCE`, whether the real
client or the generator answers. One build serves both modes. The caches do not know the mode, so restart a running
server after changing `MARKET_DATA_SOURCE`.

What the mode guarantees:

- **No network access for market data.** News stories link to `https://example.com/fixtures/news/<id>`, and the article
  reader answers those with canned text (every other link counts as unavailable). The Treasury curve comes from a
  fetch-compatible stand-in: `getYieldCurve` (`lib/server/rates.ts`) downloads through `treasuryFetch`
  (`lib/server/fixtures/treasury.ts`) unless a `fetchImpl` is passed, and `treasuryFetch` answers from the fixture CSV
  while `MARKET_DATA_SOURCE=fixtures` (the same curve model as ^IRX, ^FVX, ^TNX and ^TYX, newest row first, in Treasury's
  columns) and with the global `fetch` otherwise, per call. The unit tests stub the network while they run the app's
  getters, and the end-to-end server runs with outbound connections refused; a refusal fails the run.
- **Library shapes.** Results look like yahoo-finance2's after its validation: Date objects, raw numbers and Yahoo's units
  (`regularMarketChangePercent` in percent in quotes, fractions in quoteSummary, epoch seconds in screener rows). The
  contract test enforces it.
- **Stable data.** Prices are seeded random walks anchored at their table level on 2026-01-02, with a market factor
  (seeded by the date) and a sector factor, so stocks move with their sector and index and a fund that tracks an index
  moves exactly like it. Before the anchor the walks stay within 20 times the anchor price, and later listings (PLTR,
  ARM, the Hong Kong listings, newer ETFs) start on their first trading day. A session's bar is the same on every run and
  every day. Prices stop at the latest completed session; `marketState` follows the clock (PRE, REGULAR, POST, CLOSED),
  the numbers do not.
- **One clock.** Every answer is computed for the process clock (`fixtureNow()`). On the real clock the data changes
  when a session closes somewhere (US stocks at 16:00 New York time, futures and FX at 17:00, other exchanges at their
  close, crypto at midnight UTC), and the scheduled events move with the latest session. The end-to-end suite pins the clock instead,
  so a run sees the same data on any day (see [End-to-end tests](#end-to-end-tests)).
- **Calendars.** Daily bars exist on NYSE sessions only (holidays 2000 to 2030, from the exchange rules plus the special
  closures), on weekdays for other exchanges and FX, every day for crypto. Weekly and monthly bars aggregate the dailies;
  1-minute to 1-hour bars exist for completed sessions, open at the daily open, close at the daily close and touch its
  high and low, with pre- and after-market bars for US stocks and funds (indices, yields and the VIX have none, as on
  Yahoo).
- **Extended hours.** US stocks and funds carry the after-hours trade of the latest session from its close until the next
  pre-market (as Yahoo keeps it over a weekend) and, while it trades, the next session's pre-market trade, from the same
  minute paths as the intraday bars.
- **Sensible levels.** Indices (^GSPC, ^IXIC, ^DJI, ^RUT and the world board), ^VIX around 15 to 20, Treasury yields
  (^IRX, ^FVX, ^TNX, ^TYX) of a few percent from one curve model, FX, futures and crypto at plausible levels.
- **Names are facts, figures are not.** A table covers the app's universe (`lib/universe.ts`, `lib/names-zh.ts`, the sector
  and broad ETFs, the world board) with real names, sectors, approximate sizes, first trading days and headcounts. Every
  other well-formed symbol is known too, with a stable made-up name. People, analyst firms and institutions in the
  ownership and analyst modules are made up, and every description says it is synthetic. Insider trades are those of the
  company's officers, each under one title, on trading days of the listing. Rating actions come out on trading days
  during New York business hours, each firm on its own rating scale and starting from its previous grade. Headlines are
  made up as well: a stock's ticker brings stories about the company, the ticker of a fund, index, yield, crypto pair,
  currency pair or future market stories about that instrument (flows, levels, rates), other searches stories about the
  topic.
- **Consistent results.** A calendar quarter's EPS and revenue depend only on the quarter, so a reported quarter never
  changes; the quote, every quoteSummary module and `fundamentalsTimeSeries` share one trailing EPS (the four latest
  reported quarters) and the same annual sums. Earnings grow at about the rate of revenue. In the statements a year is
  the sum of its quarters line by line, each quarter's margins move a little around the company's figures, operating
  income lies between pretax income and gross profit, and the dividends paid are those of the dividend history that went
  ex in the period. Debt to equity is the balance sheet's, the beta is the price walk's against the S&P 500 (within a
  tenth), and insiders hold less of the largest companies.
- **Upcoming events.** Earnings and dividends are scheduled relative to the latest completed session, so the calendar, My
  day and the week ahead always have entries. The default watchlist has fixed near-term dates: NVDA reports 2 sessions
  ahead, MSFT 4, AAPL 6, GOOGL 8 and AMZN 9; AAPL goes ex-dividend in 3 sessions. Other stocks report 2 to 45 sessions
  ahead, and the eight quarters before are reported 15 to 60 days after they ended, never after the session before the
  latest.
- **Limits.** The public market-data rate limit is raised (synthetic data costs no quota). The AI and sign-in limits are
  unchanged.
- **Visible.** The status bar says "Fixture data" (演示数据) in the caveat color wherever it is shown (tablet and desktop),
  `/api/health` reports `"dataSource":"fixtures"`, and a production server logs a `config.issue` warning at startup.

Not modelled: early closes (13:00) and holidays outside the US, split adjustments of past prices (bars stay continuous;
a few real splits show as events), intraday prices during a session (quotes show the latest completed session while
the next one trades), and Yahoo quirks such as the extra trailing row of weekly charts. The fixture client does not
validate query options the way the library does, except for `fundamentalsTimeSeries`.

Not realistic, so avoid it in screenshots where the page allows: relations between instruments beyond the shared market
and sector factors. Each walk runs on its own, so an index does not follow its members (NDX and QQQ down over 52 weeks
while NVDA, AMZN and MSFT are up), related indices such as the Shanghai Composite and the CSI 300 can move apart on the
same day, and long histories (5Y, MAX) start at arbitrary levels. The dollar index is the exception: ICE's formula
computes it from the walks of its six currencies (`DOLLAR_INDEX` in `lib/server/fixtures/prices.ts`: EUR/USD, USD/JPY and
GBP/USD, and USD/CAD, USD/SEK and USD/CHF, which the table gained for it), so it falls as the euro rises (DXY 91.75 next to
EUR/USD 1.3062 at the default `E2E_NOW`) and starts in December 2003 with them. Company revenue comes from a random
price-to-sales ratio, so it can be a few times off for the largest companies.

Run the app on fixture data:

```bash
MARKET_DATA_SOURCE=fixtures npm run dev
```

## Reserved symbols and AI scenarios

| Input | Effect |
|---|---|
| Any symbol starting with `ZZ` (e.g. `ZZZZ`) | Unknown, exactly as yahoo-finance2 reports an unknown symbol (the unit tests compare the two): `quote` leaves it out, `chart` fails with "No data found, symbol may be delisted", `quoteSummary` with "Quote not found for symbol: ZZZZ", `search` finds nothing, `options` resolves to undefined, `fundamentalsTimeSeries` to `[]`. The pages show their 404 states. |
| `E2ELEN` | The mock model stops with `finish_reason: "length"`: the note shows the truncation notice. |
| `E2EERR` | The mock model sends a few chunks, then an error event: the note keeps the partial text and shows "The response was interrupted." with Retry. |
| `E2ESLOW` | The mock model streams about 300 ms per chunk, long enough to press Stop. |
| `E2EKEY` | The mock model answers 401, as for a rejected key: the note says DeepSeek rejected the request. |
| Bearer key `rejected` | 401 for every request (start the server with `DEEPSEEK_API_KEY=rejected`). |

The `E2E*` symbols are ordinary stocks in the fixture data (with descriptive names), so a note or a chat on
`/stock/E2ELEN` triggers its scenario through the page's context. In the chat on any other page, type the marker in a
message: the mock reads the latest user message and the system context only, so the marker affects that answer and
not the follow-ups, and parallel tests never interfere. Without a marker the mock answers with a short Markdown note
that names the symbol of the prompt and ends with "Mock answer for automated tests.", or with a chat answer that ends
with "Ask a follow-up question to see the conversation continue."

The mock ends a stream when the client disconnects, as DeepSeek does, and `GET http://127.0.0.1:3199/stats` counts the
streams started, completed and cancelled per scenario; the Stop spec uses it to check that Stop reaches the model.

Notes are cached on the server for 15 minutes by their context, so a repeated note is served instantly from the cache.
A test that must see the stream itself (Stop, for example) uses Regenerate, which skips the cache.

## End-to-end tests

```bash
npm run e2e          # headless; builds and starts both servers
npm run e2e:headed   # watch the browser
npx playwright test e2e/specs/ai.spec.ts --project=desktop   # one file, one project
```

`playwright.config.ts` starts two servers, with the settings of `e2e/support/env.ts`:

- the mock model, `node e2e/mock-llm.mjs`, on 127.0.0.1:3199 (`E2E_LLM_PORT`);
- the app: `npm run build`, then `next start` on 127.0.0.1:3100 (`E2E_PORT`) under two preloads,
  `e2e/support/no-network.mjs` (outbound connections to anything but this machine are refused and logged as
  `[no-network]`) and `e2e/support/clock.mjs` (the process clock starts at `E2E_NOW` and runs on). Its environment sets
  fixture data, `DEEPSEEK_API_KEY=test` pointing at the mock, test-only `ACCESS_PASSWORD` and `SESSION_SECRET`, a high
  `AI_DAILY_LIMIT`, `TRUST_PROXY=1`, `LOG_LEVEL=warn`, `GIT_SHA` (the checked-out commit) and `E2E_NO_NETWORK_LOG`
  (see below). Every setting is given, so a local `.env.local` cannot change what is tested.

Playwright refuses to run when something already listens on either port. To keep the servers between runs:

```bash
npm run e2e:serve                  # terminal 1: build, then serve until Ctrl+C (--no-build serves the existing build)
E2E_REUSE=1 npm run e2e            # terminal 2, as often as needed
```

The servers exit with `e2e:serve`, however it ends. On Windows, stopping a background shell that started it (a task
runner's stop, say) does not end it, because the process tree lives on: press Ctrl+C in its terminal, or end the process
whose PID it prints once the servers are up (`taskkill /PID <pid> /F`; `kill <pid>` elsewhere).

The global setup checks the app before any test runs: `/api/health` must report fixture data, a configured AI, the
checked-out commit and a clock that started at `E2E_NOW` (and has run for less than six hours; with `E2E_NOW=real`, a
clock within five minutes of this machine's), the server must keep a no-network log, and the sign-in must set the
production cookie `__Host-is_session`. A server of another branch, in Yahoo mode, on another clock, a development server
or one started without the preloads fails there with the reason. Uncommitted changes are not detected: restart
`e2e:serve` after editing.

**No network, enforced.** Besides writing `[no-network]` lines to the server output, the preload appends each refused
connection to `E2E_NO_NETWORK_LOG`, a temporary file per app port (`<tmp>/investseek-e2e-no-network-<port>.log`, the same
for a server Playwright starts and one from `e2e:serve`). Each server process first writes a guard line with the time it
started, and the global setup requires the guard line of the server under test (no older than its uptime says, so a line
an earlier server on the same port left behind does not count). The teardown the setup returns, which runs after the
last test while the servers are still up, fails the run when refusals were logged and lists them ("The app server tried
to reach the network ..."): for a server Playwright started, every refusal since its guard line (its start-up
included); for a reused server, those since the setup, so its earlier runs do not count.

**The clock.** `E2E_NOW` defaults to Saturday 2026-11-07 10:00 in New York (`2026-11-07T15:00:00Z`): the market is closed
after Friday's session, Friday's after-hours trade shows, and every scheduled event lies ahead. Any ISO date-time
works (`E2E_NOW=2026-11-04T16:00:00Z` for a Wednesday session); `E2E_NOW=real` runs on the real clock, and the specs that
depend on the pinned day skip themselves. Each test installs the server's current time in the browser
(`context.clock`), so client-side dates ("today", "in 3 days") agree with the data.

**Client addresses.** Every test sends its own `X-Forwarded-For` address (`10.x.x.x`), which the server trusts, so the
per-client limits (20 AI notes in 10 minutes, the sign-in limit) apply to each test as to separate visitors: reruns and
`--repeat-each` do not run into the limits, which keep their production values.

Projects: `desktop` (1440x900) and `phone` (390x844, touch). Locally they run in Google Chrome; set `E2E_CHANNEL=chromium`
to use Playwright's bundled Chromium (`npx playwright install chromium`). Failures keep a trace and a screenshot in
`test-results/` (`npx playwright show-trace <path>`). A page that fails to load with `net::ERR_NO_BUFFER_SPACE` means
the machine ran out of sockets (on Windows, another program holding thousands of them): close it or run with fewer
workers (`--workers=2`).

The global setup signs in once through `/api/auth/login` and stores the session in `e2e/.auth/state.json` (gitignored).
The production cookie is `__Host-is_session` with `Secure`; browsers treat `http://127.0.0.1` as a secure context, so it
works without HTTPS. A stored state is reused while the server accepts it, which keeps reruns under the sign-in limit
(5 attempts in 15 minutes). A spec that needs to be signed out uses a fresh context:

```ts
test.use({ storageState: { cookies: [], origins: [] } });
```

The specs:

| Spec | Covers |
|---|---|
| `smoke.spec.ts` | The harness itself (fixture data source, shared clock, the "Fixture data" status bar), the overview heatmap (one tile per universe stock on the desktop, the sector list on phones), the AAPL quote with its chart and after-hours trade, the not-found view of an unknown symbol, and the 404 of a symbol that cannot exist with its title in English and Chinese. |
| `routes.spec.ts` | Every page route (below). |
| `a11y.spec.ts` | axe on every page of the route sweep, the command bar and the chat drawer ([Accessibility](#accessibility)). |
| `ai.spec.ts` | Every AI scenario of the mock model, Stop, Regenerate, and the signed-out note panel and API. |
| `overview.spec.ts` | The overview of a returning investor (`SHELL_DATA`): My day's value, last-session P&L and its ratio over the previous close (the seed moves about 1.5%, so a ratio over today's value would show differently), unrealized and after-hours P&L, largest gains and losses and next report, computed from the page's own quotes; the week ahead against the fixed event dates (NVDA's report, AAPL's ex-date, MSFT's report; nothing after Sunday); the markets board (absolute change and 1M tag only where the cell is wide enough) and the breadth strip against their API answers; the movers in both scopes, kept across a reload; the treemap's single tab stop, arrow keys, Enter, hover card and Escape on the desktop, the sector list on phones. |
| `markets.spec.ts` | Every region of `/markets` with each instrument's price, change, session and local trade time on the pinned Saturday (exchanges closed since Friday, crypto trading), and the 2s10s and 3m10y spreads against the differences of the plotted curve points. |
| `navigation.spec.ts` | The nav rail (desktop) and the tab bar with its More sheet (phones) reaching every page with `aria-current`; Back and Forward across pages and quote tabs; `/no-such-page` (404, the registry's suggestions, its command line); `/help` (every function with its route, a page behind each, RISK landing on the risk panel far down the quote page); the keyboard: `?` with the page's own keys, `/` and Ctrl+K, Escape returning the focus, `g` sequences and a late second key. |
| `command-bar.spec.ts` | Function codes (GC bringing the Treasury curve back from the end of a scrolled page), TICKER CODE in both orders (GP landing on the chart, from another page and on the open quote), Chinese company names with the local matches checked against `searchChineseNames`, COMP, the symbol search against `/api/search` with arrow keys, unknown input, and a `?` question answered by the mock in the chat, which Escape (Close on phones) shuts, returning the focus. |
| `quote.spec.ts` | The quote page against the routes it reads: the AAPL header (price, change and percentage, market state and time, Friday's after-hours trade, the report and ex-dividend chips, SAMPLE_DATA's position line with value, P&L and portfolio weight from `/api/quotes`); every section tab with figures from its own route (diluted EPS and capital spending by fiscal year, the latest reported quarter, the latest rating action, the next ex-date, the largest institution's share held, shares, value, change and filing date), Tab and Enter, a deep link scrolled into view on phones, and Back with each tab's data; a fund's two tabs without earnings or analyst panels (the note of `?tab=earnings`); and the header and 1Y chart summary of ^GSPC, BTC-USD (open around the clock, a 24-hour 1D), EURUSD=X, GC=F and 0700.HK (HKD) at whatever decimals the page writes. |
| `chart.spec.ts` | The chart workstation through what it exposes: each range's text summary against the bars of the series the page loads (1M to 1Y as windows of the two-year series), the range keys (arrows, Home, `[` and `]`), extended hours ending at Friday's after-hours trade, comparisons (three at most, from the bar and from a link naming four; returns from `/api/history`; the list in the URL across a reload; the phone search's suggestions on screen), studies and the range kept in `investseek:chart:v1` (L for the log scale, the room made for the RSI pane), the marker key of each range, and the investor's cost, target and stop named in the legend when they lie beyond a quarter of the visible span (the spec's own rule; a fixme test marks the lines drawn on the canvas only). |
| `position-editor.spec.ts` | The position editor from the positions table and the quote header: the weighted average cost after adding shares (preview, table, `investseek:holdings:v1`), the realized P&L of a sale with the average cost kept, removal with Undo, zero, negative and non-numeric shares and a zero cost refused without saving, Escape back to the opener, a zero or non-numeric price when adding or reducing and an oversold sale refused without saving, and a new position saved through the sheet on a phone. |
| `watchlist.spec.ts` | The watchlist page: adding a symbol (its quote shows; one already listed is not added twice), the Not found notice of a stored symbol the data source does not know, removing with Undo in place, reordering (the handle's arrow keys and Alt+arrows, the row sheet on phones), sorting a column as a view that keeps the stored order, each checked in `investseek:watchlist:v1` and after a reload; the Upcoming panel against `/api/calendar`, soonest first, and the fixed dates of the default watchlist; the allocation by value, with the seeded positions' groups as fixture facts. |
| `portfolio.spec.ts` | Positions and the portfolio page against the quotes and a year of closes: each position's value, day P&L, P&L, weight and extended-hours P&L with the totals on both layouts, and the weights shown adding up to 100%; the page's tiles (beta, volatility, VaR and maximum drawdown computed from `/api/history`); today's holdings against SPY or QQQ over 1Y and 3M in the chart's label and its legend; exposure by sector, asset class and currency with a position quoted in HKD; the risk table; the tab in the address and a symmetric correlation matrix; the empty state and a first position added from it. |
| `data.spec.ts` | The data page: the backup file's contents (a second backup, made after the first was recorded, still leaves out the bookkeeping), clearing after the confirmation word and restoring the exported file, a backup made elsewhere previewed and restored by Merge (with Undo) and by Replace, malformed and damaged files refused with nothing changed, broker CSV exports with English and Chinese headers and pasted positions through the review, and the positions and watchlist CSV files against the quotes. |
| `calendar.spec.ts` | The events calendar on the pinned Saturday, from the default watchlist with two of its names held: the fixture's scheduled reports (NVDA and MSFT this week; AAPL, GOOGL and AMZN next week) and AAPL's ex-dividend date with ten times the dividend per share of the dividends API. Each period's agenda equals the feed's events in the agenda's order: day headings that read right for a Saturday, and within a day ex-dates first, then by time with a US report at its session slot, holdings before watchlist names. Rows show their time slots and money at stake. Also covered: the macro releases of the committed schedule in the agenda and the side panel; the group chips (counts, what each shows, kept in `investseek:calendar:v1` across a reload, with a Top 78 position outside the lists read from the feed); and the overview's week ahead listing the same week in the same order. |
| `screener.spec.ts` | The screener against `/api/screener`. Filters (sector, P/E, market cap) are checked against the snapshot rows and the cells. Each stock preset is checked against the rule its hint states, with its count, column set and order. Each column set shows its columns (two on the phone). The ETF universe: the 26 funds by net assets, the four presets that apply to funds, and every fund column set; beside the filter rail at 1440px the ETF overview drops 1M (`test.fixme`). Also: sorting both ways and back, a copied link reopening the screen in a new page, the CSV export, saved screens (save, reload, reopen, update, delete and undo), the watch star, and the phone's filter sheet. Every Discover list (movers, idea lists, trending) matches its API answer with the count in its caption, above the stated $1B floor; the lists on screen are checked again at $10B, which must drop stocks they show at $1B. |
| `lab.spec.ts` | The factor lab against the committed research files: every pre-registered factor test with its IC, signs, t statistics, Holm-adjusted p and the verdict tally; the track record's row, reading-name, return and whisker colours as `isConcentrated` and `selectionTone` decide at each horizon, read by column head (no reading of the committed file is concentrated, so `components/lab/ReadingTrackPanel.test.ts` renders one and the spec notes it); the risk calibration's range coverage and persistence. |
| `notes.spec.ts` | Thesis notes: a thesis written from `/notes` (its empty state) and with N on a quote page, with every field and an entry stamped with the price of the moment, kept in `investseek:notes:v1` in `lib/notes.ts`'s format across a reload; the sample AAPL note on its quote page, entries, edits, an alert at the stop, deletions with Undo; the list in review order (overdue first) with tag filters, each target and stop read in its own column (on phones in the labelled line under the thesis) with its distance from the quotes the page reads. |
| `alerts.spec.ts` | Local alerts: a rule of each of the six kinds created in the editor, with day moves up and down and P&L rules for a gain and a loss, and which ones trigger computed from the quotes, positions and report date (the bell's name and badge, rules table, history, alert center); pause, edit (a new level re-arms, also a rule that already fired; a new note does not) and delete with Undo across a reload; a price level crossed on several sessions while no tab was open, replayed from daily bars (the first session and the count); the notification permission asked for only from a click; the alert editor on phones under the toasts (fixme, a known app bug). |
| `settings.spec.ts` | Display preferences from the server's first paint, on the desktop: theme (dark, light, system following the browser's color scheme), language (`<html lang>`, the interface, price colors kept), price colors (the computed colors of an up and a down change against the design tokens) and density (a table's row height), each in its cookie and in the `<html>` of the next document. |
| `ai-chat.spec.ts` | The research assistant: opened from the navigation, a quote page's "Why is it moving?" and the command bar's `?`; what requests to `/api/ai/chat` carry with "Include my positions" on and off; a suggested question, Copy to the clipboard, Retry; at most 20 saved conversations, reopened from the history after a reload; the chat footer under the Copy toast (fixme, a known app bug). |

### Functional specs

The specs after the first four check what each page does with the fixture data, not only that it loads. They share one
rule: a figure a spec expects is computed from the app's own API answers (requested again with the test's `request`,
which carries the same client address) or from the committed data files, and written as the English interface writes
it, with the app's formatters and `MESSAGES.en`. A number is written down only where the fixture data guarantees it (the
default watchlist's scheduled events, the seeded positions) or where it states a product rule (the chart's level reach,
what a screener preset keeps). Those checks require their data at the default `E2E_NOW` and skip, or take their data
from the feed, at another one. The rules a page applies (the order of a day's events, what a filter keeps, how a sort
orders) are written out in the spec or its helper module rather than imported, so a change to the app cannot carry a
spec's expectation along with it.

Each area has a helper module in `e2e/support/`:

- `shell.ts`: a returning investor (`SHELL_DATA`: the default watchlist and eight positions weighted so the session's
  net move shows which value the day ratio divides by), `panel(page, title)`, `apiJson`, `commandBar` and
  `typeCommand`, and `hashLanding`/`expectLanded`, which check that the element a URL hash names sits at its scroll
  margin below the top of `main`. Start such a check where the target has not landed yet, or it cannot fail.
- `quote.ts`: the quote page's figures in the English UI's format. Figures whose decimals depend on the instrument are
  matched at any precision. The chart is read through its text summary, legend, marker key, controls and the size of
  its drawing area, never its canvas.
- `personal.ts`: positions valued at `/api/quotes` (base-currency totals and weights, day and extended-hours P&L), and
  the portfolio page's risk figures computed from a year of `/api/history` closes by the definitions its "How these are
  computed" panel states. `expectCells` checks a table row's cells by column head in one retrying assertion,
  `expectFigure` compares a computed figure at its displayed precision, and `expectSumOf100` adds up percentages as the
  page shows them. Uploaded files come from `e2e/fixtures/personal`.
- `research.ts`: the calendar's order within a day (`minuteInDay`, `eventOrder`), the screener presets' rules written
  from their hints, and `parseCsv`. Long lists and tables are read in one page call and compared in one polled
  assertion, which keeps these tests within their time limit on a busy machine.
- `notes.ts`: `seedLocal` for the storage `app.seedStorage` does not cover (alerts and their log, AI chats and AI
  settings), `watchNotificationRequests`, `cellUnder(table, row, header)` and `hitAtCenter(locator)`, which says what a
  tap at the middle of an element reaches (a toast in the way, for example).

A test that depends on time moves the browser clock instead of waiting: the late `g` key pauses the clock
(`page.clock.pauseAt`) and runs it past the 1.5-second timeout (`runFor`). Playwright cannot read a streamed response
body, so the AI specs read the request body and wait for the answer on screen. Keep `E2E_LLM_PORT` off the ports
`fetch` refuses (3659 is one). On Windows the clipboard returns CR LF. Journeys through a dozen pages are marked
`test.slow()`. Where the committed data cannot show a rule (no reading of the factor lab is concentrated), a component
test covers it and the spec adds an annotation. A `test.fixme` marks a known app bug ([Current state](#current-state)):
the test states the right behavior and passes once the bug is fixed.

### The route sweep

`e2e/specs/routes.spec.ts` opens every page of the app on both projects, from the cases of `e2e/support/routes.ts`:
the overview, world markets, a sector (`/sector/technology`), the screener and discover, the watchlist, the portfolio and
its exposure, risk and correlation tabs, the calendar, alerts, notes, the AAPL quote with each of its tabs (financials,
earnings, analysts, dividends, ownership), a fund (`/stock/SPY` and its dividends), a mutual fund outside the app's lists
(`/stock/VFIAX`: the fixture data makes any four letters and an X a fund), an index (`/stock/%5EGSPC`), a crypto pair
(`BTC-USD`), a currency pair (`EURUSD=X`), a future (`GC=F`), a Hong Kong listing (`0700.HK`), the factor lab, the data
page, help, `/unlock` (a public site redirects it home) and three not-found pages: `/stock/ZZZZ` (a well-formed symbol
the data source does not know, which answers 200 on purpose and shows the not-found view once the stock API answers 404),
`/stock/%24%24%24` (a symbol that cannot exist, which answers 404 from the server) and `/no-such-page`. A listing test
fails when a `page.tsx` under `app/` matches no case, so a new page needs one.

Each test starts from `SAMPLE_DATA` in the browser (a watchlist with a fund and a crypto pair, four positions with a
fund and a stock outside the heatmap universe, and a thesis note) and checks:

- the document status (200; 404 for `/stock/%24%24%24` and `/no-such-page`) and, for `/unlock`, where the redirect ends;
- no console error and no uncaught page error (the suite's collector), and no same-origin response with a status of
  400 or more;
- the page's main panel with its data: one web-first assertion on a region named by its panel title and something in it
  that only data can fill (a price, a chart summary, a data row of a table: the loading skeleton and the empty state of
  a table are one full-width cell, which does not count; discover also needs a non-zero count in the table's caption);
- once the page has settled, no error state on screen: no visible `role="alert"` (ErrorState, the error boundary, a
  failed AI note; Next.js's empty route announcer aside) and no stale-data banner;
- the API routes the case names answered 200: every panel route of the AAPL quote page and its tabs (`chart`, `signal`,
  `factors`, `news`, `earnings`, `analysts`, `implied-move`, `financials`, `dividends`, `ownership`), the fund's chart and
  dividends, the mutual fund's quote, chart, signal, factors and news, the world board, the Treasury curve, the screener,
  discover, sector news, history, profiles and the calendar.

Expected noise is allowed per case, as narrowly as possible (`expectedNoise`): `/stock/ZZZZ` gets 404 from the stock API
and each panel route, and a case whose document should answer an error status (`status: 404` for `/stock/%24%24%24` and
`/no-such-page`) allows that document's own console line and response, for its URL alone. A case can also accept a known
app bug in the document status (`knownStatus`; no case needs one now): the test passes with a `known-app-bug`
annotation, and once the bug is fixed it notes `known-status-unused`, the cue to delete the allowance. The document's
allowances follow the status the case expects, not the one it gets today, so the fix itself fails nothing (the smoke
tests of the quote's not-found pages and their accessibility checks use the same allowances).

Write specs in `e2e/specs/*.spec.ts` with the suite's `test` from `e2e/support/test.ts`:

- `consoleErrors` runs in every test and fails it on a console error or an uncaught page error (CSP violations and failed
  requests show up there). Expected noise is allowed per test, as narrowly as possible and with a reason:
  `consoleErrors.allow(/status of 404 \(Not Found\) \(http:\/\/[^/]+\/api\/stock\/ZZZZ[/?)]/, "The stock API answers 404 for an unknown symbol.")`.
- `axe.check({ known })` runs axe-core and fails on serious or critical violations (see below).
- `app.goto(path)` opens a page, waits until no data request is in flight for half a second and fonts are loaded, and
  resolves to the document response; `app.setPrefs({ theme, lang })` stores display preferences the way the app does
  (cookies read on the server); `app.seedStorage({ watchlist, holdings, notes })` puts data in localStorage under the
  stores' own keys before the test's first page load (later loads keep what the page changed); `app.isPhone` tells the
  projects apart.
- `ROUTES`, `routeCase(path)` and `SAMPLE_DATA` (`e2e/support/routes.ts`) give a page and the check that it has loaded
  its data; `expectedNoise(route)` gives the console lines and responses that page may cause.

Prefer roles and accessible names (`getByRole("region", { name: "Sector heatmap" })`) over CSS classes: panels are
regions named by their title, so specs survive layout changes.

## Accessibility

`axe.check()` scans with the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22a` and `wcag22aa` and fails on
violations of impact serious or critical, listing each rule, its help link and the selectors of the failing elements. The
full result is attached to the test report. WCAG 2.2 is included on purpose: its target-size rule (2.5.8, 24 by 24 CSS
pixels) is the minimum [docs/design-system.md](design-system.md) sets for controls.

`e2e/specs/a11y.spec.ts` runs axe on every page of the route sweep except the redirect (33 pages, from the same sample
data and after the same check that the page has loaded its data), on the open command bar (empty, then with symbol
matches for "apple") and on the open AI chat drawer, in the dark and light themes on both projects: 140 tests.

A known finding is accepted for one rule on the elements inside a locator (`known: [{ rule, within, reason }]`); every
other rule, color contrast included, still checks those elements. A known finding that no longer occurs adds an
`axe-known-unused` annotation to the test, the cue to delete it. A finding that only some data shows is marked
`dataDependent`: at another `E2E_NOW` it can be absent while the bug remains, so its absence is only reported at the
default `E2E_NOW`.

None is accepted now (`KNOWN` is empty). The last two are fixed: a heatmap tile whose change has no sign (`CSCO 0.00%` on
the pinned day) read as "CSCO0.00%" (label-content-name-mismatch), and the factor profile's meter of a factor without a
value (beta of a crypto pair) kept `role="meter"` without `aria-valuenow` (aria-required-attr). A tile now has a space
between its symbol and its change, and a `Meter` without a value is an image named `<label>: Data unavailable`. The
three findings accepted before wave 2 (heatmap tile names and sizes on `/`, the chart container around a focusable link
on `/stock/AAPL`) were fixed by wave2/overview and wave2/quote.

Color contrast passes in both themes on every page checked; `npx tsx scripts/check-contrast.ts` covers the token pairs.

## CI

`.github/workflows/ci.yml` has two jobs:

- **check**: lint, typecheck, unit tests, the production build and an audit of production dependencies.
- **e2e**: Node from `.nvmrc`, `npm ci`, Playwright's browsers cached by the Playwright version in the lockfile,
  `npx playwright install --with-deps chromium`, then `npx playwright test`, which builds and starts its own servers. In
  CI the suite uses the bundled Chromium, two workers and one retry. On failure the HTML report and the traces are
  uploaded as the `playwright-report` artifact.

## Current state

All wave 2 branches are merged and the suite covers them: the pages the navigation links to exist (no prefetch
allowance is left), the Treasury curve is served from the fixture CSV by default, the getters wave 2 added are covered
in `lib/server/fixtures/app-data.test.ts` behind its network stub, every page route is swept on both projects, axe
runs on every page of the sweep in both themes, and the functional specs check what each page does with the fixture
data.

Nothing is accepted: no case of the sweep has a `knownStatus` and `KNOWN` in `a11y.spec.ts` is empty, so every page
answers the status it should and shows no serious or critical axe finding in either theme on either project. That
`/stock/ZZZZ` answers 200 is a decision, not an allowance: telling a well-formed symbol Yahoo does not know from a real
one while the page renders would call Yahoo outside the API routes' per-client rate limit and hold up every quote page,
so the page shows its not-found view once `/api/stock/ZZZZ` answers 404. A symbol that cannot exist
(`/stock/%24%24%24`) answers 404 from the server, with the not-found title in the reader's language. The quote page of a
fund, index, currency, future or crypto pair asks for no earnings or analysts, so it causes no 4xx either
(`/stock/VFIAX` in the sweep).

Known app issues that no spec checks: a path segment with a malformed percent-escape (`/stock/%E0%A4%A`, `/stock/%ZZ`)
answers a plain-text 500 wherever a dynamic route would take it (`/stock/…`, `/sector/…`, `/api/stock/…`). Next.js fails
to decode the segment while it matches the route, before the page or the API route runs (so `normalizeSymbol` never
sees it), and ends in a bare 500 instead of the 400 it means to send; a path that no dynamic route takes (`/%E0%A4%A`)
gets the ordinary 404, and a malformed escape in the query string does no harm. `proxy.ts` runs before that match and
could answer 400 itself. The two issues listed before are fixed: `priceDigits` in `lib/quote-figures.ts` gives currency
pairs and the world board's instruments their decimals on the quote page too (four for EUR/USD, as on the world board),
and a value that rounds to zero at the shown decimals prints without a sign, in the flat tone and without an arrow
(`displayedSign` in `lib/format.ts`, behind `Delta` and the other direction colors).

Known app bugs the specs mark with `test.fixme`. Each test states the right behavior and fails today; once the bug is
fixed it passes, and its `test.fixme` line goes.

| Test | Bug | Where |
|---|---|---|
| `ai-chat.spec.ts` › the chat footer › stays within reach while the Copy toast shows | For five seconds after Copy, the toast covers the chat's question box (desktop and phone) and Send (desktop). | `components/ui/Toast.tsx`: the toasts (z-60) sit over `components/ui/Drawer.tsx` (z-50) |
| `alerts.spec.ts` › on a phone › the toasts of a saved alert leave the editor's buttons clear | On a phone, the toasts of an alert that triggers when saved cover the next editor's Save alert and Cancel. | As above |
| `chart.spec.ts` › tells assistive technology where the cost, target and stop lines drawn on the chart are | Lines within the visible prices are drawn on the canvas only, which is hidden from assistive technology; the legend names only the levels beyond the visible span. | `components/stock/PriceChart.tsx` |
| `portfolio.spec.ts` › counts a single position in the singular | One position reads "1 positions" and "of 1 positions"; "{n} symbols" has no singular either. | `watchlist.positionsCount` in `lib/i18n/messages.ts`, `kpi.effectiveSub` in `lib/i18n/port.ts` |
| `screener.spec.ts` › a 1440px screen fits the ETF overview beside the filter rail | Beside the 208px nav and the filter rail the table gets 61.8rem, the ETF overview needs 62.25rem, so its 1M column drops. | Column widths in `lib/screens.ts`; `components/screener/widths.test.ts` assumes a 192px nav |
| `watchlist.spec.ts` › refuses an unknown symbol typed in the add form | The add form checks only the format, so ZZZZ is saved and listed as a row of dashes under the "Not found" notice. | `components/watchlist/AddSymbolForm.tsx`, `addSymbol` in `hooks/useWatchlist.ts` |

## Screenshots

The nine images at the top of both READMEs come from the fixture data, regenerated by one command:

```bash
npm run screenshots                                  # into docs/screenshots
SCREENSHOTS_DIR=../shots npm run screenshots         # elsewhere (absolute, or relative to the repository root)
```

It runs `e2e/screenshots/readme.shots.ts` with its own Playwright config, which builds and starts the suite's two
servers with the settings of `e2e/support/env.ts` (fixture data, the mock model, no network access, `E2E_PORT`,
`E2E_LLM_PORT`, `E2E_CHANNEL`) and the global setup's checks, with one difference: the app's clock stands still at
`E2E_NOW` (`e2e/screenshots/frozen-clock.mjs` takes the place of `clock.mjs`), and each page's clock stands still at the
server's time (Playwright's `clock.setFixedTime`). The server stamps its data with its clock ("Updated 10:00 ET", a
panel's "As of", the screener's snapshot time), so a running clock would put another minute into each run's images. The
files end in `.shots.ts` outside `e2e/specs`, so neither `npm run e2e` nor Vitest runs them, and CI does not either.
The command takes about two minutes, most of it the build. With `E2E_REUSE=1` and servers already up, a shot takes two or
three seconds once the server's caches are warm, and 15 to 40 on a freshly started server or a busy machine.

| Image | Page | Look |
|---|---|---|
| `overview-dark-en.png` | `/`, top: My day, the week ahead, the markets board, the watchlist, sectors | desktop, dark, English, green up |
| `quote-dark-en.png` | `/stock/AAPL`: the header with the after-hours trade, the report and ex-dividend chips and the position, the chart with the cost, target and stop lines down to its footer, key statistics | desktop, dark, English |
| `portfolio-dark-en.png` | `/portfolio`: the figures, today's holdings against SPY over a year, the drawdown (scrolled down to its axis) | desktop, dark, English |
| `calendar-dark-en.png` | `/calendar`, four weeks | desktop, dark, English |
| `screener-dark-en.png` | `/screener` | desktop, dark, English |
| `lab-dark-en.png` | `/lab` | desktop, dark, English |
| `markets-dark-en.png` | `/markets` | desktop, dark, English |
| `overview-light-zh.png` | `/`, scrolled to the headlines: the last row of the markets board, breadth and the heatmap beside the headlines and the AI brief | desktop, light, Chinese, red up |
| `mobile-light-zh.png` | `/` on a phone: My day, the week ahead | phone, light, Chinese, red up |

`e2e/screenshots/images.ts` lists the nine files with the project that captures each. Desktop images are 1440 by 900
CSS pixels at device scale 1, the phone image 390 by 844 at scale 2; the nine files take about 2 MB. Each image ends where
the viewport does, so the longer column runs on past the bottom edge (the overview's headlines, the quote's key
statistics, the lab's rank correlations, the markets page's currencies). The tests choose where an image starts; the
zh overview starts at the headlines, a few pixels off if need be, so that its top edge cuts no line of text in either
column.

**The demo investor** (`e2e/screenshots/demo-data.ts`) is put into localStorage under the stores' own keys before the
first page load, as `app.seedStorage` does: a watchlist of ten large caps, eight positions worth about $120k at costs
from the past year or two (seven stocks and SPY), thesis notes on AAPL and NVDA (AAPL's target and stop lie inside its
one-year range, so the quote image's 1Y chart draws them; NVDA's target sits above its 52-week high, as a growth thesis's
target often does), and two alert rules far from their levels, so no alert fires and no toast covers a page. The browser
is signed in, as in the suite (the AI controls show as available), and each test sets the language, theme, price colors
and density as cookies.

**The instant** is the default `E2E_NOW`, Saturday 2026-11-07 10:00 in New York: the market closed after Friday's
session, Friday's after-hours trade shows and the scheduled events lie ahead (NVDA reports on Tuesday). Another
`E2E_NOW` works, but the READMEs describe the default.

**Still pictures.** Before each capture the test checks that the page shows what its image promises: the route sweep's
checks, the seeded positions and watchlist, and on the quote page the after-hours trade, the report and ex-dividend
chips, the position line, the note's target and stop, and no level of the investor's left off the chart. It checks the
look as `<html>` carries it (`lang`, `data-theme`, `data-updown`, `data-density`) and that the phone image comes from the
phone project. It then waits until no data request is in flight (one still open after 30 seconds fails the shot, named
in the error, rather than leave its panel half drawn: a sparkline shows no skeleton), every declared font face has
loaded, no skeleton, "Loading", error state, stale-data banner or toast is visible and every image has decoded. The
context asks for reduced motion (the app then finishes its animations at once), the capture skips what is left of them
and hides the caret, nothing has focus and the mouse is outside the page, so no hover state or tooltip shows. Two runs on
one machine give byte-identical files; another operating system, browser version or set of fonts changes pixels.

**One set.** The run fails unless it wrote all nine files into the folder it was asked for, each at its project's size
(1440 by 900 pixels, the phone image 780 by 1688). A run of some of the shots (`-g`, a file:line, `--project`) therefore
ends with an error listing the images it left as they were: run the whole command before committing them.

**Synthetic data.** The images show made-up prices, company figures and headlines, labelled "Fixture data" in the status
bar; the READMEs say so under the table. What the fixture data does not keep realistic ([Fixture
mode](#fixture-mode)) shows where a page lists both instruments: the markets image has the Shanghai Composite down 2.57%
beside the CSI 300 up 0.61%.

**When to regenerate:** after a change that shows on one of these pages (layout, wording, tokens), a change to the
fixture data or the demo data, and before a release. Run it without `E2E_REUSE`, look at every image (the test checks
data, not layout) and commit the images with the change. While working on a shot, `E2E_REUSE=1` with
`npm run e2e:serve` saves the build, but that server's clock runs, so the times in the images follow it (the command
warns). When a shot shows something else, update its alt text in the screenshot block of `README.md` and
`README.zh-CN.md`.
