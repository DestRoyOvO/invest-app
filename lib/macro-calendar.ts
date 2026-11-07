// Scheduled US macro releases that move the whole market, shown in the events calendar and given to the AI.
//
// Sources, checked 2026-11-07:
// - FOMC: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm (statement at 2:00 pm ET on the second
//   meeting day; 2027 dates are tentative until confirmed at the preceding meeting).
// - CPI: https://www.bls.gov/schedule/news_release/cpi.htm (8:30 am ET).
// - Employment Situation: https://www.bls.gov/schedule/news_release/empsit.htm (8:30 am ET).
// Times carry the New York UTC offset of the day (EDT -04:00 from 2026-03-08 to 2026-11-01 and from 2027-03-14 to
// 2027-11-07, EST -05:00 otherwise). Update this list when the agencies publish the next year's schedule.

import type { MacroEventKey } from "@/types/api";

export type { MacroEventKey } from "@/types/api";

export interface MacroEvent {
  key: MacroEventKey;
  /** ISO timestamp with the New York offset. */
  at: string;
  /** Reference period of the data (CPI and jobs), e.g. "2026-10"; null for FOMC decisions. */
  period: string | null;
  /** FOMC meeting with a Summary of Economic Projections (the "dot plot"). */
  projections?: boolean;
  /** The date may still move (the Fed marks next year's meetings tentative). */
  tentative?: boolean;
}

export const MACRO_SOURCES: Record<MacroEventKey, string> = {
  fomc: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
  cpi: "https://www.bls.gov/schedule/news_release/cpi.htm",
  jobs: "https://www.bls.gov/schedule/news_release/empsit.htm",
};

const fomc = (at: string, projections = false, tentative = false): MacroEvent => ({ key: "fomc", at, period: null, projections, tentative });
const cpi = (at: string, period: string): MacroEvent => ({ key: "cpi", at, period });
const jobs = (at: string, period: string): MacroEvent => ({ key: "jobs", at, period });

/** Sorted by time. */
export const MACRO_EVENTS: readonly MacroEvent[] = [
  fomc("2026-01-28T14:00:00-05:00"),
  fomc("2026-03-18T14:00:00-04:00", true),
  fomc("2026-04-29T14:00:00-04:00"),
  fomc("2026-06-17T14:00:00-04:00", true),
  fomc("2026-07-29T14:00:00-04:00"),
  fomc("2026-09-16T14:00:00-04:00", true),
  fomc("2026-10-28T14:00:00-04:00"),
  jobs("2026-11-06T08:30:00-05:00", "2026-10"),
  cpi("2026-11-10T08:30:00-05:00", "2026-10"),
  jobs("2026-12-04T08:30:00-05:00", "2026-11"),
  fomc("2026-12-09T14:00:00-05:00", true),
  cpi("2026-12-10T08:30:00-05:00", "2026-11"),
  jobs("2027-01-08T08:30:00-05:00", "2026-12"),
  cpi("2027-01-13T08:30:00-05:00", "2026-12"),
  fomc("2027-01-27T14:00:00-05:00", false, true),
  jobs("2027-02-05T08:30:00-05:00", "2027-01"),
  cpi("2027-02-11T08:30:00-05:00", "2027-01"),
  jobs("2027-03-05T08:30:00-05:00", "2027-02"),
  cpi("2027-03-10T08:30:00-05:00", "2027-02"),
  fomc("2027-03-17T14:00:00-04:00", true, true),
  jobs("2027-04-02T08:30:00-04:00", "2027-03"),
  cpi("2027-04-13T08:30:00-04:00", "2027-03"),
  fomc("2027-04-28T14:00:00-04:00", false, true),
  jobs("2027-05-07T08:30:00-04:00", "2027-04"),
  cpi("2027-05-12T08:30:00-04:00", "2027-04"),
  jobs("2027-06-04T08:30:00-04:00", "2027-05"),
  fomc("2027-06-09T14:00:00-04:00", true, true),
  cpi("2027-06-10T08:30:00-04:00", "2027-05"),
  jobs("2027-07-02T08:30:00-04:00", "2027-06"),
  cpi("2027-07-14T08:30:00-04:00", "2027-06"),
  fomc("2027-07-28T14:00:00-04:00", false, true),
  jobs("2027-08-06T08:30:00-04:00", "2027-07"),
  cpi("2027-08-11T08:30:00-04:00", "2027-07"),
  jobs("2027-09-03T08:30:00-04:00", "2027-08"),
  cpi("2027-09-14T08:30:00-04:00", "2027-08"),
  fomc("2027-09-15T14:00:00-04:00", true, true),
  jobs("2027-10-08T08:30:00-04:00", "2027-09"),
  cpi("2027-10-14T08:30:00-04:00", "2027-09"),
  fomc("2027-10-27T14:00:00-04:00", false, true),
  jobs("2027-11-05T08:30:00-04:00", "2027-10"),
  cpi("2027-11-10T08:30:00-05:00", "2027-10"),
  jobs("2027-12-03T08:30:00-05:00", "2027-11"),
  fomc("2027-12-08T14:00:00-05:00", true, true),
  cpi("2027-12-10T08:30:00-05:00", "2027-11"),
];

/** Events from `from` (inclusive) to `to` (exclusive), both epoch milliseconds. */
export function macroEventsBetween(from: number, to: number): MacroEvent[] {
  return MACRO_EVENTS.filter((event) => {
    const t = Date.parse(event.at);
    return t >= from && t < to;
  });
}

/** Time of the last scheduled event: the calendar warns when the list needs extending. */
export const MACRO_CALENDAR_ENDS = MACRO_EVENTS[MACRO_EVENTS.length - 1].at;
