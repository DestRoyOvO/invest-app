# InvestSeek quant signal model (v3)

Source of truth: `lib/signal.ts` (engine and every constant named below), `lib/stats.ts` (statistics helpers),
`lib/server/signal-service.ts` (data loading and caching) and `GET /api/stock/[symbol]/signal` (returns the
`SignalReport` type in `types/api.ts`). If this document and the code disagree, the code wins and this file is the bug.

## 中文摘要

- 这是一个**基于规则的 7 因子打分模型**：动量、趋势、RSI、成交量、波动率、估值、质量。输出 0–100 的综合分、
  五档读数（强势 / 偏强 / 中性 / 偏弱 / 弱势）、因子一致度、数据覆盖率和置信度。权重是事先设定的，
  **没有用历史收益拟合或校准过**。
- v3 重写的目标是"诚实"：所有收益计算都使用复权价；任何缺失的输入都会明确标记为"填充"（imputed），不会悄悄变成中性分；
  技术因子以 50 为中心对称（把价格路径做镜像，动量、趋势、成交量得分严格镜像，RSI 在算术镜像下严格镜像）；
  波动率因子改为"相对自身过去一年的分位数"，不再给低波动股票永久加分。在无漂移的随机游走上，
  各个波动水平下看多与看空的天数都大致相等（各约 16–18%）。
- 回测**只使用技术因子**（没有历史时点的基本面数据）：最近最多 250 个交易日，信号出现后**次日开盘**买入，
  持有 3 / 5 / 10 个交易日后按收盘价卖出，扣除 10 个基点往返成本。同时给出同一窗口内"每天都买"的基准、超额收益、
  Wilson 95% 置信区间、年化夏普、逐日盯市的最大回撤，以及看空信号的命中率。交易少于 20 笔时标记为样本不足，界面应置灰。
- 已知局限：基本面用的是今天的数据；股票池有幸存者偏差；对估值极端的股票，标签主要由基本面决定；
  在纯噪声上约三分之一的交易日会出现看多或看空标签，且标签平均每 100 个交易日变化约 14 次；回测窗口短，置信区间很宽。
- **全市场评估**（`npm run evaluate`，详见 [evaluation.md](evaluation.md)）：在 78 只美股大盘股、2024-04 至 2026-11 的数据上，
  技术评分**没有预测力**。5 / 10 / 20 日的秩 IC 全部为负（约 -0.03 至 -0.04，|t| 均小于 2），而且分组方向相反：
  偏弱、弱势读数之后的收益反而高于平均。因此界面把标签改为描述当前形态的读数，并在评分下方展示这份历史表现；
  权重没有用这份数据重新拟合，以免把过拟合换个地方。
- **本模型仅供研究和学习，不构成投资建议。**

## 1. What the model is, and what it is not

The model is a transparent, rule-based scoring system for a single US-listed symbol. It turns about 18 months of daily
prices and a handful of fundamentals into seven factor scores on a common 0–100 scale (50 = no opinion, higher = more
bullish), a weighted composite, and a five-step reading. It is meant to summarize the evidence on one screen, not to
predict returns.

- The weights and mappings are **priors chosen by hand**. They were checked for symmetry, continuity and absence of
  look-ahead (see the tests), and sanity-checked on real data, but they were **not fitted or calibrated against
  realized returns**. Nothing here has demonstrated predictive power.
- The backtest attached to every report is a description of how the technical part of the model would have traded the
  same stock over the last year. With typically 5–35 trades per hold period its confidence intervals are wide; read it
  as a sanity check, not as evidence of an edge.

## 2. Data and preprocessing

| Input | Source | Notes |
|---|---|---|
| Daily OHLCV, last 540 calendar days (~372 sessions) | `getDailyBars` (Yahoo chart) | Cached 10 min upstream |
| Market state, trailing P/E, trailing EPS, quote type | `getQuote` | |
| ROE, net margin, revenue growth, debt/equity, sector | `getSummary` (quoteSummary) | Revenue growth is the latest quarter, year over year |

- **Validation.** Rows with a missing or non-positive close, or an invalid timestamp, are dropped. Rows are sorted by
  session; a repeated session keeps the last row. Volumes that are missing, zero or non-finite count as missing.
- **Adjusted prices.** All return-based math uses dividend- and split-adjusted prices: the close is Yahoo's `adjClose`
  (falling back to the raw close), and the open is scaled by the same per-bar factor `adjClose / close`. High and low
  are not used.
- **Partial session.** While the regular session is open (`quote.marketState === "REGULAR"`), a bar dated today
  (New York date) is still forming and is removed; `meta.droppedPartialBar` reports this.
- **Minimum history.** With fewer than `MIN_BARS = 120` bars the report has `status: "insufficient_data"`, a `reason`,
  null `code / score / consensus / coverage / confidence`, no factors and no backtest.
- **Fundamentals** are only used for single stocks (`quoteType === "EQUITY"`); ETFs, indices, futures, currencies and
  crypto get none, so their value and quality factors are imputed. When the quote is unavailable, the summary's
  fundamentals are used only if its profile names a sector: funds have none, yet Yahoo reports a trailing P/E for them
  (about 23 for SPY) that must not be scored as a company valuation. P/E is the quote's trailing P/E, else the
  summary's, else price / EPS when EPS is positive. Debt/equity is a ratio (Yahoo's percent divided by 100).
- **Unknown symbols.** If Yahoo returns neither a quote nor any history, the route answers 404 `not_found`; an upstream
  outage answers 502 `upstream_error`. Reports are cached for 15 minutes per symbol (a stale report is served for up to
  an hour if a refresh fails; `asOf` always shows when it was computed) and for 5 minutes at the CDN.

## 3. Factors

Every factor returns `{ score, imputed, raw, rawUnit }`. A factor whose inputs are missing or non-finite returns the
neutral 50 with `imputed: true`; no NaN can reach the report. `raw` is the underlying metric for display, with
`rawUnit` `percent` (a decimal shown as %), `multiple` (shown as "x") or `number`.

### 3.1 Shared building blocks

- Daily log return of the adjusted close: `r_t = ln(C_t / C_{t-1})`.
- `σ_t`: sample standard deviation of the last 20 daily log returns. For scaling it is floored:
  `σ̂ = max(σ_t, SIGMA_FLOOR = 0.005)` (about 8% annualized), so a near-flat series never divides by ~0.
- **Noise unit** over a horizon of `h` sessions: `σ̂ · √h`, the typical size of a random-walk move. Momentum, trend and
  volume measure moves in these units, which makes them independent of the stock's volatility level: the same path at
  three times the volatility gets the same momentum, trend and volume scores (tested).
- `strength(x, u) = clamp(x / u, -1, 1)`.

### 3.2 Momentum (weight 0.20, raw = 20-day simple return, percent)

For each horizon `h ∈ {5, 20, 60}`:

```
z_h = ln(C_t / C_{t-h}) / (σ̂ · √h)                  return in standard deviations
s_h = 50 + 50 · clamp(z_h / MOMENTUM_FULL_Z, -1, 1)  MOMENTUM_FULL_Z = 3
momentum = 0.35 · s_5 + 0.40 · s_20 + 0.25 · s_60     (re-weighted over the available horizons)
```

**Divergence damping.** When the 5-day and 60-day sub-scores sit on opposite sides of 50, the score is shrunk toward 50
(not toward 0): `conflict = min(|s_5 - 50|, |s_60 - 50|)`, `k = 1 - 0.3 · clamp(conflict / 25, 0, 1)`,
`momentum = 50 + (momentum - 50) · k`. The damping grows continuously with the weaker side, so there is no cliff.

### 3.3 Trend (weight 0.15, raw = distance from the arithmetic 50-day average, percent)

Averages are taken over log prices (`L_n` = mean of `ln C` over the last `n` sessions, the log of the geometric moving
average) so that a path and its mirror image score exactly `100 - each other`. Each distance is measured in units of
`u(h) = TREND_FULL_UNITS · σ̂ · √h` with `TREND_FULL_UNITS = 2`, where `h` is the comparison's effective horizon.

| Component | Weight | Value in [-1, 1] |
|---|---|---|
| Price vs. MA20 | 2 | `clamp(g20)`, `g20 = (ln C - L_20) / u(20/3)` |
| Price vs. MA50 | 2 | `strength(ln C - L_50, u(50/3))` |
| Price vs. MA100 | 2 | `strength(ln C - L_100, u(100/3))` |
| MA20 vs. MA50 | 1.5 | `strength(L_20 - L_50, u(15))` |
| MA50 vs. MA100 | 1.5 | `strength(L_50 - L_100, u(25))` |
| Distance from MA20 (overextension) | 1 | `E(g20)`, rises to ±1 at one unit, fades back to 0 at two |
| MA20 slope over 5 sessions | 1 | `strength(L_20(t) - L_20(t-5), u(1))` |

`trend = 50 + 50 · Σ weight · value / Σ weight`. `E(x) = sign(x) · (|x| ≤ 1 ? |x| : max(0, 2 - |x|))` keeps the old idea
that a healthy distance from MA20 is better than an overstretched one, now symmetric for downtrends.

### 3.4 RSI (weight 0.10, raw = RSI14 value, number)

Wilder's RSI(14) on adjusted closes: the average gain and loss are seeded with the simple mean of the first 14 changes
and then smoothed as `avg = (13 · avg + current) / 14`; `RSI = 100 - 100 / (1 + G / L)`, 100 when `L = 0`, and **50
when the price did not move at all** (v2 returned 100 for a flat series). The value is checked against the published
StockCharts ChartSchool example and against an independent closed-form implementation.

The score is a contrarian, symmetric piecewise-linear map (`RSI_SCORE_KNOTS`), with the most extreme readings damped
back toward 50 because they often come with news-driven moves:

| RSI | 0 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Score | 55 | 65 | 80 | 75 | 60 | 50 | 40 | 25 | 20 | 35 | 45 |

RSI is the only factor defined on price differences rather than log returns, so it mirrors exactly under an arithmetic
reflection of the path (`p' = 2 p_0 - p`) and only approximately (within about 3 points) under a log reflection.

### 3.5 Volume (weight 0.10, raw = volume ratio, multiple)

```
ratio     = median(volume, last 5 sessions) / median(volume, the 20 sessions before them)
direction = clamp(ln(C_t / C_{t-5}) / (σ̂ · √5), -1, 1)     full 5-day move, in noise units
volume    = 50 + 35 · direction · V(ratio)
```

`V` is piecewise linear and flat outside its knots: ratio 0.6 → -0.4, 0.8 → 0, 1.0 → 0.3, 1.3 → 0.8, 1.6 → 1.0. A rally
of at least one noise unit on doubled volume scores 85 and an equally strong selloff on doubled volume 15; a rally on
thin volume scores below 50 and a selloff on thin volume ("drying up") above 50. The factor is imputed when fewer than 3 of the last 5 or fewer than 10 of the
baseline 20 sessions have volume (common for indices, FX and some crypto feeds).

### 3.6 Volatility regime (weight 0.15, raw = annualized 20-day volatility, percent)

The factor reads volatility **relative to the stock's own history**, not its absolute level (v2 scored the absolute
level, which permanently favoured low-volatility stocks):

```
DD_t = sqrt( Σ min(r, 0)² / 20 )                 downside semideviation over all 20 returns
ρ_t  = 0.7 · √2 · DD_t + 0.3 · σ_t               √2 puts DD on the scale of a standard deviation
p    = mid-rank percentile of ρ_t among the ρ values of the last 250 sessions (today included)
volatility = 100 - p
```

A calm stretch relative to the past year scores high and a turbulent one low; downside moves count more than upside
moves. `ρ` is rounded to 12 decimals so float residue on perfectly regular series cannot fake a ranking. With fewer
than 100 values of `ρ` (only possible below `MIN_BARS`) a fallback maps annualized `ρ` linearly through 10% → 75,
30% → 50, 80% → 25. The raw value is the plain annualized volatility `σ_t · √252`.

On a random walk the percentile is uniform, so this factor alone moves the composite by up to ±7.5 points; it is the
largest single source of label changes on pure noise.

### 3.7 Value (weight 0.18, raw = trailing P/E, multiple)

```
g       = clamp(revenueGrowth ?? 0.05, -0.10, 0.40)
fairPE  = clamp(15 + 60 · g, 8, 40)
value   = clamp(50 - 50 · log2(PE / fairPE), 0, 100)
```

- A P/E equal to the fair P/E scores 50, half of it 100, twice it 0. The map is continuous and monotonic in both P/E
  and growth (tested on fine grids).
- **Shrinking revenue** caps the score without a jump: the cap is 100 at 0% growth and falls linearly to 60 at -10%
  and below.
- **Loss-makers** (EPS ≤ 0, or a non-positive P/E) score 20 and are **not** imputed; `raw` is null. Yahoo omits the P/E
  of loss-making companies, which v2 turned into a neutral 50. Note that a profitable company with a P/E above about
  1.5× its fair P/E scores below 20.
- Without a usable P/E or EPS the factor is imputed. Unknown revenue growth assumes 5% and lowers coverage.
- The intercept 15 is roughly the long-run US market P/E for a company that does not grow; the slope adds 6 P/E points
  per 10 percentage points of growth. In a November 2026 sample of 79 large caps (median trailing P/E 23.1, median
  revenue growth 10.2%) the median value score was 37 and the mean 43: the factor currently calls the typical large cap
  somewhat expensive.

### 3.8 Quality (weight 0.12, raw = ROE, percent)

The mean of the available scores below, each linear and clipped to 0..100:

| Metric | 0 at | 100 at | 50 at |
|---|---|---|---|
| ROE | -5% | 35% | 15% |
| Net profit margin | -5% | 30% | 12.5% |
| Debt/equity (inverse) | 2.5 | 0 | 1.25 |

- Debt/equity is skipped for financial companies (sector contains "Financial"), where leverage is the business model,
  and when it is negative (negative equity), which v2 scored as "no debt".
- The ranges put a median company near 50 (a company at the midpoints scores exactly 50). The large caps in the
  November 2026 sample scored a median of 64, because they are more profitable than the median company.
- With none of the metrics available the factor is imputed.

## 4. Composite and labels

```
composite = Σ weight_k · score_k            weights: momentum 0.20, trend 0.15, rsi 0.10, volume 0.10,
                                                     value 0.18, quality 0.12, volatility 0.15
```

The composite is computed from the factor scores as reported (rounded to 0.1) and rounded to 0.1, so it can be
reproduced from the report itself. Imputed factors enter at 50 with their full weight, which pulls the composite toward
neutral when data is missing.

| Composite | Code | Shown as |
|---|---|---|
| ≥ 72 | `strong_bullish` | Very strong · 强势 |
| ≥ 58 and < 72 | `bullish` | Strong · 偏强 |
| > 42 and < 58 | `neutral` | Neutral · 中性 |
| > 28 and ≤ 42 | `bearish` | Weak · 偏弱 |
| ≤ 28 | `strong_bearish` | Very weak · 弱势 |

The cut-offs are symmetric around 50 (`SIGNAL_THRESHOLDS`). They were inherited from v2 and not re-derived from data.
The codes keep their historical names; the interface shows the descriptive reading because the universe evaluation
(section 7) found no forecasting edge.

## 5. Consensus, coverage and confidence

- **Consensus** (0–100, or null): the weight share of the *informative* factors that sit on the same side of 50 as the
  composite. A factor is informative when it is not imputed and at least `CONSENSUS_DEAD_BAND = 5` points from 50.
  Null when no factor is informative or the composite is exactly 50. (v2 counted imputed 50s as agreeing with any
  bullish composite.)
- **Coverage** (0–100): `100 · Σ weight_k · availability_k`, the weight share of the model backed by real data.
  Availability is the share of horizon weight available (momentum), the share of component weight available (trend),
  1 or 0 (RSI, volume), `min(1, regime values / 250)` (volatility; a 150-bar history gives 0.52), 1 for value
  (0.75 when revenue growth is unknown) and available / applicable metrics for quality. Imputed factors count 0.
  A stock with full data scores 100; an ETF 70; an instrument without volume or fundamentals 60.
- **Confidence**: `high` when consensus ≥ 70, coverage ≥ 80 and |composite - 50| ≥ 8; `medium` when consensus ≥ 55 and
  coverage ≥ 60; otherwise `low` (including when consensus is null). This describes how much the inputs agree, not
  how likely the label is to be right; it has not been calibrated against outcomes.

## 6. Backtest

Historical fundamentals are not available point-in-time, and applying today's value and quality to every past day
mostly decided in v2 whether any trades existed at all. The backtest therefore uses **technical factors only**:

```
technical_t = (0.20 · momentum + 0.15 · trend + 0.10 · rsi + 0.10 · volume + 0.15 · volatility) / 0.70
```

rounded to 0.1 and labelled with the same cut-offs. The series is computed once per report and shared by all hold
periods.

- **Window.** Signal sessions `t ∈ [first, last]` with `last = n - 1 - 10` (every signal has complete forward data for
  the longest hold) and `first = max(MIN_BARS - 1, last - 249)`. So `windowDays = min(250, n - 129)`, the same window
  for every hold period; with fewer than 20 sessions (n < 149) no backtest is reported.
- **Execution.** A signal formed at the close of session `t` is bought at the adjusted **open of `t + 1`** and sold at
  the adjusted close of `t + h`, i.e. held for `h ∈ {3, 5, 10}` sessions. Net return
  `R = C_{t+h} / O_{t+1} - 1 - 0.0010` (10 bps round trip).
- **Trades.** A trade opens on a `bullish` or `strong_bullish` session when no position is open. Trades never overlap:
  after a trade on signal `t`, the next one can use a signal formed at the exit close `t + h` and buys the next
  morning. Hence `trades ≤ ceil(windowDays / h)`.
- **Statistics.** `winRate` = share of trades with `R > 0`, with a Wilson 95% interval; `avgReturn` = mean `R`;
  `baselineWinRate` / `baselineAvgReturn` = the same `R` for **every** session of the window (buying every day under the
  same rules); `edge = avgReturn - baselineAvgReturn`, taken from the two rounded averages so that it reproduces exactly
  from the report; `sharpe = mean(R) / std(R) · √(trades · 252 / windowDays)`, annualized by the observed trade
  frequency because the strategy is flat between trades (sample std; null below two trades or without dispersion;
  no risk-free rate); `maxDrawdown` = worst peak-to-trough of the strategy's equity marked to market at every close
  while a trade is open (flat in between, cost charged at entry); `lowSample` when trades < 20, and the UI should grey
  the statistics out.
- **Bearish signals.** `bearishSignals` counts the `bearish` and `strong_bearish` sessions of the window (overlapping,
  not trades); `bearishHitRate` is the share followed by `R < 0` and `bearishAvgForwardReturn` their mean `R`, using the
  same long forward return as the baseline. Compare them with `1 - baselineWinRate` and `baselineAvgReturn`.
- Rates are rounded to 4 decimals, returns to 5 and the Sharpe ratio to 2.

## 7. Evaluation so far

**Universe evaluation** (`npm run evaluate`; full tables, halves and caveats in [evaluation.md](evaluation.md)).
78 large US stocks from the heatmap, signals from 2024-04-30 to 2026-11-06, technical score only, entry at the next
open, dividend and split adjusted, before costs. Excess is the label mean minus the mean of all observations.

| Horizon | Rank IC (t) | Very strong: excess / up | Very weak: excess / up | All observations: mean / up |
|---|---|---|---|---|
| 5 sessions | -0.025 (-1.44) | -0.16% / 52.8% (n 1546) | +1.55% / 70.1% (n 642) | +0.31% / 53.7% |
| 10 sessions | -0.044 (-1.69) | -0.17% / 54.3% (n 1528) | +2.17% / 71.0% (n 635) | +0.65% / 54.3% |
| 20 sessions | -0.026 (-0.81) | -1.02% / 51.2% (n 1485) | +2.07% / 65.8% (n 629) | +1.31% / 55.3% |

The technical score has **not predicted** forward returns in this universe and period. The rank IC is negative at
every horizon and in both halves of the period, but it never reaches |t| = 2 over the full period, and the label
buckets run the wrong way: weak and very weak readings were followed by above-average returns, strong and very strong
readings by slightly below-average ones. That pattern is consistent with the short-term reversal effect documented for
large caps (the momentum factor leans on 5- and 20-session returns) and with a period in which sharp sell-offs were
bought quickly. The very weak bucket is small and clustered in a few episodes, so its excess is less certain than its
interval suggests.

What changed because of it: the app presents the score as a reading of the current setup (very strong, strong,
neutral, weak, very weak) rather than as bullish or bearish, shows this track record under the score
(`lib/signal-evaluation.json`), and passes the same facts to the AI. The weights were **not** re-tuned on this data:
fitting them to one 2.5-year bull market would only move the overfitting somewhere else. A reversal-aware variant
should be designed from first principles and then tested out of sample.

**Driftless random walks** (zero-mean log returns, 8–12 seeds of 1,500 sessions per volatility level; a stock without
fundamentals, so value and quality are imputed):

| Annualized volatility | Bullish days | Bearish days | Strong labels | Label changes per 100 sessions |
|---|---|---|---|---|
| 10% | 16.1% | 18.1% | < 0.1% | 14.2 |
| 25% | 18.4% | 17.5% | < 0.1% | 13.4 |
| 50% | 18.2% | 16.6% | < 0.1% | 14.3 |
| 80% | 17.8% | 17.2% | < 0.1% | 14.2 |

v2 labelled a 25%-volatility random walk bullish on 37% of days and bearish on 1%. `lib/signal.test.ts` keeps this
balance as a regression test at four volatility levels.

**Real data snapshot** (Yahoo closes of 2026-11-06, 372 bars, 243-session window, 5-day hold; for illustration only):

| Symbol | Label (score) | Consensus / confidence | Trades | Win rate [95% CI] | Baseline win rate | Edge |
|---|---|---|---|---|---|---|
| NVDA | neutral (45.7) | 60 / medium | 9 (low sample) | 56% [27–81%] | 50% | +0.19 pp |
| AAPL | neutral (47.4) | 61 / medium | 22 | 45% [27–65%] | 57% | -0.84 pp |
| MSFT | neutral (54.5) | 71 / medium | 11 (low sample) | 45% [21–72%] | 50% | -0.40 pp |
| JPM | neutral (52.4) | 55 / medium | 19 (low sample) | 26% [12–49%] | 48% | -1.44 pp |
| XOM | neutral (49.1) | 53 / low | 20 | 55% [34–74%] | 61% | -0.37 pp |
| PFE | bearish (37.8) | 79 / high | 22 | 68% [47–84%] | 57% | +0.27 pp |
| TSLA | bearish (30.1) | 89 / high | 13 (low sample) | 54% [29–77%] | 51% | +0.81 pp |
| INTC | strong_bearish (26.1) | 90 / high | 12 (low sample) | 50% [25–75%] | 52% | -0.16 pp |

Every interval contains the baseline win rate: over one year of one stock the technical signal shows no measurable
edge, which is what an honest backtest of a simple rule usually shows. Over the last 250 sessions the technical labels
were mixed (for example NVDA 28 bullish / 74 bearish days, TSLA 56 / 57); in v2 the same names were bullish on 216 of
266 days (NVDA) or never (TSLA), because today's fundamentals were applied to every past day. A report takes about
1–3 ms to compute once warm, backtest included.

## 8. Changes from v2

| v2 problem | v3 |
|---|---|
| Absolute volatility level scored as a directional factor (permanent tilt toward low-vol stocks) | Percentile of a downside-weighted 20-day measure within the stock's own year |
| Downside deviation divided by the number of losing days and zeroed below 3 of them (92 → 0 cliff) | `sqrt(Σ min(r,0)² / N)` over all returns, no cut-off |
| Step-function RSI, volume, trend and value maps with cliffs; asymmetric RSI table | Continuous piecewise-linear or log maps, symmetric around 50 |
| Flat series scored RSI 100; NaN fundamentals became Strong Sell | RSI 50 without movement; every non-finite input is imputed and flagged |
| Momentum divergence penalty multiplied toward 0 | Damped toward 50 |
| Loss-makers scored a neutral 50 (Yahoo omits their P/E) | EPS ≤ 0 scores 20, not imputed |
| Quality ranges scored a typical company below "no data"; negative D/E scored as no debt; banks penalized for leverage | Re-centred ranges; negative D/E missing; D/E skipped for financials |
| "Reliability" counted imputed 50s as agreement; high for almost every stock | Consensus over informative factors only, coverage from imputed flags, explicit confidence rules |
| Backtest: 60 sessions, today's fundamentals on every past day, entry at the signal close, unadjusted prices, no costs, per-trade Sharpe, exit-only drawdown, Buy signals only | 250 sessions, technical only, next-open entry, adjusted prices, 10 bps, baseline and edge, Wilson CI, annualized Sharpe, daily mark-to-market drawdown, bearish hit rate, low-sample flag |
| A labelled signal even without price history; today's partial bar included | `insufficient_data` below 120 bars; partial bar dropped during the session |

The RSI "regime blend" of v2 (pulling RSI toward 50 in strong trends) was removed: it added hidden interactions and
thresholds; RSI is now simply a 10%-weight contrarian factor.

## 9. Known limitations

- **No point-in-time fundamentals.** Value and quality use today's data; they cannot be backtested here, and the
  live label of a stock with an extreme valuation is largely set by them (30% of the weight, and value spans its whole
  0–100 range within a 4× range of P/E). Revenue growth is a single quarter, which is noisy.
- **Survivorship and selection bias.** The universe is today's large caps; delisted and shrunken companies are absent.
- **Short, single-stock backtest.** At most 250 sessions of one symbol, so typically 5–35 trades per hold period (at
  most 84 for the 3-day hold); the baseline and bearish statistics use overlapping, autocorrelated windows. The
  universe-level evaluation (section 7) is the better evidence, and it found no edge. Re-run it with `npm run evaluate`
  before any change of weights or thresholds: `lib/evaluation.test.ts` fails when `MODEL_VERSION`, the weights or the
  thresholds drift from the committed `lib/signal-evaluation.json`.
- **Labels on noise.** On a driftless random walk about 35% of sessions carry a strong or weak reading (section 7),
  so a label on its own is weak evidence; read it with the consensus, the factor scores and the backtest.
- **Label churn.** On pure noise the label changes about 14 times per 100 sessions; there is no hysteresis.
- **Calendar.** Horizons count sessions and annualization assumes 252 of them a year, which fits exchange-traded
  instruments. For crypto, which trades every day, the annualized volatility shown is about 17% too low (√(252/365))
  and the 5/20/60-session horizons span fewer calendar days.
- **Not fitted.** Weights, cut-offs and saturation constants (`MOMENTUM_FULL_Z`, `TREND_FULL_UNITS`, the RSI and
  volume knots) are judgment calls documented here, not estimates.
- **Data.** Yahoo data can be delayed, revised or wrong. Adjusted prices are back-adjusted when a dividend or split
  occurs (returns are unaffected). The partial-bar check uses the New York date, so it may miss non-US listings.
- **Costs and execution.** 10 bps round trip and fills at the open; no slippage model, no shorting, no position sizing,
  no taxes.

## 10. Tests

`npx vitest run lib/signal.test.ts lib/stats.test.ts lib/server/signal-service.test.ts "app/api/stock/[symbol]/signal"`
covers: the RSI reference values; flat, empty, short and corrupt inputs never producing NaN; continuity and
monotonicity of value and quality on fine grids; the downside semideviation formula; exact mirror symmetry of
momentum, trend, volume (log reflection) and RSI (arithmetic reflection); independence from the volatility level; the
momentum divergence damping (toward 50, never past it); a future-bar perturbation test (changing bars after session i
never changes the score at i); the insufficient-data path; backtest invariants, hand-checkable steady trends and an
independent re-statement of the backtest rules (entries, exits, costs, Sharpe, daily drawdown, bearish statistics) on
split- and dividend-adjusted random walks; balanced label shares on random walks at 10%, 25%, 50% and 80% volatility;
the service's partial-bar, fund-detection, stale-report, not-found and upstream-error handling; and the route's
400 / 404 / 502 mapping.

## Disclaimer

This model is for education and research only. It is not investment advice and not a recommendation to buy or sell
any security. Its weights are not fitted to data, its backtests cover a short period and are subject to the
limitations above, and past results do not predict future returns. Do your own research and consider a qualified
financial adviser before making investment decisions.

本模型仅用于学习与研究，不构成任何投资建议或买卖推荐。模型权重未经数据拟合，回测期间短且存在上述局限，
历史表现不代表未来收益。投资有风险，决策请独立判断，必要时咨询专业人士。
