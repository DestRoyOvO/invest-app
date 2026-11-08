import { describe, expect, it } from "vitest";

import { deltaParts, directionOf, HEAT_EDGES, HEAT_STEPS, heatStep, heatStyle, withTrueMinus } from "./delta-utils";

describe("heatStep", () => {
  it("is flat below 0.10% and for missing values", () => {
    expect(heatStep(0)).toBe(0);
    expect(heatStep(0.0999)).toBe(0);
    expect(heatStep(-0.0999)).toBe(0);
    expect(heatStep(null)).toBe(0);
    expect(heatStep(undefined)).toBe(0);
    expect(heatStep(Number.NaN)).toBe(0);
    expect(heatStep(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("steps up at each edge, inclusive", () => {
    expect(heatStep(0.1)).toBe(1);
    expect(heatStep(0.74)).toBe(1);
    expect(heatStep(0.75)).toBe(2);
    expect(heatStep(1.74)).toBe(2);
    expect(heatStep(1.75)).toBe(3);
    expect(heatStep(3.49)).toBe(3);
    expect(heatStep(3.5)).toBe(4);
    expect(heatStep(11.04)).toBe(4);
  });

  it("mirrors negative moves", () => {
    expect(heatStep(-0.1)).toBe(-1);
    expect(heatStep(-0.99)).toBe(-2);
    expect(heatStep(-2.78)).toBe(-3);
    expect(heatStep(-31)).toBe(-4);
  });

  it("separates the moves the old linear tint could not (+2.78% vs +11.04%)", () => {
    expect(heatStep(2.78)).not.toBe(heatStep(11.04));
    expect(heatStep(0.01)).toBe(0);
  });

  it("uses the edges it documents", () => {
    expect([...HEAT_EDGES]).toEqual([0.1, 0.75, 1.75, 3.5]);
    expect(HEAT_STEPS).toHaveLength(9);
  });
});

describe("heatStyle", () => {
  it("maps flat to the flat tile", () => {
    expect(heatStyle(0)).toEqual({ background: "var(--heat-flat)", color: "var(--heat-fg)" });
  });

  it("uses semantic up/down tokens, so the red-up and color-blind conventions swap them in CSS", () => {
    expect(heatStyle(2)).toEqual({ background: "var(--heat-up-2)", color: "var(--heat-fg)" });
    expect(heatStyle(-3)).toEqual({ background: "var(--heat-down-3)", color: "var(--heat-fg)" });
    for (const step of HEAT_STEPS) {
      expect(heatStyle(step).background).not.toMatch(/green|red|blue|orange/);
    }
  });

  it("switches to the strong text color on the outer steps", () => {
    expect(heatStyle(4)).toEqual({ background: "var(--heat-up-4)", color: "var(--heat-fg-strong)" });
    expect(heatStyle(-4)).toEqual({ background: "var(--heat-down-4)", color: "var(--heat-fg-strong)" });
  });
});

describe("directionOf", () => {
  it("reads the sign of a change", () => {
    expect(directionOf(1.2)).toBe("up");
    expect(directionOf(-0.01)).toBe("down");
    expect(directionOf(0)).toBe("flat");
    expect(directionOf(null)).toBe("flat");
    expect(directionOf(Number.NaN)).toBe("flat");
  });

  it("is flat for a change that prints as zero beside it (two decimals unless told otherwise)", () => {
    expect(directionOf(-0.004)).toBe("flat");
    expect(directionOf(0.004)).toBe("flat");
    expect(directionOf(-0)).toBe("flat");
    expect(directionOf(-0.005)).toBe("down");
    expect(directionOf(-0.004, 3)).toBe("down");
    expect(directionOf(-0.4, 0)).toBe("flat");
  });
});

describe("deltaParts", () => {
  it("gives the printed text with a true minus and the sign it prints with", () => {
    expect(deltaParts(1.234, "percent")).toEqual({ text: "+1.23%", sign: 1 });
    expect(deltaParts(-0.52, "percent")).toEqual({ text: "−0.52%", sign: -1 });
    expect(deltaParts(-0.0123, "ratio", 1)).toEqual({ text: "−1.2%", sign: -1 });
    expect(deltaParts(0.77, "change", 3)).toEqual({ text: "+0.770", sign: 1 });
    expect(deltaParts(-1.80002, "change")).toEqual({ text: "−1.80", sign: -1 });
    expect(deltaParts(-0.0042, "change")).toEqual({ text: "−0.0042", sign: -1 });
  });

  it("is unsigned and flat when the value rounds to zero at the decimals shown", () => {
    expect(deltaParts(-0.001, "percent")).toEqual({ text: "0.00%", sign: 0 });
    expect(deltaParts(0.001, "percent")).toEqual({ text: "0.00%", sign: 0 });
    expect(deltaParts(-0.04, "percent", 1)).toEqual({ text: "0.0%", sign: 0 });
    expect(deltaParts(-0.4, "percent", 0)).toEqual({ text: "0%", sign: 0 });
    expect(deltaParts(-0.00004, "ratio")).toEqual({ text: "0.00%", sign: 0 });
    expect(deltaParts(-0.0004, "ratio", 1)).toEqual({ text: "0.0%", sign: 0 });
    expect(deltaParts(-0.00004, "change", 4)).toEqual({ text: "0.0000", sign: 0 });
    expect(deltaParts(-0.00004, "change")).toEqual({ text: "0.00", sign: 0 });
    expect(deltaParts(-0.004, "change", 2, "zh")).toEqual({ text: "0.00", sign: 0 });
    expect(deltaParts(-0, "percent")).toEqual({ text: "0.00%", sign: 0 });
    expect(deltaParts(-0, "change")).toEqual({ text: "0.00", sign: 0 });
  });

  it("is a dash and flat without a value", () => {
    expect(deltaParts(null, "percent")).toEqual({ text: "—", sign: 0 });
    expect(deltaParts(undefined, "change", 4)).toEqual({ text: "—", sign: 0 });
    expect(deltaParts(Number.NaN, "ratio")).toEqual({ text: "—", sign: 0 });
  });
});

describe("withTrueMinus", () => {
  it("replaces a leading hyphen with U+2212", () => {
    expect(withTrueMinus("-0.52%")).toBe("−0.52%");
    expect(withTrueMinus("-12.35")).toBe("−12.35");
  });

  it("leaves other text alone", () => {
    expect(withTrueMinus("+1.35%")).toBe("+1.35%");
    expect(withTrueMinus("0.00%")).toBe("0.00%");
    expect(withTrueMinus("—")).toBe("—");
    expect(withTrueMinus("1-2")).toBe("1-2");
  });
});
