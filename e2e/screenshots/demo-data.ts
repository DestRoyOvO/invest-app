import type { AlertRule } from "@/lib/alerts";

import type { DemoData } from "../support/shots";

// The investor the README screenshots show: what a returning user keeps in the browser after a few weeks, in the
// stores' own formats. Prices and dates fit the fixture data at the default E2E_NOW (Saturday 2026-11-07, after
// Friday's session): costs are where these stocks traded in the past year, the notes' targets and stops lie inside
// AAPL's and NVDA's one-year ranges (so the AAPL chart draws them), and no alert rule is near its level (so no alert
// fires, and no toast covers a shot).

/** An alert rule as the store keeps it, armed at `armedAt` and not yet checked. */
function rule(fields: Pick<AlertRule, "id" | "symbol" | "kind" | "value" | "note" | "armedAt">): AlertRule {
  return {
    ...fields,
    repeat: "once",
    paused: false,
    createdAt: fields.armedAt,
    lastCheckedAt: null,
    checkedSession: null,
    checkedHigh: null,
    checkedLow: null,
    side: null,
    lastTriggeredAt: null,
    lastTriggeredSession: null,
    done: false,
    triggerCount: 0,
  };
}

export const DEMO_DATA = {
  // Holdings first, then the names the investor is watching.
  watchlist: ["NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "AVGO", "TSLA", "LLY", "COST"],
  // About $120k in eight positions: seven large caps bought over the past year or two, and a core S&P 500 fund.
  holdings: {
    NVDA: { shares: 120, cost: 162.3 },
    AAPL: { shares: 45, cost: 258.2 },
    MSFT: { shares: 20, cost: 512.75 },
    GOOGL: { shares: 40, cost: 301.9 },
    AMZN: { shares: 50, cost: 214.6 },
    META: { shares: 12, cost: 590.4 },
    JPM: { shares: 30, cost: 284.1 },
    SPY: { shares: 25, cost: 645.2 },
  },
  notes: {
    AAPL: {
      thesis: "Services and the installed base carry the margins; each hardware cycle matters less to the earnings than it used to.",
      conviction: 4,
      target: 360,
      stop: 280,
      reviewBy: "2026-11-20",
      tags: ["quality", "services"],
      entries: [
        {
          at: "2026-11-04T21:15:00.000Z",
          price: 310.89,
          text: "Down 9% from the October high with no change to the thesis. Holding; reassess after the report on Nov 16.",
          kind: "note",
        },
        { at: "2026-10-21T20:30:00.000Z", price: 336.34, text: "Raised the target to 360 after the services numbers.", kind: "note" },
      ],
      updatedAt: "2026-11-04T21:15:00.000Z",
    },
    NVDA: {
      thesis: "Data-center demand runs ahead of supply into 2027. Watch the gross margin as the new systems ramp.",
      conviction: 3,
      target: 300,
      stop: 210,
      reviewBy: "2026-11-13",
      tags: ["ai", "semis"],
      entries: [
        { at: "2026-10-30T20:45:00.000Z", price: 252.25, text: "Earnings on Nov 10. Keeping the position as it is until the report.", kind: "note" },
      ],
      updatedAt: "2026-10-30T20:45:00.000Z",
    },
  },
  alerts: [
    rule({ id: "demo-nvda-target", symbol: "NVDA", kind: "above", value: 280, note: "Close to the target: review the position size.", armedAt: "2026-10-30T20:50:00.000Z" }),
    rule({ id: "demo-aapl-stop", symbol: "AAPL", kind: "below", value: 280, note: "The thesis stop from my AAPL note.", armedAt: "2026-11-04T21:20:00.000Z" }),
  ],
} satisfies DemoData;
