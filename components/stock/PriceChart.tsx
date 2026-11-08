"use client";

// TradingView Lightweight Charts™
// Copyright (c) 2026 TradingView, Inc. https://www.tradingview.com/
// Licensed under the Apache License 2.0 (node_modules/lightweight-charts/LICENSE). The library's attribution logo is
// turned off; the chart footer links to TradingView instead, which the library's license notice allows.

import type {
  AutoscaleInfo,
  IChartApi,
  IPriceLine,
  IRange,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  MouseEventParams,
  SeriesMarker,
  Time,
  UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Delta } from "@/components/ui/Delta";
import { Panel } from "@/components/ui/Panel";
import { ErrorState, Skeleton } from "@/components/ui/States";
import { Switch } from "@/components/ui/Switch";
import { useHistory } from "@/hooks/useApi";
import { useEarnings } from "@/hooks/useEarningsApi";
import { useHoldings } from "@/hooks/useHoldings";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useLocalStore } from "@/hooks/useLocalStore";
import { useNote } from "@/hooks/useNotes";
import { isIntradayRange, useChartSeries } from "@/hooks/useQuoteApi";
import { cn } from "@/lib/cn";
import { formatCompact, formatDate, formatPrice, formatShortDate, formatTime, tpl } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import { wilderRsiSeries } from "@/lib/signal";
import type { Bar, ChartRange, Lang, Quote } from "@/types/api";

import { chartSettingsStore, updateChartSettings } from "./chart-settings";
import {
  barIndexAt,
  bollingerSeries,
  chartTime,
  compareSlots,
  dataRange,
  historyRangeFor,
  percentChange,
  sessionBaselines,
  smaSeries,
  stepRange,
  tickDecimals,
  visibleBars,
  windowStart,
} from "./chart-utils";
import { RangePicker, StudiesMenu } from "./ChartToolbar";
import { CompareBar, SeriesKey } from "./CompareBar";
import { useGSequenceGuard } from "./use-g-guard";

type Lwc = typeof import("lightweight-charts");

interface Handles {
  lib: Lwc;
  chart: IChartApi;
  mode: "price" | "compare";
  candles: ISeriesApi<"Candlestick"> | null;
  /** The quote's own line while comparing. */
  line: ISeriesApi<"Line"> | null;
  ma: ISeriesApi<"Line">[];
  bands: ISeriesApi<"Line">[];
  volume: ISeriesApi<"Histogram"> | null;
  rsi: ISeriesApi<"Line"> | null;
  rsiLines: IPriceLine[];
  overlays: ISeriesApi<"Line">[];
  markers: ISeriesMarkersPluginApi<Time> | null;
}

interface Point {
  time: number;
  value: number;
}

interface CompareLine {
  symbol: string;
  points: Point[];
  loading: boolean;
  missing: boolean;
}

type EventKind = "dividend" | "split" | "earnings";

interface ChartEventMark {
  time: number;
  kind: EventKind;
  label: string;
}

/**
 * Charts already removed. When the layout changes, effects can still hold the previous chart's handles for one more
 * render; touching a removed chart throws "Object is disposed", so every effect checks this first.
 */
const removedCharts = new WeakSet<IChartApi>();

function isLive(handles: Handles | null): handles is Handles {
  return handles !== null && !removedCharts.has(handles.chart);
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** "#7d8897" -> "rgba(125, 136, 151, 0.35)"; other colors are returned unchanged. */
function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (!hex) return color;
  const n = Number.parseInt(hex[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function readColors() {
  return {
    up: cssVar("--up"),
    down: cssVar("--down"),
    fg: cssVar("--fg"),
    fg2: cssVar("--fg-2"),
    fg3: cssVar("--fg-3"),
    line: cssVar("--line"),
    line2: cssVar("--line-2"),
    accent: cssVar("--accent"),
    info: cssVar("--info"),
    warn: cssVar("--warn"),
    series: [1, 2, 3, 4, 5, 6].map((n) => cssVar(`--series-${n}`)),
    font: cssVar("--font-plex-sans") || "sans-serif",
  };
}

function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-updown"] });
  const media = window.matchMedia("(prefers-color-scheme: light)");
  media.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}

function themeSnapshot(): string {
  const root = document.documentElement;
  const light = window.matchMedia("(prefers-color-scheme: light)").matches;
  return `${root.dataset.theme ?? ""}|${root.dataset.updown ?? ""}|${light ? "light-os" : "dark-os"}`;
}

/**
 * The theme, the price convention and the OS color scheme as one key. It changes whenever the CSS colors can change,
 * so canvas colors (which the chart cannot read from CSS itself) follow them.
 */
function useThemeKey(): string {
  return useSyncExternalStore(subscribeTheme, themeSnapshot, () => "server");
}

const LOCALES: Record<Lang, string> = { en: "en-US", zh: "zh-CN" };

function isTrading(quote: Quote | null): boolean {
  const state = quote?.marketState;
  return state === "REGULAR" || state === "PRE" || state === "POST";
}

function linePoints(times: readonly number[], values: ReadonlyArray<number | null>) {
  const out: Array<{ time: UTCTimestamp; value: number }> = [];
  values.forEach((value, i) => {
    if (value !== null && Number.isFinite(value)) out.push({ time: times[i] as UTCTimestamp, value });
  });
  return out;
}

/** The first point at or after `t`, or the last at or before it (`before`). */
function pointNear(points: readonly Point[], t: number, before: boolean): Point | null {
  const times = points.map((p) => p.time);
  const index = barIndexAt(times, t);
  if (before) return index >= 0 ? points[index] : null;
  if (index >= 0 && times[index] === t) return points[index];
  return points[index + 1] ?? null;
}

function eventLabel(t: Messages, kind: EventKind, detail: string): string {
  if (kind === "dividend") return tpl(t.chart.marker.dividend, { amount: detail });
  if (kind === "split") return tpl(t.chart.marker.split, { ratio: detail });
  return t.chart.marker.earnings;
}

interface PriceChartProps {
  symbol: string;
  quote: Quote | null;
  /** The sector ETF offered as a default comparison next to SPY. */
  sectorEtf: string | null;
  compare: string[];
  onCompareChange: (symbols: string[]) => void;
  className?: string;
}

/**
 * The quote page's chart workstation: ten ranges (1D and 5D intraday with optional extended hours), up to three
 * comparisons on a percentage scale, moving averages, Bollinger bands, an RSI pane, volume, a log scale, dividend,
 * split and earnings markers, and the investor's own price lines (average cost, target, stop).
 */
export function PriceChart({ symbol, quote, sectorEtf, compare, onCompareChange, className }: PriceChartProps) {
  const { t, lang, theme, updown } = usePrefs();
  const settings = useLocalStore(chartSettingsStore);
  const themeKey = useThemeKey();
  const slots = useMemo(() => compareSlots(themeKey.split("|")[1] === "cb"), [themeKey]);
  const inGSequence = useGSequenceGuard();
  const range = settings.range;
  const compareMode = compare.length > 0;
  const live = isTrading(quote);
  const intradayRange = isIntradayRange(range);

  // --- Data -------------------------------------------------------------------------------------------------------
  const mainQuery = useChartSeries(symbol, dataRange(range), live);
  const data = mainQuery.data ?? null;
  const intraday = data?.intraday ?? false;
  const timezone = data?.timezone ?? null;
  const bars = useMemo(() => visibleBars(data?.bars ?? [], settings.extended), [data, settings.extended]);
  const times = useMemo(() => bars.map((bar) => chartTime(bar.t, intraday, timezone)), [bars, intraday, timezone]);
  const timeIndex = useMemo(() => new Map(times.map((time, i) => [time, i])), [times]);

  const historyRange = compareMode ? historyRangeFor(range) : null;
  const historyQuery = useHistory(historyRange ? [symbol, ...compare] : [], historyRange ?? "2y");
  const overlayRange: ChartRange | null = compareMode && !historyRange ? dataRange(range) : null;
  const overlay0 = useChartSeries(overlayRange ? (compare[0] ?? null) : null, overlayRange ?? "1d", live);
  const overlay1 = useChartSeries(overlayRange ? (compare[1] ?? null) : null, overlayRange ?? "1d", live);
  const overlay2 = useChartSeries(overlayRange ? (compare[2] ?? null) : null, overlayRange ?? "1d", live);
  // SWR hands out a new response object on every render; the memo below depends on the values, not the objects.
  const [overlayData0, overlayData1, overlayData2] = [overlay0.data, overlay1.data, overlay2.data];
  const [overlayError0, overlayError1, overlayError2] = [overlay0.error, overlay1.error, overlay2.error];
  const earnings = useEarnings(quote?.quoteType === "EQUITY" ? symbol : null);
  const { holdings } = useHoldings();
  const note = useNote(symbol);

  const compareLines = useMemo<CompareLine[] | null>(() => {
    if (!compareMode) return null;
    const own = bars.map((bar, i) => ({ time: times[i], value: bar.c }));
    if (historyRange) {
      const history = historyQuery.data;
      const pending = !history && !historyQuery.error;
      const toPoints = (s: string): Point[] => {
        const closes = history?.closes[s];
        if (!history || !closes) return [];
        return history.dates.flatMap((date, i) => {
          const value = closes[i];
          return value === null || value === undefined ? [] : [{ time: Math.floor(date / 1000), value }];
        });
      };
      const mainPoints = toPoints(symbol);
      return [
        { symbol, points: mainPoints.length > 0 ? mainPoints : own, loading: pending, missing: false },
        ...compare.map((s) => ({ symbol: s, points: toPoints(s), loading: pending, missing: !pending && toPoints(s).length === 0 })),
      ];
    }
    const overlays = [
      { data: overlayData0, error: overlayError0 },
      { data: overlayData1, error: overlayError1 },
      { data: overlayData2, error: overlayError2 },
    ];
    return [
      { symbol, points: own, loading: false, missing: false },
      ...compare.map((s, i) => {
        const { data: overlay, error } = overlays[i];
        const points = visibleBars(overlay?.bars ?? [], settings.extended).map((bar) => ({ time: chartTime(bar.t, intraday, timezone), value: bar.c }));
        return { symbol: s, points, loading: !overlay && !error, missing: Boolean(error) || (Boolean(overlay) && points.length === 0) };
      }),
    ];
  }, [
    compareMode,
    bars,
    times,
    historyRange,
    historyQuery.data,
    historyQuery.error,
    symbol,
    compare,
    overlayData0,
    overlayData1,
    overlayData2,
    overlayError0,
    overlayError1,
    overlayError2,
    settings.extended,
    intraday,
    timezone,
  ]);

  // Dividend, split and earnings marks, each on the bar that contains it.
  const events = useMemo<ChartEventMark[]>(() => {
    if (!data || times.length === 0) return [];
    const marks: ChartEventMark[] = [];
    const place = (t: number, kind: EventKind, label: string) => {
      const index = barIndexAt(times, t);
      if (index >= 0) marks.push({ time: times[index], kind, label });
    };
    const eventTime = (ms: number) => (intraday ? chartTime(ms, true, timezone) : Math.floor(ms / 1000));
    for (const dividend of data.dividends) place(eventTime(dividend.t), "dividend", formatPrice(dividend.amount, lang));
    for (const split of data.splits) place(eventTime(split.t), "split", split.ratio);
    for (const quarter of earnings.data?.history ?? []) {
      const ms = quarter.reportedAt ? Date.parse(quarter.reportedAt) : Number.NaN;
      if (!Number.isFinite(ms)) continue;
      // A daily bar is the exchange-local session date of the report.
      const local = intraday ? chartTime(ms, true, timezone) : Math.floor(chartTime(ms, true, timezone) / 86_400) * 86_400;
      if (local >= times[0]) place(local, "earnings", "");
    }
    return marks.sort((a, b) => a.time - b.time);
  }, [data, times, intraday, timezone, earnings.data, lang]);

  // Weekly and monthly bars would carry a dividend mark on nearly every bar: there they show in the legend only.
  const markerKinds = useMemo(() => {
    const daily = data?.interval === "1d" || intraday;
    return new Set(events.filter((mark) => mark.kind !== "dividend" || daily).map((mark) => mark.kind));
  }, [events, data, intraday]);

  const eventsByTime = useMemo(() => {
    const map = new Map<number, ChartEventMark[]>();
    for (const mark of events) map.set(mark.time, [...(map.get(mark.time) ?? []), mark]);
    return map;
  }, [events]);

  const position = holdings[symbol];
  const hasExtended = Boolean(data?.bars.some((bar) => bar.session !== undefined && bar.session !== "regular"));
  // Intraday change is measured from each session's previous regular close; daily bars from the bar before.
  const baselines = useMemo(() => (intraday ? sessionBaselines(bars, data?.previousClose ?? null, timezone) : null), [intraday, bars, data, timezone]);
  const lastBar = bars.at(-1) ?? null;
  // The last price line follows the header: the change against the previous regular close.
  const previousClose = quote?.previousClose ?? (baselines ? (baselines.at(-1) ?? null) : bars.length > 1 ? bars[bars.length - 2].c : null);
  const sessionClose = range === "1d" ? (data?.previousClose ?? null) : null;
  const precision = (lastBar?.c ?? quote?.price ?? 2) < 1 ? 4 : 2;

  // --- Chart instance ---------------------------------------------------------------------------------------------
  const containerRef = useRef<HTMLDivElement>(null);
  const [handles, setHandles] = useState<Handles | null>(null);
  const structure = compareMode ? "compare" : `price:${settings.volume ? 1 : 0}:${settings.rsi ? 1 : 0}`;

  useEffect(() => {
    let disposed = false;
    let chart: IChartApi | null = null;
    void import("lightweight-charts").then((lib) => {
      const el = containerRef.current;
      if (disposed || !el) return;
      const { createChart, createSeriesMarkers, CandlestickSeries, HistogramSeries, LineSeries, ColorType, CrosshairMode, LineStyle } = lib;
      const created = createChart(el, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: "transparent" }, fontSize: 11, attributionLogo: false },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.06 }, entireTextOnly: true },
        timeScale: { rightOffset: 3, minBarSpacing: 0.5, fixLeftEdge: true, borderVisible: true },
        grid: { vertLines: { visible: false } },
      });
      chart = created;
      const lineOptions = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
      let next: Handles;
      if (structure === "compare") {
        const line = created.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
        const overlays = [0, 1, 2].map((slot) =>
          created.addSeries(LineSeries, { lineWidth: 2, lineStyle: slot === 1 ? LineStyle.Dashed : LineStyle.Solid, priceLineVisible: false, lastValueVisible: true }),
        );
        next = { lib, chart: created, mode: "compare", candles: null, line, ma: [], bands: [], volume: null, rsi: null, rsiLines: [], overlays, markers: null };
      } else {
        const [, volumeFlag, rsiFlag] = structure.split(":");
        const candles = created.addSeries(CandlestickSeries, { borderVisible: false, priceLineVisible: false, lastValueVisible: false });
        const ma = [created.addSeries(LineSeries, lineOptions), created.addSeries(LineSeries, { ...lineOptions, lineStyle: LineStyle.Dashed }), created.addSeries(LineSeries, lineOptions)];
        const bands = [0, 1].map(() => created.addSeries(LineSeries, { ...lineOptions, lineStyle: LineStyle.Dotted }));
        let pane = 1;
        const volume = volumeFlag === "1" ? created.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false }, pane++) : null;
        const rsi =
          rsiFlag === "1"
            ? created.addSeries(
                LineSeries,
                { lineWidth: 1, priceLineVisible: false, lastValueVisible: true, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) },
                pane++,
              )
            : null;
        const panes = created.panes();
        if (volume) panes[1]?.setHeight(64);
        if (rsi) panes[volume ? 2 : 1]?.setHeight(92);
        const rsiLines = rsi ? [70, 30].map((price) => rsi.createPriceLine({ price, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false })) : [];
        next = { lib, chart: created, mode: "price", candles, line: null, ma, bands, volume, rsi, rsiLines, overlays: [], markers: createSeriesMarkers(candles, []) };
      }
      setHandles(next);
    });
    return () => {
      disposed = true;
      setHandles(null);
      if (chart) {
        removedCharts.add(chart);
        chart.remove();
      }
    };
  }, [structure]);

  // --- Colors, scale mode and formatting ----------------------------------------------------------------------------
  const scaleMode = compareMode ? "percent" : settings.log ? "log" : "normal";

  useEffect(() => {
    if (!isLive(handles)) return;
    const { lib, chart } = handles;
    const c = readColors();
    const formatPriceFn = (price: number) => formatPrice(price, lang);
    const priceFormat = {
      type: "custom" as const,
      minMove: precision === 4 ? 0.0001 : 0.01,
      formatter: formatPriceFn,
      tickmarksFormatter: (prices: number[]) => {
        const digits = Math.min(tickDecimals(prices), precision);
        return prices.map((p) => p.toLocaleString(LOCALES[lang], { minimumFractionDigits: digits, maximumFractionDigits: digits }));
      },
    };
    const percentText = (value: number, digits = 2) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}%`;
    const timeText = (time: Time) => {
      const ms = (time as number) * 1000;
      return intraday ? `${formatShortDate(ms, lang, "UTC")} ${formatTime(ms, lang, "UTC")}` : formatDate(ms, lang, "UTC");
    };
    chart.applyOptions({
      layout: { textColor: c.fg3, fontFamily: c.font, panes: { separatorColor: c.line, separatorHoverColor: c.line2 } },
      grid: { vertLines: { visible: false }, horzLines: { color: c.line2, style: lib.LineStyle.Dotted } },
      rightPriceScale: {
        borderColor: c.line,
        mode: scaleMode === "percent" ? lib.PriceScaleMode.Percentage : scaleMode === "log" ? lib.PriceScaleMode.Logarithmic : lib.PriceScaleMode.Normal,
      },
      timeScale: {
        borderColor: c.line,
        timeVisible: intraday,
        secondsVisible: false,
        tickMarkFormatter: (time: Time, type: number) => {
          const ms = (time as number) * 1000;
          const date = new Date(ms);
          if (type === lib.TickMarkType.Year) return String(date.getUTCFullYear());
          if (type === lib.TickMarkType.Month) return new Intl.DateTimeFormat(LOCALES[lang], { month: "short", timeZone: "UTC" }).format(date);
          if (type === lib.TickMarkType.DayOfMonth) return formatShortDate(ms, lang, "UTC");
          return formatTime(ms, lang, "UTC");
        },
      },
      crosshair: {
        vertLine: { color: c.fg3, labelBackgroundColor: c.accent },
        horzLine: { color: c.fg3, labelBackgroundColor: c.accent },
      },
      localization: {
        locale: LOCALES[lang],
        timeFormatter: timeText,
        percentageFormatter: (value: number) => percentText(value),
        tickmarksPercentageFormatter: (values: number[]) => {
          const digits = Math.min(tickDecimals(values), 2);
          return values.map((v) => percentText(v, digits));
        },
      },
    });
    handles.candles?.applyOptions({ upColor: c.up, downColor: c.down, wickUpColor: c.up, wickDownColor: c.down, priceFormat });
    // In percentage mode the quote's own line carries the 0% baseline; the comparisons draw none.
    handles.line?.applyOptions({ color: c.fg, priceFormat, baseLineColor: c.line2, baseLineStyle: lib.LineStyle.Dashed });
    handles.overlays.forEach((series, i) =>
      series.applyOptions({ color: c.series[slots[i].token - 1], lineStyle: slots[i].dashed ? lib.LineStyle.Dashed : lib.LineStyle.Solid, priceFormat, baseLineVisible: false }),
    );
    handles.ma.forEach((series, i) => series.applyOptions({ color: c.series[i], priceFormat }));
    handles.bands.forEach((series) => series.applyOptions({ color: c.series[5], priceFormat }));
    handles.volume?.applyOptions({ color: withAlpha(c.fg3, 0.35) });
    handles.rsi?.applyOptions({ color: c.fg2, priceFormat: { type: "custom", minMove: 1, formatter: (v: number) => v.toFixed(0) } });
    for (const line of handles.rsiLines) line.applyOptions({ color: c.line2 });
  }, [handles, themeKey, slots, theme, updown, lang, intraday, scaleMode, precision]);

  // --- Data into the chart --------------------------------------------------------------------------------------------
  const viewKey = `${symbol}|${range}|${structure}|${settings.extended}|${compare.join(",")}`;
  const appliedView = useRef<string | null>(null);
  /** Price lines drawn on the current candle series (recreated with every data or level change). */
  const priceLines = useRef<{ series: ISeriesApi<"Candlestick">; lines: IPriceLine[] } | null>(null);

  useEffect(() => {
    if (!isLive(handles)) return;
    const { lib, chart } = handles;
    const c = readColors();
    const ts = times as UTCTimestamp[];

    if (handles.mode === "price" && handles.candles) {
      // Pre- and post-market candles are drawn at reduced strength, so the regular session stands out.
      const dim = (bar: Bar) => withAlpha(bar.c >= bar.o ? c.up : c.down, 0.4);
      handles.candles.setData(
        bars.map((bar, i) => {
          const candle = { time: ts[i], open: bar.o, high: bar.h, low: bar.l, close: bar.c };
          if (!bar.session || bar.session === "regular") return candle;
          const color = dim(bar);
          return { ...candle, color, wickColor: color, borderColor: color };
        }),
      );
      const closes = bars.map((bar) => bar.c);
      const studies = [settings.ma20, settings.ma50, settings.ma200];
      [20, 50, 200].forEach((period, i) => {
        handles.ma[i].setData(studies[i] ? linePoints(times, smaSeries(closes, period)) : []);
        handles.ma[i].applyOptions({ visible: studies[i] });
      });
      const bands = settings.bollinger ? bollingerSeries(closes, 20, 2) : null;
      handles.bands[0].setData(bands ? linePoints(times, bands.upper) : []);
      handles.bands[1].setData(bands ? linePoints(times, bands.lower) : []);
      handles.volume?.setData(bars.map((bar, i) => ({ time: ts[i], value: bar.v ?? 0 })));
      handles.rsi?.setData(linePoints(times, wilderRsiSeries(closes, 14)));

      handles.markers?.setMarkers(
        events.filter((mark) => markerKinds.has(mark.kind)).map((mark): SeriesMarker<Time> => ({
          time: mark.time as UTCTimestamp,
          position: mark.kind === "earnings" ? "aboveBar" : "belowBar",
          shape: "circle",
          size: 0.5,
          color: mark.kind === "earnings" ? c.fg2 : c.fg3,
          text: mark.kind === "dividend" ? "D" : mark.kind === "split" ? "S" : "E",
        })),
      );

      // Price lines: the last price colored by the change against the previous close, then the investor's levels.
      if (priceLines.current?.series === handles.candles) for (const line of priceLines.current.lines) handles.candles.removePriceLine(line);
      const lines: IPriceLine[] = [];
      const last = bars.at(-1);
      if (last) {
        const up = previousClose === null || last.c >= previousClose;
        lines.push(handles.candles.createPriceLine({ price: last.c, color: up ? c.up : c.down, lineWidth: 1, lineStyle: lib.LineStyle.Dotted, axisLabelVisible: true, title: "" }));
      }
      if (sessionClose !== null) {
        lines.push(
          handles.candles.createPriceLine({
            price: sessionClose,
            color: c.fg3,
            lineWidth: 1,
            lineStyle: lib.LineStyle.Dashed,
            axisLabelVisible: true,
            axisLabelColor: c.line2,
            axisLabelTextColor: c.fg2,
            title: t.chart.priceLine.prevClose,
          }),
        );
      }
      const levels: Array<[number | null | undefined, string, string, number]> = [
        [position?.cost, t.chart.priceLine.cost, c.fg2, lib.LineStyle.Dashed],
        [note?.target, t.chart.priceLine.target, c.info, lib.LineStyle.Dotted],
        [note?.stop, t.chart.priceLine.stop, c.fg2, lib.LineStyle.Dotted],
      ];
      for (const [price, title, color, lineStyle] of levels) {
        if (typeof price === "number" && price > 0) {
          lines.push(handles.candles.createPriceLine({ price, color, lineWidth: 1, lineStyle, axisLabelVisible: true, title, axisLabelColor: color }));
        }
      }
      priceLines.current = { series: handles.candles, lines };

      // Keep the investor's levels (and the previous close on 1D) on screen when they sit near the visible prices.
      const levelPrices = [...levels.map(([price]) => price), sessionClose].filter((p): p is number => typeof p === "number" && p > 0);
      handles.candles.applyOptions({
        autoscaleInfoProvider: (original: () => AutoscaleInfo | null): AutoscaleInfo | null => {
          const base = original();
          if (!base?.priceRange || levelPrices.length === 0) return base;
          let { minValue, maxValue } = base.priceRange;
          const span = maxValue - minValue;
          for (const p of levelPrices) {
            if (p >= minValue - span * 0.25 && p <= maxValue + span * 0.25) {
              minValue = Math.min(minValue, p);
              maxValue = Math.max(maxValue, p);
            }
          }
          return { ...base, priceRange: { minValue, maxValue } };
        },
      });
    } else if (handles.mode === "compare" && handles.line && compareLines) {
      const toSeries = (points: Point[]) => points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }));
      handles.line.setData(toSeries(compareLines[0]?.points ?? []));
      handles.overlays.forEach((series, slot) => series.setData(toSeries(compareLines[slot + 1]?.points ?? [])));
    }

    // The visible window: once per view (symbol, range, layout), not on every refresh, so panning and zoom survive.
    const lastTime = times.at(-1);
    if (lastTime === undefined) return;
    if (appliedView.current !== viewKey) {
      appliedView.current = viewKey;
      const start = windowStart(range, lastTime * 1000);
      requestAnimationFrame(() => {
        if (removedCharts.has(chart)) return;
        try {
          if (start !== null) chart.timeScale().setVisibleRange({ from: (start / 1000) as UTCTimestamp, to: lastTime as UTCTimestamp });
          else chart.timeScale().fitContent();
        } catch {
          // A range outside the data: keep the chart's own view.
        }
      });
    } else if (intraday) {
      // Intraday bars arrive every minute; keep the whole session in view.
      chart.timeScale().fitContent();
    }
  }, [handles, bars, times, compareLines, events, markerKinds, settings.ma20, settings.ma50, settings.ma200, settings.bollinger, previousClose, sessionClose, position, note, range, viewKey, intraday, t, themeKey]);

  // --- Crosshair and visible range for the legend -------------------------------------------------------------------
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [visible, setVisible] = useState<{ from: number; to: number } | null>(null);

  useEffect(() => {
    if (!isLive(handles)) return;
    const onMove = (param: MouseEventParams<Time>) => setHoverTime(typeof param.time === "number" ? param.time : null);
    const onRange = (next: IRange<Time> | null) => setVisible(next ? { from: next.from as number, to: next.to as number } : null);
    handles.chart.subscribeCrosshairMove(onMove);
    handles.chart.timeScale().subscribeVisibleTimeRangeChange(onRange);
    return () => {
      if (removedCharts.has(handles.chart)) return;
      handles.chart.unsubscribeCrosshairMove(onMove);
      handles.chart.timeScale().unsubscribeVisibleTimeRangeChange(onRange);
    };
  }, [handles]);

  // --- Keys ---------------------------------------------------------------------------------------------------------
  useHotkeys([
    { key: "[", description: t.chart.keys, handler: () => updateChartSettings({ range: stepRange(range, -1) }) },
    { key: "]", description: t.chart.keys, handler: () => updateChartSettings({ range: stepRange(range, 1) }) },
    { key: "l", description: t.chart.study.log, when: () => !compareMode && !inGSequence(), handler: () => updateChartSettings({ log: !settings.log }) },
  ]);

  // --- Legend and summary -------------------------------------------------------------------------------------------
  const hoverIndex = hoverTime !== null ? timeIndex.get(hoverTime) : undefined;
  const shownIndex = hoverIndex ?? bars.length - 1;
  const shown: Bar | null = bars[shownIndex] ?? null;
  const reference = baselines ? (baselines[shownIndex] ?? null) : shownIndex > 0 ? bars[shownIndex - 1].c : null;
  const shownChange = percentChange(reference, shown?.c);
  const shownTime = times[shownIndex];
  const shownEvents = shownTime !== undefined ? (eventsByTime.get(shownTime) ?? []) : [];

  const windowBars = useMemo(() => {
    if (!visible) return bars;
    return bars.filter((_, i) => times[i] >= visible.from && times[i] <= visible.to);
  }, [bars, times, visible]);
  const low = windowBars.length ? Math.min(...windowBars.map((b) => b.l)) : null;
  const high = windowBars.length ? Math.max(...windowBars.map((b) => b.h)) : null;
  const summary = lastBar
    ? tpl(t.chart.summary, {
        symbol,
        range: t.stock.ranges[range],
        low: formatPrice(low, lang),
        high: formatPrice(high, lang),
        last: formatPrice(lastBar.c, lang),
        date: intraday ? `${formatShortDate(lastBar.t, lang, timezone ?? undefined)} ${formatTime(lastBar.t, lang, timezone ?? undefined)}` : formatDate(lastBar.t, lang, "UTC"),
      })
    : symbol;

  const compareReturns = useMemo(() => {
    if (!compareLines) return [];
    return compareLines.map((line) => {
      const from = visible?.from ?? line.points[0]?.time;
      const to = hoverTime ?? visible?.to ?? line.points.at(-1)?.time;
      const start = from !== undefined ? pointNear(line.points, from, false) : null;
      const end = to !== undefined ? pointNear(line.points, to, true) : null;
      return { ...line, change: start && end && end.time >= start.time ? percentChange(start.value, end.value) : null };
    });
  }, [compareLines, visible, hoverTime]);

  const loading = mainQuery.isLoading && !data;
  const noRegular = Boolean(data && data.bars.length > 0 && bars.length === 0);
  const height = !compareMode && settings.rsi ? "h-[392px] sm:h-[472px]" : "h-[300px] sm:h-[380px]";
  const ohlc = t.chart.ohlc;
  const suggestions = ["SPY", ...(sectorEtf ? [sectorEtf] : [])];

  return (
    <Panel
      id="chart"
      title={t.stock.chart}
      code="GP"
      className={cn("scroll-mt-2", className)}
      actions={<StudiesMenu settings={settings} onChange={updateChartSettings} disabled={compareMode} />}
      footer={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-1.5 text-micro text-fg-3">
          <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" className="hover:text-fg-2 hover:underline">
            {t.chart.attribution}
          </a>
          {!compareMode && markerKinds.size > 0 ? (
            <span>
              {(["dividend", "split", "earnings"] as const)
                .filter((kind) => markerKinds.has(kind))
                .map((kind) => t.chart.markerKey[kind])
                .join(" · ")}
            </span>
          ) : null}
          <span className="hidden sm:inline">{t.chart.keys}</span>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-2 py-1 sm:px-3">
        <RangePicker value={range} onChange={(next) => updateChartSettings({ range: next })} />
        {intradayRange && hasExtended ? (
          <Switch
            label={t.chart.extendedHours}
            checked={settings.extended}
            onCheckedChange={(extended) => updateChartSettings({ extended })}
            className="shrink-0 text-xs max-sm:min-h-10 max-sm:items-center"
          />
        ) : null}
        <div className="min-w-0 lg:ml-auto">
          <CompareBar symbol={symbol} compare={compare} slots={slots} suggestions={suggestions} onChange={onCompareChange} />
        </div>
      </div>

      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line px-3 py-1 text-xs text-fg-3">
        {compareMode ? (
          <>
            {compareReturns.map((line, i) => (
              <span key={line.symbol} className="flex items-center gap-1.5">
                <SeriesKey slot={slots[i - 1]} main={i === 0} />
                <span className="mono font-medium text-fg">{line.symbol}</span>
                {line.missing ? (
                  <span>{tpl(t.chart.noData, { symbol: line.symbol })}</span>
                ) : line.loading ? (
                  <Skeleton className="h-3 w-10" />
                ) : (
                  <Delta value={line.change} />
                )}
              </span>
            ))}
            <span className="ml-auto text-micro">{historyRange ? `${t.chart.compareNote} · ${t.chart.adjusted}` : t.chart.compareNote}</span>
          </>
        ) : shown ? (
          <>
            <span className="num text-fg-2">
              {intraday ? `${formatShortDate(shown.t, lang, timezone ?? undefined)} ${formatTime(shown.t, lang, timezone ?? undefined)}` : formatDate(shown.t, lang, "UTC")}
            </span>
            <span className="mono flex flex-wrap gap-x-3">
              <span>
                {ohlc.open} <span className="num text-fg-2">{formatPrice(shown.o, lang)}</span>
              </span>
              <span>
                {ohlc.high} <span className="num text-fg-2">{formatPrice(shown.h, lang)}</span>
              </span>
              <span>
                {ohlc.low} <span className="num text-fg-2">{formatPrice(shown.l, lang)}</span>
              </span>
              <span>
                {ohlc.close} <span className="num text-fg-2">{formatPrice(shown.c, lang)}</span>
              </span>
            </span>
            <Delta value={shownChange} />
            {shown.v ? (
              <span className="mono hidden sm:inline">
                {ohlc.volume} <span className="num text-fg-2">{formatCompact(shown.v, lang)}</span>
              </span>
            ) : null}
            {shown.session && shown.session !== "regular" ? <span className="text-warn">{t.chart.session[shown.session]}</span> : null}
            {shownEvents.map((mark) => (
              <span key={`${mark.kind}-${mark.time}`} className="text-fg-2">
                {eventLabel(t, mark.kind, mark.label)}
              </span>
            ))}
            <span className="ml-auto flex flex-wrap items-center gap-x-3">
              {settings.ma20 ? <StudyKey slot={0} label={t.chart.study.ma20} /> : null}
              {settings.ma50 ? <StudyKey slot={1} label={t.chart.study.ma50} /> : null}
              {settings.ma200 ? <StudyKey slot={2} label={t.chart.study.ma200} /> : null}
              {settings.bollinger ? <StudyKey slot={5} label={t.chart.legendBollinger} /> : null}
            </span>
          </>
        ) : null}
      </div>

      <div className={cn("relative", height)}>
        <div ref={containerRef} aria-hidden="true" className="absolute inset-0" />
        <p className="sr-only">{summary}</p>
        {loading ? <Skeleton className="absolute inset-3" /> : null}
        {mainQuery.error && !data ? (
          <div className="absolute inset-0 flex items-center justify-center bg-panel">
            <ErrorState error={mainQuery.error} onRetry={() => mainQuery.mutate()} />
          </div>
        ) : null}
        {data && bars.length === 0 ? (
          <div className="absolute inset-0 flex items-center bg-panel px-4 text-sm text-fg-2">{noRegular ? t.chart.emptyRegular : t.chart.empty}</div>
        ) : null}
      </div>
    </Panel>
  );
}

/** Legend key for a study line: series 1 to 3 for the moving averages (series 2 dashed), series 6 dotted for the bands. */
function StudyKey({ slot, label }: { slot: number; label: string }) {
  const swatch =
    slot === 1 ? (
      <span aria-hidden className="inline-block w-3 border-t-2 border-dashed border-series-2" />
    ) : slot === 5 ? (
      <span aria-hidden className="inline-block w-3 border-t-2 border-dotted border-series-6" />
    ) : (
      <span aria-hidden className={cn("inline-block h-0.5 w-3", slot === 0 ? "bg-series-1" : "bg-series-3")} />
    );
  return (
    <span className="flex items-center gap-1">
      {swatch}
      <span className="mono">{label}</span>
    </span>
  );
}
