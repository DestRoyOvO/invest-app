# Changelog

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
