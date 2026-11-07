"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Panel, PanelMeta } from "@/components/ui/Panel";
import { ErrorState, Skeleton, StaleBanner } from "@/components/ui/States";
import { useYieldCurve } from "@/hooks/useMarketsApi";
import { cn } from "@/lib/cn";
import { formatDate, formatShortDate, tpl } from "@/lib/format";
import type { TenorKey, YieldCurve, YieldCurveResponse, YieldSpread } from "@/types/markets";

import { curveChartGeometry, spreadSparkGeometry } from "./curve-chart";

/** Tenors labeled on the x axis (every tenor is plotted). */
const AXIS_TENORS = new Set<TenorKey>(["1M", "3M", "6M", "1Y", "2Y", "5Y", "10Y", "20Y", "30Y"]);
/** Tenors in the table under the chart. */
const KEY_TENORS: readonly TenorKey[] = ["3M", "2Y", "5Y", "10Y", "30Y"];
const CHART_HEIGHT = 200;
const PAD = { top: 12, right: 14, bottom: 24, left: 44 };

interface Series {
  key: "current" | "monthAgo" | "yearAgo";
  curve: YieldCurve;
  color: string;
  dash?: string;
  width: number;
  label: string;
}

function percent(value: number | null | undefined): string {
  return typeof value === "number" ? `${value.toFixed(2)}%` : "—";
}

function signedBp(value: number | null, template: string): string {
  if (value === null) return "—";
  const rounded = Math.round(value);
  const text = rounded > 0 ? `+${rounded}` : rounded < 0 ? `−${Math.abs(rounded)}` : "0";
  return template.replace("{n}", text);
}

/** Width of an element, kept up to date with a ResizeObserver (0 before the first measurement). */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function LegendSwatch({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg aria-hidden width={18} height={8} className="shrink-0">
      <line x1={1} x2={17} y1={4} y2={4} stroke={color} strokeWidth={2} strokeDasharray={dash} strokeLinecap="round" />
    </svg>
  );
}

/** The curves by tenor: latest, a month ago (dashed) and a year ago, with a readout that follows the pointer. */
function YieldCurveChart({ data, series }: { data: YieldCurveResponse; series: Series[] }) {
  const { t, lang } = usePrefs();
  const [ref, width] = useWidth<HTMLDivElement>();
  const tenIndex = Math.max(data.tenors.indexOf("10Y"), 0);
  const [hover, setHover] = useState<number | null>(null);
  const index = hover ?? tenIndex;
  const geometry = useMemo(() => curveChartGeometry(series.map((s) => s.curve.yields), width, CHART_HEIGHT, PAD), [series, width]);

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (geometry.xs.length === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left;
    let nearest = 0;
    geometry.xs.forEach((xi, i) => {
      if (Math.abs(xi - x) < Math.abs(geometry.xs[nearest] - x)) nearest = i;
    });
    setHover(nearest);
  };

  return (
    <div className="px-3 pt-2.5">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2">
        {series
          .slice()
          .reverse()
          .map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <LegendSwatch color={s.color} dash={s.dash} />
              <span>{s.label}</span>
              <span className="num text-fg-3">{formatShortDate(s.curve.date, lang, "UTC")}</span>
            </li>
          ))}
      </ul>
      <p className="num mt-1.5 text-xs text-fg-3" aria-live="off">
        <span className="mono font-medium text-fg">{t.markets.rates.tenors[data.tenors[index]]}</span>
        {series
          .slice()
          .reverse()
          .map((s) => (
            <span key={s.key} className="ml-3">
              {s.label} <span className="text-fg">{percent(s.curve.yields[index])}</span>
            </span>
          ))}
      </p>
      <div ref={ref} className="mt-1 h-[200px] w-full">
        {width > 0 ? (
          <svg
            width={width}
            height={CHART_HEIGHT}
            aria-hidden
            className="block touch-pan-y"
            onPointerMove={onPointerMove}
            onPointerLeave={() => setHover(null)}
          >
            {geometry.yTicks.map((tick) => (
              <g key={tick.value}>
                <line x1={PAD.left} x2={width - PAD.right} y1={tick.y} y2={tick.y} stroke="var(--line)" strokeWidth={1} />
                <text x={PAD.left - 6} y={tick.y} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--fg-3)" className="num">
                  {tick.value.toFixed(2)}%
                </text>
              </g>
            ))}
            {data.tenors.map((tenor, i) =>
              AXIS_TENORS.has(tenor) ? (
                <text key={tenor} x={geometry.xs[i]} y={CHART_HEIGHT - 6} textAnchor="middle" fontSize={10} fill="var(--fg-3)" className="num">
                  {t.markets.rates.tenors[tenor]}
                </text>
              ) : null,
            )}
            <line x1={geometry.xs[index]} x2={geometry.xs[index]} y1={PAD.top} y2={CHART_HEIGHT - PAD.bottom} stroke="var(--line-2)" strokeWidth={1} />
            {series.map((s, i) => (
              <path
                key={s.key}
                d={geometry.paths[i]}
                fill="none"
                stroke={s.color}
                strokeWidth={s.width}
                strokeDasharray={s.dash}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {series.map((s, i) => {
              const point = geometry.points[i][index];
              return point ? <circle key={s.key} cx={point.x} cy={point.y} r={s.key === "current" ? 3 : 2.5} fill={s.color} /> : null;
            })}
          </svg>
        ) : null}
      </div>
    </div>
  );
}

function SpreadSpark({ spread }: { spread: YieldSpread }) {
  const geometry = spreadSparkGeometry(
    spread.history.map((point) => point.bp),
    88,
    26,
  );
  if (!geometry.path || !geometry.end) return <svg aria-hidden width={88} height={26} />;
  return (
    <svg aria-hidden width={88} height={26} className="shrink-0">
      {geometry.zeroY !== null ? <line x1={0} x2={88} y1={geometry.zeroY} y2={geometry.zeroY} stroke="var(--line-2)" strokeDasharray="2 2" strokeWidth={1} /> : null}
      <path d={geometry.path} fill="none" stroke="var(--spark)" strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={geometry.end.x} cy={geometry.end.y} r={2.5} fill="var(--fg-2)" />
    </svg>
  );
}

function SpreadRow({ spread }: { spread: YieldSpread }) {
  const { t } = usePrefs();
  const inverted = spread.bp !== null && spread.bp < 0;
  const note = inverted
    ? tpl(t.markets.rates.inverted, { short: t.markets.rates.shortTenor[spread.key] })
    : spread.invertedDays > 0
      ? tpl(t.markets.rates.invertedDays, { n: spread.invertedDays, total: spread.history.length })
      : t.markets.rates.neverInverted;
  const change = spread.bp !== null && spread.monthAgoBp !== null ? spread.bp - spread.monthAgoBp : null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="mono font-medium text-fg">{t.markets.rates.spread[spread.key]}</span>
          <span className="truncate text-xs text-fg-3">{t.markets.rates.spreadName[spread.key]}</span>
        </div>
        <p className={cn("mt-0.5 flex items-center gap-1 text-micro", inverted ? "text-warn" : "text-fg-3")}>
          {inverted ? <AlertTriangle aria-hidden className="size-3 shrink-0" strokeWidth={1.75} /> : null}
          {note}
        </p>
      </div>
      <div className="text-right">
        <div className="num text-base text-fg">{signedBp(spread.bp, t.markets.rates.bp)}</div>
        <div className="num text-micro text-fg-3">{tpl(t.markets.rates.vsMonthAgo, { n: signedBp(change, t.markets.rates.bp) })}</div>
      </div>
      <span className="flex items-center gap-1.5">
        <SpreadSpark spread={spread} />
        <span className="text-micro text-fg-3">{t.markets.rates.history}</span>
      </span>
    </div>
  );
}

function RatesBody({ data }: { data: YieldCurveResponse }) {
  const { t, lang } = usePrefs();
  const { current, monthAgo, yearAgo } = data;
  // Drawn back to front: a year ago, a month ago (dashed, as series 2 looks like series 1 to some readers), latest.
  const series: Series[] = [];
  if (yearAgo) series.push({ key: "yearAgo", curve: yearAgo, color: "var(--series-3)", width: 1.5, label: t.markets.rates.yearAgo });
  if (monthAgo) series.push({ key: "monthAgo", curve: monthAgo, color: "var(--series-2)", dash: "4 3", width: 1.5, label: t.markets.rates.monthAgo });
  series.push({ key: "current", curve: current, color: "var(--series-1)", width: 2, label: t.markets.rates.latest });
  const at = (curve: YieldCurve | null, tenor: TenorKey) => {
    const i = data.tenors.indexOf(tenor);
    return curve && i >= 0 ? curve.yields[i] : null;
  };
  const keyTenors = KEY_TENORS.filter((tenor) => data.tenors.includes(tenor));

  return (
    <>
      <YieldCurveChart data={data} series={series} />

      <table className="w-full table-fixed border-collapse text-data">
        <caption className="sr-only">{t.markets.rates.chart}</caption>
        <thead>
          <tr className="shadow-[inset_0_-1px_0_var(--line)]">
            <th scope="col" className="col-head h-8 px-3 text-left">
              {t.markets.rates.tenor}
            </th>
            <th scope="col" className="col-head h-8 px-3 text-right">
              {t.markets.rates.latest}
            </th>
            <th scope="col" className="col-head h-8 px-3 text-right">
              {t.markets.rates.monthAgo}
            </th>
            <th scope="col" className="col-head h-8 px-3 text-right max-sm:hidden">
              {t.markets.rates.yearAgo}
            </th>
            <th scope="col" className="col-head h-8 px-3 text-right">
              {t.markets.rates.chg1m}
            </th>
          </tr>
        </thead>
        <tbody>
          {keyTenors.map((tenor) => {
            const latest = at(data.current, tenor);
            const month = at(data.monthAgo, tenor);
            return (
              <tr key={tenor} className="h-row border-b border-line/70 last:border-b-0">
                <th scope="row" className="mono px-3 text-left font-medium text-fg">
                  {t.markets.rates.tenors[tenor]}
                </th>
                <td className="num px-3 text-right text-fg">{percent(latest)}</td>
                <td className="num px-3 text-right text-fg-2">{percent(month)}</td>
                <td className="num px-3 text-right text-fg-2 max-sm:hidden">{percent(at(data.yearAgo, tenor))}</td>
                <td className="num px-3 text-right text-fg">
                  {signedBp(latest !== null && month !== null ? (latest - month) * 100 : null, t.markets.rates.bp)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Every tenor for screen readers; the chart above is drawn for the eye. */}
      <table className="sr-only">
        <caption>{t.markets.rates.chart}</caption>
        <thead>
          <tr>
            <th scope="col">{t.markets.rates.tenor}</th>
            {series
              .slice()
              .reverse()
              .map((s) => (
                <th key={s.key} scope="col">
                  {s.label} {formatDate(s.curve.date, lang, "UTC")}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {data.tenors.map((tenor, i) => (
            <tr key={tenor}>
              <th scope="row">{t.markets.rates.tenors[tenor]}</th>
              {series
                .slice()
                .reverse()
                .map((s) => (
                  <td key={s.key}>{percent(s.curve.yields[i])}</td>
                ))}
            </tr>
          ))}
        </tbody>
      </table>

      <section aria-label={t.markets.rates.spreads} className="border-t border-line">
        <h3 className="col-head px-3 pt-2.5">{t.markets.rates.spreads}</h3>
        <div className="divide-y divide-line/70">
          {data.spreads.map((spread) => (
            <SpreadRow key={spread.key} spread={spread} />
          ))}
        </div>
      </section>

      <p className="border-t border-line px-3 py-1.5 text-micro text-fg-3">{tpl(t.markets.rates.source, { date: formatDate(data.current.date, lang, "UTC") })}</p>
    </>
  );
}

/** GC: the US Treasury par yield curve, today against a month and a year ago, with the 2s10s and 3m10y spreads. */
export function RatesPanel({ className }: { className?: string }) {
  const { t, lang } = usePrefs();
  const { data, error, mutate } = useYieldCurve();
  return (
    <Panel
      id="rates"
      title={t.markets.rates.title}
      code="GC"
      className={cn("scroll-mt-2", className)}
      actions={data ? <PanelMeta>{formatDate(data.current.date, lang, "UTC")}</PanelMeta> : null}
    >
      <StaleBanner show={Boolean(error && data) || Boolean(data?.stale)} />
      {data ? (
        <RatesBody data={data} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : (
        <div className="space-y-2 p-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-[200px]" />
          <Skeleton className="h-24" />
        </div>
      )}
    </Panel>
  );
}
