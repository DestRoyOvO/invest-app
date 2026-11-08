import { describe, expect, it } from "vitest";

import type { FactorResearch } from "@/lib/evaluation";
import research from "@/lib/factor-research.json";
import { MESSAGES } from "@/lib/i18n/messages";
import { METRICS } from "@/lib/screens";
import type { ScreenRow } from "@/types/screener";

// The note above the factor columns (t.screener.factorNote.body in lib/i18n/screener.ts) says that none of the style
// factors behind the percentile columns predicted later returns in the factor research. The sentence is fixed text, so
// these tests fail when lib/factor-research.json stops supporting it: then rewrite factorNote.body (en and zh).

const data = research as unknown as FactorResearch;
const STYLE_FACTORS = ["momentum", "reversal", "high52", "volatility", "beta"] as const;

describe("factor note", () => {
  it("covers exactly the style factors the percentile columns show", () => {
    // Each factor gets its own number, so the columns' values say which factors they read.
    const probe = { percentiles: { momentum: 1, reversal: 2, high52: 3, volatility: 4, beta: 5 } } as unknown as ScreenRow;
    const shown = Object.values(METRICS)
      .filter((metric) => metric.unit === "percentile")
      .map((metric) => metric.value(probe));
    expect(shown.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("matches the research: no style factor predicted returns at any horizon", () => {
    for (const key of STYLE_FACTORS) {
      const factor = data.factors.find((f) => f.key === key);
      expect(factor, `${key} is missing from lib/factor-research.json`).toBeDefined();
      expect(factor?.results.length).toBeGreaterThan(0);
      for (const result of factor?.results ?? []) {
        expect(result.verdict, `${key} at ${result.days} days is now ${result.verdict}: update factorNote.body in lib/i18n/screener.ts`).toBe("not_predictive");
      }
    }
  });

  it("names the universe size the research used", () => {
    expect(MESSAGES.en.screener.factorNote.body).toContain(`${data.universe}-stock universe`);
    expect(MESSAGES.zh.screener.factorNote.body).toContain(`${data.universe} 只股票`);
  });
});
