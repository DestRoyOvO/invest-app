import { describe, expect, it } from "vitest";

import { etClock, formatDuration, isTradingState, minutesToOpen, ribbonModel, sessionCountdown, SESSION, type EtClock } from "./session";

const at = (weekday: number, hh: number, mm: number, ss = 0): EtClock => ({ weekday, minutes: hh * 60 + mm + ss / 60 });
const EN = { days: "{d}d {h}h", hours: "{h}h {m}m", minutes: "{m}m" };
const ZH = { days: "{d}天{h}小时", hours: "{h}小时{m}分", minutes: "{m}分" };

describe("etClock", () => {
  it("reads the New York weekday and time in winter and summer time", () => {
    // Monday 9 Nov 2026, 09:30 EST (UTC-5).
    expect(etClock(Date.UTC(2026, 10, 9, 14, 30))).toEqual({ weekday: 1, minutes: 570 });
    // Wednesday 1 Jul 2026, 09:30 EDT (UTC-4).
    expect(etClock(Date.UTC(2026, 6, 1, 13, 30))).toEqual({ weekday: 3, minutes: 570 });
    // Saturday 7 Nov 2026 just after midnight in New York.
    expect(etClock(Date.UTC(2026, 10, 7, 5, 0, 30))).toEqual({ weekday: 6, minutes: 0.5 });
  });
});

describe("minutesToOpen", () => {
  it("counts to 09:30 today before the open on a weekday", () => {
    expect(minutesToOpen("PRE", at(2, 8, 0))).toBe(90);
    expect(minutesToOpen("PREPRE", at(2, 2, 0))).toBe(450);
    // Before 04:00 Yahoo may already say CLOSED on a normal day.
    expect(minutesToOpen("CLOSED", at(2, 2, 0))).toBe(450);
    expect(minutesToOpen(null, at(1, 9, 0))).toBe(30);
  });

  it("skips to the next weekday after the open, over weekends and holidays", () => {
    expect(minutesToOpen("POST", at(5, 17, 0))).toBe(3 * 1440 + 570 - 1020);
    expect(minutesToOpen("CLOSED", at(6, 13, 53))).toBe(2 * 1440 + 570 - 833);
    expect(minutesToOpen("CLOSED", at(0, 23, 0))).toBe(1440 + 570 - 1380);
    // A weekday Yahoo calls CLOSED during the day is a holiday: the next weekday opens.
    expect(minutesToOpen("CLOSED", at(1, 8, 0))).toBe(1440 + 570 - 480);
    expect(minutesToOpen("CLOSED", at(4, 10, 0))).toBe(1440 + 570 - 600);
  });
});

describe("sessionCountdown", () => {
  it("counts to the close during the regular session and to the open otherwise", () => {
    expect(sessionCountdown("REGULAR", at(3, 14, 48))).toEqual({ kind: "closes", minutes: 72 });
    expect(sessionCountdown("POST", at(3, 16, 30)).kind).toBe("opens");
    expect(sessionCountdown("CLOSED", at(6, 12, 0)).kind).toBe("opens");
  });

  it("uses the clock when the state is unknown and never counts negative", () => {
    expect(sessionCountdown(null, at(2, 10, 0))).toEqual({ kind: "closes", minutes: 360 });
    expect(sessionCountdown(null, at(6, 10, 0)).kind).toBe("opens");
    expect(sessionCountdown("REGULAR", at(2, 16, 1)).minutes).toBe(0);
    // Yahoo still says PRE a moment after 09:30: the open is now, not tomorrow.
    expect(sessionCountdown("PRE", at(2, 9, 30, 30))).toEqual({ kind: "opens", minutes: 0 });
  });
});

describe("formatDuration", () => {
  it("prints days and hours, hours and minutes, or minutes", () => {
    expect(formatDuration(271, EN)).toBe("4h 31m");
    expect(formatDuration(72, EN)).toBe("1h 12m");
    expect(formatDuration(2617, EN)).toBe("1d 19h");
    expect(formatDuration(12, EN)).toBe("12m");
    expect(formatDuration(0.2, EN)).toBe("1m");
    expect(formatDuration(0, EN)).toBe("1m");
    expect(formatDuration(270.4, EN)).toBe("4h 31m");
    expect(formatDuration(271, ZH)).toBe("4小时31分");
    expect(formatDuration(72, ZH)).toBe("1小时12分");
    expect(formatDuration(3870, ZH)).toBe("2天16小时");
  });
});

describe("ribbonModel", () => {
  it("maps 04:00 to 20:00 with the elapsed share of each segment and the now tick", () => {
    const model = ribbonModel("REGULAR", at(3, 12, 0));
    expect(model.open).toBe(true);
    expect(model.now).toBeCloseTo((720 - 240) / 960);
    expect(model.segments.map((s) => s.kind)).toEqual(["pre", "regular", "post"]);
    expect(model.segments[0].elapsed).toBe(1);
    expect(model.segments[1].elapsed).toBeCloseTo((720 - 570) / 390);
    expect(model.segments[2].elapsed).toBe(0);
    expect(model.segments.reduce((sum, s) => sum + s.width, 0)).toBeCloseTo(1);
    expect(model.segments[1].start).toBeCloseTo((SESSION.open - SESSION.preOpen) / 960);
  });

  it("takes open or closed from Yahoo and only places now with the clock", () => {
    const closed = ribbonModel("CLOSED", at(3, 12, 0));
    expect(closed.open).toBe(false);
    expect(closed.now).toBeNull();
    expect(closed.segments.every((s) => s.elapsed === 0)).toBe(true);
    expect(ribbonModel("POST", at(3, 20, 5)).now).toBe(1);
    expect(ribbonModel("PRE", at(3, 4, 0)).now).toBe(0);
    expect(isTradingState("POSTPOST")).toBe(false);
    expect(isTradingState(null)).toBe(false);
  });
});
