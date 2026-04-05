# Quantitative Signal Model v2 — Technical Specification

## Overview

InvestSeek's quantitative signal model is a **7-factor, rule-based scoring system**
that produces a composite score (0–100), a 5-tier recommendation label, and a
**confidence metric** indicating factor agreement. It uses the same code path for
live signals and historical backtesting to ensure reproducibility.

---

## Data Sources

All data comes from **Yahoo Finance** via the `yahoo-finance2` npm package:

| Data Point | Yahoo API | Factors Using It |
|---|---|---|
| Daily OHLCV (~18 months) | `yf.chart(ticker, { period1: 540d, interval: '1d' })` | Momentum, Trend, RSI, Volume, Volatility |
| Trailing P/E | `yf.quote` + `yf.quoteSummary` | Value |
| ROE | `financialData.returnOnEquity` | Quality |
| Profit Margin | `financialData.profitMargins` | Quality |
| Revenue Growth | `financialData.revenueGrowth` | Value (growth-adjustment) |
| Debt/Equity | `financialData.debtToEquity` | Quality |

---

## Factor Definitions (7 Factors)

### 1. Multi-Timeframe Momentum (Weight: 20%)

Combines 5-day, 20-day, and 60-day price returns to capture momentum at different
time horizons while filtering out noise.

```
score = 0.35 * normalize(return_5d, -15%, +15%)
      + 0.40 * normalize(return_20d, -20%, +20%)
      + 0.25 * normalize(return_60d, -30%, +30%)
```

**Divergence penalty**: If short-term and long-term momentum diverge by more than
40 points, the score is dampened by 15% to reduce whipsaw risk.

**Rationale**: A stock rising on all timeframes is a much stronger signal than one
rising short-term but falling long-term.

### 2. Trend Alignment (Weight: 15%)

Evaluates price position relative to MA20, MA50, and MA100, plus moving average
alignment (shorter above longer = bullish).

**Scoring components** (point-based, normalized to 0–100):
- Price > MA20: +2 pts | Price > MA50: +2 pts | Price > MA100: +2 pts
- MA20 > MA50: +1.5 pts | MA50 > MA100: +1.5 pts
- Healthy distance from MA20 (0–5%): +1 pt

**Rationale**: A stock with aligned moving averages (golden cross territory) is in
a confirmed trend, which historically has higher forward returns.

### 3. RSI Mean-Reversion (Weight: 10%)

14-day Relative Strength Index, scored with a non-linear mapping that captures
oversold buying opportunities and overbought sell pressure.

| RSI Range | Score | Interpretation |
|---|---|---|
| <=15 | 65 | Extreme oversold — bullish but cautious (possible fundamental issue) |
| 16–30 | 85 | Oversold — strong buy opportunity |
| 31–45 | 70 | Mildly bearish RSI — mild buy |
| 46–55 | 55 | Neutral zone |
| 56–70 | 40 | Mildly overbought — cautious |
| 71–85 | 20 | Overbought — sell pressure expected |
| >85 | 10 | Extremely overbought |

**Rationale**: RSI catches mean-reversion opportunities that pure momentum misses.
The non-linear scoring avoids the trap of buying into a free-fall (extreme oversold
gets a lower score than moderate oversold).

### 4. Volume Dynamics (Weight: 10%)

Compares recent 5-day average volume to the preceding 20-day baseline, cross-
referenced with price direction for confirmation.

| Price Direction | Volume Ratio | Score | Interpretation |
|---|---|---|---|
| Rising | >1.3x | 85 | Strong bullish confirmation |
| Rising | <0.7x | 40 | Weak rally — likely unsustainable |
| Falling | >1.3x | 20 | Heavy selling / capitulation |
| Falling | <0.7x | 60 | Drying up — potential reversal |
| Flat | any | ~50 | Neutral |

**Rationale**: Price moves confirmed by volume are far more reliable than those on
thin volume. This catches distribution (price up, volume down) and accumulation
patterns.

### 5. Enhanced Value (Weight: 18%)

Growth-adjusted P/E scoring. The acceptable P/E range widens for higher-growth
companies:

| Revenue Growth | P/E Range Mapped to [0, 100] |
|---|---|
| >15% (high growth) | 10–80 |
| 5–15% (moderate) | 8–50 |
| <5% or unknown | 5–35 |

If P/E is unavailable or negative, returns neutral 50.

**Rationale**: A P/E of 40 is expensive for a no-growth utility but reasonable for
a 30% revenue grower. This PEG-like adjustment prevents the model from permanently
penalizing growth stocks.

### 6. Financial Quality (Weight: 12%)

Composite of three fundamental metrics (averaged equally):

| Metric | Good Range | Formula |
|---|---|---|
| ROE | 0%–35% | `normalize(ROE, 0, 0.35)` |
| Profit Margin | -5%–30% | `normalize(margin, -0.05, 0.30)` |
| Debt/Equity | 0–3.0 | `inverseNormalize(D/E, 0, 3.0)` |

If data is unavailable for a metric, it defaults to 50 (neutral).

**Rationale**: High-quality businesses (high ROE, good margins, low debt) have more
durable earnings and are more resilient in downturns.

### 7. Volatility / Risk (Weight: 15%)

**Downside-weighted** volatility measure inspired by the Sortino ratio:

```
blended_vol = 0.70 * annualized_downside_deviation + 0.30 * annualized_total_vol
score = inverseNormalize(blended_vol, 0.08, 0.70)
```

**Rationale**: Upside volatility is welcome; it's downside volatility that destroys
portfolios. A stock with high total vol but mostly upside moves gets a better score
than one with symmetric or downside-heavy vol.

---

## Composite Score & Weights

```
composite = momentum * 0.20 + trend * 0.15 + rsi * 0.10 + volume * 0.10
          + value * 0.18 + quality * 0.12 + volatility * 0.15
```

### Signal Labels

| Score | Label |
|---|---|
| 72–100 | Strong Buy |
| 58–71 | Buy |
| 42–57 | Hold |
| 28–41 | Sell |
| 0–27 | Strong Sell |

### Confidence Score

Measures factor agreement: what percentage of the 7 factors agree with the overall
direction (bullish if score >= 50, bearish if < 50).

| Confidence | Meaning |
|---|---|
| >= 70% | HIGH — Most factors align. Signal is reliable. |
| 45–69% | MEDIUM — Mixed signals. Proceed with caution. |
| < 45% | LOW — Factors disagree. High uncertainty. |

---

## Backtest Methodology

The enhanced backtest evaluates signal accuracy over a configurable window
(default: 60 trading days) with these metrics:

1. For each day `t` in the window, compute the full 7-factor signal using only
   data available at day `t`.
2. If signal is Buy or Strong Buy, record a trade:
   - Entry: `close[t]`, Exit: `close[t + holdDays]` (default 5 days)
3. **Metrics reported**:
   - **Win Rate**: fraction of trades with positive return
   - **Avg Return**: mean return per trade
   - **Sharpe Ratio**: `mean(returns) / std(returns)` (per-trade)
   - **Max Drawdown**: worst cumulative peak-to-trough across sequential trades
   - **Sample Size**: `buySignals / totalSignals` (shows signal selectivity)

### Data Requirements

Minimum bars: `100 (lookback for MA100) + backtestDays + holdDays`
With defaults (60d backtest, 5d hold): 165 bars (~8 months).

---

## Improvements Over v1

| Aspect | v1 | v2 |
|---|---|---|
| Factors | 3 (momentum, P/E, vol) | 7 (+ trend, RSI, volume, quality) |
| Momentum | Single 20d return | Multi-TF (5d/20d/60d) with divergence penalty |
| Value | Fixed P/E thresholds | Growth-adjusted (PEG-like) |
| Volatility | Simple annualized vol | Downside-weighted (Sortino-style) |
| Volume | Not used | Price-volume confirmation |
| Mean reversion | Not available | RSI-based with non-linear scoring |
| Quality | Not available | ROE + margins + leverage |
| Confidence | Not available | Factor-agreement metric |
| Backtest | Win rate + avg return | + Sharpe, max drawdown, selectivity |
| Signal thresholds | Symmetric 25/40/60/75 | Calibrated 28/42/58/72 |
| Data window | 252d (1yr) | 540d (18mo) for richer MA100 lookback |

---

## Known Limitations

- **Data quality**: Yahoo Finance data may have delays, gaps, or inaccuracies.
- **P/E & fundamentals look-ahead**: Backtest uses current fundamentals for
  historical signals (no point-in-time reconstruction).
- **No transaction costs**: Returns are gross; real trades incur commissions and
  slippage.
- **Rule-based**: Fixed formulas and weights; not adaptive to regime changes.
- **Single-stock**: No portfolio-level correlation or diversification analysis.
- **No earnings event handling**: Does not adjust around earnings dates.

---

## Disclaimer

**This model is for educational and research purposes only. It does not constitute
investment advice. All investment strategies involve risk of loss. Past backtest
performance does not guarantee future results. Always consult with a qualified
financial professional before making investment decisions.**
