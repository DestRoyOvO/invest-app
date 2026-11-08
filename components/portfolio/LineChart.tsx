"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";

import { formatDate, formatShortDate } from "@/lib/format";
import type { Lang } from "@/types/api";

import { areaPath, extent, linePath, monthTicks, nearestIndex, niceTicks } from "./chart-geometry";

export interface ChartSeries {
  key: string;
  label: string;
  values: ReadonlyArray<number | null>;
  /** A --series-* token: identity only, never direction. */
  color: string;
  dashed?: boolean;
  /** Fill between the line and the baseline (a drawdown). */
  area?: boolean;
}

interface LineChartProps {
  /** Session dates (epoch ms, UTC midnight). */
  dates: readonly number[];
  series: readonly ChartSeries[];
  height: number;
  /** Dashed reference line, e.g. 100 for a rebased chart or 0 for drawdowns. */
  baseline?: number;
  formatTick: (value: number) => string;
  formatValue: (value: number) => string;
  /** Spoken summary of what the chart shows (the drawing itself is hidden from screen readers). */
  label: string;
  lang: Lang;
}

const PAD = { top: 10, right: 48, bottom: 22, left: 4 };

/**
 * A small SVG line chart drawn with tokens: dotted gridlines, ticks on the right, month labels, a dashed baseline and a
 * readout of every series under the pointer. Responsive to its container's width.
 */
export function LineChart({ dates, series, height, baseline, formatTick, formatValue, label, lang }: LineChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => setWidth(Math.round(entries[0]?.contentRect.width ?? 0)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const n = dates.length;
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const range = extent(
    series.map((s) => s.values),
    baseline !== undefined ? [baseline] : [],
  );

  let drawing = null;
  if (range && n >= 2 && innerW > 0) {
    const [lo, hi] = range;
    const span = hi - lo || Math.abs(hi) || 1;
    const min = lo - span * 0.06;
    const max = hi + span * 0.06;
    const ticks = niceTicks(min, max, Math.max(2, Math.round(innerH / 44)));
    const x = (i: number) => PAD.left + (i / (n - 1)) * innerW;
    const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * innerH;
    const months = monthTicks(dates, Math.max(2, Math.floor(innerW / 70)));
    const baseY = baseline !== undefined ? y(baseline) : PAD.top + innerH;
    const onMove = (event: PointerEvent<SVGSVGElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      setHover(nearestIndex(event.clientX - rect.left, PAD.left, innerW, n));
    };
    drawing = (
      <svg width={width} height={height} aria-hidden onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="block touch-pan-y">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={PAD.left + innerW} y1={y(tick)} y2={y(tick)} stroke="var(--line)" strokeDasharray="1 3" />
            <text x={width - PAD.right + 6} y={y(tick)} dy="0.32em" fill="var(--fg-3)" fontSize={11} className="num">
              {formatTick(tick)}
            </text>
          </g>
        ))}
        {baseline !== undefined ? <line x1={PAD.left} x2={PAD.left + innerW} y1={baseY} y2={baseY} stroke="var(--line-2)" strokeDasharray="3 3" /> : null}
        {months.map((m) => (
          <text key={m.date} x={x(m.index)} y={height - 6} textAnchor="middle" fill="var(--fg-3)" fontSize={11} className="num">
            {formatShortDate(m.date, lang, "UTC").replace(/\s?\d+日?$/, "")}
          </text>
        ))}
        {series.map((s) =>
          s.area ? <path key={`${s.key}-area`} d={areaPath(s.values, x, y, baseY)} fill={s.color} fillOpacity={0.16} stroke="none" /> : null,
        )}
        {series.map((s) => (
          <path key={s.key} d={linePath(s.values, x, y)} fill="none" stroke={s.color} strokeWidth={1.5} strokeDasharray={s.dashed ? "5 3" : undefined} strokeLinejoin="round" />
        ))}
        {hover !== null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--line-2)" />
            {series.map((s) => {
              const v = s.values[hover];
              return typeof v === "number" ? <circle key={s.key} cx={x(hover)} cy={y(v)} r={3} fill={s.color} stroke="var(--panel)" strokeWidth={1.5} /> : null;
            })}
          </g>
        ) : null}
      </svg>
    );
  }

  const readoutLeft = hover !== null && innerW > 0 ? Math.min(Math.max(PAD.left + (hover / Math.max(1, n - 1)) * innerW + 10, 0), Math.max(0, width - 190)) : 0;
  return (
    <div ref={wrapRef} role="img" aria-label={label} className="relative w-full" style={{ height }}>
      {drawing}
      {hover !== null && dates[hover] !== undefined ? (
        <div aria-hidden className="pointer-events-none absolute top-1 w-44 rounded-xs border border-line-2 bg-panel-2 px-2 py-1.5 text-xs shadow-xl" style={{ left: readoutLeft }}>
          <div className="num text-fg-3">{formatDate(dates[hover], lang, "UTC")}</div>
          {series.map((s) => {
            const v = s.values[hover];
            return (
              <div key={s.key} className="mt-0.5 flex items-center gap-1.5">
                <span className="size-2 shrink-0 rounded-[1px]" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 truncate text-fg-2">{s.label}</span>
                <span className="num text-fg">{typeof v === "number" ? formatValue(v) : "—"}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
