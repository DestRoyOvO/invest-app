import { describe, expect, it } from "vitest";

import { en, zh } from "@/lib/i18n/messages";
import type { ExposureSlice } from "@/lib/portfolio-analytics";
import type { HoldingGroup } from "@/lib/sectors";

import { allocationLegend, holdingGroupLabel, MAX_LEGEND, REST_COLOR, SLICE_COLORS } from "./labels";

function slices(n: number): ExposureSlice<string>[] {
  // Largest first, as groupExposure returns them.
  return Array.from({ length: n }, (_, i) => ({ id: `g${i}`, key: `g${i}`, value: 100 - i, weight: (100 - i) / 1000, symbols: [`S${i}`] }));
}

describe("allocationLegend", () => {
  it("never repeats a color, with five, six or seven groups", () => {
    for (const n of [1, 5, 6, 7, 12]) {
      const colors = allocationLegend(slices(n)).map((e) => e.color);
      expect(new Set(colors).size).toBe(colors.length);
      expect(colors.length).toBeLessThanOrEqual(MAX_LEGEND);
    }
  });

  it("names a sixth group in the neutral series instead of cycling back to series 1", () => {
    const legend = allocationLegend(slices(6));
    expect(legend.map((e) => e.id)).toEqual(["g0", "g1", "g2", "g3", "g4", "g5"]);
    expect(legend.map((e) => e.color)).toEqual([...SLICE_COLORS, REST_COLOR]);
  });

  it("folds seven or more groups into five plus Other", () => {
    const legend = allocationLegend(slices(7));
    expect(legend.map((e) => e.id)).toEqual(["g0", "g1", "g2", "g3", "g4", "rest"]);
    const rest = legend[5];
    expect(rest.key).toBeNull();
    expect(rest.color).toBe(REST_COLOR);
    expect(rest.value).toBe(95 + 94);
    expect(rest.weight).toBeCloseTo(0.189, 10);
  });

  it("is empty without slices", () => {
    expect(allocationLegend([])).toEqual([]);
  });
});

describe("holdingGroupLabel", () => {
  it("names universe sectors, asset classes, Yahoo sectors and the unclassified rest", () => {
    const groups: HoldingGroup[] = [{ kind: "asset", key: "etf" }, { kind: "other", label: "Technology" }, { kind: "unclassified" }];
    expect(groups.map((g) => holdingGroupLabel(g, en, "en"))).toEqual(["ETFs and funds", "Technology", "Unclassified"]);
    expect(holdingGroupLabel({ kind: "unclassified" }, zh, "zh")).toBe("未分类");
    expect(holdingGroupLabel({ kind: "sector", key: "technology" }, en, "en")).toBe("Information Technology");
    expect(holdingGroupLabel({ kind: "sector", key: "technology" }, zh, "zh", true)).toBe("科技");
  });
});
