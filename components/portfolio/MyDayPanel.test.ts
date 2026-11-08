import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ValuedPosition } from "@/lib/portfolio";

import { MoverList } from "./MyDayPanel";

// Server-rendered markup of My day's lists of the largest gains and losses: each list is named by its heading, so it
// is found and announced by that name. The panel reads the app router and the UI actions, which only exist in the app.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }), usePathname: () => "/" }));
vi.mock("@/components/providers/PrefsProvider", async () => {
  const { MESSAGES } = await import("@/lib/i18n/messages");
  return { useT: () => MESSAGES.en, usePrefs: () => ({ t: MESSAGES.en, lang: "en" }) };
});
vi.mock("@/components/providers/UiProvider", () => ({ useUi: () => ({ openCommand: () => undefined }) }));

function position(symbol: string, dayPnl: number): ValuedPosition {
  return { symbol, shares: 10, cost: 100, price: 110, currency: "USD", value: 1100, costBasis: 1000, pnl: 100, pnlPct: 0.1, dayPnl, weight: 0.5 };
}

describe("MoverList", () => {
  it("is a list labelled by its heading", () => {
    const markup = renderToStaticMarkup(
      createElement(MoverList, { title: "Largest gains", rows: [position("NVDA", 120), position("AAPL", 45)], quotes: new Map(), lang: "en", empty: "None" }),
    );
    const heading = /<h3 id="([^"]+)" class="col-head">Largest gains<\/h3>/.exec(markup);
    const list = /<ul aria-labelledby="([^"]+)"/.exec(markup);
    expect(heading).not.toBeNull();
    expect(list?.[1]).toBe(heading?.[1]);
    expect([...markup.matchAll(/<li /g)]).toHaveLength(2);
  });

  it("gives the gains and the losses side by side their own names", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(MoverList, { title: "Largest gains", rows: [position("NVDA", 120)], quotes: new Map(), lang: "en", empty: "None" }),
        createElement(MoverList, { title: "Largest losses", rows: [position("MSFT", -30)], quotes: new Map(), lang: "en", empty: "None" }),
      ),
    );
    const headings = new Map([...markup.matchAll(/<h3 id="([^"]+)" class="col-head">([^<]+)<\/h3>/g)].map(([, id, title]) => [id, title]));
    const names = [...markup.matchAll(/<ul aria-labelledby="([^"]+)"/g)].map(([, id]) => headings.get(id));
    expect(names).toEqual(["Largest gains", "Largest losses"]);
  });

  it("shows its empty line instead of an empty list", () => {
    const markup = renderToStaticMarkup(createElement(MoverList, { title: "Largest losses", rows: [], quotes: new Map(), lang: "en", empty: "No losses today" }));
    expect(markup).not.toContain("<ul");
    expect(markup).toContain("No losses today");
  });
});
