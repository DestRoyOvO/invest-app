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
- [After merging the wave 2 branches](#after-merging-the-wave-2-branches)

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
| `app-data.test.ts` | The data through the app's own mappers and pages: quotes, summaries, bars, search, news, overview, screens, calendar, signal, screener, AI context. `fetch` and `node:https` are stubbed and the file fails if any getter reached for the network. |
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
  reader answers those with canned text (every other link counts as unavailable). The Treasury curve has a fetch-compatible
  stand-in (`fixtureTreasuryFetch`, picked by `treasuryFetch`), see [below](#after-merging-the-wave-2-branches). The unit
  tests stub the network while they run the app's getters, and the end-to-end server runs with outbound connections
  refused.
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
  reported quarters) and the same annual sums.
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
  `AI_DAILY_LIMIT`, `TRUST_PROXY=1`, `LOG_LEVEL=warn` and `GIT_SHA` (the checked-out commit). Every setting is given, so a
  local `.env.local` cannot change what is tested.

Playwright refuses to run when something already listens on either port. To keep the servers between runs:

```bash
npm run e2e:serve                  # terminal 1: build, then serve until Ctrl+C (--no-build serves the existing build)
E2E_REUSE=1 npm run e2e            # terminal 2, as often as needed
```

The global setup checks the app before any test runs: `/api/health` must report fixture data, a configured AI, the
checked-out commit and a clock that started at `E2E_NOW` (and has run for less than six hours), and the sign-in must set
the production cookie `__Host-is_session`. A server of another branch, in Yahoo mode, a development server or one started
without the preloads fails there with the reason. Uncommitted changes are not detected: restart `e2e:serve` after
editing.

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
`test-results/` (`npx playwright show-trace <path>`).

The global setup signs in once through `/api/auth/login` and stores the session in `e2e/.auth/state.json` (gitignored).
The production cookie is `__Host-is_session` with `Secure`; browsers treat `http://127.0.0.1` as a secure context, so it
works without HTTPS. A stored state is reused while the server accepts it, which keeps reruns under the sign-in limit
(5 attempts in 15 minutes). A spec that needs to be signed out uses a fresh context:

```ts
test.use({ storageState: { cookies: [], origins: [] } });
```

Write specs in `e2e/specs/*.spec.ts` with the suite's `test` from `e2e/support/test.ts`:

- `consoleErrors` runs in every test and fails it on a console error or an uncaught page error (CSP violations and failed
  requests show up there). Expected noise is allowed per test, as narrowly as possible and with a reason:
  `consoleErrors.allow(/status of 404 \(Not Found\) \(http:\/\/[^/]+\/api\/stock\/ZZZZ[/?)]/, "The stock API answers 404 for an unknown symbol.")`.
- `axe.check({ known })` runs axe-core and fails on serious or critical violations (see below).
- `app.goto(path)` opens a page and waits until no data request is in flight for half a second and fonts are loaded;
  `app.setPrefs({ theme, lang })` stores display preferences the way the app does (cookies read on the server);
  `app.isPhone` tells the projects apart.

Prefer roles and accessible names (`getByRole("region", { name: "Sector heatmap" })`) over CSS classes: panels are
regions named by their title, so specs survive layout changes.

## Accessibility

`axe.check()` scans with the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22a` and `wcag22aa` and fails on
violations of impact serious or critical, listing each rule, its help link and the selectors of the failing elements. The
full result is attached to the test report. WCAG 2.2 is included on purpose: its target-size rule (2.5.8, 24 by 24 CSS
pixels) is the minimum [docs/design-system.md](design-system.md) sets for controls. `e2e/specs/a11y.spec.ts` checks `/`
and `/stock/AAPL` in the dark and light themes on both projects.

A known finding is accepted for one rule on the elements inside a locator (`known: [{ rule, within, reason }]`); every
other rule, color contrast included, still checks those elements. A known finding that no longer occurs adds an
`axe-known-unused` annotation to the test, the cue to delete it. These are accepted until the branches that rewrite the
components are merged:

| Page | Rule | Elements | Fixed by |
|---|---|---|---|
| `/` | label-content-name-mismatch (serious) | heatmap tiles: the aria-label puts the company and price between the symbol and the change the tile shows | wave2/overview (new heatmap) |
| `/` | target-size (serious) | small heatmap tiles (`a[href$="QCOM"]`, `a[href$="NKE"]`) and sector headers (17px tall) | wave2/overview |
| `/stock/AAPL` | nested-interactive (serious) | the chart container `[role="img"]` around lightweight-charts' focusable attribution link | wave2/quote (container hidden from assistive technology, no attribution link) |

Color contrast passes in both themes, heatmap tiles included; `npx tsx scripts/check-contrast.ts` covers the token pairs.

## CI

`.github/workflows/ci.yml` has two jobs:

- **check**: lint, typecheck, unit tests, the production build and an audit of production dependencies.
- **e2e**: Node from `.nvmrc`, `npm ci`, Playwright's browsers cached by the Playwright version in the lockfile,
  `npx playwright install --with-deps chromium`, then `npx playwright test`, which builds and starts its own servers. In
  CI the suite uses the bundled Chromium, two workers and one retry. On failure the HTML report and the traces are
  uploaded as the `playwright-report` artifact.

## After merging the wave 2 branches

- Remove the merged pages from `PENDING_PAGES` in `e2e/support/test.ts` (navigation prefetches of `/markets`,
  `/screener`, `/portfolio` and `/calendar` answer 404 until those pages exist).
- Delete the known findings in `e2e/specs/a11y.spec.ts` once wave2/overview and wave2/quote are in (their
  `axe-known-unused` annotations say when), and rerun axe.
- The overview heatmap of wave2/overview renders tiles as `role="option"` named `"<symbol> <change>"` (a list on
  phones): adjust the heatmap assertion in `e2e/specs/smoke.spec.ts`.
- Wire the Treasury curve of wave2/overview to the fixture CSV: in `lib/server/rates.ts`, import `treasuryFetch` from
  `./fixtures/treasury` and make it `getYieldCurve`'s default (`const fetchImpl = options.fetchImpl ?? treasuryFetch;`).
  It answers from the fixture CSV while `MARKET_DATA_SOURCE=fixtures` and with the global `fetch` otherwise, per call. The
  fixture curve is the same model behind ^IRX, ^FVX, ^TNX and ^TYX, newest row first, in Treasury's columns. Until this
  is done, the end-to-end server's network guard makes the Rates panel fail (a `[no-network]` line names
  home.treasury.gov), and the unit test below fails on its network stub.
- Run the fixture tests (`npx vitest run lib/server/fixtures`) and the suite: the generator already covers the calls the
  branches add (earnings and analyst modules, options chains, fundamentals time series, ownership modules, intraday and
  monthly charts with dividend and split events). Extend `lib/server/fixtures/app-data.test.ts` with their getters
  (`getEarningsDetail`, `getAnalystActivity`, `getImpliedMove`, `getFinancials`, `getDividends`, `getOwnership`, the
  1d, 5d, ytd and max chart ranges, and `getYieldCurve()` without a `fetchImpl`) so their mappers stay covered and the
  network stub proves they stay offline.
