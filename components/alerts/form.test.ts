import { describe, expect, it } from "vitest";

import { formFromRule, parseNumberInput, valueAfterKindChange } from "./form";

describe("parseNumberInput", () => {
  it("reads plain, signed, grouped and percent input", () => {
    expect(parseNumberInput("170")).toBe(170);
    expect(parseNumberInput(" 1,234.50 ")).toBe(1234.5);
    expect(parseNumberInput("\u221210")).toBe(-10);
    expect(parseNumberInput("-2.5%")).toBe(-2.5);
    expect(parseNumberInput("+20")).toBe(20);
    expect(parseNumberInput(".5")).toBe(0.5);
  });

  it("rejects empty or unreadable input", () => {
    expect(parseNumberInput("")).toBeNull();
    expect(parseNumberInput("abc")).toBeNull();
    expect(parseNumberInput("1e5")).toBeNull();
    expect(parseNumberInput("1.2.3")).toBeNull();
    expect(parseNumberInput("-")).toBeNull();
  });
});

describe("kind changes", () => {
  it("keeps a price between price kinds and resets otherwise", () => {
    expect(valueAfterKindChange("above", "below", "170")).toBe("170");
    expect(valueAfterKindChange("above", "day_move", "170")).toBe("5");
    expect(valueAfterKindChange("day_move", "pnl_from_cost", "5")).toBe("-10");
    expect(valueAfterKindChange("pnl_from_cost", "cross_ma200", "-10")).toBe("");
  });

  it("fills the form from a rule", () => {
    expect(formFromRule({ symbol: "NVDA", kind: "cross_ma200", value: null, repeat: "daily", note: "trend" })).toEqual({
      symbol: "NVDA",
      kind: "cross_ma200",
      value: "",
      repeat: "daily",
      note: "trend",
    });
  });
});
