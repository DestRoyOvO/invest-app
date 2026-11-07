import { describe, expect, it } from "vitest";

import { parsePortTab, sanitizePortView } from "./port-view";

describe("parsePortTab", () => {
  it("accepts the four tabs and falls back to the overview", () => {
    expect(parsePortTab("correlation")).toBe("correlation");
    expect(parsePortTab(["risk", "exposure"])).toBe("risk");
    expect(parsePortTab("CORR")).toBe("overview");
    expect(parsePortTab(undefined)).toBe("overview");
    expect(parsePortTab(null)).toBe("overview");
  });
});

describe("sanitizePortView", () => {
  it("keeps valid choices and repairs the rest", () => {
    expect(sanitizePortView({ benchmark: "QQQ", range: "3m" })).toEqual({ benchmark: "QQQ", range: "3m" });
    expect(sanitizePortView({ benchmark: "DIA", range: "5y" })).toEqual({ benchmark: "SPY", range: "1y" });
    expect(sanitizePortView({ range: "6m" })).toEqual({ benchmark: "SPY", range: "6m" });
    expect(sanitizePortView("nope")).toEqual({ benchmark: "SPY", range: "1y" });
  });
});
