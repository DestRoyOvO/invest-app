"use client";

import { useMemo, useState } from "react";

import {
  formatTarget,
  periodMonth,
  RATING_KEYS,
  RATING_SHADES,
  ratingSegments,
  ratingTotal,
  relativeChange,
  scalePosition,
  signedPercent,
  targetScale,
} from "@/components/calendar/earnings-model";
import { useClock } from "@/components/calendar/use-clock";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { EmptyState, ErrorState, SkeletonRows, StaleBanner } from "@/components/ui/States";
import { TickNumber } from "@/components/ui/TickNumber";
import { useStock } from "@/hooks/useApi";
import { useAnalysts } from "@/hooks/useEarningsApi";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatNumber, formatShortDate, tpl } from "@/lib/format";
import { ratingWord } from "@/lib/i18n/yahoo-terms";
import type { Lang } from "@/types/api";
import type { AnalystAction, AnalystActivity } from "@/types/earnings";

import { requestsCoverage, showsCoverage } from "./quote-utils";

// Rating distribution by month, the price-target range against the price, and recent rating and target actions (ANR).
// Ratings are opinions: one neutral hue (a lighter shade for each step away from "strong buy", RATING_SHADES), no buy or
// sell colors.

const ACTIONS_SHOWN = 8;

type RecommendationKey = "strong_buy" | "buy" | "hold" | "underperform" | "sell" | "none";

export function AnalystsPanel({ symbol, className }: { symbol: string; className?: string }) {
  const { t } = usePrefs();
  const a = t.earnings.analysts;
  // Shares the quote page's request: the live price for the target marker, and the quote type, so funds and indices
  // (which have no analyst coverage) are not asked for. A symbol outside the app's lists waits for that type
  // (requestsCoverage).
  const stock = useStock(symbol);
  const quote = stock.data?.quote;
  const noCoverage = !showsCoverage(symbol, quote?.quoteType);
  const { data, error, isLoading, mutate } = useAnalysts(requestsCoverage(symbol, quote) ? symbol : null);
  const now = useClock();
  const price = quote?.price ?? data?.currentPrice ?? null;

  let body;
  if (data && now !== null) body = <AnalystsBody activity={data} price={price} now={now} />;
  else if (noCoverage || (error instanceof ApiError && error.status === 404)) body = <EmptyState>{a.none}</EmptyState>;
  else if (error && !isLoading) body = <ErrorState error={error} onRetry={() => mutate()} compact />;
  else body = <SkeletonRows rows={7} />;

  return (
    <Panel
      code="ANR"
      title={a.title}
      className={className}
      bodyClassName="@container"
      actions={data?.numberOfAnalysts ? <PanelMeta>{tpl(a.analysts, { n: data.numberOfAnalysts })}</PanelMeta> : null}
      footer={data ? <p className="border-t border-line px-3 py-2 text-micro text-fg-3">{a.disclaimer}</p> : null}
    >
      {data && error ? <StaleBanner show since={data.asOf} /> : null}
      {body}
    </Panel>
  );
}

function AnalystsBody({ activity, price, now }: { activity: AnalystActivity; price: number | null; now: number }) {
  return (
    <div className="grid @3xl:grid-cols-2">
      <div className="min-w-0 @3xl:border-r @3xl:border-line">
        <Ratings activity={activity} now={now} />
        <Targets activity={activity} price={price} />
      </div>
      <div className="min-w-0 border-t border-line @3xl:border-t-0">
        <Actions actions={activity.actions} />
      </div>
    </div>
  );
}

function Ratings({ activity, now }: { activity: AnalystActivity; now: number }) {
  const { t, lang } = usePrefs();
  const a = t.earnings.analysts;
  const rows = activity.trend.filter((row) => ratingTotal(row) > 0);
  const recommendationKey = (activity.recommendationKey ?? "none") as RecommendationKey;
  const meanLabel = t.stock.recommendation[recommendationKey] ?? activity.recommendationKey ?? "";
  if (rows.length === 0) return null;
  const current = rows[0];
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="col-head">{a.ratings}</h3>
        {activity.recommendationMean !== null && activity.recommendationMean !== undefined ? (
          <span className="text-micro text-fg-3">{tpl(a.mean, { value: formatNumber(activity.recommendationMean, 2, lang), label: meanLabel })}</span>
        ) : null}
      </div>
      <ul className="mt-2 space-y-1.5">
        {rows.map((row) => {
          const month = periodMonth(row.period, now, lang);
          const segments = ratingSegments(row);
          const list = segments.map((s) => tpl(a.count, { n: s.count, label: a.rating[s.key] })).join(", ");
          return (
            <li key={row.period} className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.25rem] items-center gap-2">
              <span className="text-micro text-fg-3">{month}</span>
              <span role="img" aria-label={tpl(a.monthLabel, { month, list })} className="flex h-3 gap-px overflow-hidden rounded-xs">
                {segments
                  .filter((s) => s.count > 0)
                  .map((s) => (
                    <span key={s.key} className={cn("h-full", RATING_SHADES[s.key])} style={{ width: `${s.share * 100}%` }} />
                  ))}
              </span>
              <span className="num text-right text-micro text-fg-2">{ratingTotal(row)}</span>
            </li>
          );
        })}
      </ul>
      <ul aria-label={a.ratings} className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
        {RATING_KEYS.map((key) => (
          <li key={key} className="inline-flex items-center gap-1.5 text-micro text-fg-2">
            <span aria-hidden className={cn("size-2.5 rounded-xs", RATING_SHADES[key])} />
            {a.rating[key]}
            <span className="num text-fg">{current[key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Targets({ activity, price }: { activity: AnalystActivity; price: number | null }) {
  const { t, lang } = usePrefs();
  const a = t.earnings.analysts;
  const { targetLow: low, targetHigh: high, targetMean: mean } = activity;
  const scale = targetScale(low, high, price);
  if (!scale || low === null || high === null) return null;
  const gap = mean !== null && price ? relativeChange(mean, price) : null;
  const label = tpl(a.targetLabel, { low: formatTarget(low, lang), high: formatTarget(high, lang), mean: formatTarget(mean, lang), price: formatTarget(price, lang) });
  const pricePos = price !== null && price > 0 ? scalePosition(scale, price) : null;
  return (
    <div className="border-t border-line px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="col-head">{a.targets}</h3>
        {gap !== null ? <span className="text-micro text-fg-3">{tpl(a.vsPrice, { pct: signedPercent(gap) })}</span> : null}
      </div>
      <div role="img" aria-label={label} className="relative mt-6 mb-1 h-3">
        <span aria-hidden className="absolute top-1/2 h-1 -translate-y-1/2 bg-line-2" style={{ left: `${scalePosition(scale, low)}%`, right: `${100 - scalePosition(scale, high)}%` }} />
        <span aria-hidden className="absolute top-1/2 h-1 w-px -translate-y-1/2 bg-fg-3" style={{ left: `${scalePosition(scale, low)}%` }} />
        <span aria-hidden className="absolute top-1/2 h-1 w-px -translate-y-1/2 bg-fg-3" style={{ left: `${scalePosition(scale, high)}%` }} />
        {mean !== null ? <span aria-hidden className="absolute top-0 h-3 w-0.5 -translate-x-1/2 bg-fg" style={{ left: `${scalePosition(scale, mean)}%` }} /> : null}
        {pricePos !== null ? (
          <span aria-hidden className="absolute -top-5 flex -translate-x-1/2 flex-col items-center" style={{ left: `${pricePos}%` }}>
            <span className="num rounded-xs bg-panel px-0.5 text-micro leading-4 text-accent">
              <TickNumber value={price}>{formatTarget(price, lang)}</TickNumber>
            </span>
            <span className="h-4 w-0.5 bg-accent" />
          </span>
        ) : null}
      </div>
      <dl className="grid grid-cols-3 gap-2 text-micro">
        <div>
          <dt className="text-fg-3">{a.low}</dt>
          <dd className="num text-data text-fg">{formatTarget(low, lang)}</dd>
        </div>
        <div className="text-center">
          <dt className="text-fg-3">{a.meanTarget}</dt>
          <dd className="num text-data text-fg">{formatTarget(mean, lang)}</dd>
        </div>
        <div className="text-right">
          <dt className="text-fg-3">{a.high}</dt>
          <dd className="num text-data text-fg">{formatTarget(high, lang)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** The rating change in the reader's language: "Neutral → Buy" (中性 → 买入), "Init. Buy", or the rating alone. */
function gradeText(action: AnalystAction, initShort: string, lang: Lang): string {
  const to = action.toGrade ? ratingWord(action.toGrade, lang) : "—";
  if (action.fromGrade && action.toGrade && action.fromGrade !== action.toGrade) return `${ratingWord(action.fromGrade, lang)} → ${to}`;
  if (action.action === "init") return `${initShort} ${to}`;
  return to;
}

function targetText(action: AnalystAction, lang: "en" | "zh"): string {
  const { priorTarget: prior, currentTarget: current } = action;
  if (current === null) return "—";
  if (prior !== null && prior !== current) return `${formatTarget(prior, lang, true)} → ${formatTarget(current, lang, true)}`;
  return formatTarget(current, lang, true);
}

function Actions({ actions }: { actions: readonly AnalystAction[] }) {
  const { t, lang } = usePrefs();
  const a = t.earnings.analysts;
  const [all, setAll] = useState(false);
  const rows = useMemo(() => (all ? actions : actions.slice(0, ACTIONS_SHOWN)), [actions, all]);
  const actionLabels = a.action as Record<string, string>;
  const columns: Array<DataTableColumn<AnalystAction>> = [
    // "10月15日" needs more room than "Oct 15". In a box narrower than 28rem (the right-hand column at xl, phones) the
    // date moves under the firm, so the firm keeps room for its name.
    {
      key: "date",
      header: a.columns.date,
      width: lang === "zh" ? "5.75rem" : "4.5rem",
      hideBelowContainer: "md",
      render: (row) => <span className="num text-fg-2">{formatShortDate(row.date, lang, "America/New_York")}</span>,
    },
    {
      key: "firm",
      header: a.columns.firm,
      render: (row) => (
        <span className="block py-0.5 @md:py-0">
          <span className="block truncate text-fg" title={row.firm}>
            {row.firm}
          </span>
          <span className="num block text-micro text-fg-3 @md:hidden">{formatShortDate(row.date, lang, "America/New_York")}</span>
        </span>
      ),
    },
    {
      key: "rating",
      header: a.columns.rating,
      width: "8.25rem",
      render: (row) => {
        const grade = gradeText(row, a.initShort, lang);
        const action = row.action ? (actionLabels[row.action] ?? row.action) : null;
        return (
          <span className="text-fg-2" title={action ? tpl(a.actionGrade, { action, grade }) : grade}>
            {grade}
          </span>
        );
      },
    },
    { key: "target", header: a.columns.target, align: "right", width: "6rem", render: (row) => <span className="num text-fg">{targetText(row, lang)}</span> },
  ];
  return (
    <div>
      <h3 className="col-head px-3 pt-2.5 pb-1">{a.actions}</h3>
      <DataTable rows={rows} columns={columns} rowKey={(row) => `${row.date}:${row.firm}`} caption={a.actions} empty={a.noActions} />
      {actions.length > ACTIONS_SHOWN ? (
        <div className="border-t border-line px-2 py-1.5">
          <Button size="sm" variant="ghost" aria-expanded={all} onClick={() => setAll((value) => !value)}>
            {all ? a.showLess : tpl(a.showAll, { n: actions.length })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
