import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addAlertRule,
  alertLogStore,
  alertsStore,
  applyAlertPatches,
  baselineFromQuote,
  catchUp,
  catchUpRange,
  clearAlertLog,
  createRule,
  daysUntil,
  evaluate,
  isValidRuleValue,
  markAlertEventsSeen,
  MAX_ALERT_EVENTS,
  MAX_ALERT_RULES,
  needsCatchUp,
  planChecks,
  rearmAlertRule,
  recordAlertEvents,
  removeAlertRule,
  restoreAlertLog,
  restoreAlertRule,
  ruleStatus,
  sanitizeLog,
  sanitizeRules,
  sessionOf,
  setAlertPaused,
  unseenCount,
  updateAlertRule,
  utcDate,
  validateRuleInput,
  type AlertBar,
  type AlertEvent,
  type AlertQuote,
  type AlertRule,
  type AlertRuleInput,
} from "./alerts";

class MemoryStorage {
  readonly map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage: storage, addEventListener: () => {}, removeEventListener: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Friday Nov 6, 2026, 15:00 New York (20:00 UTC), during the regular session.
const NOW = new Date("2026-11-06T20:00:00Z");
const SESSION = "2026-11-06";

function quote(overrides: Partial<AlertQuote> = {}): AlertQuote {
  return {
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
    ...overrides,
  };
}

function rule(input: Partial<AlertRuleInput> = {}, overrides: Partial<AlertRule> = {}): AlertRule {
  const base = createRule({ symbol: "NVDA", kind: "below", value: 170, repeat: "once", ...input }, new Date("2026-11-02T15:00:00Z"), null, "r1");
  return { ...base, ...overrides };
}

const bar = (session: string, h: number, l: number): AlertBar => ({ t: Date.parse(`${session}T00:00:00Z`), h, l });

describe("values and sanitizing", () => {
  it("checks values per kind", () => {
    expect(isValidRuleValue("above", 170)).toBe(true);
    expect(isValidRuleValue("above", 0)).toBe(false);
    expect(isValidRuleValue("day_move", 0.05)).toBe(false);
    expect(isValidRuleValue("day_move", 5)).toBe(true);
    expect(isValidRuleValue("pnl_from_cost", -10)).toBe(true);
    expect(isValidRuleValue("pnl_from_cost", 0)).toBe(false);
    expect(isValidRuleValue("pnl_from_cost", -100)).toBe(false);
    expect(isValidRuleValue("earnings_within", 3)).toBe(true);
    expect(isValidRuleValue("earnings_within", 2.5)).toBe(false);
    expect(isValidRuleValue("cross_ma200", null)).toBe(true);
    expect(isValidRuleValue("cross_ma200", 5)).toBe(false);
    expect(isValidRuleValue("above", Number.NaN)).toBe(false);
  });

  it("keeps valid rules and drops invalid ones and duplicate ids", () => {
    const good = rule();
    const rules = sanitizeRules([
      good,
      { ...good },
      { ...good, id: "bad id!" },
      { ...good, id: "r2", symbol: "nope$" },
      { ...good, id: "r3", kind: "sideways" },
      { ...good, id: "r4", value: -1 },
      { ...good, id: "r5", kind: "cross_ma200", value: null, symbol: "aapl", repeat: "weekly", triggerCount: -3 },
      "junk",
    ]);
    expect(rules.map((r) => r.id)).toEqual(["r1", "r5"]);
    expect(rules[1]).toMatchObject({ symbol: "AAPL", value: null, repeat: "once", triggerCount: 0 });
    expect(sanitizeRules({ not: "a list" })).toEqual([]);
    const many = Array.from({ length: MAX_ALERT_RULES + 5 }, (_, i) => ({ ...good, id: `id${i}` }));
    expect(sanitizeRules(many)).toHaveLength(MAX_ALERT_RULES);
  });

  it("orders, dedupes and caps the log", () => {
    const event = (id: string, at: string) => ({ id, ruleId: "r1", symbol: "NVDA", kind: "below", value: 170, at, seen: false });
    const log = sanitizeLog([event("a", "2026-11-01T10:00:00Z"), event("b", "2026-11-03T10:00:00Z"), event("a", "2026-11-05T10:00:00Z"), { id: "c" }]);
    expect(log.map((e) => e.id)).toEqual(["b", "a"]);
    const many = Array.from({ length: MAX_ALERT_EVENTS + 10 }, (_, i) => event(`e${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()));
    const capped = sanitizeLog(many);
    expect(capped).toHaveLength(MAX_ALERT_EVENTS);
    expect(capped[0].id).toBe(`e${MAX_ALERT_EVENTS + 9}`);
  });
});

describe("sessions and dates", () => {
  it("uses the UTC date of the last regular trade as the session", () => {
    expect(utcDate(Date.parse("2026-11-05T00:00:00Z"))).toBe("2026-11-05");
    expect(utcDate("not a date")).toBeNull();
    expect(sessionOf(quote(), NOW)).toBe(SESSION);
    expect(sessionOf(quote({ regularMarketTime: null }), new Date("2026-11-08T03:00:00Z"))).toBe("2026-11-08");
  });

  it("counts days to a report in New York", () => {
    expect(daysUntil("2026-11-17T21:00:00Z", NOW)).toBe(11);
    // 23:30 New York on Nov 6 is already Nov 7 in UTC; the report on Nov 7 New York time is tomorrow.
    expect(daysUntil("2026-11-07T13:00:00Z", new Date("2026-11-07T04:30:00Z"))).toBe(1);
    expect(daysUntil("2026-11-06T12:00:00Z", NOW)).toBe(0);
    expect(daysUntil(null, NOW)).toBeNull();
  });
});

describe("evaluate", () => {
  it("fires a once rule at the level, records the check and then stays quiet", () => {
    const r = rule({ kind: "above", value: 185 });
    const check = evaluate(r, quote(), {}, NOW);
    expect(check.fire).toBe(true);
    expect(check.patch).toMatchObject({ checkedSession: SESSION, checkedHigh: 188.1, checkedLow: 181.2, done: true, triggerCount: 1, lastTriggeredSession: SESSION });
    expect(check.event).toMatchObject({ id: `r1@${r.armedAt}`, symbol: "NVDA", kind: "above", value: 185, observed: 186.64, currency: "USD", extreme: null, missed: null, seen: false });
    const after = evaluate({ ...r, ...check.patch }, quote({ price: 187 }), {}, NOW);
    expect(after.met).toBe(true);
    expect(after.fire).toBe(false);
  });

  it("fires a daily rule once per session", () => {
    const r = rule({ kind: "below", value: 190, repeat: "daily" });
    const first = evaluate(r, quote(), {}, NOW);
    expect(first.fire).toBe(true);
    expect(first.event?.id).toBe(`r1@${SESSION}`);
    const sameDay = evaluate({ ...r, ...first.patch }, quote(), {}, new Date("2026-11-06T20:30:00Z"));
    expect(sameDay.fire).toBe(false);
    const nextDay = evaluate({ ...r, ...first.patch }, quote({ regularMarketTime: "2026-11-09T15:00:00Z" }), {}, new Date("2026-11-09T15:00:10Z"));
    expect(nextDay.fire).toBe(true);
    expect(nextDay.event?.id).toBe("r1@2026-11-09");
  });

  it("catches a touch between two checks from a new session high", () => {
    const watched = rule({ kind: "above", value: 188 }, { checkedSession: SESSION, checkedHigh: 187.5, checkedLow: 181.2 });
    const check = evaluate(watched, quote({ price: 186.9, dayHigh: 188.4 }), {}, NOW);
    expect(check.fire).toBe(true);
    expect(check.event).toMatchObject({ observed: 186.9, extreme: 188.4 });
    // The same high seen before (or a high from before the rule existed) does not count.
    expect(evaluate({ ...watched, checkedHigh: 188.4 }, quote({ price: 186.9, dayHigh: 188.4 }), {}, NOW).fire).toBe(false);
    expect(evaluate({ ...watched, checkedSession: "2026-11-05" }, quote({ price: 186.9, dayHigh: 188.4 }), {}, NOW).fire).toBe(false);
    expect(evaluate({ ...watched, checkedHigh: null }, quote({ price: 186.9, dayHigh: 188.4 }), {}, NOW).fire).toBe(false);
  });

  it("checks day moves in either direction", () => {
    const r = rule({ kind: "day_move", value: 2.5 });
    expect(evaluate(r, quote({ changePercent: 2.78 }), {}, NOW).fire).toBe(true);
    expect(evaluate(r, quote({ changePercent: -3.1 }), {}, NOW).event?.observed).toBe(-3.1);
    expect(evaluate(r, quote({ changePercent: 1.2 }), {}, NOW).fire).toBe(false);
    expect(evaluate(r, quote({ changePercent: null }), {}, NOW).unavailable).toBe("no_price");
  });

  it("checks P&L from cost against a position", () => {
    const loss = rule({ kind: "pnl_from_cost", value: -10 });
    const gain = rule({ kind: "pnl_from_cost", value: 20 });
    expect(evaluate(loss, quote(), {}, NOW)).toMatchObject({ fire: false, unavailable: "no_position" });
    expect(evaluate(loss, quote({ price: 90 }), { NVDA: { shares: 10, cost: 100 } }, NOW)).toMatchObject({ fire: true, observed: -10 });
    expect(evaluate(loss, quote({ price: 91 }), { NVDA: { shares: 10, cost: 100 } }, NOW).fire).toBe(false);
    expect(evaluate(gain, quote({ price: 120 }), { NVDA: { shares: 10, cost: 100 } }, NOW).fire).toBe(true);
  });

  it("checks the days left before earnings", () => {
    const r = rule({ kind: "earnings_within", value: 14 });
    const check = evaluate(r, quote({ earningsDateEstimated: true }), {}, NOW);
    expect(check.event).toMatchObject({ observed: 11, eventDate: "2026-11-17T21:00:00Z", estimated: true });
    expect(evaluate(rule({ kind: "earnings_within", value: 3 }), quote(), {}, NOW).fire).toBe(false);
    expect(evaluate(r, quote({ nextEarningsDate: null }), {}, NOW).unavailable).toBe("no_earnings_date");
    expect(evaluate(r, quote({ nextEarningsDate: "2026-10-28T20:00:00Z" }), {}, NOW).unavailable).toBe("no_earnings_date");
  });

  it("records the side of the 200-day average first and fires on a cross", () => {
    const r = rule({ kind: "cross_ma200", value: null, repeat: "daily" });
    const first = evaluate(r, quote({ price: 158 }), {}, NOW);
    expect(first).toMatchObject({ fire: false, patch: { side: "below" } });
    const cross = evaluate({ ...r, ...first.patch }, quote({ price: 162 }), {}, new Date("2026-11-06T20:05:00Z"));
    expect(cross.fire).toBe(true);
    expect(cross.event).toMatchObject({ direction: "above", reference: 160.5, observed: 162 });
    expect(cross.patch.side).toBe("above");
    expect(evaluate(r, quote({ twoHundredDayAverage: null }), {}, NOW).unavailable).toBe("no_average");
  });

  it("stores nothing without a usable quote and never fires a paused rule", () => {
    const r = rule({ kind: "above", value: 100 });
    expect(evaluate(r, null, {}, NOW)).toMatchObject({ fire: false, unavailable: "no_quote", patch: {} });
    expect(evaluate(r, quote({ stale: true }), {}, NOW)).toMatchObject({ unavailable: "stale", patch: {} });
    expect(evaluate(r, quote({ price: null }), {}, NOW)).toMatchObject({ unavailable: "no_price", patch: {} });
    expect(evaluate({ ...r, paused: true }, quote(), {}, NOW)).toMatchObject({ met: true, fire: false });
  });
});

describe("catchUp", () => {
  // Checked last on Tuesday Nov 3 at 15:00 New York, when that session's low so far was 175.
  const checked = { checkedAt: "2026-11-03T20:00:00Z", checkedSession: "2026-11-03", checkedHigh: 182, checkedLow: 175 };
  const bars = [bar("2026-11-02", 184, 176), bar("2026-11-03", 183, 174.5), bar("2026-11-04", 180, 172), bar("2026-11-05", 178, 168.2), bar("2026-11-06", 188.1, 171)];

  it("reports the first session that traded through the level", () => {
    const r = rule({ kind: "below", value: 170 }, checked);
    const check = catchUp(r, bars, NOW, "USD");
    expect(check.fire).toBe(true);
    expect(check.event).toMatchObject({ id: `r1@${r.armedAt}`, missed: { session: "2026-11-05", extreme: 168.2, sessions: 1 }, observed: 168.2, currency: "USD" });
    expect(check.patch).toMatchObject({ done: true, lastTriggeredSession: "2026-11-05", checkedSession: SESSION, checkedHigh: 188.1, checkedLow: 171, checkedAt: NOW.toISOString() });
  });

  it("counts the checked session only for a new extreme beyond its baseline", () => {
    const r = rule({ kind: "below", value: 174.8 }, checked);
    expect(catchUp(r, bars, NOW).event?.missed).toMatchObject({ session: "2026-11-03", extreme: 174.5, sessions: 4 });
    // The low of 174.5 had not been seen at the last check (175), so it happened after it. Without a baseline the
    // session is skipped instead.
    const noBaseline = rule({ kind: "below", value: 174.8 }, { checkedAt: "2026-11-03T20:00:00Z", checkedSession: null, checkedLow: null });
    expect(catchUp(noBaseline, bars, NOW).event?.missed?.session).toBe("2026-11-04");
    const alreadySeen = rule({ kind: "below", value: 174.8 }, { ...checked, checkedLow: 174.5 });
    expect(catchUp(alreadySeen, bars, NOW).event?.missed?.session).toBe("2026-11-04");
  });

  it("makes one event for a daily rule and skips sessions it already reported", () => {
    const r = rule({ kind: "above", value: 179, repeat: "daily" }, { ...checked, checkedHigh: 183 });
    const check = catchUp(r, bars, NOW);
    expect(check.event).toMatchObject({ id: `r1@${SESSION}`, missed: { session: "2026-11-04", extreme: 180, sessions: 2 } });
    expect(check.patch.lastTriggeredSession).toBe(SESSION);
    const reported = rule({ kind: "above", value: 179, repeat: "daily" }, { ...checked, checkedHigh: 183, lastTriggeredSession: "2026-11-04" });
    expect(catchUp(reported, bars, NOW).event?.missed).toMatchObject({ session: SESSION, sessions: 1 });
  });

  it("moves the baseline even when nothing was missed, and ignores other rules", () => {
    const quiet = catchUp(rule({ kind: "below", value: 150 }, checked), bars, NOW);
    expect(quiet).toMatchObject({ fire: false, patch: { checkedSession: SESSION, checkedLow: 171 } });
    expect(catchUp(rule({ kind: "day_move", value: 5 }, checked), bars, NOW)).toMatchObject({ fire: false, patch: {} });
    expect(catchUp(rule({ kind: "below", value: 170 }, { ...checked, done: true }), bars, NOW).fire).toBe(false);
    expect(catchUp(rule({ kind: "below", value: 170 }, { ...checked, paused: true }), bars, NOW).fire).toBe(false);
    expect(catchUp(rule({ kind: "below", value: 170 }, checked), [], NOW)).toMatchObject({ fire: false, patch: { checkedAt: NOW.toISOString() } });
  });

  it("logs a live trigger and a catch-up of the same session once", () => {
    const r = rule({ kind: "below", value: 172, repeat: "daily" }, { ...checked, checkedAt: "2026-11-06T14:00:00Z", checkedSession: SESSION, checkedLow: 173 });
    const live = evaluate(r, quote({ price: 171.5, dayLow: 171 }), {}, NOW);
    const replay = catchUp(r, bars, NOW);
    expect(live.event?.id).toBe(replay.event?.id);
    expect(recordAlertEvents([live.event as AlertEvent])).toHaveLength(1);
    expect(recordAlertEvents([replay.event as AlertEvent])).toHaveLength(0);
  });
});

describe("planChecks", () => {
  it("replays stale price rules first and checks the rest live", () => {
    const fresh = rule({ kind: "above", value: 180 }, { id: "fresh", checkedAt: "2026-11-06T19:58:00Z", checkedSession: SESSION });
    const stale = rule({ kind: "below", value: 170 }, { id: "stale", checkedAt: "2026-10-20T20:00:00Z" });
    const staleMove = rule({ kind: "day_move", value: 2 }, { id: "move", checkedAt: "2026-10-20T20:00:00Z" });
    const paused = rule({ kind: "above", value: 100 }, { id: "paused", paused: true });
    const quotes = new Map([["NVDA", quote()]]);
    const plan = planChecks([fresh, stale, staleMove, paused], quotes, {}, NOW);
    expect(plan.catchUps).toEqual([{ symbol: "NVDA", range: "1mo" }]);
    expect([...plan.patches.keys()]).toEqual(["fresh", "move"]);
    expect(plan.events.map((e) => e.ruleId)).toEqual(["fresh", "move"]);

    const waiting = planChecks([fresh, stale], quotes, {}, NOW, { catchingUp: new Set(["NVDA"]) });
    expect([...waiting.patches.keys()]).toEqual([]);
    expect(waiting.catchUps).toEqual([]);
    const gaveUp = planChecks([stale], quotes, {}, NOW, { skipCatchUp: new Set(["stale"]) });
    expect([...gaveUp.patches.keys()]).toEqual(["stale"]);
  });

  it("knows when a rule needs a replay and which range covers it", () => {
    expect(needsCatchUp(rule({}, { checkedAt: "2026-11-06T19:56:00Z" }), NOW)).toBe(false);
    expect(needsCatchUp(rule({}, { checkedAt: "2026-11-06T19:50:00Z" }), NOW)).toBe(true);
    expect(needsCatchUp(rule({ kind: "day_move", value: 3 }, { checkedAt: "2026-10-01T00:00:00Z" }), NOW)).toBe(false);
    expect(catchUpRange("2026-10-01T00:00:00Z", NOW)).toBe("3mo");
    expect(catchUpRange("2026-06-01T00:00:00Z", NOW)).toBe("6mo");
    expect(catchUpRange("2025-01-01T00:00:00Z", NOW)).toBe("1y");
    expect(catchUpRange("garbage", NOW)).toBe("1mo");
  });
});

describe("stores", () => {
  const input: AlertRuleInput = { symbol: " nvda ", kind: "below", value: 170, repeat: "once", note: "  wrong below  " };

  it("adds rules with a baseline, rejects bad input and stops at the limit", () => {
    const baseline = baselineFromQuote(quote(), NOW);
    expect(baseline).toEqual({ session: SESSION, high: 188.1, low: 181.2, side: "above" });
    const added = addAlertRule(input, { now: NOW, baseline, id: "a1" });
    expect(added.status).toBe("added");
    expect(alertsStore.getSnapshot()[0]).toMatchObject({ id: "a1", symbol: "NVDA", note: "wrong below", checkedAt: NOW.toISOString(), checkedLow: 181.2, side: "above" });
    expect(JSON.parse(storage.getItem("investseek:alerts:v1") ?? "[]")).toHaveLength(1);
    expect(addAlertRule({ ...input, value: -1 })).toEqual({ status: "invalid", error: "value" });
    expect(addAlertRule({ ...input, symbol: "$$" })).toEqual({ status: "invalid", error: "symbol" });
    expect(validateRuleInput({ symbol: "SPY", kind: "cross_ma200", value: 12, repeat: "once" })).toBeNull();
    alertsStore.write(Array.from({ length: MAX_ALERT_RULES }, (_, i) => createRule(input, NOW, null, `x${i}`)));
    expect(addAlertRule(input).status).toBe("full");
  });

  it("has no baseline without a fresh quote", () => {
    expect(baselineFromQuote(null, NOW)).toBeNull();
    expect(baselineFromQuote(quote({ stale: true }), NOW)).toBeNull();
    expect(baselineFromQuote(quote({ twoHundredDayAverage: null }), NOW)?.side).toBeNull();
  });

  it("re-arms on edit, resets the watch on resume and re-arms a fired rule", () => {
    addAlertRule(input, { now: new Date("2026-11-02T15:00:00Z"), id: "a1" });
    applyAlertPatches(new Map([["a1", { done: true, lastTriggeredAt: NOW.toISOString(), lastTriggeredSession: SESSION, triggerCount: 1 }]]));
    expect(updateAlertRule("a1", { ...input, value: 165 }, { now: NOW })).toBeNull();
    expect(alertsStore.getSnapshot()[0]).toMatchObject({ value: 165, done: false, armedAt: NOW.toISOString(), lastTriggeredAt: NOW.toISOString(), triggerCount: 1, checkedAt: null });
    expect(updateAlertRule("nope", input)).toBe("missing");

    setAlertPaused("a1", true);
    expect(alertsStore.getSnapshot()[0].paused).toBe(true);
    const later = new Date("2026-11-09T15:00:00Z");
    setAlertPaused("a1", false, later);
    expect(alertsStore.getSnapshot()[0]).toMatchObject({ paused: false, checkedAt: later.toISOString(), checkedSession: null, side: null });

    applyAlertPatches(new Map([["a1", { done: true }]]));
    rearmAlertRule("a1", later);
    expect(alertsStore.getSnapshot()[0]).toMatchObject({ done: false, armedAt: later.toISOString() });
  });

  it("drops patches for rules edited after the check", () => {
    addAlertRule(input, { now: NOW, id: "a1" });
    const seen = new Map([["a1", "2026-01-01T00:00:00.000Z"]]);
    applyAlertPatches(new Map([["a1", { done: true }]]), seen);
    expect(alertsStore.getSnapshot()[0].done).toBe(false);
    applyAlertPatches(new Map([["a1", { done: true }]]), new Map([["a1", NOW.toISOString()]]));
    expect(alertsStore.getSnapshot()[0].done).toBe(true);
  });

  it("removes a rule and puts it back where it was", () => {
    for (const id of ["a", "b", "c"]) addAlertRule(input, { now: NOW, id });
    const removed = removeAlertRule("b");
    expect(alertsStore.getSnapshot().map((r) => r.id)).toEqual(["a", "c"]);
    expect(removeAlertRule("zzz")).toBeNull();
    restoreAlertRule(removed!.rule, removed!.index);
    restoreAlertRule(removed!.rule, removed!.index);
    expect(alertsStore.getSnapshot().map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("logs events once, marks them seen and clears with undo", () => {
    const r = rule({ kind: "above", value: 185 });
    const event = evaluate(r, quote(), {}, NOW).event as AlertEvent;
    const other = { ...event, id: "other", at: "2026-11-06T20:01:00.000Z" };
    expect(recordAlertEvents([event, event])).toHaveLength(1);
    recordAlertEvents([other]);
    expect(alertLogStore.getSnapshot().map((e) => e.id)).toEqual(["other", event.id]);
    expect(unseenCount(alertLogStore.getSnapshot())).toBe(2);
    markAlertEventsSeen(["other"]);
    expect(unseenCount(alertLogStore.getSnapshot())).toBe(1);
    markAlertEventsSeen();
    expect(unseenCount(alertLogStore.getSnapshot())).toBe(0);
    const cleared = clearAlertLog();
    expect(alertLogStore.getSnapshot()).toEqual([]);
    restoreAlertLog(cleared);
    expect(alertLogStore.getSnapshot()).toHaveLength(2);
  });
});

describe("ruleStatus", () => {
  it("reports paused, triggered, unavailable, met and watching", () => {
    expect(ruleStatus(rule({}, { paused: true }), quote(), {}, NOW).status).toBe("paused");
    expect(ruleStatus(rule({}, { done: true }), quote(), {}, NOW).status).toBe("triggered");
    expect(ruleStatus(rule({ kind: "pnl_from_cost", value: 10 }), quote(), {}, NOW)).toMatchObject({ status: "unavailable", reading: { unavailable: "no_position" } });
    expect(ruleStatus(rule({ kind: "above", value: 180 }), quote(), {}, NOW).status).toBe("met");
    expect(ruleStatus(rule({ kind: "below", value: 170 }), quote(), {}, NOW).status).toBe("watching");
    expect(ruleStatus(rule(), null, {}, NOW).status).toBe("watching");
  });
});
