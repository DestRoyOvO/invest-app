// Earnings and analyst facts for the AI context, from the earnings contract (types/earnings.ts, served by
// lib/server/earnings.ts) and the cached daily bars. Everything here is pure; lib/server/ai-context.ts loads the data.
//
// Yahoo's estimate rows go stale or carry the wrong label around report dates (seen for PLTR and AAPL in the data
// audit), so an estimate is used only when its value differs from the estimate of the quarter just reported, and it
// is described as "the upcoming report" rather than by its period label.

import type { DailyBar } from "@/lib/bars";
import { INTO_REPORT_DAYS } from "@/lib/ai-notes";
import type { AnalystAction, AnalystActivity, EarningsDetail, EarningsEstimate, EarningsQuarter, RatingCounts } from "@/types/earnings";

import { cleanInline, daysUntil, fmtCompact, fmtDaysUntil, fmtNumber, fmtPrice, fmtRatio, isFiniteNumber, NA } from "./ai-format";

const DAY_MS = 86_400_000;
const MAX_SURPRISES = 4;
const MAX_REACTIONS = 4;
const MAX_ACTIONS = 5;
const ACTION_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// Report reactions
// ---------------------------------------------------------------------------

export interface ReportReaction {
  /** Report date (ISO date). */
  date: string;
  /** Decimal move of the adjusted close. */
  move: number;
  /**
   * "next": the first session after a report with a known time (after the close: the next day; before or during the
   * session: that day). "window": the time is unknown, so the move from the close before the report date to the
   * close of the session after it.
   */
  basis: "next" | "window";
}

type ReportTiming = "before" | "after" | "unknown";

/** Before the open, after the close, or unknown (a date without a time) from the report timestamp in UTC. */
export function reportTiming(reportedAt: string): ReportTiming {
  const time = /T(\d{2}):(\d{2})/.exec(reportedAt);
  if (!time) return "unknown";
  const minutes = Number(time[1]) * 60 + Number(time[2]);
  if (minutes === 0) return "unknown";
  // 20:00 UTC is 16:00 in New York in summer (15:00 in winter): later reports came after the close.
  return minutes >= 20 * 60 ? "after" : "before";
}

/** Index of the first bar on or after `t`, or -1. */
function firstAtOrAfter(bars: readonly DailyBar[], t: number): number {
  return bars.findIndex((bar) => bar.t >= t);
}

/**
 * The adjusted-close move after each of the last reports, newest first. Reports without bars on both sides (or with
 * a gap of more than a week around them) are skipped.
 */
export function reportReactions(history: readonly EarningsQuarter[], bars: readonly DailyBar[], limit = MAX_REACTIONS): ReportReaction[] {
  const sorted = [...bars].filter((bar) => Number.isFinite(bar.t) && isFiniteNumber(bar.adjClose) && bar.adjClose > 0).sort((a, b) => a.t - b.t);
  const reports = history
    .map((quarter) => quarter.reportedAt)
    .filter((at): at is string => typeof at === "string" && /^\d{4}-\d{2}-\d{2}/.test(at))
    .sort()
    .reverse();
  const out: ReportReaction[] = [];
  for (const reportedAt of reports) {
    if (out.length >= limit) break;
    const date = reportedAt.slice(0, 10);
    const day = Date.parse(`${date}T00:00:00Z`);
    if (Number.isNaN(day)) continue;
    const timing = reportTiming(reportedAt);
    let from: number;
    let to: number;
    if (timing === "before") {
      to = firstAtOrAfter(sorted, day);
      from = to - 1;
    } else {
      to = firstAtOrAfter(sorted, day + DAY_MS);
      if (timing === "after") from = to - 1;
      else {
        const sameOrAfter = firstAtOrAfter(sorted, day);
        from = (sameOrAfter < 0 ? sorted.length : sameOrAfter) - 1;
      }
    }
    if (from < 0 || to < 0 || from >= to) continue;
    if (sorted[to].t - sorted[from].t > 7 * DAY_MS) continue;
    out.push({ date, move: sorted[to].adjClose / sorted[from].adjClose - 1, basis: timing === "unknown" ? "window" : "next" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------

/** The latest reported quarter (with an actual EPS). */
export function lastReported(history: readonly EarningsQuarter[]): EarningsQuarter | null {
  const reported = history.filter((quarter) => isFiniteNumber(quarter.epsActual));
  if (reported.length === 0) return null;
  return [...reported].sort((a, b) => (a.periodEnd ?? a.reportedAt ?? "").localeCompare(b.periodEnd ?? b.reportedAt ?? "")).at(-1) ?? null;
}

function sameValue(a: number | null | undefined, b: number | null | undefined): boolean {
  return isFiniteNumber(a) && isFiniteNumber(b) && Math.abs(a - b) < 1e-9;
}

/**
 * The estimate row for the upcoming report: the current quarter ("0q"), or the next one when "0q" still carries the
 * estimate of the quarter that was just reported (a stale row). Null when neither row is usable.
 */
export function upcomingEstimate(detail: EarningsDetail): EarningsEstimate | null {
  const last = lastReported(detail.history);
  for (const period of ["0q", "+1q"] as const) {
    const row = detail.estimates.find((estimate) => estimate.period === period);
    if (!row || !isFiniteNumber(row.epsAvg)) continue;
    if (last && sameValue(row.epsAvg, last.epsEstimate)) continue;
    return row;
  }
  return null;
}

export interface Consensus {
  epsAvg: number | null;
  epsLow: number | null;
  epsHigh: number | null;
  revenueAvg: number | null;
  revenueLow: number | null;
  revenueHigh: number | null;
  analysts: number | null;
}

/** The consensus for the upcoming report: calendarEvents when it is not stale, else the upcoming estimate row. */
export function upcomingConsensus(detail: EarningsDetail): Consensus | null {
  const last = lastReported(detail.history);
  const row = upcomingEstimate(detail);
  const calendar = detail.consensus;
  if (calendar && isFiniteNumber(calendar.epsAvg) && !(last && sameValue(calendar.epsAvg, last.epsEstimate))) {
    return { ...calendar, analysts: row && sameValue(row.epsAvg, calendar.epsAvg) ? row.analysts : null };
  }
  if (!row) return null;
  return {
    epsAvg: row.epsAvg,
    epsLow: row.epsLow,
    epsHigh: row.epsHigh,
    revenueAvg: row.revenueAvg,
    revenueLow: row.revenueLow,
    revenueHigh: row.revenueHigh,
    analysts: row.analysts,
  };
}

/** Relative change from `then` to `current` as a signed percent ("+2.9%"); n/a without both values. */
function changeSince(current: number | null, then: number | null): string {
  if (!isFiniteNumber(current) || !isFiniteNumber(then) || then === 0) return NA;
  return fmtRatio((current - then) / Math.abs(then), 1, true);
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export interface EarningsBlockInput {
  detail: EarningsDetail | null;
  bars: readonly DailyBar[] | null;
  /** Trading currency of the symbol, to flag financial figures in another currency. */
  currency: string | null;
  /** Fallbacks from the quote when the earnings detail has no date. */
  quoteNextDate?: string | null;
  quoteDateEstimated?: boolean | null;
  now: Date;
}

/** True when the next report is between today and INTO_REPORT_DAYS days away. */
export function isIntoReport(nextDate: string | null | undefined, now: Date): boolean {
  if (!nextDate) return false;
  const days = daysUntil(nextDate, now);
  return days !== null && days >= 0 && days <= INTO_REPORT_DAYS;
}

function consensusLine(consensus: Consensus, currency: string | null): string {
  const eps = [`EPS ${fmtNumber(consensus.epsAvg)}`];
  const details: string[] = [];
  if (isFiniteNumber(consensus.epsLow) && isFiniteNumber(consensus.epsHigh)) details.push(`range ${fmtNumber(consensus.epsLow)}-${fmtNumber(consensus.epsHigh)}`);
  if (isFiniteNumber(consensus.analysts)) details.push(`${consensus.analysts} analysts`);
  if (details.length > 0) eps.push(`(${details.join(", ")})`);
  let revenue = "";
  if (isFiniteNumber(consensus.revenueAvg)) {
    const range =
      isFiniteNumber(consensus.revenueLow) && isFiniteNumber(consensus.revenueHigh)
        ? ` (range ${fmtCompact(consensus.revenueLow, currency)}-${fmtCompact(consensus.revenueHigh, currency)})`
        : "";
    revenue = `; revenue ${fmtCompact(consensus.revenueAvg, currency)}${range}`;
  }
  return `- consensus for the upcoming report: ${eps.join(" ")}${revenue}`;
}

/**
 * The Earnings block: next report and whether it is confirmed, the consensus with its range and analyst count, how
 * the EPS estimate moved over 30 and 90 days with revision counts, the last four surprises and the price move after
 * each of the last four reports, plus the "Into the report" marker the stock note keys on. Null without any data.
 */
export function earningsBlock({ detail, bars, currency, quoteNextDate, quoteDateEstimated, now }: EarningsBlockInput): string | null {
  const nextDate = detail?.nextDate ?? quoteNextDate ?? null;
  const estimated = detail?.nextDateEstimated ?? quoteDateEstimated ?? null;
  if (!detail && !nextDate) return null;

  const figuresCurrency = detail?.financialCurrency ?? currency;
  const foreign = detail?.financialCurrency && currency && detail.financialCurrency !== currency ? `; financial figures in ${cleanInline(detail.financialCurrency, 8)}` : "";
  const lines = [`Earnings (Yahoo${foreign}; consensus figures and estimates are analyst opinions):`];

  const days = nextDate ? daysUntil(nextDate, now) : null;
  if (nextDate && days !== null && days >= 0) {
    const status = estimated === true ? "estimated by Yahoo, not confirmed by the company" : estimated === false ? "confirmed" : "confirmation unknown";
    lines.push(`- next report: ${nextDate.slice(0, 10)} (${status}), ${fmtDaysUntil(days)}`);
  } else if (nextDate) {
    lines.push(`- no future report date is known; the last listed date is ${nextDate.slice(0, 10)}`);
  } else {
    lines.push("- next report date: not available");
  }

  if (detail) {
    const consensus = upcomingConsensus(detail);
    lines.push(consensus ? consensusLine(consensus, figuresCurrency) : "- consensus for the upcoming report: not available (Yahoo's estimate rows are missing or stale)");

    const estimate = upcomingEstimate(detail);
    if (estimate && isFiniteNumber(estimate.epsTrend.current)) {
      const trend = estimate.epsTrend;
      const parts = [`${fmtNumber(trend.current)} now`];
      if (isFiniteNumber(trend.d30)) parts.push(`${fmtNumber(trend.d30)} 30 days ago (${changeSince(trend.current, trend.d30)} since)`);
      if (isFiniteNumber(trend.d90)) parts.push(`${fmtNumber(trend.d90)} 90 days ago (${changeSince(trend.current, trend.d90)} since)`);
      const revisions =
        isFiniteNumber(estimate.revisions.up30) || isFiniteNumber(estimate.revisions.down30)
          ? `; revisions in the last 30 days: ${estimate.revisions.up30 ?? 0} up, ${estimate.revisions.down30 ?? 0} down`
          : "";
      lines.push(`- EPS estimate for the upcoming report: ${parts.join(", ")}${revisions}`);
    }

    const reported = detail.history.filter((quarter) => isFiniteNumber(quarter.epsActual)).slice(-MAX_SURPRISES).reverse();
    if (reported.length > 0) {
      const items = reported.map((quarter) => {
        const label = cleanInline(quarter.period, 12) || (quarter.periodEnd ? quarter.periodEnd.slice(0, 10) : NA);
        const estimateText = isFiniteNumber(quarter.epsEstimate) ? ` vs estimate ${fmtNumber(quarter.epsEstimate)}` : "";
        const surprise = isFiniteNumber(quarter.surprise) ? ` (surprise ${fmtRatio(quarter.surprise, 1, true)})` : "";
        return `${label} EPS ${fmtNumber(quarter.epsActual)}${estimateText}${surprise}`;
      });
      lines.push(`- last ${reported.length} reports, newest first: ${items.join("; ")}`);
    }

    const reactions = bars ? reportReactions(detail.history, bars) : [];
    if (reactions.length > 0) {
      const basis = reactions.some((reaction) => reaction.basis === "window")
        ? "where the report time is unknown, from the close before the report date to the close of the next session"
        : "first session after each report";
      lines.push(
        `- price move after each of the last ${reactions.length} reports (dividend-adjusted closes, ${basis}): ${reactions
          .map((reaction) => `${reaction.date} ${fmtRatio(reaction.move, 1, true)}`)
          .join(", ")}`,
      );
    }
  }

  if (isIntoReport(nextDate, now)) lines.push(`- Into the report: the next report is ${INTO_REPORT_DAYS} days away or less.`);
  return lines.join("\n");
}

function countsText(counts: RatingCounts): string {
  const total = counts.strongBuy + counts.buy + counts.hold + counts.sell + counts.strongSell;
  return `strong buy ${counts.strongBuy}, buy ${counts.buy}, hold ${counts.hold}, sell ${counts.sell}, strong sell ${counts.strongSell} (${total} ratings)`;
}

const ACTION_WORDS: Readonly<Record<string, string>> = {
  up: "upgrade",
  down: "downgrade",
  main: "maintains",
  init: "initiates",
  reit: "reiterates",
};

/** One analyst action in words, e.g. "2026-11-05 Morgan Stanley: upgrade from Hold to Buy; target 220.00 -> 250.00 (raises)". */
export function actionText(action: AnalystAction): string {
  const firm = cleanInline(action.firm, 40) || "unknown firm";
  const from = cleanInline(action.fromGrade, 24);
  const to = cleanInline(action.toGrade, 24);
  const verb = action.action ? (ACTION_WORDS[action.action] ?? cleanInline(action.action, 12)) : "";
  const grade = from && to && from !== to ? `from ${from} to ${to}` : to;
  const rating = [verb, grade].filter(Boolean).join(" ");
  let target = "";
  if (isFiniteNumber(action.currentTarget)) {
    const prior = isFiniteNumber(action.priorTarget) && action.priorTarget !== action.currentTarget ? `${fmtPrice(action.priorTarget)} -> ` : "";
    const how = action.priceTargetAction ? ` (${cleanInline(action.priceTargetAction, 12).toLowerCase()})` : "";
    target = `target ${prior}${fmtPrice(action.currentTarget)}${how}`;
  }
  return `${action.date.slice(0, 10)} ${firm}: ${[rating, target].filter(Boolean).join("; ") || "no details"}`;
}

/** Analyst actions of the last `days` days up to now, newest first. */
export function recentActions(activity: AnalystActivity | null, now: Date, days: number): AnalystAction[] {
  if (!activity) return [];
  const since = now.getTime() - days * DAY_MS;
  return activity.actions
    .filter((action) => {
      const t = Date.parse(action.date);
      return Number.isFinite(t) && t >= since && t <= now.getTime() + DAY_MS;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * The Analyst activity block: rating counts now against three months ago, the target range and the last five rating
 * or target actions of the past 30 days. Null without data.
 */
export function analystBlock(activity: AnalystActivity | null, now: Date): string | null {
  if (!activity) return null;
  const lines = ["Analyst activity (ratings and price targets are opinions, not facts about the future):"];
  const current = activity.trend.find((row) => row.period === "0m") ?? activity.trend[0];
  const earlier = activity.trend.find((row) => row.period === "-3m") ?? (activity.trend.length > 1 ? activity.trend[activity.trend.length - 1] : undefined);
  if (current) {
    const then = earlier && earlier !== current ? `; ${earlier.period === "-3m" ? "3 months ago" : `period ${cleanInline(earlier.period, 6)}`}: ${countsText(earlier)}` : "";
    lines.push(`- ratings now: ${countsText(current)}${then}`);
  }
  if (isFiniteNumber(activity.targetMean)) {
    const range = isFiniteNumber(activity.targetLow) && isFiniteNumber(activity.targetHigh) ? `, range ${fmtPrice(activity.targetLow)}-${fmtPrice(activity.targetHigh)}` : "";
    const count = isFiniteNumber(activity.numberOfAnalysts) ? `, ${activity.numberOfAnalysts} analysts` : "";
    lines.push(`- price targets: mean ${fmtPrice(activity.targetMean)}${range}${count}`);
  }
  const recent = recentActions(activity, now, ACTION_WINDOW_DAYS).slice(0, MAX_ACTIONS);
  lines.push(
    recent.length > 0
      ? `- actions in the last ${ACTION_WINDOW_DAYS} days, newest first: ${recent.map(actionText).join("; ")}`
      : `- no rating or target actions in the last ${ACTION_WINDOW_DAYS} days`,
  );
  return lines.join("\n");
}
