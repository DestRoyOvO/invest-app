import { describe, expect, it } from "vitest";

import { evaluationVerdict, findHorizon, findLabel, IC_T_RELIABLE } from "./evaluation";
import { EVALUATION_DAYS, SIGNAL_EVALUATION } from "./evaluation-data";
import { FACTOR_WEIGHTS, MODEL_VERSION, SIGNAL_THRESHOLDS } from "./signal";

describe("evaluationVerdict", () => {
  it("needs |t| >= 2 with a matching sign", () => {
    expect(evaluationVerdict({ ic: { mean: 0.05, t: 2.4, dates: 30 } })).toBe("predictive");
    expect(evaluationVerdict({ ic: { mean: -0.05, t: -2.1, dates: 30 } })).toBe("inverse");
    expect(evaluationVerdict({ ic: { mean: -0.044, t: -1.69, dates: 63 } })).toBe("none");
    expect(evaluationVerdict({ ic: { mean: 0.03, t: IC_T_RELIABLE - 0.01, dates: 63 } })).toBe("none");
    expect(evaluationVerdict({ ic: { mean: null, t: null, dates: 0 } })).toBe("none");
  });
});

describe("committed evaluation (lib/signal-evaluation.json)", () => {
  it("matches the current model settings; re-run npm run evaluate after changing the model", () => {
    expect(SIGNAL_EVALUATION.model.version).toBe(MODEL_VERSION);
    expect(SIGNAL_EVALUATION.model.thresholds).toEqual(SIGNAL_THRESHOLDS);
    expect(SIGNAL_EVALUATION.model.weights).toEqual(FACTOR_WEIGHTS);
  });

  it("covers the default horizon and every label", () => {
    const horizon = findHorizon(SIGNAL_EVALUATION, EVALUATION_DAYS);
    if (!horizon) throw new Error("default horizon missing");
    for (const code of ["strong_bullish", "bullish", "neutral", "bearish", "strong_bearish"] as const) {
      expect(findLabel(horizon, code)?.n).toBeGreaterThan(0);
    }
    expect(horizon.ic.dates).toBeGreaterThan(0);
    expect(SIGNAL_EVALUATION.universe).toBeGreaterThan(0);
    expect(SIGNAL_EVALUATION.from < SIGNAL_EVALUATION.to).toBe(true);
  });
});
