"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Delta, withTrueMinus } from "@/components/ui/Delta";
import { Segmented } from "@/components/ui/Segmented";
import { Skeleton } from "@/components/ui/States";
import { formatDate, formatRatio, tpl } from "@/lib/format";
import { alignByDate, PERFORMANCE_SESSIONS, performanceWindow, type PerformanceRange, type RiskReport } from "@/lib/portfolio-analytics";
import type { HistoryResponse } from "@/types/api";

import { LineChart } from "./LineChart";
import { PORT_BENCHMARKS, type PortBenchmark } from "./port-view";

const RANGES: readonly PerformanceRange[] = ["3m", "6m", "1y"];
/** Segmented options are 28px; phones get 40px touch targets. */
const HOLDINGS_COLOR = "var(--series-1)";
const BENCHMARK_COLOR = "var(--series-6)";

interface PerformanceTabProps {
  report: RiskReport;
  benchmark: PortBenchmark;
  range: PerformanceRange;
  onBenchmarkChange: (benchmark: PortBenchmark) => void;
  onRangeChange: (range: PerformanceRange) => void;
  /** QQQ history, loaded only when QQQ is the benchmark. */
  qqq: HistoryResponse | undefined;
  loading: boolean;
}

/** Today's holdings rebased to 100 against SPY or QQQ, and their drawdown, over 3, 6 or 12 months. Hypothetical. */
export function PerformanceTab({ report, benchmark, range, onBenchmarkChange, onRangeChange, qqq, loading }: PerformanceTabProps) {
  const { t, lang } = usePrefs();
  const o = t.port.overview;
  const benchCloses =
    benchmark === "SPY" ? report.benchmark : qqq ? alignByDate(report.dates, { dates: qqq.dates, closes: qqq.closes.QQQ ?? [] }) : report.dates.map(() => null);
  const perf = performanceWindow(report.dates, report.values, benchCloses, PERFORMANCE_SESSIONS[range]);
  const ratio = (v: number | null, digits = 1) => withTrueMinus(formatRatio(v, { digits, sign: true }));

  const controls = (
    <div className="flex flex-wrap items-end gap-3 px-3 pt-3">
      <Segmented
        label={o.benchmark}
        value={benchmark}
        onChange={onBenchmarkChange}
        options={PORT_BENCHMARKS.map((b) => ({ value: b, label: b }))}
        size="sm"
        className="w-36"
      />
      <Segmented
        label={o.range}
        value={range}
        onChange={onRangeChange}
        options={RANGES.map((r) => ({ value: r, label: o.ranges[r] }))}
        size="sm"
        className="w-48"
      />
    </div>
  );

  if (loading) {
    return (
      <>
        {controls}
        <div className="space-y-3 p-3">
          <Skeleton className="h-60" />
          <Skeleton className="h-28" />
        </div>
      </>
    );
  }
  if (perf.dates.length < 2 || report.sessions < 2) {
    return (
      <>
        {controls}
        <p className="px-3 py-6 text-sm text-fg-2">{o.noHistory}</p>
      </>
    );
  }

  const deepest = perf.maxDrawdown && perf.maxDrawdown.depth < 0 ? perf.maxDrawdown : null;
  return (
    <>
      {controls}
      <div className="px-3 pt-3">
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <li className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: HOLDINGS_COLOR }} />
            <span className="text-fg-2">{o.holdings}</span>
            <Delta value={perf.holdingsReturn} kind="ratio" digits={1} />
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: BENCHMARK_COLOR }} />
            <span className="mono text-fg-2">{benchmark}</span>
            <Delta value={perf.benchmarkReturn} kind="ratio" digits={1} />
          </li>
        </ul>
      </div>
      <div className="px-3 pt-2">
        <LineChart
          dates={perf.dates}
          series={[
            { key: "holdings", label: o.holdings, values: perf.holdings, color: HOLDINGS_COLOR },
            { key: "benchmark", label: benchmark, values: perf.benchmark, color: BENCHMARK_COLOR, dashed: true },
          ]}
          height={240}
          baseline={100}
          formatTick={(v) => v.toFixed(0)}
          formatValue={(v) => v.toFixed(1)}
          label={tpl(o.chartLabel, { own: ratio(perf.holdingsReturn), benchmark, other: ratio(perf.benchmarkReturn) })}
          lang={lang}
        />
        <p className="pt-1 pb-3 text-xs text-fg-3">{o.hypothetical}</p>
      </div>
      <div className="border-t border-line px-3 pt-3 pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="col-head">{o.drawdown}</h3>
          {deepest ? (
            <p className="num text-xs text-fg-2">{tpl(o.largest, { pct: ratio(deepest.depth), date: formatDate(deepest.troughDate, lang, "UTC") })}</p>
          ) : null}
        </div>
        <LineChart
          dates={perf.dates}
          series={[{ key: "drawdown", label: o.drawdown, values: perf.drawdown, color: "var(--fg-2)", area: true }]}
          height={120}
          baseline={0}
          formatTick={(v) => withTrueMinus(formatRatio(v, { digits: 0 }))}
          formatValue={(v) => ratio(v)}
          label={o.drawdownCaption}
          lang={lang}
        />
        <p className="pt-1 text-xs text-fg-3">{o.drawdownCaption}</p>
      </div>
    </>
  );
}
