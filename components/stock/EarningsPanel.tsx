"use client";

import { useMemo } from "react";

import { reportTimeEt } from "@/components/calendar/agenda-format";
import {
  daysUntil,
  estimateTrend,
  figureCurrencies,
  hasUsOptions,
  intoReportNote,
  isNonEquity,
  knownNonEquity,
  relativeWhen,
  shortDay,
  signedPercent,
  upcomingQuarter,
  weekdayDay,
  withinDays,
  type FigureCurrencies,
} from "@/components/calendar/earnings-model";
import { useClock } from "@/components/calendar/use-clock";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { useUi } from "@/components/providers/UiProvider";
import { AiChip, Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { EmptyState, ErrorState, SkeletonRows, StaleBanner } from "@/components/ui/States";
import { StatTile } from "@/components/ui/StatTile";
import { useStock } from "@/hooks/useApi";
import { useEarnings, useImpliedMove } from "@/hooks/useEarningsApi";
import { ApiError } from "@/lib/api-client";
import { formatCompact, formatDate, formatNumber, formatRatio, tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import type { EarningsDetail, EarningsQuarter, ImpliedMove } from "@/types/earnings";

import { earningsTiming, isUsListing } from "./quote-utils";

// Next report, the "Into the report" note, consensus, estimate revisions, the implied move and the reported quarters
// for one symbol (ERN). Laid out in one column at half width and in two columns when its container is wide (the quote
// page's Earnings tab). Surprises are facts about past quarters, drawn in neutral ink.

/** The note appears when the report is this close. */
const NOTE_DAYS = 14;
/** The implied move is requested when the report is this close (the server prices nothing further out). */
const IMPLIED_DAYS = 30;

export function EarningsPanel({ symbol, className }: { symbol: string; className?: string }) {
  const { t } = usePrefs();
  const e = t.earnings;
  // Shares the quote page's request: the trading currency, and the quote type, so funds and indices (which do not
  // report earnings) are not asked for. The app's own funds and index symbols are known before the quote arrives.
  const stock = useStock(symbol);
  const noEarnings = knownNonEquity(symbol) || isNonEquity(stock.data?.quote.quoteType);
  const { data, error, isLoading, mutate } = useEarnings(noEarnings ? null : symbol);
  const now = useClock();
  const { openChat } = useUi();
  const wantsImplied = Boolean(data?.nextDate && now !== null && hasUsOptions(symbol) && withinDays(data.nextDate, now, IMPLIED_DAYS));
  const implied = useImpliedMove(wantsImplied ? symbol : null);

  const trading = stock.data?.quote.currency ?? null;
  const currencies = data ? figureCurrencies(trading, data) : null;

  let body;
  if (data && now !== null && currencies) {
    body = <EarningsBody detail={data} implied={implied.data ?? null} now={now} currencies={currencies} />;
  } else if (noEarnings || (error instanceof ApiError && error.status === 404)) {
    body = <EmptyState>{e.none}</EmptyState>;
  } else if (error && !isLoading) {
    body = <ErrorState error={error} onRetry={() => mutate()} compact />;
  } else {
    body = <SkeletonRows rows={7} />;
  }

  return (
    <Panel
      code="ERN"
      title={e.title}
      className={className}
      bodyClassName="@container"
      actions={currencies?.note ? <CurrencyNote note={currencies.note} trading={trading} /> : null}
      footer={
        data ? (
          <div className="border-t border-line px-2 py-1.5">
            <Button size="sm" variant="ghost" onClick={() => openChat({ text: tpl(e.askText, { symbol }), intent: { kind: "earnings", symbol } })}>
              <AiChip tone="current" />
              {e.ask}
            </Button>
          </div>
        ) : null
      }
    >
      {data && error ? <StaleBanner show since={data.asOf} /> : null}
      {body}
    </Panel>
  );
}

/** "Figures in CNY", or "EPS in USD, revenue in TWD" when the two differ (an ADR such as TSM). */
function CurrencyNote({ note, trading }: { note: NonNullable<FigureCurrencies["note"]>; trading: string | null }) {
  const { t } = usePrefs();
  const e = t.earnings;
  const text = note.kind === "all" ? tpl(e.currency, { currency: note.currency }) : tpl(e.currencySplit, { eps: note.eps, revenue: note.revenue });
  const title =
    trading === null
      ? undefined
      : note.kind === "all"
        ? tpl(e.currencyTitle, { currency: note.currency, trading })
        : tpl(e.currencySplitTitle, { eps: note.eps, revenue: note.revenue, trading });
  return (
    <span title={title}>
      <PanelMeta>{text}</PanelMeta>
    </span>
  );
}

function EarningsBody({ detail, implied, now, currencies }: { detail: EarningsDetail; implied: ImpliedMove | null; now: number; currencies: FigureCurrencies }) {
  const { t, lang } = usePrefs();
  const e = t.earnings;
  const days = daysUntil(detail.nextDate, now);
  const note = detail.nextDate && withinDays(detail.nextDate, now, NOTE_DAYS) ? intoReportNote(detail, implied, now, e, lang, currencies) : [];
  return (
    <div className="grid @3xl:grid-cols-2">
      <div className="min-w-0 @3xl:border-r @3xl:border-line">
        <div className="px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="col-head">{e.nextReport}</h3>
            {days !== null ? <span className="text-micro text-fg-3">{relativeWhen(days, e.when, lang)}</span> : null}
          </div>
          {detail.nextDate ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-base font-medium text-fg">{weekdayDay(detail.nextDate, lang)}</span>
              <span className="text-sm text-fg-2">{slotText(detail, t)}</span>
              {detail.nextDateEstimated ? (
                <span title={e.estTitle}>
                  <Badge>{e.est}</Badge>
                </span>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 text-sm text-fg-2">{e.noDate}</p>
          )}
        </div>

        {note.length > 0 ? (
          <div className="mx-3 mb-3 rounded-xs border border-line bg-panel-2 px-2.5 py-2">
            <h3 className="col-head">{e.intoReport}</h3>
            <p className="mt-1 text-xs leading-5 text-fg-2">{note.join(" ")}</p>
          </div>
        ) : null}

        <Consensus detail={detail} currencies={currencies} />
        <EstimateTrend detail={detail} />
        {implied ? (
          <div className="flex items-start justify-between gap-3 border-t border-line px-3 py-2.5">
            <h3 className="col-head pt-0.5">{e.implied}</h3>
            <p className="text-right" title={tpl(e.impliedTitle, { pct: formatRatio(implied.move, { digits: 1 }), date: shortDay(implied.expiry, lang) })}>
              <span className="num block text-data text-fg">{tpl(e.impliedValue, { pct: formatRatio(implied.move, { digits: 1 }), date: shortDay(implied.expiry, lang) })}</span>
              <span className="block text-micro text-fg-3">{e.impliedNote}</span>
            </p>
          </div>
        ) : null}
      </div>
      <div className="min-w-0 border-t border-line @3xl:border-t-0">
        <History history={detail.history} />
      </div>
    </div>
  );
}

function slotText(detail: EarningsDetail, t: Messages): string {
  if (!detail.nextDate) return t.earnings.slot.tbd;
  // An estimated date keeps the company's usual release session (marked "est." beside it), as the quote header's chip
  // and the calendar say: "Reports Thu Jan 28 · after close · est." over "Thu, Jan 28 · After close · EST.".
  if (detail.nextDateEstimated) {
    const usual = earningsTiming(detail.nextDate, isUsListing(detail.symbol));
    return usual ? t.earnings.slot[usual] : t.earnings.slot.tbd;
  }
  if (detail.nextTiming) return t.earnings.slot[detail.nextTiming];
  return reportTimeEt(detail.symbol, detail.nextDate, t.calendar) ?? t.earnings.slot.tbd;
}

function rangeText(low: number | null, high: number | null, format: (value: number) => string, template: string): string | null {
  return low !== null && high !== null ? tpl(template, { low: format(low), high: format(high) }) : null;
}

/** A tile sub-line split into lines (range, then analysts), so neither is cut off at half width or in Chinese. */
function subLines(lines: ReadonlyArray<string | null>) {
  const shown = lines.filter((line): line is string => line !== null);
  if (shown.length === 0) return undefined;
  return (
    <>
      {shown.map((line) => (
        <span key={line} className="block truncate">
          {line}
        </span>
      ))}
    </>
  );
}

function Consensus({ detail, currencies }: { detail: EarningsDetail; currencies: FigureCurrencies }) {
  const { t, lang } = usePrefs();
  const e = t.earnings;
  const consensus = detail.consensus;
  const eps = (value: number) => formatNumber(value, 2, lang);
  const revenue = (value: number) => formatCompact(value, lang);
  const labelIn = (label: string, currency: string | null) => (currency ? tpl(e.inCurrency, { label, currency }) : label);
  return (
    <div className="border-t border-line">
      <div className="flex items-center justify-between gap-3 px-3 pt-2.5">
        <h3 className="col-head">{e.consensus}</h3>
        {consensus?.periodEnd ? <span className="text-micro text-fg-3">{tpl(e.quarterEnding, { date: formatDate(consensus.periodEnd, lang, "UTC") })}</span> : null}
      </div>
      {consensus && consensus.epsAvg !== null ? (
        <div className="mt-2 grid grid-cols-2 gap-px border-t border-line bg-line">
          <StatTile
            label={labelIn(e.eps, currencies.eps)}
            value={eps(consensus.epsAvg)}
            sub={subLines([rangeText(consensus.epsLow, consensus.epsHigh, eps, e.range), consensus.analysts ? tpl(e.analystCount, { n: consensus.analysts }) : null])}
          />
          <StatTile
            label={labelIn(e.revenue, currencies.revenue)}
            value={consensus.revenueAvg !== null ? revenue(consensus.revenueAvg) : "—"}
            sub={subLines([
              rangeText(consensus.revenueLow, consensus.revenueHigh, revenue, e.range),
              consensus.revenueAnalysts ? tpl(e.analystCount, { n: consensus.revenueAnalysts }) : null,
            ])}
          />
        </div>
      ) : (
        <p className="px-3 pt-1 pb-2.5 text-sm text-fg-2">{e.noConsensus}</p>
      )}
    </div>
  );
}

function EstimateTrend({ detail }: { detail: EarningsDetail }) {
  const { t, lang } = usePrefs();
  const e = t.earnings;
  const quarter = upcomingQuarter(detail);
  if (!quarter) return null;
  const points = estimateTrend(quarter);
  const { up7, down7, up30, down30 } = quarter.revisions;
  const revisions = [
    up7 !== null && down7 !== null ? tpl(e.revisionsLine, { days: 7, up: up7, down: down7 }) : null,
    up30 !== null && down30 !== null ? tpl(e.revisionsLine, { days: 30, up: up30, down: down30 }) : null,
  ].filter((line): line is string => line !== null);
  return (
    <div className="border-t border-line px-3 py-2.5">
      <table className="w-full table-fixed text-data">
        <caption className="sr-only">{e.trend}</caption>
        <thead>
          <tr>
            <th scope="col" className="col-head w-[32%] pb-1 text-left">
              {e.trend}
            </th>
            {points.map((point) => (
              <th key={point.key} scope="col" className="col-head pb-1 text-right">
                {point.key === "now" ? e.trendNow : tpl(e.trendAgo, { n: point.days })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className="truncate text-left text-xs font-normal text-fg-3">
              {e.trendValue}
            </th>
            {points.map((point) => (
              <td key={point.key} className="num text-right text-fg">
                {formatNumber(point.value, 2, lang)}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row" className="truncate text-left text-xs font-normal text-fg-3">
              {e.trendDelta}
            </th>
            {points.map((point) => (
              <td key={point.key} className="num text-right text-xs text-fg-2">
                {point.key === "now" ? "" : signedPercent(point.changeToNow)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {revisions.length > 0 ? (
        <p className="mt-2 text-xs text-fg-2">
          <span className="text-fg-3">{e.revisions}</span> {revisions.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

function SurpriseBar({ value, max }: { value: number | null; max: number }) {
  const width = value === null ? 0 : Math.min(Math.abs(value) / max, 1) * 50;
  return (
    <span aria-hidden className="relative inline-block h-2.5 w-8 shrink-0 align-middle">
      <span className="absolute inset-y-0 left-1/2 w-px bg-line-2" />
      {value !== null && width > 0 ? (
        <span className="absolute inset-y-0.5 bg-fg-3" style={value >= 0 ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }} />
      ) : null}
    </span>
  );
}

function History({ history }: { history: readonly EarningsQuarter[] }) {
  const { t, lang } = usePrefs();
  const e = t.earnings;
  const rows = useMemo(() => [...history].reverse(), [history]);
  const max = Math.max(0.05, ...history.map((q) => Math.abs(q.surprise ?? 0)));
  const columns: Array<DataTableColumn<EarningsQuarter>> = [
    {
      key: "quarter",
      header: e.columns.quarter,
      // The report date follows the quarter, or goes under it while the table is narrower than 24rem (the right-hand
      // column at 1280px, 360px phones): there the column gets 104 to 106px, and "3Q2025 10月30日" needs 127.
      render: (q) => (
        <span className="text-fg @max-sm:block @max-sm:py-0.5" title={q.fiscalPeriod ? tpl(e.fiscal, { period: q.fiscalPeriod }) : undefined}>
          {q.period}
          {q.reportedAt ? <span className="num ml-1.5 text-micro text-fg-3 @max-sm:ml-0 @max-sm:block">{shortDay(q.reportedAt, lang)}</span> : null}
        </span>
      ),
    },
    { key: "actual", header: e.columns.actual, align: "right", width: "4rem", render: (q) => <span className="num text-fg">{formatNumber(q.epsActual, 2, lang)}</span> },
    { key: "estimate", header: e.columns.estimate, align: "right", width: "4.5rem", render: (q) => <span className="num text-fg-2">{formatNumber(q.epsEstimate, 2, lang)}</span> },
    {
      key: "surprise",
      header: e.columns.surprise,
      align: "right",
      width: "7.25rem",
      render: (q) => (
        <span className="inline-flex items-center justify-end gap-1.5">
          <SurpriseBar value={q.surprise} max={max} />
          <span className="num w-[3.25rem] text-right text-fg">{signedPercent(q.surprise)}</span>
        </span>
      ),
    },
  ];
  return (
    <div>
      <h3 className="col-head px-3 pt-2.5 pb-1">{e.history}</h3>
      {/* The table's own box is the query container of the quarter cells (no column hides by container size here). */}
      <DataTable rows={rows} columns={columns} rowKey={(q) => q.periodEnd ?? q.period} caption={e.history} empty={t.calendar.surprises.none} className="@container" />
    </div>
  );
}

