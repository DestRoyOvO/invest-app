# InvestSeek quant signal model (v4)

Source of truth: `lib/signal.ts` (engine and every constant named below), `lib/risk-forecast.ts` (risk forecast),
`lib/stats.ts` and `lib/research-stats.ts` (statistics helpers), `lib/server/signal-service.ts` (data loading and
caching) and `GET /api/stock/[symbol]/signal` (returns the `SignalReport` type in `types/api.ts`). The evidence lives
in [evaluation.md](evaluation.md) (`npm run evaluate`) and [factor-research.md](factor-research.md) (`npm run research`).
If this document and the code disagree, the code wins and this file is the bug.

## 中文摘要

- 这是一个**基于规则的打分模型**：动量、趋势、RSI、成交量、估值、质量 6 个方向性因子，输出 0–100 的综合分、五档读数
  （强势 / 偏强 / 中性 / 偏弱 / 弱势）、因子一致度、数据覆盖率和置信度。权重是事先设定的，**没有用历史收益拟合过**。
- **v4 的唯一改动**：把"波动率状态"移出方向性评分。它衡量的是风险而不是方向，在 2014–2024 留出样本上的 10 日秩 IC 约为 0。
  其 15% 的权重按比例分给其余因子（机械的重新归一化，不是拟合）；波动率仍然计算并展示，用于风险。
- 技术评分实际上是**短期相对强弱**：它与过去 21 个交易日收益的截面秩相关约 +0.77。在 2016–2026 年、78 只大盘股上，
  它**没有预测过收益**：5 / 10 / 20 日秩 IC 为 -0.005 / -0.010 / -0.017，Newey-West t 都不到 2；2014–2024 留出样本上
  10 日 IC 为 -0.004，五个技术因子都没有通过事先设定的检验。去掉波动率状态是在看过这份留出样本之后决定的，
  所以对 v4 来说它已不是独立的检验。
- 历史表现表改为固定区间、全部交易日的 IC 加 Newey-West t、按日期分块的 bootstrap 区间，并把超额收益拆成
  "择时"（读数出现时大盘涨跌）和"选股"（相对同日股票池）。10 日"弱势"读数相对同日股票池只有 +0.10%（区间 -0.94% 至 +0.96%）。
- 个股回测新增**循环置换检验**：把读数序列平移至少 20 个交易日重新回测，给出 p 值。78 只股票里 p < 0.05 的比例约 5%，
  与随机一致；界面将把 p ≥ 0.01 的结果灰显。
- **新增风险预测**（数据真正能预测的部分）：20 日与 252 日方差等权混合的波动率预测、未来 10 日 ±1σ / ±2σ 价格区间
  （2016–2026 实测覆盖率 71.8% / 94.5%）、相对自身过去一年的波动分位、252 日 Beta，以及 63 日波动率
  （所在五分位"一个月内从高点回撤 10% 以上"的历史频率从 7.3% 到 37.3%）。
- **本模型仅供研究和学习，不构成投资建议。**

## 1. What the model is, and what it is not

The model is a transparent, rule-based scoring system for a single US-listed symbol. It turns about 18 months of daily
prices and a handful of fundamentals into factor scores on a common 0–100 scale (50 = no opinion, higher = stronger),
a weighted composite, a five-step reading and a risk forecast. It is meant to summarize the evidence on one screen, not
to predict returns.

- The weights and mappings are **priors chosen by hand**. They were checked for symmetry, continuity and absence of
  look-ahead (see the tests), but they were **not fitted or calibrated against realized returns**.
- The **technical score** (the price-based part of the composite) is best read as **short-term relative strength**:
  its mean cross-sectional rank correlation with the trailing 21-session return is +0.77 (v3: +0.72). It has **not
  predicted returns** in this universe: not over 2016–2026, not in any subperiod, and not on the 2014–2024 holdout
  (section 8).
- The **risk forecast** is the part with measured calibration: 10-session ranges that held about 72% and 94% of moves,
  and volatility and beta that rank next quarter's values with rank correlations of 0.72 and 0.77 (section 7).
- The backtest attached to every report describes how the technical part of the model would have traded the same
  stock over the last year. With typically 5–35 trades per hold period it is mostly noise; its permutation p-value says
  how easily random timing produces the same edge.

## 2. Data and preprocessing

| Input | Source | Notes |
|---|---|---|
| Daily OHLCV, last 540 calendar days (~372 sessions) | `getDailyBars` (Yahoo chart) | Cached 10 min upstream |
| SPY daily bars, same request | `getDailyBars("SPY", 540)` | Shared cache entry with the screener; used for beta only |
| Market state, trailing P/E, trailing EPS, quote type | `getQuote` | |
| ROE, net margin, revenue growth, debt/equity, sector | `getSummary` (quoteSummary) | Revenue growth is the latest quarter, year over year |

- **Validation.** Rows with a missing or non-positive close, or an invalid timestamp, are dropped. Rows are sorted by
  session; a repeated session keeps the last row. Volumes that are missing, zero or non-finite count as missing.
- **Adjusted prices.** All return-based math uses dividend- and split-adjusted prices: the close is Yahoo's `adjClose`
  (falling back to the raw close), and the open is scaled by the same per-bar factor `adjClose / close`. High and low
  are not used.
- **Partial session.** While the regular session is open (`quote.marketState === "REGULAR"`), a bar dated today
  (New York date) is still forming and is removed; `meta.droppedPartialBar` reports this. The benchmark's bars go by
  the same rule, and beta only uses sessions both series completed.
- **Minimum history.** With fewer than `MIN_BARS = 120` bars the report has `status: "insufficient_data"`, a `reason`,
  null `code / score / consensus / coverage / confidence`, no factors, no backtest and `risk: null`.
- **Fundamentals** are only used for single stocks (`quoteType === "EQUITY"`); ETFs, indices, futures, currencies and
  crypto get none, so their value and quality factors are imputed. When the quote is unavailable, the summary's
  fundamentals are used only if its profile names a sector: funds have none, yet Yahoo reports a trailing P/E for them
  (about 23 for SPY) that must not be scored as a company valuation. P/E is the quote's trailing P/E, else the
  summary's, else price / EPS when EPS is positive. Debt/equity is a ratio (Yahoo's percent divided by 100).
- **Unknown symbols.** If Yahoo returns neither a quote nor any history, the route answers 404 `not_found`; an upstream
  outage answers 502 `upstream_error`. A failed benchmark request only leaves `risk.beta` null. Reports are cached for
  15 minutes per symbol (a stale report is served for up to an hour if a refresh fails; `asOf` always shows when it was
  computed) and for 5 minutes at the CDN.

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

### 3.2 Momentum (weight 4/17 ≈ 0.235, raw = 20-day simple return, percent)

For each horizon `h ∈ {5, 20, 60}`:

```
z_h = ln(C_t / C_{t-h}) / (σ̂ · √h)                  return in standard deviations
s_h = 50 + 50 · clamp(z_h / MOMENTUM_FULL_Z, -1, 1)  MOMENTUM_FULL_Z = 3
momentum = 0.35 · s_5 + 0.40 · s_20 + 0.25 · s_60     (re-weighted over the available horizons)
```

**Divergence damping.** When the 5-day and 60-day sub-scores sit on opposite sides of 50, the score is shrunk toward 50
(not toward 0): `conflict = min(|s_5 - 50|, |s_60 - 50|)`, `k = 1 - 0.3 · clamp(conflict / 25, 0, 1)`,
`momentum = 50 + (momentum - 50) · k`. The damping grows continuously with the weaker side, so there is no cliff.

These horizons straddle two documented effects of opposite sign: the last month's return tends to reverse in large
caps, while months 2 to 12 tend to continue. A 5/20/60-day blend largely cancels them, which is one reason the score
describes the recent move rather than forecasting the next one.

### 3.3 Trend (weight 3/17 ≈ 0.176, raw = distance from the arithmetic 50-day average, percent)

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
that a healthy distance from MA20 is better than an overstretched one, symmetric for downtrends.

### 3.4 RSI (weight 2/17 ≈ 0.118, raw = RSI14 value, number)

Wilder's RSI(14) on adjusted closes: the average gain and loss are seeded with the simple mean of the first 14 changes
and then smoothed as `avg = (13 · avg + current) / 14`; `RSI = 100 - 100 / (1 + G / L)`, 100 when `L = 0`, and **50
when the price did not move at all**. The value is checked against the published StockCharts ChartSchool example and
against an independent closed-form implementation.

The score is a contrarian, symmetric piecewise-linear map (`RSI_SCORE_KNOTS`), with the most extreme readings damped
back toward 50 because they often come with news-driven moves:

| RSI | 0 | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Score | 55 | 65 | 80 | 75 | 60 | 50 | 40 | 25 | 20 | 35 | 45 |

RSI is the only factor defined on price differences rather than log returns, so it mirrors exactly under an arithmetic
reflection of the path (`p' = 2 p_0 - p`) and only approximately (within about 3 points) under a log reflection.

### 3.5 Volume (weight 2/17 ≈ 0.118, raw = volume ratio, multiple)

```
ratio     = median(volume, last 5 sessions) / median(volume, the 20 sessions before them)
direction = clamp(ln(C_t / C_{t-5}) / (σ̂ · √5), -1, 1)     full 5-day move, in noise units
volume    = 50 + 35 · direction · V(ratio)
```

`V` is piecewise linear and flat outside its knots: ratio 0.6 → -0.4, 0.8 → 0, 1.0 → 0.3, 1.3 → 0.8, 1.6 → 1.0. A rally
of at least one noise unit on doubled volume scores 85 and an equally strong selloff on doubled volume 15; a rally on
thin volume scores below 50 and a selloff on thin volume ("drying up") above 50. The factor is imputed when fewer than
3 of the last 5 or fewer than 10 of the baseline 20 sessions have volume (common for indices, FX and some crypto feeds).

### 3.6 Volatility regime (weight 0 since v4, raw = annualized 20-day volatility, percent)

The factor reads volatility **relative to the stock's own history**:

```
DD_t = sqrt( Σ min(r, 0)² / 20 )                 downside semideviation over all 20 returns
ρ_t  = 0.7 · √2 · DD_t + 0.3 · σ_t               √2 puts DD on the scale of a standard deviation
p    = mid-rank percentile of ρ_t among the ρ values of the last 250 sessions (today included)
volatility = 100 - p
```

A calm stretch relative to the past year scores high and a turbulent one low. In v3 it carried 15% of the composite
on the premise that calm stretches are bullish; on the 2014–2024 holdout its 10-session rank IC was +0.005 (t 0.56),
and on a random walk it alone moved the composite by up to ±7.5 points, the largest single source of label changes on
noise. **v4 keeps computing and reporting it (`RISK_FACTORS`, weight 0) but it no longer moves the score, the reading,
the consensus or the coverage.** The risk forecast (section 7) supersedes it as the risk reading.

### 3.7 Value (weight 18/85 ≈ 0.212, raw = trailing P/E, multiple)

```
g       = clamp(revenueGrowth ?? 0.05, -0.10, 0.40)
fairPE  = clamp(15 + 60 · g, 8, 40)
value   = clamp(50 - 50 · log2(PE / fairPE), 0, 100)
```

- A P/E equal to the fair P/E scores 50, half of it 100, twice it 0. The map is continuous and monotonic in both P/E
  and growth (tested on fine grids).
- **Shrinking revenue** caps the score without a jump: the cap is 100 at 0% growth and falls linearly to 60 at -10%
  and below.
- **Loss-makers** (EPS ≤ 0, or a non-positive P/E) score 20 and are **not** imputed; `raw` is null.
- Without a usable P/E or EPS the factor is imputed. Unknown revenue growth assumes 5% and lowers coverage.
- In a November 2026 sample of 79 large caps (median trailing P/E 23.1, median revenue growth 10.2%) the median value
  score was 37 and the mean 43: the factor currently calls the typical large cap somewhat expensive.

### 3.8 Quality (weight 12/85 ≈ 0.141, raw = ROE, percent)

The mean of the available scores below, each linear and clipped to 0..100:

| Metric | 0 at | 100 at | 50 at |
|---|---|---|---|
| ROE | -5% | 35% | 15% |
| Net profit margin | -5% | 30% | 12.5% |
| Debt/equity (inverse) | 2.5 | 0 | 1.25 |

- Debt/equity is skipped for financial companies (sector contains "Financial"), where leverage is the business model,
  and when it is negative (negative equity).
- The ranges put a median company near 50. The large caps in the November 2026 sample scored a median of 64.
- With none of the metrics available the factor is imputed.

## 4. Composite and labels

v4 starts from the hand-set v3 priors (`V3_FACTOR_WEIGHTS`: momentum 0.20, trend 0.15, RSI 0.10, volume 0.10, value
0.18, quality 0.12, volatility 0.15), drops the risk factors and divides the rest by their sum (0.85). This is a
mechanical renormalization, not a fit: the relative weights of the remaining factors are unchanged.

```
composite = Σ weight_k · score_k     weights: momentum 4/17, trend 3/17, rsi 2/17, volume 2/17,
                                              value 18/85, quality 12/85, volatility 0
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

The cut-offs are symmetric around 50 (`SIGNAL_THRESHOLDS`), inherited from v2 and not re-derived from data. The codes
keep their historical names; the interface shows the descriptive reading because the score has no forecasting edge.

## 5. Consensus, coverage and confidence

- **Consensus** (0–100, or null): the weight share of the *informative* factors that sit on the same side of 50 as the
  composite. A factor is informative when it is not imputed and at least `CONSENSUS_DEAD_BAND = 5` points from 50
  (a weight of 0 contributes nothing). Null when no factor is informative or the composite is exactly 50.
- **Coverage** (0–100): `100 · Σ weight_k · availability_k`, the weight share of the model backed by real data.
  Availability is the share of horizon weight available (momentum), the share of component weight available (trend),
  1 or 0 (RSI, volume), 1 for value (0.75 when revenue growth is unknown) and available / applicable metrics for
  quality. Imputed factors count 0. A stock with full data scores 100; an ETF 65 (value and quality imputed); an
  instrument without volume or fundamentals 53. (v3: 100 / 70 / 60, because the always-available volatility regime
  carried weight.)
- **Confidence**: `high` when consensus ≥ 70, coverage ≥ 80 and |composite - 50| ≥ 8; `medium` when consensus ≥ 55 and
  coverage ≥ 60; otherwise `low` (including when consensus is null). This describes how much the inputs agree, not how
  likely the reading is to be right. Instruments without volume or fundamentals now stay at `low`.

## 6. Backtest

Historical fundamentals are not available point-in-time, so the backtest uses **technical factors only**:

```
technical_t = (0.20 · momentum + 0.15 · trend + 0.10 · rsi + 0.10 · volume) / 0.55
```

rounded to 0.1 and labelled with the same cut-offs. The series is computed once per report and shared by all hold
periods.

- **Window.** Signal sessions `t ∈ [first, last]` with `last = n - 1 - 10` (every signal has complete forward data for
  the longest hold) and `first = max(MIN_BARS - 1, last - 249)`. So `windowDays = min(250, n - 129)`; with fewer than
  20 sessions (n < 149) no backtest is reported.
- **Execution.** A signal formed at the close of session `t` is bought at the adjusted **open of `t + 1`** and sold at
  the adjusted close of `t + h`, `h ∈ {3, 5, 10}`. Net return `R = C_{t+h} / O_{t+1} - 1 - 0.0010` (10 bps round trip).
- **Trades.** A trade opens on a `bullish` or `strong_bullish` session when no position is open. Trades never overlap:
  after a trade on signal `t`, the next one can use a signal formed at the exit close `t + h`. Hence
  `trades ≤ ceil(windowDays / h)`.
- **Statistics.** `winRate` = share of trades with `R > 0`, with a Wilson 95% interval; `avgReturn` = mean `R`;
  `baselineWinRate` / `baselineAvgReturn` = the same `R` for **every** session of the window; `edge = avgReturn -
  baselineAvgReturn`, taken from the two rounded averages; `sharpe = mean(R) / std(R) · √(trades · 252 / windowDays)`;
  `maxDrawdown` = worst peak-to-trough of the strategy's equity marked to market at every close while a trade is open;
  `lowSample` when trades < 20.
- **Permutation test (new in v4).** `pValue` is a two-sided circular-shift permutation p-value of the edge. The label
  sequence of the window is rotated by every offset of at least `permutationMinShift = 20` sessions in either
  direction (all `windowDays - 39` of them; above `permutationMaxShifts = 1000` valid rotations, 1,000 seeded random
  ones), and the edge is recomputed with the same trade rule and the same returns. Rotation keeps how often and in what
  runs strong readings occur and keeps the return series, but breaks their alignment.
  `pValue = (1 + rotations with |edge| ≥ |observed|) / (1 + rotations)`, null without trades. Across the 78 universe
  stocks (372 bars to 2026-11-06) 11 of 234 stock-hold results had p < 0.05 (4.7%) and 2 had p < 0.01 (0.9%), what
  chance alone produces. With three hold periods per stock, the interface treats edges with p ≥ 0.01 as
  indistinguishable from random timing.
- **Bearish signals.** `bearishSignals` counts the `bearish` and `strong_bearish` sessions of the window; their hit rate
  and mean forward return use the same long forward return as the baseline.
- Rates are rounded to 4 decimals, returns to 5, the Sharpe ratio to 2 and `pValue` to 4.

## 7. Risk forecast

`SignalReport.risk` (`lib/risk-forecast.ts`, filled by the signal service from the stock's completed bars and SPY's):

| Field | Definition |
|---|---|
| `forecastVolatility` | `sqrt(0.5 · var20 + 0.5 · var252)` of daily log returns, annualized with √252. Fixed in advance (an equal blend of short and long memory, as in HAR models, Corsi 2009), not tuned. Needs 253 bars. |
| `range1`, `range2` | `price · exp(∓ k · σ_daily · √10)` for `k = 1, 2`: the 10-session ranges around the last completed close, log-symmetric. |
| `ownPercentile` | Mid-rank percentile of today's 20-session volatility among its values at each of the last 252 sessions. Needs 272 bars. |
| `beta` | Beta of daily simple returns to SPY over the last 252 sessions on matching sessions (`lib/factors.ts`, at least 80% overlap). Not Yahoo's 5-year monthly beta in KeyStats. |
| `volatility63` | Annualized volatility of the last 63 daily returns (`lib/factors.ts`), the measure of the universe quintiles below. |

Measured calibration (`npm run research`, `lib/risk-calibration.json`, 78 stocks, 2016-01-01 to 2026-11-06):

- 10-session moves stayed inside the 1-sigma range on **71.8%** of 210,230 stock-days and inside 2 sigma on **94.5%**
  (normal: 68.3% / 95.4%; 2016–2020 73.0% / 94.3%, 2021–2023 72.0% / 95.3%, 2024–2026 69.3% / 93.9%). Tails are fatter
  than normal, so the 2-sigma range is approximate. The 20-session estimate alone gave 67.3% / 91.7% and a worse QLIKE
  loss (0.549 against 0.426 for the blend).
- Trailing 63-session volatility ranked realized volatility over the next 63 sessions with a mean rank correlation of
  0.72 (never below 0.43 on any date); trailing 252-session beta ranked next-quarter beta at 0.77 (minimum 0.35).
- By quintile of `volatility63` across the universe (Q1 lowest), the share of stock-months with a peak-to-trough drop of
  10% or more within 21 sessions was 7.3% / 13.2% / 17.0% / 21.8% / 37.3%, and with a 21-session return of -10% or worse
  2.6% / 4.7% / 6.3% / 7.3% / 13.2%. The highest quintile ranged 34–41% and the lowest 6–9% across the three
  subperiods. The quintile boundaries at the window end were 22%, 26%, 31% and 37% annualized volatility.

Earnings and macro events break the ranges; they describe a normal stretch, not a worst case.

## 8. Evaluation so far

**Universe evaluation** (`npm run evaluate`; full tables in [evaluation.md](evaluation.md)). 78 large US stocks,
signals 2016-01-04 to 2026-11-06 (window pinned in `scripts/evaluation.config.json`), technical score only, entry at
the next open, dividend and split adjusted, before costs. The rank IC is the mean of all daily cross-sectional ICs,
tested with a Newey-West t; the readings' excess return is split into market timing and stock selection (against the
same-day equal-weight universe), with 95% moving-block bootstrap intervals over dates.

| Horizon | Rank IC (NW t) | t over grid phases | Very strong: vs universe [95% CI] | Very weak: vs universe [95% CI] |
|---|---|---|---|---|
| 5 sessions | -0.005 (-0.64) | -1.04 to -0.11 | +0.02% [-0.19%, +0.22%] | +0.35% [-0.49%, +1.09%] |
| 10 sessions | -0.010 (-1.06) | -1.92 to -0.03 | +0.18% [-0.23%, +0.57%] | +0.10% [-0.94%, +0.96%] |
| 20 sessions | -0.017 (-1.43) | -1.69 to -0.11 | +0.42% [-0.27%, +1.10%] | +0.78% [-0.88%, +2.63%] |

- The technical score has **not predicted** forward returns: no horizon reaches |t| = 2, no subperiod either, and the
  sign is slightly negative, as expected from a score that leans on the last month's move in large caps.
- The old track record (a 2.5-year window, one arbitrary grid phase) showed "very weak" readings followed by +2.17%
  and a 71% up-rate over 10 sessions. Most of that was market timing: weak readings pile up in sell-offs, which were
  bought quickly. Against the same-day universe the very weak reading earned +0.10% over 10 sessions in 2016–2026,
  with an interval from -0.94% to +0.96%, spread over 66 episodes.
- **Holdout** 2014-01-02 to 2024-04-29 (the decade before the window the model was first evaluated on): composite
  10-session rank IC -0.004 (NW t -0.39, 95% CI -0.024 to +0.016); momentum -0.002, trend -0.004, RSI +0.002, volume
  -0.002, volatility regime +0.005; none passes the one-sided Holm test fixed in advance. No weight was fitted to these
  years, but v4 dropped the volatility regime after seeing this table (the other weights were only rescaled), so for
  v4 the decade is no longer an independent test. The change moved the composite's holdout IC from +0.001 (v3) to
  -0.004; both are zero within the interval.
- **Hindsight gap**: the universe, equal-weighted, returned 19.1% a year over the window against 12.0% for RSP and 14.6%
  for SPY. The 78 names are today's leaders, so absolute returns in every table are flattered.
- **Factor research** ([factor-research.md](factor-research.md)): none of seven pre-registered factors (12-1 momentum,
  short-term reversal, 52-week high, low volatility, low beta, the technical score, their composite) passes the
  adoption rule (Holm p < 0.05 and the same sign in every subperiod). With 78 names the smallest detectable IC is
  0.033 / 0.066 / 0.107 at 5 / 21 / 63 sessions, above typical large-cap factor ICs.

What changed because of it: the weights were **not** re-tuned (fitting them to this data would only move the
overfitting elsewhere). The volatility regime left the directional score, the score is described as short-term
relative strength, the track record shows return against the same-day universe with honest intervals, and the
quantitative weight of the product moved to the risk forecast, which the data supports.

**Driftless random walks** (zero-mean log returns, 12 seeds of 1,500 sessions per volatility level; a stock without
fundamentals, so value and quality are imputed):

| Annualized volatility | Strong or very strong days | Weak or very weak days | Very strong or very weak | Label changes per 100 sessions |
|---|---|---|---|---|
| 10% | 6.7% | 8.2% | 0% | 8.6 |
| 25% | 7.0% | 8.5% | 0% | 8.8 |
| 50% | 7.0% | 8.6% | 0% | 8.8 |
| 80% | 6.9% | 8.7% | 0% | 8.8 |

v3 labelled 16–18% of noise days on each side and changed label about 14 times per 100 sessions; without the
volatility regime the score reacts less to noise. `lib/signal.test.ts` keeps the balance as a regression test.

**Real data snapshot** (Yahoo closes to 2026-11-06, 372 bars, 243-session window, 5-day hold; for illustration only):

| Symbol | Technical score (reading) | Trades | Win rate [95% CI] | Baseline win rate | Edge | Permutation p |
|---|---|---|---|---|---|---|
| NVDA | 33.5 (weak) | 11 (low sample) | 36% [15–65%] | 50% | -1.79 pp | 0.19 |
| AAPL | 52.0 (neutral) | 21 | 62% [41–79%] | 57% | -0.15 pp | 0.76 |
| MSFT | 55.6 (neutral) | 12 (low sample) | 50% [25–75%] | 50% | -0.25 pp | 0.84 |
| JPM | 47.6 (neutral) | 18 (low sample) | 50% [29–71%] | 48% | -0.36 pp | 0.40 |
| XOM | 40.5 (weak) | 24 | 54% [35–72%] | 61% | -0.35 pp | 0.40 |
| PFE | 51.0 (neutral) | 17 (low sample) | 82% [59–94%] | 57% | +0.82 pp | 0.11 |
| TSLA | 42.3 (neutral) | 7 (low sample) | 43% [16–75%] | 51% | +0.01 pp | 1.00 |
| AMD | 39.2 (weak) | 24 | 54% [35–72%] | 57% | +1.04 pp | 0.42 |

No edge is distinguishable from random timing. A report takes a few milliseconds to compute once warm, backtest and
permutation test included.

## 9. Changes

### From v3 to v4

| v3 | v4 |
|---|---|
| Volatility regime 15% of the directional composite | Weight 0 (`RISK_FACTORS`); still computed and reported; other weights renormalized proportionally |
| Technical score = 5 price factors / 0.70 | 4 directional price factors / 0.55; described as short-term relative strength |
| Coverage 100 / 70 / 60 (stock / ETF / no volume or fundamentals) | 100 / 65 / 53 |
| Backtest edge with a Wilson interval only | Adds a circular-shift permutation p-value per hold period |
| No risk forecast | `risk`: volatility forecast, 10-session ranges, own-history percentile, beta, 63-session volatility, with measured calibration |
| Track record: 2.5 years anchored to the run date, one grid phase, raw excess, Wilson intervals, "best label" line | Pinned decade, all-dates IC with Newey-West t and grid-phase range, timing and selection, block-bootstrap intervals, episodes, holdout decade, hindsight gap |

### From v2 to v3

| v2 problem | v3 |
|---|---|
| Absolute volatility level scored as a directional factor (permanent tilt toward low-vol stocks) | Percentile of a downside-weighted 20-day measure within the stock's own year |
| Downside deviation divided by the number of losing days and zeroed below 3 of them (92 → 0 cliff) | `sqrt(Σ min(r,0)² / N)` over all returns, no cut-off |
| Step-function RSI, volume, trend and value maps with cliffs; asymmetric RSI table | Continuous piecewise-linear or log maps, symmetric around 50 |
| Flat series scored RSI 100; NaN fundamentals became Strong Sell | RSI 50 without movement; every non-finite input is imputed and flagged |
| Momentum divergence penalty multiplied toward 0 | Damped toward 50 |
| Loss-makers scored a neutral 50 (Yahoo omits their P/E) | EPS ≤ 0 scores 20, not imputed |
| Quality ranges scored a typical company below "no data"; negative D/E scored as no debt; banks penalized for leverage | Re-centred ranges; negative D/E missing; D/E skipped for financials |
| "Reliability" counted imputed 50s as agreement | Consensus over informative factors only, coverage from imputed flags, explicit confidence rules |
| Backtest: 60 sessions, today's fundamentals on every past day, entry at the signal close, unadjusted prices, no costs | 250 sessions, technical only, next-open entry, adjusted prices, 10 bps, baseline and edge, daily mark-to-market drawdown |
| A labelled signal even without price history; today's partial bar included | `insufficient_data` below 120 bars; partial bar dropped during the session |

## 10. Known limitations

- **No return forecast.** Neither the technical score nor any tested style factor has predicted returns in this
  universe. The reading describes the current setup.
- **No point-in-time fundamentals.** Value and quality use today's data; they cannot be backtested here, and the live
  reading of a stock with an extreme valuation is largely set by them (about 35% of the weight).
- **Survivorship and selection bias.** The universe is today's large caps; delisted and shrunken companies are absent.
  The hindsight gap (universe 19.1% a year against RSP 12.0%) measures how much that flatters every return table.
- **Power.** With 78 names, realistic factor ICs (0.01 to 0.03) are below what the evaluation can detect, so "not
  predictive" means "cannot tell", not "disproven". Testing a new factor needs a larger point-in-time universe.
- **Short, single-stock backtest.** At most 250 sessions of one symbol, so typically 5–35 trades per hold period; read
  the permutation p-value before the edge.
- **Risk ranges.** Calibrated on 2016–2026 large caps; fat tails make the 2-sigma range approximate, and earnings,
  macro releases and regime changes break it. Beta and volatility describe the past year and quarter.
- **Calendar.** Horizons count sessions and annualization assumes 252 of them a year, which fits exchange-traded
  instruments. For crypto, which trades every day, the annualized volatility shown is about 17% too low (√(252/365)).
- **Not fitted.** Weights, cut-offs and saturation constants are judgment calls documented here, not estimates.
- **Data.** Yahoo data can be delayed, revised or wrong. The partial-bar check uses the New York date, so it may miss
  non-US listings.
- **Costs and execution.** 10 bps round trip and fills at the open; no slippage model, no shorting, no position sizing,
  no taxes.

## 11. Tests

`npx vitest run lib/signal.test.ts lib/risk-forecast.test.ts lib/evaluation.test.ts lib/research-stats.test.ts lib/server/signal-service.test.ts`
covers: the RSI reference values; flat, empty, short and corrupt inputs never producing NaN; continuity and
monotonicity of value and quality; exact mirror symmetry of momentum, trend, volume and RSI; independence from the
volatility level; a future-bar perturbation test; the v4 weights as a proportional renormalization of the v3 priors,
and a technical score built from the four directional factors only; backtest invariants and an independent
re-statement of the backtest rules including the permutation p-value; balanced label shares on random walks; the risk
forecast's blend, ranges, coverage on a Gaussian walk, own-history percentile, QLIKE, drawdown and beta; the
evaluation core's timing-plus-selection identity, reproducibility on fixture bars, independence from bar order,
duplicates and data after the window end, the Newey-West verdict and the grid-phase fragility flag; that the committed
JSON files match the current model and the pinned config; and the service's partial-bar, benchmark, fund-detection,
stale-report, not-found and upstream-error handling.

## Disclaimer

This model is for education and research only. It is not investment advice and not a recommendation to buy or sell
any security. Its weights are not fitted to data, its backtests cover a short period and are subject to the
limitations above, and past results do not predict future returns. Do your own research and consider a qualified
financial adviser before making investment decisions.

本模型仅用于学习与研究，不构成任何投资建议或买卖推荐。模型权重未经数据拟合，回测期间短且存在上述局限，
历史表现不代表未来收益。投资有风险，决策请独立判断，必要时咨询专业人士。
