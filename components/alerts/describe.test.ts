import { describe, expect, it } from "vitest";

import { createRule, readRule, type AlertEvent, type AlertQuote } from "@/lib/alerts";
import { MESSAGES } from "@/lib/i18n/messages";

import { describeAlertEvent, describeReading, describeRule, signedPercent } from "./describe";

const en = MESSAGES.en;
const zh = MESSAGES.zh;

function event(overrides: Partial<AlertEvent>): AlertEvent {
  return {
    id: "r1@x",
    ruleId: "r1",
    symbol: "NVDA",
    kind: "below",
    value: 170,
    observed: 169.5,
    extreme: null,
    reference: null,
    direction: null,
    eventDate: null,
    estimated: false,
    missed: null,
    session: "2026-11-06",
    currency: "USD",
    note: "",
    at: "2026-11-06T20:00:00.000Z",
    seen: false,
    ...overrides,
  };
}

describe("describeRule", () => {
  it("words each kind", () => {
    expect(describeRule({ kind: "above", value: 200 }, en, "en")).toBe("At or above 200.00");
    expect(describeRule({ kind: "below", value: 170 }, zh, "zh")).toBe("达到或低于 170.00");
    expect(describeRule({ kind: "day_move", value: 2.5 }, en, "en")).toBe("Day move ±2.5% or more");
    expect(describeRule({ kind: "pnl_from_cost", value: -10 }, en, "en")).toBe("Loss from cost of 10% or more");
    expect(describeRule({ kind: "pnl_from_cost", value: 25 }, en, "en")).toBe("Gain from cost of 25% or more");
    expect(describeRule({ kind: "earnings_within", value: 0 }, en, "en")).toBe("On the report day");
    expect(describeRule({ kind: "earnings_within", value: 1 }, en, "en")).toBe("Report within 1 day");
    expect(describeRule({ kind: "earnings_within", value: 7 }, en, "en")).toBe("Report within 7 days");
    expect(describeRule({ kind: "cross_ma200", value: null }, en, "en")).toBe("Crosses the 200-day average");
  });
});

describe("describeAlertEvent", () => {
  it("reports missed price levels like the brief's example", () => {
    const missed = event({ missed: { session: "2026-11-05", extreme: 168.2, sessions: 1 } });
    expect(describeAlertEvent(missed, en, "en")).toBe("NVDA traded below 170.00 on Nov 5 (low 168.20)");
    expect(describeAlertEvent({ ...missed, missed: { session: "2026-11-05", extreme: 168.2, sessions: 3 } }, en, "en")).toBe(
      "NVDA traded below 170.00 on Nov 5 (low 168.20), and on 2 more sessions",
    );
    expect(describeAlertEvent(missed, zh, "zh")).toBe("NVDA 在 11月5日 曾低于 170.00（最低 168.20）");
  });

  it("reports live price, touch, move, P&L, earnings and cross triggers", () => {
    // A price trigger never claims a move it did not see: a rule created or re-armed past its level fires at once.
    expect(describeAlertEvent(event({ kind: "above", value: 185, observed: 186.64 }), en, "en", "live")).toBe("NVDA traded at 186.64, at or above 185.00");
    expect(describeAlertEvent(event({ kind: "below", value: 170, observed: 169.5 }), zh, "zh", "live")).toBe("NVDA 报 169.50，达到或低于 170.00");
    expect(describeAlertEvent(event({ kind: "above", value: 188, observed: 186.9, extreme: 188.4 }), en, "en", "live")).toBe("NVDA reached 188.00 (high 188.40); last 186.90");
    expect(describeAlertEvent(event({ kind: "day_move", value: 2, observed: -3.1 }), en, "en", "live")).toBe("NVDA moved −3.10% today");
    expect(describeAlertEvent(event({ kind: "pnl_from_cost", value: -10, observed: -10 }), en, "en", "live")).toBe("NVDA is −10.00% from your cost");
    const earnings = event({ kind: "earnings_within", value: 14, observed: 11, eventDate: "2026-11-17T21:00:00Z", estimated: true });
    expect(describeAlertEvent(earnings, en, "en", "live")).toBe("NVDA reports on Nov 17 (est.), in 11 days");
    expect(describeAlertEvent({ ...earnings, observed: 1, estimated: false }, en, "en", "live")).toBe("NVDA reports tomorrow, Nov 17");
    expect(describeAlertEvent(event({ kind: "cross_ma200", value: null, observed: 162, reference: 160.5, direction: "above" }), en, "en", "live")).toBe(
      "NVDA crossed above its 200-day average (160.50) at 162.00",
    );
  });

  it("words the log with dates, never today, tomorrow or in N days", () => {
    // The alert center and the history show these days later, next to "2 days ago"; "log" is the default.
    const move = event({ kind: "day_move", value: 3, observed: -3.4, session: "2026-11-05", at: "2026-11-05T15:00:00.000Z" });
    expect(describeAlertEvent(move, en, "en")).toBe("NVDA moved −3.40% on Nov 5");
    expect(describeAlertEvent(move, zh, "zh", "log")).toBe("NVDA 在 11月5日 涨跌 −3.40%");
    // Events logged before the session was stored use the UTC date of the trigger.
    expect(describeAlertEvent({ ...move, session: null }, en, "en")).toBe("NVDA moved −3.40% on Nov 5");
    const earnings = event({ kind: "earnings_within", value: 14, observed: 1, eventDate: "2026-11-17T21:00:00Z", estimated: true });
    expect(describeAlertEvent(earnings, en, "en")).toBe("NVDA reports on Nov 17 (est.)");
    expect(describeAlertEvent({ ...earnings, observed: 0, estimated: false }, zh, "zh")).toBe("NVDA 于 11月17日 发布财报");
    expect(describeAlertEvent(event({ kind: "pnl_from_cost", value: -10, observed: -10 }), en, "en")).toBe("NVDA was −10.00% from your cost");
    // Wording that holds at any time is shared by both.
    const missed = event({ missed: { session: "2026-11-05", extreme: 168.2, sessions: 1 } });
    expect(describeAlertEvent(missed, en, "en", "log")).toBe(describeAlertEvent(missed, en, "en", "live"));
    for (const lang of ["en", "zh"] as const) {
      for (const sample of [move, earnings, { ...earnings, observed: 0 }]) {
        expect(describeAlertEvent(sample, MESSAGES[lang], lang)).not.toMatch(/today|tomorrow|in \d+ days|今日|今天|明天|还有/);
      }
    }
  });
});

describe("describeReading", () => {
  const quote: AlertQuote = {
    symbol: "NVDA",
    price: 186.64,
    changePercent: 2.78,
    dayHigh: 188.1,
    dayLow: 181.2,
    currency: "USD",
    regularMarketTime: "2026-11-06T19:59:30Z",
    nextEarningsDate: "2026-11-17T21:00:00Z",
    earningsDateEstimated: false,
    twoHundredDayAverage: 160.5,
    stale: false,
  };
  const now = new Date("2026-11-06T20:00:00Z");
  const read = (kind: Parameters<typeof createRule>[0]["kind"], value: number | null) => {
    const rule = createRule({ symbol: "NVDA", kind, value, repeat: "once" }, now, null, "r1");
    return describeReading(kind, value, readRule(rule, quote, { NVDA: { shares: 1, cost: 200 } }, now), en);
  };

  it("shows how far each rule is from triggering", () => {
    expect(read("below", 170)).toBe("8.9% away");
    expect(read("above", 180)).toBeNull();
    expect(read("day_move", 5)).toBe("today +2.78%");
    expect(read("pnl_from_cost", -10)).toBe("P&L −6.68%");
    expect(read("earnings_within", 3)).toBe("in 11 days");
    expect(read("cross_ma200", null)).toBe("+16.29% vs avg");
    expect(describeReading("below", 170, null, en)).toBeNull();
    expect(signedPercent(null)).toBe("—");
  });
});
