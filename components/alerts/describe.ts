// Words for alert rules and triggers, built from the stored fields so they follow the language setting. Pure, so the
// wording is unit tested; the toast, the system notification, the alert center and /alerts all use it.

import { withTrueMinus } from "@/components/ui/delta-utils";
import type { AlertEvent, AlertKind, AlertReading, AlertRule } from "@/lib/alerts";
import { formatPercent, formatPrice, formatShortDate, tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import type { Lang } from "@/types/api";

const THRESHOLD = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** A rule threshold in percent, e.g. 5 -> "5%", 2.5 -> "2.5%". */
function threshold(value: number): string {
  return `${THRESHOLD.format(Math.abs(value))}%`;
}

/** A signed percent with a true minus, e.g. "+2.78%" or "−10.00%". */
export function signedPercent(value: number | null | undefined): string {
  return withTrueMinus(formatPercent(value));
}

/** A session date (YYYY-MM-DD) as a short date, e.g. "Nov 5". */
function sessionDate(session: string, lang: Lang): string {
  return formatShortDate(`${session}T12:00:00Z`, lang, "UTC");
}

/** The rule in a few words, e.g. "At or below 170.00", "Day move ±5% or more", "Loss from cost of 10% or more". */
export function describeRule(rule: Pick<AlertRule, "kind" | "value">, t: Messages, lang: Lang): string {
  const words = t.alerts.rule;
  const value = rule.value ?? 0;
  switch (rule.kind) {
    case "above":
      return tpl(words.above, { level: formatPrice(value, lang) });
    case "below":
      return tpl(words.below, { level: formatPrice(value, lang) });
    case "day_move":
      return tpl(words.day_move, { pct: threshold(value) });
    case "pnl_from_cost":
      return tpl(value < 0 ? words.pnlLoss : words.pnlGain, { pct: threshold(value) });
    case "earnings_within":
      return value === 0 ? words.earningsDay : value === 1 ? words.earningsOne : tpl(words.earnings, { n: value });
    case "cross_ma200":
      return words.cross_ma200;
  }
}

function reportDate(event: Pick<AlertEvent, "eventDate" | "estimated">, t: Messages, lang: Lang): string {
  const date = formatShortDate(event.eventDate, lang, "America/New_York");
  return event.estimated ? tpl(t.alerts.event.estimatedDate, { date }) : date;
}

/** What happened, in one sentence, e.g. "NVDA traded below 170.00 on Nov 5 (low 168.20)". */
export function describeAlertEvent(event: AlertEvent, t: Messages, lang: Lang): string {
  const words = t.alerts.event;
  const symbol = event.symbol;
  const level = formatPrice(event.value, lang);
  const price = formatPrice(event.observed, lang);
  switch (event.kind) {
    case "above":
    case "below": {
      const up = event.kind === "above";
      if (event.missed) {
        const extreme = formatPrice(event.missed.extreme, lang);
        const date = sessionDate(event.missed.session, lang);
        const text = up ? tpl(words.missedAbove, { symbol, level, date, high: extreme }) : tpl(words.missedBelow, { symbol, level, date, low: extreme });
        const more = event.missed.sessions - 1;
        if (more <= 0) return text;
        return more === 1 ? tpl(words.missedMoreOne, { text }) : tpl(words.missedMore, { text, n: more });
      }
      if (event.extreme !== null) {
        const extreme = formatPrice(event.extreme, lang);
        return up ? tpl(words.aboveTouched, { symbol, level, high: extreme, price }) : tpl(words.belowTouched, { symbol, level, low: extreme, price });
      }
      return tpl(up ? words.above : words.below, { symbol, level, price });
    }
    case "day_move":
      return tpl(words.dayMove, { symbol, change: signedPercent(event.observed) });
    case "pnl_from_cost":
      return tpl(words.pnl, { symbol, pnl: signedPercent(event.observed) });
    case "earnings_within": {
      const date = reportDate(event, t, lang);
      if (event.observed === 0) return tpl(words.earningsToday, { symbol, date });
      if (event.observed === 1) return tpl(words.earningsTomorrow, { symbol, date });
      return tpl(words.earnings, { symbol, date, n: event.observed ?? 0 });
    }
    case "cross_ma200":
      return tpl(event.direction === "below" ? words.crossBelow : words.crossAbove, { symbol, ma: formatPrice(event.reference, lang), price });
  }
}

/** The current reading next to a rule on /alerts, e.g. "8.9% away", "today +2.78%", "in 11 days". Null when unknown. */
export function describeReading(kind: AlertKind, value: number | null, reading: AlertReading | null, t: Messages): string | null {
  if (!reading || reading.unavailable) return null;
  const words = t.alerts.now;
  const observed = reading.observed;
  if (observed === null) return null;
  switch (kind) {
    case "above":
    case "below": {
      // A level already reached has no distance left; the status column says so.
      if (value === null || observed <= 0 || reading.met) return null;
      return tpl(words.away, { pct: `${Math.abs((value / observed - 1) * 100).toFixed(1)}%` });
    }
    case "day_move":
      return tpl(words.today, { change: signedPercent(observed) });
    case "pnl_from_cost":
      return tpl(words.pnl, { pnl: signedPercent(observed) });
    case "earnings_within":
      return observed === 0 ? words.reportToday : observed === 1 ? words.reportTomorrow : tpl(words.reportIn, { n: observed });
    case "cross_ma200":
      return reading.reference ? tpl(words.vsAverage, { pct: signedPercent((observed / reading.reference - 1) * 100) }) : null;
  }
}
