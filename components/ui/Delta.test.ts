import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Delta } from "./Delta";

/** The text Delta renders (markup without tags). */
const text = (props: Parameters<typeof Delta>[0]) => renderToStaticMarkup(createElement(Delta, props)).replace(/<[^>]+>/g, "");

describe("Delta", () => {
  it("shows a change with the decimals of the price beside it", () => {
    // USD/JPY at 158.425 (3 decimals) and EUR/USD at 1.1143 (4), as Yahoo quoted them on 2026-11-07.
    expect(text({ value: 0.7720032, kind: "change", digits: 3 })).toBe("+0.772");
    expect(text({ value: 0.77, kind: "change", digits: 3 })).toBe("+0.770");
    expect(text({ value: -0.0075005293, kind: "change", digits: 4 })).toBe("−0.0075");
    expect(text({ value: 0.022000313, kind: "change", digits: 3, lang: "zh" })).toBe("+0.022");
    expect(text({ value: 0, kind: "change", digits: 4 })).toBe("0.0000");
    expect(text({ value: null, kind: "change", digits: 4 })).toBe("—");
  });

  it("keeps formatChange's rule for a change without digits", () => {
    expect(text({ value: -1.80002, kind: "change" })).toBe("−1.80");
    expect(text({ value: 1234.5, kind: "change" })).toBe("+1,234.50");
    expect(text({ value: 0.0042, kind: "change" })).toBe("+0.0042");
  });

  it("uses digits as before for percents and ratios", () => {
    expect(text({ value: 0.4548, digits: 1 })).toBe("+0.5%");
    expect(text({ value: -0.0123, kind: "ratio", digits: 1 })).toBe("−1.2%");
  });
});
