# Testing InvestSeek

Three layers, none of which calls Yahoo or DeepSeek:

- **Unit tests** (Vitest): pure functions, server modules, the fixture data generator and the mock model.
- **End-to-end tests** (Playwright): the production build in a real browser, with synthetic market data
  (`MARKET_DATA_SOURCE=fixtures`) and a mock model behind the AI features.
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
| `sessions.test.ts` | NYSE holidays against the published calendars, special closures, session times across daylight saving time, the latest completed session, the market state. |
| `prices.test.ts` | A bar never changes once its session closed, OHLC consistency, ^VIX and yields in range, funds that move with their index, intraday bars that match their daily bar. |
| `client.test.ts` | The not-found prefix in every method, module availability per quote type, dispatch at call time. |
| `app-data.test.ts` | The data through the app's own mappers and pages: quotes, summaries, bars, search, news, overview, screens, calendar, signal, screener, AI context. |
| `treasury.test.ts` | The Treasury CSV columns and its agreement with ^TNX and ^IRX. |

## Fixture mode

`MARKET_DATA_SOURCE=fixtures` makes the server answer every market data request from a deterministic generator
(`lib/server/fixtures`) instead of Yahoo. It exists for the end-to-end tests and for screenshots; never use it for a real
deployment, because the prices are made up.

How it works: every Yahoo call goes through the shared `yf` client of `lib/server/yahoo.ts`. That client is wrapped
(`lib/server/fixtures/client.ts`) so that each method (`quote`, `chart`, `quoteSummary`, `search`, `screener`,
`trendingSymbols`, `options`, `fundamentalsTimeSeries`) decides at call time, from `MARKET_DATA_SOURCE`, whether the real
client or the generator answers. One build serves both modes.

What the mode guarantees:

- **No network access for market data.** News stories link to `https://example.com/fixtures/news/<id>`, and the article
  reader answers those with canned text (every other link counts as unavailable). The Treasury curve has a fetch-compatible
  stand-in (`fixtureTreasuryFetch`), see [below](#after-merging-the-wave-2-branches).
- **Library shapes.** Results look like yahoo-finance2's after its validation: Date objects, raw numbers and Yahoo's units
  (`regularMarketChangePercent` in percent in quotes, fractions in quoteSummary, epoch seconds in screener rows). The
  contract test enforces it.
- **Stable data.** Prices are seeded random walks anchored at their table level on 2026-01-02, with a market factor
  (seeded by the date) and a sector factor, so stocks move with their sector and index and a fund that tracks an index
  moves exactly like it. A session's bar is the same on every run and every day. Prices stop at the latest completed
  session, so the data changes only when a session closes (16:00 New York time for US listings) and stays the same for a
  whole test run in between. `marketState` follows the clock (PRE, REGULAR, POST, CLOSED), the numbers do not.
- **Calendars.** Daily bars exist on NYSE sessions only (holidays 2000 to 2030, from the exchange rules plus the special
  closures), on weekdays for other exchanges and FX, every day for crypto. Weekly and monthly bars aggregate the dailies;
  1-minute to 1-hour bars exist for completed sessions, open at the daily open, close at the daily close and touch its
  high and low, with pre- and after-market bars for US listings.
- **Sensible levels.** Indices (^GSPC, ^IXIC, ^DJI, ^RUT and the world board), ^VIX around 15 to 20, Treasury yields
  (^IRX, ^FVX, ^TNX, ^TYX) of a few percent from one curve model, FX, futures and crypto at plausible levels.
- **Names are facts, figures are not.** A table covers the app's universe (`lib/universe.ts`, `lib/names-zh.ts`, the sector
  and broad ETFs, the world board) with real names, sectors and approximate sizes. Every other well-formed symbol is
  known too, with a stable made-up name. People, analyst firms and institutions in the ownership and analyst modules are
  made up, and every description says it is synthetic.
- **Upcoming events.** Earnings and dividends are scheduled relative to the latest completed session, so the calendar, My
  day and the week ahead always have entries. The default watchlist has fixed near-term dates: NVDA reports 2 sessions
  ahead, MSFT 4, AAPL 6, GOOGL 8 and AMZN 9; AAPL goes ex-dividend in 3 sessions.
- **Limits.** The public market-data rate limit is raised (synthetic data costs no quota, and the suite's browsers share
  one client key). The AI and sign-in limits are unchanged.
- **Visible.** The status bar says "Fixture data" (演示数据), `/api/health` reports `"dataSource":"fixtures"`, and a
  production server logs a `config.issue` warning at startup.

Not modelled: early closes (13:00) and holidays outside the US, split adjustments of past prices (bars stay continuous;
a few real splits show as events), and Yahoo quirks such as the extra trailing row of weekly charts.

Run the app on fixture data:

```bash
MARKET_DATA_SOURCE=fixtures npm run dev
```

## Reserved symbols and AI scenarios

| Input | Effect |
|---|---|
| Any symbol starting with `ZZ` (e.g. `ZZZZ`) | Unknown, exactly as Yahoo answers an unknown symbol: `quote` leaves it out, `chart` fails with "No data found, symbol may be delisted", `quoteSummary` with "Quote not found for symbol: ZZZZ", `search` finds nothing, `options` resolves to undefined, `fundamentalsTimeSeries` to `[]`. The pages show their 404 states. |
| `E2ELEN` | The mock model stops with `finish_reason: "length"`: the note shows the truncation notice. |
| `E2EERR` | The mock model sends a few chunks, then an error event: the note shows the error and Retry. |
| `E2ESLOW` | The mock model streams about 300 ms per chunk, long enough to press Stop. |
| `E2EKEY` | The mock model answers 401, as for a rejected key (`provider_rejected`). |
| Bearer key `rejected` | 401 for every request (start the server with `DEEPSEEK_API_KEY=rejected`). |

The `E2E*` symbols are ordinary stocks in the fixture data (with descriptive names), so a note on `/stock/E2ELEN` triggers
its scenario. In the chat, type the marker in the message. The mock looks at the latest user message first, then at the
whole prompt, so parallel tests never interfere. Without a marker it answers with a short Markdown note (or chat answer)
that names the symbol of the prompt and ends with "Mock answer for automated tests."

Notes are cached on the server for 15 minutes by their context, so a repeated note is served instantly from the cache.
A test that must see the stream itself (Stop, for example) should use Regenerate, which skips the cache.

## End-to-end tests

```bash
npm run e2e          # headless; builds and starts the app unless one already runs on port 3100
npm run e2e:headed   # watch the browser
npx playwright test e2e/specs/ai.spec.ts --project=desktop   # one file, one project
```

`playwright.config.ts` starts two servers:

- the mock model, `node e2e/mock-llm.mjs`, on 127.0.0.1:3199 (`E2E_LLM_PORT`);
- the app, `npm run build && npm start -- -H 127.0.0.1 -p 3100` (`E2E_PORT`), with the environment in
  `e2e/support/env.ts`: fixture data, `DEEPSEEK_API_KEY=test` pointing at the mock, test-only `ACCESS_PASSWORD` and
  `SESSION_SECRET`, a high `AI_DAILY_LIMIT` and `LOG_LEVEL=warn`. Every setting is given, so a local `.env.local` cannot
  change what is tested.

Locally both are reused when they already run, which skips the build between runs. To keep a server around:

```bash
node e2e/mock-llm.mjs &
MARKET_DATA_SOURCE=fixtures DEEPSEEK_API_KEY=test DEEPSEEK_BASE_URL=http://127.0.0.1:3199 \
  ACCESS_PASSWORD=e2e-test-password-not-a-secret SESSION_SECRET=e2e-test-session-secret-0123456789abcdef \
  AI_DAILY_LIMIT=100000 LOG_LEVEL=warn npm start -- -H 127.0.0.1 -p 3100
```

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
  requests show up there). Expected noise is allowed per test, with a reason:
  `consoleErrors.allow(/status of 404/, "The API answers 404 for an unknown symbol.")`.
- `axe.check({ exclude })` runs axe-core and fails on serious or critical violations (see below).
- `app.goto(path)` opens a page and waits until no data request is in flight for half a second and fonts are loaded;
  `app.setPrefs({ theme, lang })` stores display preferences the way the app does (cookies read on the server);
  `app.isPhone` tells the projects apart.

Prefer roles and accessible names (`getByRole("region", { name: "Sector heatmap" })`) over CSS classes: panels are
regions named by their title, so specs survive layout changes.

## Accessibility

`axe.check()` scans with the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22a` and `wcag22aa` and fails on
violations of impact serious or critical, listing each rule, its help link and the selectors of the failing elements. The
full result is attached to the test report. `e2e/specs/a11y.spec.ts` checks `/` and `/stock/AAPL` in the dark and light
themes on both projects.

Known findings, excluded in that spec until the branches that rewrite the components are merged:

| Page | Rule | Elements | Fixed by |
|---|---|---|---|
| `/` | label-content-name-mismatch (serious) | heatmap tiles, e.g. `.text-center.outline-offset-\[-2px\][href$="NVDA"]`: the aria-label puts the company and price between the symbol and the change the tile shows | wave2/overview (new heatmap) |
| `/` | target-size (serious) | small heatmap tiles (`a[href$="QCOM"]`, `a[href$="NKE"]`) and sector headers (`.px-1\.5.bg-panel-2[href$="technology"]`, 17px tall) | wave2/overview |
| `/stock/AAPL` | nested-interactive (serious) | the chart container `[role="img"].absolute.inset-0` around lightweight-charts' focusable attribution link | wave2/quote (container hidden from assistive technology, no attribution link) |

Color contrast passes in both themes; `npx tsx scripts/check-contrast.ts` covers the token pairs.

## CI

`.github/workflows/ci.yml` has two jobs:

- **check**: lint, typecheck, unit tests, the production build and an audit of production dependencies.
- **e2e**: Node from `.nvmrc`, `npm ci`, Playwright's browsers cached by the Playwright version in the lockfile,
  `npx playwright install --with-deps chromium`, then `npx playwright test`, which builds and starts its own server. In CI
  the suite uses the bundled Chromium, two workers and one retry. On failure the HTML report and the traces are uploaded
  as the `playwright-report` artifact.

## After merging the wave 2 branches

- Remove the merged pages from `PENDING_PAGES` in `e2e/support/test.ts` (navigation prefetches of `/markets`,
  `/screener`, `/portfolio` and `/calendar` answer 404 until those pages exist).
- Drop the known exclusions in `e2e/specs/a11y.spec.ts` once wave2/overview and wave2/quote are in, and rerun axe.
- The overview heatmap of wave2/overview renders tiles as `role="option"` named `"<symbol> <change>"` (a list on
  phones): adjust the heatmap assertion in `e2e/specs/smoke.spec.ts`.
- Wire the Treasury curve of wave2/overview to the fixture CSV: in `lib/server/rates.ts`, let `getYieldCurve` default its
  `fetchImpl` to `fixtureTreasuryFetch` (from `lib/server/fixtures/treasury.ts`) when
  `readEnv().marketDataSource === "fixtures"`, and keep `fetch` otherwise. The fixture curve is the same model behind
  ^IRX, ^FVX, ^TNX and ^TYX, newest row first, in Treasury's columns.
- Run the fixture tests (`npx vitest run lib/server/fixtures`) and the suite: the generator already covers the calls the
  branches add (earnings and analyst modules, options chains, fundamentals time series, ownership modules, intraday and
  monthly charts with dividend and split events).
