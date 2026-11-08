import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Delta } from "./Delta";

const markup = (props: Parameters<typeof Delta>[0]) => renderToStaticMarkup(createElement(Delta, props));
/** The text Delta renders (markup without tags). */
const text = (props: Parameters<typeof Delta>[0]) => markup(props).replace(/<[^>]+>/g, "");
/** The direction class Delta puts on its number. */
const tone = (props: Parameters<typeof Delta>[0]) => /text-(up|down|fg-3)/.exec(markup(props))?.[1];

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

  it("prints a move that rounds to zero unsigned, in the flat tone, without an arrow", () => {
    // A change of -0.001% used to read as a red "▼−0.00%".
    expect(text({ value: -0.001, arrow: true })).toBe("0.00%");
    expect(tone({ value: -0.001, arrow: true })).toBe("fg-3");
    expect(markup({ value: -0.001, arrow: true })).not.toMatch(/[▲▼]/);
    expect(text({ value: 0.004 })).toBe("0.00%");
    expect(tone({ value: 0.004 })).toBe("fg-3");
    expect(text({ value: -0.04, digits: 1 })).toBe("0.0%");
    expect(text({ value: -0.4, digits: 0 })).toBe("0%");
    expect(text({ value: -0.00004, kind: "ratio", digits: 2 })).toBe("0.00%");
    expect(tone({ value: -0.00004, kind: "ratio", digits: 2 })).toBe("fg-3");
    expect(text({ value: -0.00004, kind: "change", digits: 4 })).toBe("0.0000");
    expect(tone({ value: -0.00004, kind: "change", digits: 4 })).toBe("fg-3");
    expect(text({ value: -0.00004, kind: "change" })).toBe("0.00");
    expect(text({ value: -0, arrow: true })).toBe("0.00%");
    expect(tone({ value: -0 })).toBe("fg-3");
  });

  it("colors and arrows a move that shows at the decimals by its sign", () => {
    expect(text({ value: -0.005, arrow: true })).toBe("▼−0.01%");
    expect(tone({ value: -0.005 })).toBe("down");
    expect(text({ value: 0.005, arrow: true })).toBe("▲+0.01%");
    expect(tone({ value: 0.005 })).toBe("up");
    expect(tone({ value: -0.00006, kind: "change", digits: 4 })).toBe("down");
    expect(tone({ value: 0.0042, kind: "change" })).toBe("up");
  });
});
