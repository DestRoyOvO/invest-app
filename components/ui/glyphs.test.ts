import { describe, expect, it } from "vitest";

import { sparklineGeometry, toPercent, whiskerGeometry } from "./glyphs";

describe("toPercent", () => {
  it("maps and clamps into 0-100", () => {
    expect(toPercent(25)).toBe(25);
    expect(toPercent(-5)).toBe(0);
    expect(toPercent(140)).toBe(100);
    expect(toPercent(0.5, 0, 1)).toBe(50);
  });

  it("returns null for missing values or an empty domain", () => {
    expect(toPercent(null)).toBeNull();
    expect(toPercent(Number.NaN)).toBeNull();
    expect(toPercent(5, 10, 10)).toBeNull();
  });
});

describe("sparklineGeometry", () => {
  it("needs two finite points", () => {
    expect(sparklineGeometry([1], 80, 24)).toEqual({ path: "", end: null, baselineY: null });
    expect(sparklineGeometry([1, Number.NaN], 80, 24).path).toBe("");
  });

  it("keeps an inset on every side so the end dot is not clipped", () => {
    const g = sparklineGeometry([10, 12, 11, 15], 80, 24, 3);
    expect(g.path.startsWith("M3,")).toBe(true);
    expect(g.end).toEqual({ x: 77, y: 3 });
    // The first value (10) is the minimum, so the baseline sits at the bottom inset.
    expect(g.baselineY).toBe(21);
  });

  it("skips non-finite values", () => {
    const g = sparklineGeometry([1, Number.NaN, 3], 40, 20, 2);
    expect(g.path.split(" ")).toHaveLength(2);
  });

  it("draws a constant series through the middle", () => {
    const g = sparklineGeometry([5, 5, 5], 40, 20, 2);
    expect(g.end?.y).toBe(10);
    expect(g.baselineY).toBe(10);
  });
});

describe("whiskerGeometry", () => {
  const base = { width: 72, height: 12, dotRadius: 3 };

  it("maps the estimate, interval and base onto the track", () => {
    const g = whiskerGeometry({ ...base, estimate: 0.5, low: 0.25, high: 0.75, base: 0.5 });
    expect(g.track).toEqual({ x1: 3, x2: 69 });
    expect(g.dot).toEqual({ x: 36, r: 3 });
    expect(g.interval).toEqual({ x1: 19.5, x2: 52.5 });
    expect(g.baseX).toBe(36);
    expect(g.midY).toBe(6);
  });

  it("flags an interval that excludes the base rate", () => {
    expect(whiskerGeometry({ ...base, estimate: 0.62, low: 0.56, high: 0.68, base: 0.54 }).excludesBase).toBe(true);
    expect(whiskerGeometry({ ...base, estimate: 0.46, low: 0.4, high: 0.52, base: 0.54 }).excludesBase).toBe(true);
  });

  it("does not flag an interval that overlaps the base, or a missing base or interval", () => {
    expect(whiskerGeometry({ ...base, estimate: 0.543, low: 0.518, high: 0.568, base: 0.543 }).excludesBase).toBe(false);
    expect(whiskerGeometry({ ...base, estimate: 0.6, low: 0.55, high: 0.65 }).excludesBase).toBe(false);
    expect(whiskerGeometry({ ...base, estimate: 0.6, base: 0.5 }).excludesBase).toBe(false);
  });

  it("accepts a reversed interval and a custom domain", () => {
    const g = whiskerGeometry({ ...base, estimate: 0, low: 0.05, high: -0.05, min: -0.1, max: 0.1 });
    expect(g.interval).toEqual({ x1: 19.5, x2: 52.5 });
    expect(g.dot?.x).toBe(36);
  });

  it("pins values outside the domain to the ends and omits missing parts", () => {
    const g = whiskerGeometry({ ...base, estimate: 1.4, low: null, high: null, base: null });
    expect(g.dot?.x).toBe(69);
    expect(g.interval).toBeNull();
    expect(g.baseX).toBeNull();
    expect(whiskerGeometry({ ...base, estimate: null }).dot).toBeNull();
  });
});
