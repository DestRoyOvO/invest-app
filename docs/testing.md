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
| `sessions.test.ts` | NYSE holidays against the published calendars, special closures, session times across daylight saving time, the latest completed session, the market state. |
| `prices.test.ts` | A bar never changes once its session closed, OHLC consistency, long histories within 20 times the anchor price, first trading days of later listings, ^VIX and yields in range, funds that move with their index, intraday bars that match their daily bar, extended-hours trades that match the chart. |
| `app-data.test.ts` | The data through the app's own getters and mappers, with content checks rather than presence: quotes, summaries, bars, search, news (market, sector, company, stock), the overview and the shell's board, screens and every discover screen, the stock and ETF screeners, factor profiles, the calendar, the signal, the earnings detail (its quarters sum to the quote's trailing EPS), analyst activity, the implied move, financial statements (for every stock of the universe: net, operating and gross margins in that order, moving between periods, earnings that follow revenue, the dividend history paid out in the cash flow), dividends, ownership, the 1d, 5d, ytd, 5y and max chart ranges, the Treasury curve through `getYieldCurve()`'s default fetch (its 10-year agrees with ^TNX), the world board, aligned history, profiles and every kind of AI context. `fetch` and `node:https` are stubbed and the file fails if any getter reached for the network. |
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
  when a session closes somewhere (US stocks at 16:00 New York time, other exchanges, futures, and crypto and FX at
  midnight UTC), and the scheduled events move with the latest session. The end-to-end suite pins the clock instead,
  so a run sees the same data on any day (see [End-to-end tests](#end-to-end-tests)).
- **Calendars.** Daily bars exist on NYSE sessions only (holidays 2000 to 2030, from the exchange rules plus the special
  closures), on weekdays for other exchanges and FX, every day for crypto. Weekly and monthly bars aggregate the dailies;
  1-minute to 1-hour bars exist for completed sessions, open at the daily open, close at the daily close and touch its
  high and low, with pre- and after-market bars for US listings.
- **Extended hours.** US stocks and funds carry the after-hours trade of the latest session from its close until the next
  pre-market (as Yahoo keeps it over a weekend) and, while it trades, the next session's pre-market trade, from the same
  minute paths as the intraday bars.
- **Sensible levels.** Indices (^GSPC, ^IXIC, ^DJI, ^RUT and the world board), ^VIX around 15 to 20, Treasury yields
  (^IRX, ^FVX, ^TNX, ^TYX) of a few percent from one curve model, FX, futures and crypto at plausible levels.
- **Names are facts, figures are not.** A table covers the app's universe (`lib/universe.ts`, `lib/names-zh.ts`, the sector
  and broad ETFs, the world board) with real names, sectors, approximate sizes and first trading days. Every other
  well-formed symbol is known too, with a stable made-up name. People, analyst firms and institutions in the ownership and
  analyst modules are made up, and every description says it is synthetic.
- **Consistent results.** A calendar quarter's EPS and revenue depend only on the quarter, so a reported quarter never
  changes; the quote, every quoteSummary module and `fundamentalsTimeSeries` share one trailing EPS (the four latest
  reported quarters) and the same annual sums. Earnings grow at about the rate of revenue. In the statements a year is
  the sum of its quarters line by line, each quarter's margins move a little around the company's figures, operating
  income lies between pretax income and gross profit, and the dividends paid are those of the dividend history that went
  ex in the period.
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
| `smoke.spec.ts` | The harness itself (fixture data source, shared clock, the "Fixture data" status bar), the overview heatmap (one tile per universe stock on the desktop, the sector list on phones), the AAPL quote with its chart and after-hours trade, the not-found view of an unknown symbol. |
| `routes.spec.ts` | Every page route (below). |
| `a11y.spec.ts` | axe on every page of the route sweep, the command bar and the chat drawer ([Accessibility](#accessibility)). |
| `ai.spec.ts` | Every AI scenario of the mock model, Stop, Regenerate, and the signed-out note panel and API. |

### The route sweep

`e2e/specs/routes.spec.ts` opens every page of the app on both projects, from the cases of `e2e/support/routes.ts`:
the overview, world markets, a sector (`/sector/technology`), the screener and discover, the watchlist, the portfolio and
its exposure, risk and correlation tabs, the calendar, alerts, notes, the AAPL quote with each of its tabs (financials,
earnings, analysts, dividends, ownership), a fund (`/stock/SPY` and its dividends), an index (`/stock/%5EGSPC`), a crypto
pair (`BTC-USD`), a currency pair (`EURUSD=X`), a future (`GC=F`), a Hong Kong listing (`0700.HK`), the factor lab, the
data page, help, `/unlock` (a public site redirects it home) and two not-found pages (`/stock/ZZZZ`, `/no-such-page`).
A listing test fails when a `page.tsx` under `app/` matches no case, so a new page needs one.

Each test starts from `SAMPLE_DATA` in the browser (a watchlist with a fund and a crypto pair, four positions with a
fund and a stock outside the heatmap universe, and a thesis note) and checks:

- the document status (200; 404 for `/no-such-page`) and, for `/unlock`, where the redirect ends;
- no console error and no uncaught page error (the suite's collector), and no same-origin response with a status of
  400 or more;
- the page's main panel with its data: one web-first assertion on a region named by its panel title and something in it
  that only data can fill (a price, a chart summary, a data row of a table: the loading skeleton and the empty state of
  a table are one full-width cell, which does not count; discover also needs a non-zero count in the table's caption);
- once the page has settled, no error state on screen: no visible `role="alert"` (ErrorState, the error boundary, a
  failed AI note; Next.js's empty route announcer aside) and no stale-data banner;
- the API routes the case names answered 200: every panel route of the AAPL quote page and its tabs (`chart`, `signal`,
  `factors`, `news`, `earnings`, `analysts`, `implied-move`, `financials`, `dividends`, `ownership`), the fund's chart and
  dividends, the world board, the Treasury curve, the screener, discover, sector news, history, profiles and the
  calendar.

Expected noise is allowed per case, as narrowly as possible (`expectedNoise`): `/stock/ZZZZ` gets 404 from the stock API
and each panel route, and a case whose document should answer an error status (`status: 404` for `/no-such-page` and
`/stock/ZZZZ`) allows that document's own console line and response, for its URL alone. A case can also accept a known
app bug in the document status (`knownStatus`): the test passes with a `known-app-bug` annotation, and once the bug is
fixed it notes `known-status-unused`, the cue to delete the allowance. The document's allowances follow the status the
case expects, not the one it gets today, so the fix itself fails nothing (the smoke test of `/stock/ZZZZ` and its
accessibility checks use the same allowances).

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

`e2e/specs/a11y.spec.ts` runs axe on every page of the route sweep except the redirect (31 pages, from the same sample
data and after the same check that the page has loaded its data), on the open command bar (empty, then with symbol
matches for "apple") and on the open AI chat drawer, in the dark and light themes on both projects: 132 tests.

A known finding is accepted for one rule on the elements inside a locator (`known: [{ rule, within, reason }]`); every
other rule, color contrast included, still checks those elements. A known finding that no longer occurs adds an
`axe-known-unused` annotation to the test, the cue to delete it. A finding that only some data shows is marked
`dataDependent`: at another `E2E_NOW` it can be absent while the bug remains, so its absence is only reported at the
default `E2E_NOW`. Accepted now, until the branches that own the fixes are merged:

| Page | Rule | Elements | Owner of the fix |
|---|---|---|---|
| `/sector/technology` (desktop) | label-content-name-mismatch (serious) | a heatmap tile whose change has no sign (`CSCO 0.00%` on the pinned day): the symbol and the change are two spans with no space between them, which axe reads as "CSCO0.00%" (a signed change separates them). A space between the spans fixes it. | `components/market/SectorHeatmap.tsx`, int/pages |
| `/stock/BTC-USD` | aria-required-attr (critical) | the factor profile meter of a factor without a value (beta of a crypto pair): `Meter` keeps `role="meter"` and drops `aria-valuenow`, which the role requires | `components/ui/Meter.tsx` (int/ui), used by `components/stock/FactorProfilePanel.tsx` (int/pages) |

The tile finding depends on the data (`dataDependent`): with another `E2E_NOW`, a tile of `/` or of another day's sector
page whose price did not move can show it too, and the CSCO tile can be signed. The three findings accepted before wave 2 (heatmap tile names and sizes on `/`, the chart
container around a focusable link on `/stock/AAPL`) were fixed by wave2/overview and wave2/quote and are gone.

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
in `lib/server/fixtures/app-data.test.ts` behind its network stub, every page route is swept on both projects, and axe
runs on every page of the sweep in both themes.

What is still accepted, and what removes it:

| Where | What | Owner | When it is fixed |
|---|---|---|---|
| `/stock/ZZZZ` | The document answers 200, not 404 (a soft 404): `app/(terminal)/stock/[symbol]/page.tsx` renders `StockView`, which shows the not-found view only after `/api/stock/ZZZZ` answers 404. | int/pages | The sweep notes `known-status-unused`: delete the case's `knownStatus`. |
| `/sector/technology` | label-content-name-mismatch on a tile with an unsigned change (table above). | int/pages | The a11y test notes `axe-known-unused` at the default `E2E_NOW`: delete the entry in `KNOWN`. |
| `/stock/BTC-USD` | aria-required-attr on a meter without a value (table above). | int/ui | As above. |

When the pending work of the other integration branches lands, nothing here should need to change: the specs do not look
at the Earnings and Analysts panels of funds and indices (int/pages hides them), the only company name they check, Apple
Inc., is the same short and long (int/pages prefers long names), a panel is the first region of its name (int/ui's
DataTable may add a labelled scroll region around an overflowing table), and the command bar opens with "/" rather than
through the phone's command field (int/shell turns it into an icon button).
