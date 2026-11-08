import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MESSAGES } from "@/lib/i18n/messages";
import type { Lang } from "@/types/api";

import { emptyMeterLabel, Meter } from "./Meter";

// Meter reads the reader's language for the name of an empty track; the provider only exists inside the app.
const prefs = vi.hoisted(() => ({ lang: "en" as Lang }));
vi.mock("@/components/providers/PrefsProvider", async () => {
  const { MESSAGES } = await import("@/lib/i18n/messages");
  return { usePrefs: () => ({ t: MESSAGES[prefs.lang], lang: prefs.lang }) };
});

const html = (props: Parameters<typeof Meter>[0]) => renderToStaticMarkup(createElement(Meter, props));

describe("Meter", () => {
  it("is a meter with its current value, range and spoken value", () => {
    const markup = html({ value: 72.4, label: "Momentum percentile", valueText: "72nd percentile" });
    expect(markup).toContain('role="meter"');
    expect(markup).toContain('aria-valuenow="72"');
    expect(markup).toContain('aria-valuemin="0"');
    expect(markup).toContain('aria-valuemax="100"');
    expect(markup).toContain('aria-valuetext="72nd percentile"');
    expect(markup).toContain('aria-label="Momentum percentile"');
    expect(markup).toContain("width:72.4%");
  });

  it("keeps the meter role at zero, which is a value", () => {
    const markup = html({ value: 0, label: "Beta percentile" });
    expect(markup).toContain('role="meter"');
    expect(markup).toContain('aria-valuenow="0"');
  });

  it("without a value is no meter, but an image that says there is no value", () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      const markup = html({ value, label: "Beta percentile", valueText: "—" });
      expect(markup).not.toContain('role="meter"');
      expect(markup).not.toContain("aria-valuenow");
      expect(markup).not.toContain("aria-valuetext");
      expect(markup).toContain('role="img"');
      expect(markup).toContain('aria-label="Beta percentile: Data unavailable"');
      // The track, its midline and nothing filled.
      expect(markup).toContain("bg-line-2");
      expect(markup).not.toContain("bg-fg-3");
    }
  });

  it("keeps a marker on an empty track", () => {
    const markup = html({ value: null, marker: 30, label: "Volatility percentile" });
    expect(markup).toContain('role="img"');
    expect(markup).toContain("left:30%");
  });

  it("names an empty track in the reader's language", () => {
    expect(emptyMeterLabel("Volatility percentile", MESSAGES.en, "en")).toBe("Volatility percentile: Data unavailable");
    expect(emptyMeterLabel("波动率百分位", MESSAGES.zh, "zh")).toBe("波动率百分位：暂无数据");
    prefs.lang = "zh";
    try {
      expect(html({ value: null, label: "贝塔百分位" })).toContain('aria-label="贝塔百分位：暂无数据"');
    } finally {
      prefs.lang = "en";
    }
  });
});
