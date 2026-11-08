import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { alertLogStore, alertsStore, createRule, type AlertBar, type AlertQuote, type AlertRule } from "@/lib/alerts";

import { createAlertEngine, FLUSH_INTERVAL_MS, REPLAY_ATTEMPTS } from "./engine";

class MemoryStorage {
  readonly map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: new MemoryStorage(), addEventListener: () => {}, removeEventListener: () => {} });
  // The stores keep their last value in memory between tests.
  alertsStore.write([]);
  alertLogStore.write([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const START = new Date("2026-11-06T20:00:00Z");

function quote(overrides: Partial<AlertQuote> = {}): AlertQuote {
  return {
    symbol: "NVDA",
    price: 186.64,
    changePercent: 2.78,
    dayHigh: 188.1,
    dayLow: 181.2,
    currency: "USD",
    regularMarketTime: "2026-11-06T19:59:30Z",
    nextEarningsDate: null,
    earningsDateEstimated: null,
    twoHundredDayAverage: 160.5,
    stale: false,
    ...overrides,
  };
}

function seed(rules: AlertRule[]) {
  alertsStore.write(rules);
}

function rule(id: string, kind: AlertRule["kind"], value: number | null, overrides: Partial<AlertRule> = {}): AlertRule {
  return { ...createRule({ symbol: "NVDA", kind, value, repeat: "once" }, new Date("2026-11-06T19:59:00Z"), null, id), lastCheckedAt: "2026-11-06T19:59:00Z", ...overrides };
}

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(fetchBars = vi.fn(async (): Promise<readonly AlertBar[]> => [])) {
  let clock = START.getTime();
  const notify = vi.fn();
  const engine = createAlertEngine({ fetchBars, notify, now: () => new Date(clock) });
  const advance = (ms: number) => {
    clock += ms;
  };
  return { engine, notify, fetchBars, advance };
}

describe("createAlertEngine", () => {
  it("fires, logs and notifies once, and writes the trigger at once", () => {
    seed([rule("up", "above", 185)]);
    const { engine, notify } = setup();
    engine.setInputs(new Map([["NVDA", quote()]]), {});
    engine.check();
    engine.check();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(alertLogStore.getSnapshot()).toHaveLength(1);
    expect(alertsStore.getSnapshot()[0]).toMatchObject({ done: true, triggerCount: 1 });
  });

  it("writes routine check results at most once a minute, or when flushed", () => {
    seed([rule("down", "below", 150)]);
    const { engine, advance } = setup();
    engine.setInputs(new Map([["NVDA", quote()]]), {});
    engine.check();
    const firstWrite = alertsStore.getSnapshot()[0].lastCheckedAt;
    expect(firstWrite).toBe(START.toISOString());
    advance(15_000);
    engine.check();
    expect(alertsStore.getSnapshot()[0].lastCheckedAt).toBe(firstWrite);
    engine.flush();
    expect(alertsStore.getSnapshot()[0].lastCheckedAt).toBe(new Date(START.getTime() + 15_000).toISOString());
    advance(FLUSH_INTERVAL_MS);
    engine.check();
    expect(alertsStore.getSnapshot()[0].lastCheckedAt).toBe(new Date(START.getTime() + 15_000 + FLUSH_INTERVAL_MS).toISOString());
  });

  it("replays a stale price rule from daily bars before checking it live", async () => {
    const stale = rule("down", "below", 170, { lastCheckedAt: "2026-11-03T20:00:00Z", checkedSession: "2026-11-03", checkedHigh: 182, checkedLow: 175 });
    seed([stale]);
    const bars: AlertBar[] = [
      { t: Date.parse("2026-11-04T00:00:00Z"), h: 180, l: 172 },
      { t: Date.parse("2026-11-05T00:00:00Z"), h: 178, l: 168.2 },
      { t: Date.parse("2026-11-06T00:00:00Z"), h: 188.1, l: 171 },
    ];
    const { engine, notify, fetchBars } = setup(vi.fn(async () => bars));
    engine.setInputs(new Map([["NVDA", quote()]]), {});
    engine.check();
    expect(fetchBars).toHaveBeenCalledWith("NVDA", "1mo");
    expect(alertsStore.getSnapshot()[0].lastCheckedAt).toBe(stale.lastCheckedAt);
    engine.check();
    expect(fetchBars).toHaveBeenCalledTimes(1);
    await flushPromises();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(alertLogStore.getSnapshot()[0].missed).toEqual({ session: "2026-11-05", extreme: 168.2, sessions: 1 });
    expect(alertsStore.getSnapshot()[0]).toMatchObject({ done: true, checkedSession: "2026-11-06", lastCheckedAt: START.toISOString() });
  });

  it("retries a failed replay and then goes back to live checks", async () => {
    seed([rule("down", "below", 190, { lastCheckedAt: "2026-11-01T20:00:00Z" })]);
    const fetchBars = vi.fn(async (): Promise<readonly AlertBar[]> => {
      throw new Error("upstream");
    });
    const { engine, notify, advance } = setup(fetchBars);
    engine.setInputs(new Map([["NVDA", quote()]]), {});
    for (let attempt = 0; attempt < REPLAY_ATTEMPTS; attempt++) {
      engine.check();
      await flushPromises();
      advance(5 * 60_000);
    }
    expect(fetchBars).toHaveBeenCalledTimes(REPLAY_ATTEMPTS);
    expect(notify).not.toHaveBeenCalled();
    engine.check();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(alertLogStore.getSnapshot()[0].missed).toBeNull();
  });

  it("ignores replays that finish after it stopped and drops results of re-armed rules", async () => {
    let resolve: (bars: readonly AlertBar[]) => void = () => {};
    const fetchBars = vi.fn(() => new Promise<readonly AlertBar[]>((r) => (resolve = r)));
    seed([rule("down", "below", 170, { lastCheckedAt: "2026-11-01T20:00:00Z" }), rule("watch", "below", 100)]);
    const { engine } = setup(fetchBars);
    engine.setInputs(new Map([["NVDA", quote()]]), {});
    engine.check();
    // The investor edits "watch" before the routine results are written.
    alertsStore.update((rules) => rules.map((r) => (r.id === "watch" ? { ...r, armedAt: "2026-11-06T20:00:30.000Z", lastCheckedAt: null } : r)));
    engine.stop();
    resolve([{ t: Date.parse("2026-11-05T00:00:00Z"), h: 178, l: 160 }]);
    await flushPromises();
    expect(alertLogStore.getSnapshot()).toHaveLength(0);
    expect(alertsStore.getSnapshot().find((r) => r.id === "watch")?.lastCheckedAt).toBeNull();
  });
});
