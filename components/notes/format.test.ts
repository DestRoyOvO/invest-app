import { describe, expect, it } from "vitest";

import { MESSAGES } from "@/lib/i18n/messages";

import { distanceText, levelLine, reviewText } from "./format";

const en = MESSAGES.en;
const zh = MESSAGES.zh;

describe("note level wording", () => {
  it("describes a level's distance from the price", () => {
    expect(distanceText(170, 186.64, en)).toBe("8.9% below");
    expect(distanceText(240, 186.64, en)).toBe("28.6% above");
    expect(distanceText(186.65, 186.64, en)).toBe("at the price");
    expect(distanceText(170, null, en)).toBeNull();
    expect(distanceText(170, 186.64, zh)).toBe("低于现价 8.9%");
  });

  it("writes the brief's stop line", () => {
    expect(levelLine("stop", 170, 186.64, en, "en")).toBe("stop 170.00 · 8.9% below");
    expect(levelLine("target", 240, 186.64, en, "en")).toBe("target 240.00 · 28.6% above");
    expect(levelLine("stop", 170, null, en, "en")).toBe("170.00");
  });
});

describe("reviewText", () => {
  it("counts down and then reports overdue days", () => {
    expect(reviewText(0, en)).toBe("today");
    expect(reviewText(1, en)).toBe("tomorrow");
    expect(reviewText(12, en)).toBe("in 12 days");
    expect(reviewText(-1, en)).toBe("1 day overdue");
    expect(reviewText(-3, en)).toBe("3 days overdue");
    expect(reviewText(-3, zh)).toBe("已逾期 3 天");
  });
});
