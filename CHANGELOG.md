# Changelog

## 0.3.0 · Function codes, portfolio analytics and honest research (2026-11)

Every screen gets a function code, your positions move to the center (home page, calendar, alerts and the AI), and the quant layer now forecasts risk and publishes the tests its return signals failed. Built in three waves from an eight-lens audit ([roadmap](docs/roadmap-v0.3.md)).

### Added
- **Function codes and the command bar.** MKT, WEI, GC, SECT, EQS, MOST, WL, PORT, CORR, EVTS, ALRT, NOTE, QT, DES, GP, FA, ERN, ANR, DVD, HDS, RISK, COMP, LAB, DATA and HELP, with English and Chinese aliases. `NVDA GP`, `GP NVDA`, `COMP AAPL MSFT SPY`, Chinese company names and `?question` all work; `g` shortcuts, a `?` sheet with the page's own keys, `/help` with every route, a session ribbon and a 404 page that suggests functions.
- **A personal home page.** My day (value, today's P&L and its largest contributors, extended-hours P&L, the next report), the week ahead, a breadth strip, a heatmap on a stepped scale with a legend, hover cards and keyboard navigation, and movers for the whole US market or the large caps.
- **World markets and rates (WEI, GC).** Regional benchmarks with their sessions and local times, an overnight line, currencies, commodities, crypto and breadth by sector; the US Treasury par yield curve against a month and a year ago, with the 2s10s and 3m10y spreads.
- **Portfolio analytics (PORT, CORR).** Beta, volatility, 1-day 95% historical VaR, maximum drawdown, effective positions and projected dividends; today's holdings against SPY or QQQ; exposure by sector, asset class and currency; risk contributions and a correlation matrix. A position editor opens from anywhere (add shares at a weighted cost, or reduce with the realized P&L shown).
- **Events and earnings (EVTS, ERN, ANR).** A calendar of earnings, ex-dividend dates with the cash a position receives, and FOMC, CPI and jobs releases, plus a week-ahead panel. On the quote page: consensus and revisions, the options-implied move, past surprises, rating trends, price targets and recent rating changes.
- **Screener and Discover (EQS, MOST).** 78 large caps and 26 ETFs with filters, seven presets, six column sets, share links, CSV export and saved screens; Yahoo's market-wide movers, idea lists and trending symbols behind a quality filter.
- **Quote workstation.** Tabs for Financials, Earnings, Analysts, Dividends and Ownership; a header that knows your position; a chart with ten ranges including 1D and 5D intraday with extended hours, up to three comparisons, MA 20/50/200, Bollinger bands, RSI, a log scale, dividend, split and earnings markers, and your cost, target and stop lines.
- **Notes and alerts (NOTE, ALRT).** Thesis notes with conviction, target, stop, review dates, tags and a dated timeline; local alert rules (price, day move, P&L from cost, earnings within N days, the 200-day average) checked while a tab is open, with catch-up of missed price levels and optional system notifications.
- **Your data (DATA).** Backup and restore of everything kept in the browser with a merge or replace preview, position import from broker CSV files and pasted text (English and Chinese headers), and CSV export.
- **Risk you can measure.** A risk forecast panel (10-session ±1σ and ±2σ ranges, volatility percentiles, beta, drawdown frequencies by volatility quintile) with its measured calibration, a factor profile with the evidence for each factor, a permutation p-value for every per-stock backtest edge, `npm run research` for the pre-registered factor study, and the factor lab (LAB).
- **AI.** Positions in the chat context behind an "Include my positions" switch that says they go to DeepSeek; earnings and analyst facts; "Why is it moving?" with a market, sector and peer breakdown and cited headlines; precomputed portfolio facts; saved notes and up to 20 chats; suggested questions; note outlines per asset class; a 15-minute server note cache; time and token limits that suit reasoning models.
- **Preferences.** The System theme by default, color-blind price colors (blue up, orange down) and a compact density.
- **Self-hosting and operations.** A Docker image and Compose file with optional automatic HTTPS through Caddy, one validated settings schema with startup checks, `/api/health` with version, commit, uptime and an upstream readiness check, structured JSON logs (`LOG_LEVEL`), `DEEPSEEK_BASE_URL`, an installable web app manifest with icons and a social card, a weekday Yahoo canary, Dependabot and issue forms.

### Changed
- **The technical score is described, not sold.** It is shown in neutral ink as short-term relative strength, and its track record comes from a pinned, reproducible evaluation: a fixed 2016–2026 window, the all-dates rank IC with a Newey-West t, timing and selection split apart, block-bootstrap intervals, a 2014–2024 holdout and the hindsight gap. None of it shows a reliable edge, and the app says so.
- **Model v4** takes the volatility regime out of the score (it measures risk, not direction) and rescales the other hand-set weights in proportion. The change was made after seeing the 2014–2024 holdout, so for v4 that holdout is no longer an independent test.
- **New design system.** Semantic tokens for dark, light and system themes, IBM Plex Sans tabular figures, red and green for prices and P&L only, column-flow layouts, shared primitives (DataTable, panel codes, whiskers, ticking numbers, toasts, drawers) and WCAG AA contrast checked in both themes and all three price conventions. A prompt-candle brand mark replaces the starter icons.
- **Lighter requests.** A small board endpoint feeds the ticker strip and status bar, the watchlist and holdings share one batched quote request, the overview carries only the fields it shows, and the backup validator loads only when a file is checked.
- **yahoo-finance2 4**, which needs Node.js 22.

### Fixed
- **Honest data states.** Stale quotes show as stale, with their age, instead of passing for live prices.
- **Layout and touch.** Tables fit their panels from 375 to 1440 px in both languages without sideways scrolling, and controls are at least 40 px tall on phones.
- **Keyboard and screen readers.** Focus stays in place in the command bar and dialogs; scrollable regions are focusable; accessible names start with the visible text.
- **AI.** Missing data is no longer turned into claims, and a key DeepSeek rejects is told apart from AI being switched off.

### Security
- **Private site mode** (`SITE_ACCESS=private`): every page and API route behind the access password, with `noindex` and private caching.
- A nonce-based Content-Security-Policy for pages in production, and a `__Host-` session cookie that a sibling subdomain cannot plant or overwrite.
- A production server refuses to start with settings that would leave it unsafe or impossible to sign in to, such as a password without a valid `SESSION_SECRET` or one longer than the sign-in form accepts.
- Failed and rate-limited sign-ins are logged, without the password.
- Public routes charge one rate-limit unit per uncached Yahoo call, and none for symbols Yahoo does not know.
- On a private site the readiness check hides Yahoo call times from visitors without a session.
- `DEEPSEEK_BASE_URL` accepts only https, or plain http on localhost for test mocks.

### Docs
- README rewritten in English and Chinese at parity: what the numbers say, a tour by function code, the command grammar and keys, architecture diagrams, data sources and limits, and self-hosting.
- New: the [deployment guide](docs/deployment.md), the [design system](docs/design-system.md), [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and a [docs index](docs/README.md).
- Generated reports for the [evaluation](docs/evaluation.md) and the [factor research](docs/factor-research.md), the [signal model](docs/signal-model.md) updated to v4, and the [v0.3 roadmap](docs/roadmap-v0.3.md) with its status.
- `scripts/check-links.ts` checks every relative link and image in the Markdown docs.

## 0.2.0 · Terminal redesign (2026-11)

A rewrite of the app around the habits of a professional terminal, with the model, the data layer and the AI made honest and safe enough to deploy.

### Product
- New terminal interface: command bar, keyboard navigation, ticker strip, dense panels, dark and light themes, green-up or red-up colors, English and Chinese, phone layout with a bottom tab bar.
- Market overview with a market-cap sector heatmap, sector bars, movers and headlines; sector pages; quote pages with a candlestick chart, key statistics, news and profile.
- Watchlist with sparklines and sector mix, plus positions (shares, average cost) with value, weight, day P&L and unrealized P&L. Everything is stored in the browser.
- Portfolio totals never add amounts in different currencies, and positions without a quote stay visible and editable.
- AI research notes and a page-aware assistant (DeepSeek). The portfolio scan weighs concentration and risk by position value. Answers cut off by the length limit are flagged.

### Quant model (v3)
- Seven factors with raw inputs, explicit missing-data handling, symmetric technical factors and a relative volatility regime.
- Per-stock backtest on adjusted prices with next-open entries, costs, Wilson intervals, a buy-every-session baseline and a Sharpe ratio annualized by the observed trade frequency.
- New universe evaluation (`npm run evaluate`, [docs/evaluation.md](docs/evaluation.md)). It found no reliable forward edge, so the score is now shown as a reading (very strong to very weak) with its track record under it, and the AI receives the same facts. A test fails when the model changes without a new evaluation.

### Platform
- Typed client-server contract, a shared Yahoo client with timeouts, tiered TTL caching with in-flight de-duplication and stale-on-error.
- AI endpoints behind a password session in production, rate limits and a daily budget, same-origin checks, zod validation and body size caps. Public endpoints are rate limited per client.
- Server-built AI context with untrusted third-party text fenced off; SSRF-safe article fetching.
- Security headers and a production CSP.
- More than 400 unit tests (Vitest) and CI with lint, typecheck, tests, build and a dependency audit.
- Hardened after an independent multi-agent review: bounded quote cache and fail-fast Yahoo queueing, per-call charging for uncached public loads, loopback-only AI in password-less development mode, focus management in drawers and the command palette, and WCAG AA text contrast in both themes.

## 0.1.0

The original single-page dashboard with a rule-based signal and AI analysis.
