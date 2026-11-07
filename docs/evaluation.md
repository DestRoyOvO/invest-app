# Signal evaluation

Generated 2026-11-07 by `npm run evaluate` (scripts/evaluate-signal.ts), model v3.

- Universe: 78 large US stocks from the sector heatmap.
- Period: signals from 2024-04-30 to 2026-11-06 (3 years of history requested; the first 120 sessions of each stock are warm-up).
- Signal: the technical composite only (momentum, trend, RSI, volume, volatility regime), labelled with the live thresholds (very strong >= 72, strong >= 58, weak <= 42, very weak <= 28). The tables use the internal codes: strong_bullish = very strong, bullish = strong, bearish = weak, strong_bearish = very weak.
- Returns: enter at the next session's open, exit at the close h sessions after the signal, dividend and split adjusted, before costs.
- Caveats: survivorship bias (today's constituents), overlapping observations within each label table, no transaction costs, one market regime. Treat small excess returns as noise unless the interval and the IC t-statistic agree.

## Summary

- 5 sessions: rank IC -0.025 (t = -1.44), no reliable relationship between score and forward return. Best label by excess return: strong_bearish (1.55% vs base, n = 642).
- 10 sessions: rank IC -0.044 (t = -1.69), no reliable relationship between score and forward return. Best label by excess return: strong_bearish (2.17% vs base, n = 635).
- 20 sessions: rank IC -0.026 (t = -0.81), no reliable relationship between score and forward return. Best label by excess return: strong_bearish (2.07% vs base, n = 629).

A relationship counts as reliable when |t| >= 2 on non-overlapping dates. Label tables overlap heavily and cluster in time (for example around sharp sell-offs), so their intervals are narrower than the real uncertainty.

## Detail

### Full period

**5-session forward return** (base rate: mean 0.31%, hit rate 53.7%, n = 49062)

| Label | Observations | Mean return | Excess vs base | Hit rate | Hit rate 95% CI |
|---|---:|---:|---:|---:|---:|
| strong_bullish | 1546 | 0.15% | -0.16% | 52.8% | 50.3% – 55.3% |
| bullish | 10865 | 0.23% | -0.08% | 52.7% | 51.8% – 53.7% |
| neutral | 24245 | 0.18% | -0.12% | 52.3% | 51.7% – 53.0% |
| bearish | 11764 | 0.56% | 0.26% | 56.7% | 55.8% – 57.5% |
| strong_bearish | 642 | 1.86% | 1.55% | 70.1% | 66.4% – 73.5% |

Rank IC (non-overlapping dates): mean -0.025, t = -1.44, dates = 126 (no reliable relationship between score and forward return).

**10-session forward return** (base rate: mean 0.65%, hit rate 54.3%, n = 48672)

| Label | Observations | Mean return | Excess vs base | Hit rate | Hit rate 95% CI |
|---|---:|---:|---:|---:|---:|
| strong_bullish | 1528 | 0.48% | -0.17% | 54.3% | 51.8% – 56.8% |
| bullish | 10723 | 0.50% | -0.15% | 53.7% | 52.7% – 54.6% |
| neutral | 24078 | 0.45% | -0.20% | 52.7% | 52.0% – 53.3% |
| bearish | 11708 | 1.10% | 0.45% | 57.5% | 56.6% – 58.4% |
| strong_bearish | 635 | 2.82% | 2.17% | 71.0% | 67.4% – 74.4% |

Rank IC (non-overlapping dates): mean -0.044, t = -1.69, dates = 63 (no reliable relationship between score and forward return).

**20-session forward return** (base rate: mean 1.31%, hit rate 55.3%, n = 47892)

| Label | Observations | Mean return | Excess vs base | Hit rate | Hit rate 95% CI |
|---|---:|---:|---:|---:|---:|
| strong_bullish | 1485 | 0.29% | -1.02% | 51.2% | 48.6% – 53.7% |
| bullish | 10437 | 0.88% | -0.44% | 53.9% | 52.9% – 54.8% |
| neutral | 23754 | 1.20% | -0.12% | 54.5% | 53.9% – 55.2% |
| bearish | 11587 | 1.97% | 0.65% | 58.3% | 57.4% – 59.1% |
| strong_bearish | 629 | 3.38% | 2.07% | 65.8% | 62.0% – 69.4% |

Rank IC (non-overlapping dates): mean -0.026, t = -0.81, dates = 31 (no reliable relationship between score and forward return).

### First half (to 2025-08-06)

**5-session forward return** (base rate: mean 0.35%, hit rate 55.2%, n = 24726)

| Label | Observations | Mean return | Excess vs base | Hit rate | Hit rate 95% CI |
|---|---:|---:|---:|---:|---:|
| strong_bullish | 931 | 0.13% | -0.22% | 53.4% | 50.2% – 56.6% |
| bullish | 5408 | 0.14% | -0.20% | 52.5% | 51.1% – 53.8% |
| neutral | 11526 | 0.19% | -0.15% | 53.9% | 53.0% – 54.8% |
| bearish | 6467 | 0.70% | 0.35% | 58.7% | 57.5% – 59.9% |
| strong_bearish | 394 | 2.32% | 1.97% | 75.1% | 70.6% – 79.1% |

Rank IC (non-overlapping dates): mean -0.032, t = -1.20, dates = 64 (no reliable relationship between score and forward return).

**10-session forward return** (base rate: mean 0.72%, hit rate 56.1%, n = 24726)

| Label | Observations | Mean return | Excess vs base | Hit rate | Hit rate 95% CI |
|---|---:|---:|---:|---:|---:|
| strong_bullish | 931 | 0.30% | -0.42% | 54.9% | 51.7% – 58.1% |
| bullish | 5408 | 0.37% | -0.35% | 53.6% | 52.2% – 54.9% |
| neutral | 11526 | 0.41% | -0.31% | 54.1% | 53.2% – 55.0% |
| bearish | 6467 | 1.45% | 0.73% | 60.8% | 59.6% – 62.0% |
| strong_bearish | 394 | 3.56% | 2.84% | 76.9% | 72.5% – 80.8% |

Rank IC (non-overlapping dates): mean -0.077, t = -2.10, dates = 32 (higher scores were followed by lower returns).

**20-session forward return** (base rate: mean 1.45%, hit rate 57.5%, n = 24726)

| Label | Observations | Mean return | Excess vs base | Hit rate | Hit rate 95% CI |
|---|---:|---:|---:|---:|---:|
| strong_bullish | 931 | 0.13% | -1.31% | 50.2% | 47.0% – 53.4% |
| bullish | 5408 | 0.75% | -0.70% | 54.9% | 53.6% – 56.2% |
| neutral | 11526 | 1.24% | -0.20% | 56.8% | 55.9% – 57.7% |
| bearish | 6467 | 2.48% | 1.03% | 61.4% | 60.2% – 62.6% |
| strong_bearish | 394 | 3.12% | 1.67% | 64.2% | 59.4% – 68.8% |

Rank IC (non-overlapping dates): mean -0.053, t = -1.10, dates = 16 (no reliable relationship between score and forward return).

### Second half (from 2025-08-06)

**5-session forward return** (base rate: mean 0.27%, hit rate 52.2%, n = 24336)

| Label | Observations | Mean return | Excess vs base | Hit rate | Hit rate 95% CI |
|---|---:|---:|---:|---:|---:|
| strong_bullish | 615 | 0.17% | -0.09% | 51.9% | 47.9% – 55.8% |
| bullish | 5457 | 0.31% | 0.05% | 53.0% | 51.7% – 54.3% |
| neutral | 12719 | 0.18% | -0.09% | 50.9% | 50.0% – 51.8% |
| bearish | 5297 | 0.40% | 0.13% | 54.1% | 52.8% – 55.4% |
| strong_bearish | 248 | 1.12% | 0.85% | 62.1% | 55.9% – 67.9% |

Rank IC (non-overlapping dates): mean -0.036, t = -1.47, dates = 63 (no reliable relationship between score and forward return).

**10-session forward return** (base rate: mean 0.57%, hit rate 52.5%, n = 23946)

| Label | Observations | Mean return | Excess vs base | Hit rate | Hit rate 95% CI |
|---|---:|---:|---:|---:|---:|
| strong_bullish | 597 | 0.77% | 0.20% | 53.4% | 49.4% – 57.4% |
| bullish | 5315 | 0.63% | 0.06% | 53.8% | 52.5% – 55.2% |
| neutral | 12552 | 0.48% | -0.09% | 51.4% | 50.5% – 52.2% |
| bearish | 5241 | 0.66% | 0.09% | 53.3% | 52.0% – 54.7% |
| strong_bearish | 241 | 1.62% | 1.05% | 61.4% | 55.1% – 67.3% |

Rank IC (non-overlapping dates): mean -0.028, t = -0.92, dates = 31 (no reliable relationship between score and forward return).

**20-session forward return** (base rate: mean 1.17%, hit rate 53.1%, n = 23166)

| Label | Observations | Mean return | Excess vs base | Hit rate | Hit rate 95% CI |
|---|---:|---:|---:|---:|---:|
| strong_bullish | 554 | 0.55% | -0.62% | 52.9% | 48.7% – 57.0% |
| bullish | 5029 | 1.01% | -0.16% | 52.8% | 51.4% – 54.1% |
| neutral | 12228 | 1.15% | -0.02% | 52.4% | 51.5% – 53.3% |
| bearish | 5120 | 1.32% | 0.15% | 54.3% | 52.9% – 55.7% |
| strong_bearish | 235 | 3.83% | 2.66% | 68.5% | 62.3% – 74.1% |

Rank IC (non-overlapping dates): mean -0.017, t = -0.39, dates = 15 (no reliable relationship between score and forward return).

