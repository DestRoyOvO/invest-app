import { describe, expect, it } from "vitest";

import { CHART_SETTINGS_KEY, DEFAULT_CHART_SETTINGS, sanitizeChartSettings } from "./chart-settings";

describe("sanitizeChartSettings", () => {
  it("keeps valid values and falls back to the defaults for the rest", () => {
    expect(sanitizeChartSettings({ range: "5d", extended: true, rsi: true, log: "yes", ma20: false, junk: 1 })).toEqual({
      ...DEFAULT_CHART_SETTINGS,
      range: "5d",
      extended: true,
      rsi: true,
      ma20: false,
    });
  });

  it("replaces unknown ranges and non-objects with the defaults", () => {
    expect(sanitizeChartSettings({ range: "10y" }).range).toBe(DEFAULT_CHART_SETTINGS.range);
    expect(sanitizeChartSettings(null)).toEqual(DEFAULT_CHART_SETTINGS);
    expect(sanitizeChartSettings([1, 2])).toEqual(DEFAULT_CHART_SETTINGS);
  });

  it("stores under the app's versioned prefix", () => {
    expect(CHART_SETTINGS_KEY).toBe("investseek:chart:v1");
  });
});
