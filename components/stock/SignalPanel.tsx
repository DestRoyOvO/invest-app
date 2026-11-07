"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Badge } from "@/components/ui/Badge";
import { Delta } from "@/components/ui/Delta";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { ErrorState, SkeletonRows } from "@/components/ui/States";
import { cn } from "@/lib/cn";
import { evaluationVerdict, excludesZero, findHorizon } from "@/lib/evaluation";
import { EVALUATION_DAYS, SIGNAL_EVALUATION } from "@/lib/evaluation-data";
import { formatMultiple, formatNumber, formatRatio, tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import { labelForScore } from "@/lib/signal";
import type { BacktestResult, FactorResult, Lang, SignalCode, SignalReport } from "@/types/api";

const THRESHOLDS = [28, 42, 58, 72];

function codeTone(code: SignalCode | null): "up" | "down" | "neutral" {
  if (code === "bullish" || code === "strong_bullish") return "up";
  if (code === "bearish" || code === "strong_bearish") return "down";
  return "neutral";
}

function formatRaw(factor: FactorResult): string {
  if (factor.raw === null) return "—";
  if (factor.rawUnit === "percent") return formatRatio(factor.raw, { digits: 1, sign: factor.key === "momentum" || factor.key === "trend" });
  if (factor.rawUnit === "multiple") return formatMultiple(factor.raw, factor.key === "volume" ? 2 : 1);
  return factor.raw.toFixed(1);
}

function ScoreGauge({ score }: { score: number }) {
  return (
    <div className="relative h-2 w-full" aria-hidden>
      <div className="absolute inset-0 flex">
        <span className="h-full bg-down/35" style={{ width: "28%" }} />
        <span className="h-full bg-down/15" style={{ width: "14%" }} />
        <span className="h-full bg-line-2" style={{ width: "16%" }} />
        <span className="h-full bg-up/15" style={{ width: "14%" }} />
        <span className="h-full bg-up/35" style={{ width: "28%" }} />
      </div>
      {THRESHOLDS.map((x) => (
        <span key={x} className="absolute inset-y-0 w-px bg-panel" style={{ left: `${x}%` }} />
      ))}
      <span className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 bg-fg" style={{ left: `${Math.min(Math.max(score, 0), 100)}%` }} />
    </div>
  );
}

function FactorRow({ factor, t }: { factor: FactorResult; t: Messages }) {
  const offset = factor.score - 50;
  const width = `${(Math.min(Math.abs(offset), 50) / 50) * 50}%`;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_2rem] items-center gap-3 py-1.5 text-xs">
      <div className="min-w-0">
        <div className="truncate text-fg-2">{t.signal.factors[factor.key]}</div>
        <div className="num truncate text-fg-3">
          {factor.imputed ? (
            t.signal.imputed
          ) : factor.key === "value" && factor.raw === null ? (
            // A non-imputed valuation without a P/E means negative earnings.
            <span className="text-fg-2">{t.signal.lossMaking}</span>
          ) : (
            <>
              {t.signal.rawLabels[factor.key]} <span className="text-fg-2">{formatRaw(factor)}</span>
            </>
          )}
        </div>
      </div>
      <div aria-hidden className="relative h-2">
        <span className="absolute inset-y-0 left-1/2 w-px bg-line-2" />
        {!factor.imputed ? (
          <span className={cn("absolute inset-y-0", offset >= 0 ? "left-1/2 bg-up/70" : "right-1/2 bg-down/70")} style={{ width }} />
        ) : null}
      </div>
      <div className={cn("num text-right", factor.imputed ? "text-fg-3" : "text-fg")}>{factor.imputed ? "—" : Math.round(factor.score)}</div>
    </div>
  );
}

function BacktestTable({ results, t }: { results: BacktestResult[]; t: Messages }) {
  const c = t.signal.cols;
  return (
    <table className="w-full border-collapse text-data">
      <thead>
        <tr className="border-b border-line">
          <th scope="col" className="col-head h-7 px-3 text-left" />
          <th scope="col" className="col-head h-7 px-2 text-right">{c.trades}</th>
          <th scope="col" className="col-head h-7 px-2 text-right">{c.winRate}</th>
          <th scope="col" className="col-head h-7 px-2 text-right">{c.avgReturn}</th>
          <th scope="col" className="col-head hidden h-7 px-2 text-right sm:table-cell">{c.baseline}</th>
          <th scope="col" className="col-head h-7 px-2 text-right">{c.edge}</th>
          <th scope="col" className="col-head hidden h-7 px-2 text-right md:table-cell">{c.sharpe}</th>
          <th scope="col" className="col-head hidden h-7 px-3 text-right md:table-cell">{c.maxDD}</th>
        </tr>
      </thead>
      <tbody>
        {results.map((r) => (
          <tr key={r.holdDays} className={cn("border-b border-line/60 last:border-b-0", r.lowSample && "text-fg-3")}>
            <th scope="row" className="num h-8 px-3 text-left font-normal text-fg-2">
              {tpl(t.signal.hold, { n: r.holdDays })}
              {r.lowSample ? <span title={t.signal.lowSample}>*</span> : null}
            </th>
            <td className="num px-2 text-right">{r.trades}</td>
            <td className="num px-2 text-right" title={r.winRateCI ? `95% CI ${formatRatio(r.winRateCI[0], { digits: 0 })}–${formatRatio(r.winRateCI[1], { digits: 0 })}` : undefined}>
              {formatRatio(r.winRate, { digits: 0 })}
              {r.winRateCI ? (
                <span className="ml-1 hidden text-xs text-fg-3 lg:inline">
                  {Math.round(r.winRateCI[0] * 100)}–{Math.round(r.winRateCI[1] * 100)}
                </span>
              ) : null}
            </td>
            <td className="px-2 text-right">{r.lowSample ? <span className="num">{formatRatio(r.avgReturn, { digits: 2, sign: true })}</span> : <Delta value={r.avgReturn} kind="ratio" />}</td>
            <td className="num hidden px-2 text-right text-fg-3 sm:table-cell">{formatRatio(r.baselineAvgReturn, { digits: 2, sign: true })}</td>
            <td className="px-2 text-right">{r.lowSample ? <span className="num">{formatRatio(r.edge, { digits: 2, sign: true })}</span> : <Delta value={r.edge} kind="ratio" />}</td>
            <td className="num hidden px-2 text-right md:table-cell">{formatNumber(r.sharpe, 2)}</td>
            <td className="num hidden px-3 text-right md:table-cell">{formatRatio(r.maxDrawdown, { digits: 1 })}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The universe evaluation measures the technical-only score, so the highlighted row is this stock's technical reading. */
function TrackRecord({ technicalScore, t, lang }: { technicalScore: number | null; t: Messages; lang: Lang }) {
  const evaluation = SIGNAL_EVALUATION;
  const horizon = findHorizon(evaluation, EVALUATION_DAYS);
  if (!horizon) return null;
  const verdict = evaluationVerdict(horizon);
  const tr = t.signal.track;
  const code: SignalCode | null = technicalScore === null ? null : labelForScore(technicalScore);
  return (
    <div className="border-t border-line">
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1.5">
        <h3 className="label">{tpl(tr.title, { n: evaluation.universe, days: horizon.days })}</h3>
        <Badge tone={verdict === "predictive" ? "info" : "warn"}>{tr.verdict[verdict]}</Badge>
      </div>
      <table className="w-full border-collapse text-data">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="col-head h-7 px-3 text-left">{tr.reading}</th>
            <th scope="col" className="col-head h-7 px-2 text-right">{tr.sessions}</th>
            <th scope="col" className="col-head h-7 px-2 text-right">{tr.excess}</th>
            <th scope="col" className="col-head h-7 px-3 text-right">{tr.upRate}</th>
          </tr>
        </thead>
        <tbody>
          {horizon.labels.map((row) => {
            const current = row.code === code;
            return (
              <tr key={row.code} className={cn("border-b border-line/60 last:border-b-0", current && "bg-panel-2")}>
                <th scope="row" className={cn("h-7 px-3 text-left font-normal", current ? "text-fg" : "text-fg-2")}>
                  {current ? <span aria-hidden className="mr-1.5 inline-block size-1.5 rounded-full bg-accent align-middle" /> : null}
                  {t.signal.codes[row.code]}
                  {current ? <span className="sr-only"> ({tr.current})</span> : null}
                </th>
                <td className="num px-2 text-right text-fg-2">{formatNumber(row.n, 0, lang)}</td>
                <td className="px-2 text-right">
                  {/* Return against the same-day universe (market moves removed), coloured only when its interval excludes 0. */}
                  {excludesZero(row.ci.selection) ? (
                    <Delta value={row.selection} kind="ratio" />
                  ) : (
                    <span className="num text-fg-2">{formatRatio(row.selection, { digits: 2, sign: true })}</span>
                  )}
                  {row.ci.selection ? (
                    <span className="num ml-1 hidden text-xs text-fg-3 lg:inline">
                      [{formatRatio(row.ci.selection[0], { digits: 2, sign: true })}, {formatRatio(row.ci.selection[1], { digits: 2, sign: true })}]
                    </span>
                  ) : null}
                </td>
                <td className="num px-3 text-right text-fg-2">{formatRatio(row.hitRate, { digits: 0 })}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="space-y-1 px-3 py-2 text-xs text-fg-3">
        {technicalScore !== null && code !== null ? (
          <p className="text-fg-2">{tpl(tr.thisStock, { score: formatNumber(technicalScore, 1, lang), reading: t.signal.codes[code] })}</p>
        ) : null}
        <p>{tpl(tr.note[verdict], { n: evaluation.universe, days: horizon.days, ic: formatNumber(horizon.ic.mean, 3, lang), t: formatNumber(horizon.ic.t, 2, lang) })}</p>
        <p>
          {tpl(tr.foot, {
            from: evaluation.from,
            to: evaluation.to,
            base: formatRatio(horizon.base.mean, { digits: 2, sign: true }),
            hit: formatRatio(horizon.base.hitRate, { digits: 0 }),
          })}
        </p>
      </div>
    </div>
  );
}

interface SignalPanelProps {
  report: SignalReport | undefined;
  error: unknown;
  onRetry: () => void;
  className?: string;
}

export function SignalPanel({ report, error, onRetry, className }: SignalPanelProps) {
  const { t, lang } = usePrefs();

  if (!report) {
    return (
      <Panel title={t.signal.title} className={className}>
        {error ? <ErrorState error={error} onRetry={onRetry} /> : <SkeletonRows rows={9} />}
      </Panel>
    );
  }

  if (report.status !== "ok" || report.code === null || report.score === null) {
    return (
      <Panel title={t.signal.title} className={className}>
        <p className="px-3 py-6 text-sm text-fg-3">{t.signal.insufficient}</p>
      </Panel>
    );
  }

  const tone = codeTone(report.code);
  const technical = report.factors.filter((f) => f.group === "technical");
  const fundamental = report.factors.filter((f) => f.group === "fundamental");
  const five = report.backtest?.results.find((r) => r.holdDays === 5);

  return (
    <Panel title={t.signal.title} actions={report.confidence ? <PanelMeta>{t.signal.confidence[report.confidence]}</PanelMeta> : null} className={className}>
      <div className="space-y-3 border-b border-line px-3 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Badge tone={tone === "neutral" ? "neutral" : tone} className="h-6 px-2 text-sm">
            {t.signal.codes[report.code]}
          </Badge>
          <span className="text-xs text-fg-3">
            {t.signal.score} <span className="num text-base text-fg">{formatNumber(report.score, 1, lang)}</span>
            <span className="num">/100</span>
          </span>
          <span className="text-xs text-fg-3">
            {t.signal.consensus} <span className="num text-fg-2">{report.consensus === null ? "—" : `${Math.round(report.consensus)}%`}</span>
          </span>
          <span className="text-xs text-fg-3">
            {t.signal.coverage} <span className="num text-fg-2">{report.coverage === null ? "—" : `${Math.round(report.coverage)}%`}</span>
          </span>
        </div>
        <ScoreGauge score={report.score} />
      </div>

      <div className="grid gap-px bg-line md:grid-cols-2 [&>*]:bg-panel">
        <div className="px-3 py-2">
          <h3 className="label mb-1">{t.signal.technical}</h3>
          {technical.map((f) => (
            <FactorRow key={f.key} factor={f} t={t} />
          ))}
        </div>
        <div className="px-3 py-2">
          <h3 className="label mb-1">{t.signal.fundamental}</h3>
          {fundamental.map((f) => (
            <FactorRow key={f.key} factor={f} t={t} />
          ))}
        </div>
      </div>

      {report.backtest && report.backtest.results.length > 0 ? (
        <div className="border-t border-line">
          <h3 className="label px-3 pt-2.5 pb-1.5">{t.signal.backtest}</h3>
          <BacktestTable results={report.backtest.results} t={t} />
          <div className="space-y-1 px-3 py-2 text-xs text-fg-3">
            <p>{tpl(t.signal.backtestNote, { n: report.backtest.results[0]?.windowDays ?? 0, bps: report.backtest.costBps })}</p>
            {report.backtest.results.some((r) => r.lowSample) ? <p>* {t.signal.lowSample}</p> : null}
            {five && five.bearishSignals > 0 ? (
              <p>
                {tpl(t.signal.bearish, {
                  n: five.bearishSignals,
                  hit: formatRatio(five.bearishHitRate, { digits: 0 }),
                  base: formatRatio(five.baselineWinRate === null ? null : 1 - five.baselineWinRate, { digits: 0 }),
                })}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <TrackRecord technicalScore={report.technicalScore} t={t} lang={lang} />

      <div className="mt-auto space-y-1 border-t border-line px-3 py-2 text-xs text-fg-3">
        {report.meta.droppedPartialBar ? <p>{t.signal.partialBar}</p> : null}
        <p>{t.signal.disclaimer}</p>
      </div>
    </Panel>
  );
}
