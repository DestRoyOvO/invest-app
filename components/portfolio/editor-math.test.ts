import { describe, expect, it } from "vitest";

import { applyChange, parseDecimal, previewAt } from "./editor-math";

describe("parseDecimal", () => {
  it("reads plain decimals with thousands separators", () => {
    expect(parseDecimal("12")).toBe(12);
    expect(parseDecimal(" 1,234.50 ")).toBe(1234.5);
    expect(parseDecimal("1 200")).toBe(1200);
    expect(parseDecimal("1，200")).toBe(1200);
    expect(parseDecimal(".5")).toBe(0.5);
    expect(parseDecimal("+3")).toBe(3);
    expect(parseDecimal("-2")).toBe(-2);
  });

  it("rejects anything else", () => {
    for (const bad of ["", " ", "abc", "1.2.3", "1e5", "$100", "12abc", "Infinity"]) expect(parseDecimal(bad)).toBeNull();
  });
});

describe("applyChange", () => {
  const current = { shares: 40, cost: 118.5 };

  it("sets a position and validates both fields", () => {
    expect(applyChange({ mode: "edit", current: null, shares: "10", price: "150" })).toEqual({
      errors: {},
      valid: true,
      next: { shares: 10, cost: 150 },
      closes: false,
      realized: null,
    });
    expect(applyChange({ mode: "edit", current, shares: "0", price: "" }).errors).toEqual({ shares: "shares", price: "cost" });
    expect(applyChange({ mode: "edit", current, shares: "-1", price: "abc" }).valid).toBe(false);
  });

  it("adds shares at the weighted average cost", () => {
    const result = applyChange({ mode: "add", current, shares: "10", price: "180" });
    expect(result.next?.shares).toBe(50);
    expect(result.next?.cost).toBeCloseTo((40 * 118.5 + 10 * 180) / 50, 6);
    expect(result.next?.cost).toBeCloseTo(130.8);
    expect(applyChange({ mode: "add", current, shares: "10", price: "0" }).errors).toEqual({ price: "price" });
  });

  it("reduces at a price, keeps the average cost and reports realized P&L", () => {
    const result = applyChange({ mode: "reduce", current, shares: "15", price: "180" });
    expect(result.next).toEqual({ shares: 25, cost: 118.5 });
    expect(result.realized).toBeCloseTo(15 * (180 - 118.5));
    expect(result.closes).toBe(false);
    expect(applyChange({ mode: "reduce", current, shares: "5", price: "100" }).realized).toBeCloseTo(-92.5);
  });

  it("closes the position when every share is sold and refuses to sell more than held", () => {
    const all = applyChange({ mode: "reduce", current, shares: "40", price: "120" });
    expect(all).toMatchObject({ valid: true, closes: true, next: null });
    expect(all.realized).toBeCloseTo(60);
    expect(applyChange({ mode: "reduce", current, shares: "41", price: "120" }).errors).toEqual({ shares: "tooMany" });
  });

  it("treats add and reduce without a stored position as setting one", () => {
    expect(applyChange({ mode: "reduce", current: null, shares: "5", price: "20" }).next).toEqual({ shares: 5, cost: 20 });
    expect(applyChange({ mode: "add", current: null, shares: "5", price: "" }).errors).toEqual({ price: "cost" });
  });

  it("rounds away floating-point noise", () => {
    expect(applyChange({ mode: "add", current: { shares: 0.1, cost: 10 }, shares: "0.2", price: "10" }).next).toEqual({ shares: 0.3, cost: 10 });
    expect(applyChange({ mode: "reduce", current: { shares: 0.3, cost: 10 }, shares: "0.1", price: "10" }).next?.shares).toBe(0.2);
  });
});

describe("previewAt", () => {
  it("values a position at the last price", () => {
    const p = previewAt({ shares: 40, cost: 118.5 }, 186.64);
    expect(p?.value).toBeCloseTo(7465.6);
    expect(p?.pnl).toBeCloseTo(2725.6);
    expect(p?.pnlPct).toBeCloseTo((186.64 - 118.5) / 118.5);
    expect(previewAt(null, 100)).toBeNull();
    expect(previewAt({ shares: 1, cost: 1 }, null)).toBeNull();
    expect(previewAt({ shares: 1, cost: 1 }, 0)).toBeNull();
  });
});
