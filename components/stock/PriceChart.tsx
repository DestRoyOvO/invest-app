"use client";

import type { IChartApi, ISeriesApi, MouseEventParams, Time, UTCTimestamp } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Delta } from "@/components/ui/Delta";
import { Panel } from "@/components/ui/Panel";
import { ErrorState, Skeleton } from "@/components/ui/States";
import { Tabs } from "@/components/ui/Tabs";
import { useChart } from "@/hooks/useApi";
import { formatCompact, formatDate, formatPrice } from "@/lib/format";
import type { Bar, ChartRange } from "@/types/api";

const RANGES: ChartRange[] = ["1mo", "3mo", "6mo", "1y", "2y", "5y"];

function movingAverage(bars: Bar[], period: number): Array<{ time: UTCTimestamp; value: number }> {
  const out: Array<{ time: UTCTimestamp; value: number }> = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].c;
    if (i >= period) sum -= bars[i - period].c;
    if (i >= period - 1) out.push({ time: (bars[i].t / 1000) as UTCTimestamp, value: sum / period });
  }
  return out;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** "#2fbf71" -> "rgba(47, 191, 113, 0.45)"; non-hex colors are returned unchanged. */
function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (!hex) return color;
  const n = Number.parseInt(hex[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

interface ChartHandles {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram">;
  ma20: ISeriesApi<"Line">;
  ma50: ISeriesApi<"Line">;
}

/** Candlestick chart with volume and 20/50-period moving averages (lightweight-charts, loaded on demand). */
export function PriceChart({ symbol, className }: { symbol: string; className?: string }) {
  const { t, lang, theme, updown } = usePrefs();
  const [range, setRange] = useState<ChartRange>("1y");
  const { data, error, isLoading, mutate } = useChart(symbol, range);
  const containerRef = useRef<HTMLDivElement>(null);
  const handlesRef = useRef<ChartHandles | null>(null);
  const [hovered, setHovered] = useState<Bar | null>(null);
  const [ready, setReady] = useState(false);

  const bars = useMemo(() => data?.bars ?? [], [data]);
  const byTime = useMemo(() => new Map(bars.map((b) => [b.t / 1000, b])), [bars]);
  const last = bars[bars.length - 1] ?? null;
  const shown = hovered ?? last;
  const shownIndex = shown ? bars.indexOf(shown) : -1;
  const prevClose = shownIndex > 0 ? bars[shownIndex - 1].c : null;
  const shownChange = shown && prevClose ? ((shown.c - prevClose) / prevClose) * 100 : null;

  // Create the chart once (the library is imported lazily to keep it out of the initial bundle).
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void import("lightweight-charts").then(({ createChart, CandlestickSeries, HistogramSeries, LineSeries, ColorType, CrosshairMode }) => {
      const el = containerRef.current;
      if (disposed || !el) return;
      const chart = createChart(el, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: "transparent" }, fontFamily: cssVar("--font-plex-mono") || "monospace", fontSize: 11, attributionLogo: true },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.06 } },
        timeScale: { rightOffset: 2, minBarSpacing: 1.5 },
        localization: { locale: lang === "zh" ? "zh-CN" : "en-US" },
      });
      const candles = chart.addSeries(CandlestickSeries, { borderVisible: false, priceLineVisible: false });
      // Volume gets its own pane below the price pane, so the price axis never shows negative values.
      const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false }, 1);
      chart.panes()[1]?.setHeight(72);
      const ma20 = chart.addSeries(LineSeries, { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      const ma50 = chart.addSeries(LineSeries, { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      handlesRef.current = { chart, candles, volume, ma20, ma50 };
      setReady(true);
      cleanup = () => {
        chart.remove();
        handlesRef.current = null;
      };
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
    // The chart instance is created once; theme, locale and data are applied in the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply theme colors (dark/light and the up/down convention).
  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles || !ready) return;
    const up = cssVar("--up");
    const down = cssVar("--down");
    const line = cssVar("--line");
    const fg3 = cssVar("--fg-3");
    handles.chart.applyOptions({
      layout: { textColor: fg3, panes: { separatorColor: line, separatorHoverColor: cssVar("--line-2") } },
      grid: { vertLines: { color: line }, horzLines: { color: line } },
      rightPriceScale: { borderColor: line },
      timeScale: { borderColor: line },
      crosshair: { vertLine: { color: fg3, labelBackgroundColor: cssVar("--panel-2") }, horzLine: { color: fg3, labelBackgroundColor: cssVar("--panel-2") } },
    });
    handles.candles.applyOptions({ upColor: up, downColor: down, wickUpColor: up, wickDownColor: down });
    handles.ma20.applyOptions({ color: cssVar("--info") });
    handles.ma50.applyOptions({ color: cssVar("--fg-3") });
    handles.volume.setData(
      bars.map((b, i) => ({
        time: (b.t / 1000) as UTCTimestamp,
        value: b.v ?? 0,
        color: withAlpha(b.c >= (i > 0 ? bars[i - 1].c : b.o) ? up : down, 0.45),
      })),
    );
  }, [theme, updown, ready, bars]);

  // Data.
  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles || !ready) return;
    handles.candles.setData(bars.map((b) => ({ time: (b.t / 1000) as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c })));
    handles.ma20.setData(movingAverage(bars, 20));
    handles.ma50.setData(movingAverage(bars, 50));
    handles.chart.timeScale().fitContent();
  }, [bars, ready]);

  // Crosshair readout.
  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles || !ready) return;
    const onMove = (param: MouseEventParams<Time>) => {
      const time = typeof param.time === "number" ? param.time : null;
      setHovered(time !== null ? (byTime.get(time) ?? null) : null);
    };
    handles.chart.subscribeCrosshairMove(onMove);
    return () => handles.chart.unsubscribeCrosshairMove(onMove);
  }, [byTime, ready]);

  const high = bars.length ? Math.max(...bars.map((b) => b.h)) : null;
  const low = bars.length ? Math.min(...bars.map((b) => b.l)) : null;
  const summary = last
    ? `${symbol} ${t.stock.ranges[range]}: ${formatPrice(low, lang)} – ${formatPrice(high, lang)}, ${formatPrice(last.c, lang)} (${formatDate(last.t, lang, "UTC")})`
    : symbol;

  return (
    <Panel
      title={t.stock.chart}
      actions={<Tabs label={t.stock.chart} value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r, label: t.stock.ranges[r] }))} />}
      className={className}
    >
      <div className="mono flex min-h-8 flex-wrap items-center gap-x-4 gap-y-0.5 border-b border-line px-3 py-1 text-xs text-fg-3">
        {shown ? (
          <>
            <span className="text-fg-2">{formatDate(shown.t, lang, "UTC")}</span>
            <span>
              O <span className="text-fg-2">{formatPrice(shown.o, lang)}</span>
            </span>
            <span>
              H <span className="text-fg-2">{formatPrice(shown.h, lang)}</span>
            </span>
            <span>
              L <span className="text-fg-2">{formatPrice(shown.l, lang)}</span>
            </span>
            <span>
              C <span className="text-fg-2">{formatPrice(shown.c, lang)}</span>
            </span>
            <Delta value={shownChange} className="mono" />
            <span className="hidden sm:inline">
              V <span className="text-fg-2">{formatCompact(shown.v, lang)}</span>
            </span>
          </>
        ) : null}
        <span className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span aria-hidden className="h-0.5 w-3 bg-info" />
            MA20
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden className="h-0.5 w-3 bg-fg-3" />
            MA50
          </span>
        </span>
      </div>
      <div className="relative h-[340px] sm:h-[380px]">
        <div ref={containerRef} role="img" aria-label={summary} className="absolute inset-0" />
        {isLoading && !data ? <Skeleton className="absolute inset-3" /> : null}
        {error && !data ? (
          <div className="absolute inset-0 flex items-center justify-center bg-panel">
            <ErrorState error={error} onRetry={() => mutate()} />
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
