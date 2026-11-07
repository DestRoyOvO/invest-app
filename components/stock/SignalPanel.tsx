"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { backtestTiming, isConcentrated, rateDomain, rsiState, scoreText, selectionTone, symmetricDomain } from "@/components/lab/evidence";
import { formatIc, formatP, formatT, pct, yearSpan } from "@/components/lab/stats-format";
import { usePrefs } from "@/components/providers/PrefsProvider";
import { Badge } from "@/components/ui/Badge";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Tooltip } from "@/components/ui/HoverCard";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { EmptyState, ErrorState, SkeletonRows, StaleBanner } from "@/components/ui/States";
import { Whisker } from "@/components/ui/Whisker";
import { cn } from "@/lib/cn";
import { evaluationVerdict, findHorizon, type HorizonOutcome, type LabelOutcome } from "@/lib/evaluation";
import { EVALUATION_DAYS, SIGNAL_EVALUATION } from "@/lib/evaluation-data";
import { DASH, formatInteger, formatMultiple, formatShortDate, tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import { labelForScore, SIGNAL_THRESHOLDS } from "@/lib/signal";
import type { BacktestResult, FactorResult, Lang, SignalCode, SignalReport } from "@/types/api";

// The technical reading of one stock: short-term relative strength, drawn in neutral ink because the universe
// evaluation (lib/signal-evaluation.json) found that it describes the setup without predicting returns. The evidence
// (track record, holdout, per-stock backtest with its permutation test) sits in a collapsed section below.

const TICKS = [SIGNAL_THRESHOLDS.strongBearish, SIGNAL_THRESHOLDS.bearish, SIGNAL_THRESHOLDS.bullish, SIGNAL_THRESHOLDS.strongBullish];

function formatRaw(factor: FactorResult): string {
  if (factor.raw === null) return DASH;
  if (factor.rawUnit === "percent") return pct(factor.raw, 1, factor.key === "momentum" || factor.key === "trend");
  if (factor.rawUnit === "multiple") return formatMultiple(factor.raw, factor.key === "volume" ? 2 : 1);
  return factor.raw.toFixed(1);
}

/** Neutral 0-100 track with the four reading cut-offs as ticks and an accent marker at the score. */
function ScoreGauge({ score, label, valueText, weak, strong }: { score: number; label: string; valueText: string; weak: string; strong: string }) {
  const x = Math.min(Math.max(score, 0), 100);
  return (
    <div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(x)}
        aria-valuetext={valueText}
        className="relative h-2 w-full bg-line-2"
      >
        {TICKS.map((tick) => (
          <span key={tick} aria-hidden className="absolute inset-y-0 w-px bg-panel" style={{ left: `${tick}%` }} />
        ))}
        <span aria-hidden className="absolute -inset-y-1 w-0.5 -translate-x-1/2 bg-accent" style={{ left: `${x}%` }} />
      </div>
      <div aria-hidden className="mt-1.5 flex justify-between text-micro text-fg-3">
        <span>{weak}</span>
        <span>{strong}</span>
      </div>
    </div>
  );
}

/** An input of the reading: its raw value and its 0-100 score as a neutral bar from the midline. */
function InputRow({ factor, t }: { factor: FactorResult; t: Messages }) {
  const offset = factor.score - 50;
  const width = `${(Math.min(Math.abs(offset), 50) / 50) * 50}%`;
  const state = factor.key === "rsi" && !factor.imputed ? rsiState(factor.raw) : null;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_minmax(4.5rem,7rem)_1.75rem] items-center gap-3 py-1.5">
      <div className="min-w-0">
        <div className="truncate text-xs text-fg-2">{t.signal.factors[factor.key]}</div>
        <div className="num truncate text-xs text-fg-3">
          {factor.imputed ? (
            t.signal.imputed
          ) : (
            <>
              {t.signal.rawLabels[factor.key]} <span className="text-fg-2">{formatRaw(factor)}</span>
              {state ? <span> · {t.signal.rsiState[state]}</span> : null}
            </>
          )}
        </div>
      </div>
      <div aria-hidden className="relative h-1.5 bg-line">
        <span className="absolute -inset-y-0.5 left-1/2 w-px bg-line-2" />
        {!factor.imputed ? <span className={cn("absolute inset-y-0 bg-fg-3", offset >= 0 ? "left-1/2" : "right-1/2")} style={{ width }} /> : null}
      </div>
      <div className={cn("num text-right text-xs", factor.imputed ? "text-fg-3" : "text-fg")}>{factor.imputed ? DASH : Math.round(factor.score)}</div>
    </li>
  );
}

/** Valuation, quality and the zero-weight volatility regime: shown for context, not part of the reading. */
function ContextRow({ factor, t }: { factor: FactorResult; t: Messages }) {
  const riskOnly = factor.group === "technical" && factor.weight === 0;
  let value;
  if (factor.imputed) value = t.signal.imputed;
  // A non-imputed valuation without a P/E means negative earnings.
  else if (factor.key === "value" && factor.raw === null) value = <span className="text-fg-2">{t.signal.lossMaking}</span>;
  else
    value = (
      <>
        {t.signal.rawLabels[factor.key]} <span className="text-fg-2">{formatRaw(factor)}</span>
      </>
    );
  return (
    <li className="flex min-h-9 items-center justify-between gap-3 py-1.5 text-xs">
      <span className="min-w-0 truncate text-fg-2">{t.signal.factors[factor.key]}</span>
      <span className="num flex shrink-0 items-center gap-2 text-fg-3">
        <span>{value}</span>
        {riskOnly ? <Badge>{t.signal.riskOnly}</Badge> : null}
      </span>
    </li>
  );
}

function SelectionCell({ row, tone, domain, t }: { row: LabelOutcome; tone: "up" | "down" | "neutral"; domain: [number, number]; t: Messages }) {
  const tr = t.signal.track;
  const interval = row.ci.selection;
  const raw = tpl(tr.rawExcess, {
    value: pct(row.excess, 2, true),
    lo: pct(row.ci.excess?.[0], 2, true),
    hi: pct(row.ci.excess?.[1], 2, true),
    timing: pct(row.timing, 2, true),
  });
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <Tooltip label={raw}>
        <button
          type="button"
          className={cn("num rounded-xs focus-visible:outline-offset-[-2px]", tone === "up" ? "text-up" : tone === "down" ? "text-down" : undefined)}
        >
          {pct(row.selection, 2, true)}
        </button>
      </Tooltip>
      <Whisker
        estimate={row.selection}
        low={interval?.[0]}
        high={interval?.[1]}
        base={0}
        min={domain[0]}
        max={domain[1]}
        label={tpl(tr.whisker, { reading: t.signal.codes[row.code], value: pct(row.selection, 2, true), lo: pct(interval?.[0], 2, true), hi: pct(interval?.[1], 2, true) })}
        className="hidden sm:inline-block"
      />
    </span>
  );
}

/** What followed each reading across the universe, the current reading marked. */
function TrackRecord({ horizon, code, t, lang }: { horizon: HorizonOutcome; code: SignalCode; t: Messages; lang: Lang }) {
  const tr = t.signal.track;
  const totalDates = horizon.ic.dates;
  const domain = symmetricDomain(horizon.labels.map((label) => label.ci.selection));
  const columns: DataTableColumn<LabelOutcome>[] = [
    {
      key: "reading",
      header: tr.reading,
      render: (row) => {
        const current = row.code === code;
        return (
          <span className="inline-flex items-center gap-1.5">
            {current ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
            <span className={current ? "text-fg" : undefined}>{t.signal.codes[row.code]}</span>
            {current ? <span className="sr-only"> ({tr.current})</span> : null}
          </span>
        );
      },
    },
    { key: "n", header: tr.sessions, align: "right", width: "5.25rem", hideBelow: "sm", render: (row) => <span className="num">{formatInteger(row.n, lang)}</span> },
    {
      key: "selection",
      header: tr.vsUniverse,
      align: "right",
      width: "10rem",
      render: (row) => <SelectionCell row={row} tone={selectionTone(row, totalDates)} domain={domain} t={t} />,
    },
    { key: "beat", header: tr.beatMedian, align: "right", width: "6rem", render: (row) => <span className="num">{pct(row.beatMedian, 0)}</span> },
    {
      key: "episodes",
      header: tr.episodes,
      align: "right",
      width: "5.5rem",
      hideBelow: "sm",
      render: (row) => <span className="num">{tpl(tr.episodeCell, { n: formatInteger(row.episodes, lang), share: pct(row.largestEpisodeShare, 0) })}</span>,
    },
  ];
  return (
    <DataTable
      rows={horizon.labels}
      columns={columns}
      rowKey={(row) => row.code}
      caption={tpl(tr.caption, { n: SIGNAL_EVALUATION.universe, days: horizon.days })}
      rowClassName={(row) => cn(row.code === code && "bg-panel-2", isConcentrated(row, totalDates) ? "text-fg-3" : "text-fg-2")}
    />
  );
}

function Backtest({ results, costBps, t, lang }: { results: BacktestResult[]; costBps: number; t: Messages; lang: Lang }) {
  const b = t.signal.backtest;
  const domain = rateDomain(results.flatMap((r) => [r.winRate, r.winRateCI?.[0], r.winRateCI?.[1], r.baselineWinRate]));
  const returnCell = (value: number | null, row: BacktestResult) => {
    const colored = backtestTiming(row) === "unlikely" && value !== null && value !== 0;
    return <span className={cn("num", colored ? (value > 0 ? "text-up" : "text-down") : "text-fg-3")}>{pct(value, 2, true)}</span>;
  };
  const columns: DataTableColumn<BacktestResult>[] = [
    {
      key: "hold",
      header: b.cols.hold,
      width: "3.5rem",
      render: (r) => (
        <span className="num text-fg-2">{tpl(b.hold, { n: r.holdDays })}</span>
      ),
    },
    { key: "trades", header: b.cols.trades, align: "right", width: "4rem", render: (r) => <span className="num text-fg-2">{formatInteger(r.trades, lang)}</span> },
    { key: "win", header: b.cols.winRate, align: "right", width: "4.5rem", render: (r) => <span className="num text-fg-2">{pct(r.winRate, 0)}</span> },
    {
      key: "winRange",
      header: <span className="sr-only">{b.cols.range}</span>,
      width: "6rem",
      hideBelow: "sm",
      render: (r) => (
        <Whisker
          estimate={r.winRate}
          low={r.winRateCI?.[0]}
          high={r.winRateCI?.[1]}
          base={r.baselineWinRate}
          min={domain[0]}
          max={domain[1]}
          label={tpl(b.winWhisker, { rate: pct(r.winRate, 0), lo: pct(r.winRateCI?.[0], 0), hi: pct(r.winRateCI?.[1], 0), base: pct(r.baselineWinRate, 0) })}
        />
      ),
    },
    { key: "avg", header: b.cols.avgReturn, align: "right", width: "5.5rem", hideBelow: "sm", render: (r) => returnCell(r.avgReturn, r) },
    {
      key: "baseline",
      header: b.cols.baseline,
      align: "right",
      width: "5.5rem",
      hideBelow: "md",
      render: (r) => <span className="num text-fg-3">{pct(r.baselineAvgReturn, 2, true)}</span>,
    },
    { key: "edge", header: b.cols.edge, align: "right", width: "5.5rem", render: (r) => returnCell(r.edge, r) },
    { key: "p", header: b.cols.p, align: "right", width: "4rem", render: (r) => <span className="num text-fg-2">{formatP(r.pValue)}</span> },
  ];
  return (
    <div className="border-t border-line">
      <h3 className="col-head px-3 pt-2.5 pb-1">{b.title}</h3>
      <DataTable rows={results} columns={columns} rowKey={(r) => String(r.holdDays)} caption={b.caption} />
      <ul className="space-y-0.5 px-3 pt-2 text-xs text-fg-2">
        {results.map((r) => (
          <li key={r.holdDays} className="num">
            {tpl(b.timing[backtestTiming(r)], { hold: tpl(b.hold, { n: r.holdDays }), p: formatP(r.pValue), n: r.trades })}
          </li>
        ))}
      </ul>
      <div className="space-y-1 px-3 pt-1.5 pb-2.5 text-xs text-fg-3">
        <p>{tpl(b.note, { n: results[0]?.windowDays ?? 0, bps: costBps })}</p>
        <p>{tpl(b.chance, { n: SIGNAL_EVALUATION.universe })}</p>
      </div>
    </div>
  );
}

function Evidence({ report, code, t, lang }: { report: SignalReport; code: SignalCode; t: Messages; lang: Lang }) {
  const evaluation = SIGNAL_EVALUATION;
  const horizon = findHorizon(evaluation, EVALUATION_DAYS);
  const tr = t.signal.track;
  const holdout = evaluation.holdout;
  const passed = holdout.factors.filter((f) => f.pass).length;
  const verdict = horizon ? evaluationVerdict(horizon) : null;
  return (
    <details className="group border-t border-line">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-xs font-medium text-fg-2 select-none hover:text-fg max-sm:min-h-10 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-3.5 shrink-0 transition-transform group-open:rotate-90" strokeWidth={2} />
        <span className="min-w-0 flex-1">{t.signal.evidence}</span>
        {verdict ? <Badge tone={verdict === "predictive" ? "info" : "warn"}>{tr.verdict[verdict]}</Badge> : null}
      </summary>
      {horizon ? (
        <div className="border-t border-line">
          <h3 className="col-head px-3 pt-2.5 pb-1">{tpl(tr.title, { n: evaluation.universe, days: horizon.days })}</h3>
          <TrackRecord horizon={horizon} code={code} t={t} lang={lang} />
          <div className="space-y-1 px-3 py-2 text-xs text-fg-3">
            <p>{tpl(tr.foot, { days: horizon.days, n: evaluation.universe, from: evaluation.from, to: evaluation.to })}</p>
            <p>{tr.colors}</p>
            <p className="text-fg-2">
              {tpl(tr.holdout, {
                years: yearSpan(holdout.period.from, holdout.period.to),
                ic: formatIc(holdout.composite.mean),
                lo: formatIc(holdout.composite.ci?.[0]),
                hi: formatIc(holdout.composite.ci?.[1]),
                t: formatT(holdout.composite.t),
                result: holdout.composite.pass ? tr.holdoutPass : tr.holdoutFail,
                factors: tpl(tr.holdoutFactors, { passed, total: holdout.factors.length }),
              })}
            </p>
            {horizon.ic.fragile && horizon.ic.phaseT ? (
              <p className="text-warn">{tpl(tr.fragile, { lo: formatT(horizon.ic.phaseT[0]), hi: formatT(horizon.ic.phaseT[1]) })}</p>
            ) : null}
          </div>
        </div>
      ) : null}
      {report.backtest && report.backtest.results.length > 0 ? (
        <Backtest results={report.backtest.results} costBps={report.backtest.costBps} t={t} lang={lang} />
      ) : null}
    </details>
  );
}

interface SignalPanelProps {
  report: SignalReport | undefined;
  error: unknown;
  onRetry: () => void;
  className?: string;
  /** Section id, e.g. for an in-page anchor. */
  id?: string;
}

export function SignalPanel({ report, error, onRetry, className, id }: SignalPanelProps) {
  const { t, lang } = usePrefs();
  const title = t.signal.title;

  if (!report) {
    return (
      <Panel title={title} code="SIG" className={className} id={id}>
        {error ? <ErrorState error={error} onRetry={onRetry} /> : <SkeletonRows rows={9} />}
      </Panel>
    );
  }

  const score = report.technicalScore;
  if (report.status !== "ok" || score === null) {
    return (
      <Panel title={title} code="SIG" className={className} id={id}>
        <EmptyState>{t.signal.insufficient}</EmptyState>
      </Panel>
    );
  }

  const code = labelForScore(score);
  const reading = t.signal.codes[code];
  const shown = scoreText(score);
  const evaluation = SIGNAL_EVALUATION;
  const horizon = findHorizon(evaluation, EVALUATION_DAYS);
  const verdict = horizon ? evaluationVerdict(horizon) : null;
  const inputs = report.factors.filter((f) => f.group === "technical" && f.weight > 0);
  const context = report.factors.filter((f) => !(f.group === "technical" && f.weight > 0));
  const closeDate = report.meta.lastBarDate ? formatShortDate(report.meta.lastBarDate, lang, "UTC") : null;

  return (
    <Panel
      title={title}
      code="SIG"
      actions={closeDate ? <PanelMeta>{tpl(t.signal.asOf, { date: closeDate })}</PanelMeta> : null}
      className={className}
      id={id}
    >
      <StaleBanner show={Boolean(error)} since={report.asOf} />
      <div className="space-y-3 border-b border-line px-3 pt-3 pb-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-sm text-fg-2">{t.signal.headline}</span>
          <span className="num text-figure text-fg">
            {shown}
            <span className="text-sm text-fg-3">{t.signal.outOf}</span>
          </span>
          <span aria-hidden className="text-fg-3">
            ·
          </span>
          <Badge className="self-center">{reading}</Badge>
        </div>
        <ScoreGauge
          score={score}
          label={t.signal.headline}
          valueText={tpl(t.signal.gauge, { score: shown, reading })}
          weak={t.signal.weak}
          strong={t.signal.strong}
        />
        {horizon && verdict ? (
          <p className="text-xs leading-5 text-fg-2">
            {tpl(t.signal.verdict[verdict], {
              n: evaluation.universe,
              years: yearSpan(evaluation.period.from, evaluation.period.to),
              days: horizon.days,
              ic: formatIc(horizon.ic.mean),
              t: formatT(horizon.ic.t),
            })}{" "}
            <Link href="/lab#method" className="whitespace-nowrap text-info underline decoration-info/50 underline-offset-2 hover:decoration-info">
              {t.signal.howItWorks}
            </Link>
          </p>
        ) : null}
      </div>

      <div className="grid gap-px bg-line md:grid-cols-2 [&>*]:bg-panel">
        <div className="px-3 py-2">
          <h3 className="col-head mb-0.5">{t.signal.inputs}</h3>
          <ul>
            {inputs.map((f) => (
              <InputRow key={f.key} factor={f} t={t} />
            ))}
          </ul>
        </div>
        <div className="px-3 py-2">
          <h3 className="col-head mb-0.5">{t.signal.context}</h3>
          <ul>
            {context.map((f) => (
              <ContextRow key={f.key} factor={f} t={t} />
            ))}
          </ul>
        </div>
      </div>

      <Evidence report={report} code={code} t={t} lang={lang} />

      <div className="space-y-1 border-t border-line px-3 py-2 text-xs text-fg-3">
        {report.meta.droppedPartialBar ? <p>{t.signal.partialBar}</p> : null}
        <p>{t.signal.disclaimer}</p>
      </div>
    </Panel>
  );
}
