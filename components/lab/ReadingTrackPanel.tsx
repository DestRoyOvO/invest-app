"use client";

import { useState } from "react";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { Badge } from "@/components/ui/Badge";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Panel } from "@/components/ui/Panel";
import { Whisker } from "@/components/ui/Whisker";
import { cn } from "@/lib/cn";
import { evaluationVerdict, type HoldoutTest, type HorizonOutcome, type Interval, type LabelOutcome } from "@/lib/evaluation";
import { DASH, formatInteger, tpl } from "@/lib/format";

import { EVALUATION_DAYS, SIGNAL_EVALUATION } from "./data";
import { COMMON_READING_DATE_SHARE, EPISODE_SHARE_LIMIT, isConcentrated, selectionTone, symmetricDomain } from "./evidence";
import { HorizonPicker } from "./FactorTestsPanel";
import { ScrollRegion } from "./ScrollRegion";
import { formatIc, formatP, formatT, joinList, pct, yearSpan } from "./stats-format";
import { keepSymbols } from "./text";

// The corrected track record of the technical reading: rank IC by horizon with its robustness checks, subperiods, the
// outcome after each reading split into timing and selection, and the holdout decade.

export function ReadingTrackPanel() {
  const { t, lang } = usePrefs();
  const l = t.lab.track;
  const intervalText = (interval: Interval | null, digits: number, sign = true) =>
    interval ? tpl(l.interval, { lo: pct(interval[0], digits, sign), hi: pct(interval[1], digits, sign) }) : DASH;
  const evaluation = SIGNAL_EVALUATION;
  const [horizonKey, setHorizonKey] = useState(String(EVALUATION_DAYS));
  const horizon = evaluation.horizons.find((h) => h.days === Number(horizonKey)) ?? evaluation.horizons[0];
  const holdout = evaluation.holdout;

  const summaryColumns: DataTableColumn<HorizonOutcome>[] = [
    { key: "horizon", header: l.cols.horizon, width: "7rem", render: (h) => tpl(l.sessions, { days: h.days }) },
    { key: "ic", header: l.cols.ic, align: "right", width: "5.5rem", render: (h) => <span className="num text-fg">{formatIc(h.ic.mean)}</span> },
    { key: "nw", header: keepSymbols(l.cols.nw), align: "right", width: "5rem", render: (h) => <span className="num">{formatT(h.ic.t)}</span> },
    { key: "nw2", header: keepSymbols(l.cols.nw2), align: "right", width: "6.5rem", render: (h) => <span className="num text-fg-3">{formatT(h.ic.t2)}</span> },
    {
      key: "phases",
      header: keepSymbols(l.cols.phases),
      align: "right",
      width: "8.5rem",
      render: (h) => <span className="num text-fg-3">{h.ic.phaseT ? tpl(l.phaseRange, { lo: formatT(h.ic.phaseT[0]), hi: formatT(h.ic.phaseT[1]) }) : DASH}</span>,
    },
    {
      key: "verdict",
      header: l.cols.verdict,
      width: "12.5rem",
      render: (h) => (
        <span className="inline-flex items-center gap-1.5">
          <span>{l.verdict[evaluationVerdict(h)]}</span>
          {h.ic.fragile ? <Badge tone="warn">{l.fragile}</Badge> : null}
        </span>
      ),
    },
  ];

  const subperiods = evaluation.horizons[0]?.subperiods ?? [];
  const subperiodColumns: DataTableColumn<HorizonOutcome>[] = [
    { key: "horizon", header: l.cols.horizon, width: "7rem", render: (h) => tpl(l.sessions, { days: h.days }) },
    ...subperiods.map(
      (period, i): DataTableColumn<HorizonOutcome> => ({
        key: `s${i}`,
        header: yearSpan(period.from, period.to),
        align: "right",
        width: "9rem",
        render: (h) => {
          const row = h.subperiods[i];
          return <span className="num">{row ? tpl(l.subperiodCell, { ic: formatIc(row.mean), t: formatT(row.t) }) : DASH}</span>;
        },
      }),
    ),
  ];

  const totalDates = horizon.ic.dates;
  const domain = symmetricDomain(horizon.labels.map((label) => label.ci.selection));
  const labelColumns: DataTableColumn<LabelOutcome>[] = [
    { key: "reading", header: l.labelCols.reading, width: "6rem", render: (row) => <span className="text-fg">{t.signal.codes[row.code]}</span> },
    { key: "n", header: l.labelCols.n, align: "right", width: "4.75rem", render: (row) => <span className="num">{formatInteger(row.n, lang)}</span> },
    {
      key: "episodes",
      header: l.labelCols.episodes,
      align: "right",
      // Fits "41（13%）" with the Chinese full-width parentheses.
      width: "6rem",
      render: (row) => <span className="num">{tpl(t.signal.track.episodeCell, { n: formatInteger(row.episodes, lang), share: pct(row.largestEpisodeShare, 0) })}</span>,
    },
    {
      key: "selection",
      header: l.labelCols.selection,
      align: "right",
      width: "10.5rem",
      render: (row) => {
        const tone = selectionTone(row, totalDates);
        const interval = row.ci.selection;
        const concentrated = isConcentrated(row, totalDates);
        // A concentrated row is grey throughout: its value inherits the row's --fg-3 like every other cell, and its
        // whisker is grey too (no accent dot even when the interval excludes zero).
        const ink = tone === "up" ? "text-up" : tone === "down" ? "text-down" : concentrated ? undefined : "text-fg";
        return (
          <div className="py-1">
            <div className="flex items-center justify-end gap-2">
              <span className={cn("num", ink)}>{pct(row.selection, 2, true)}</span>
              <Whisker
                estimate={row.selection}
                low={interval?.[0]}
                high={interval?.[1]}
                base={0}
                min={domain[0]}
                max={domain[1]}
                neutral={concentrated}
                label={tpl(t.signal.track.whisker, {
                  reading: t.signal.codes[row.code],
                  value: pct(row.selection, 2, true),
                  lo: pct(interval?.[0], 2, true),
                  hi: pct(interval?.[1], 2, true),
                })}
              />
            </div>
            <div className="num text-micro text-fg-3">{intervalText(interval, 2)}</div>
          </div>
        );
      },
    },
    { key: "timing", header: l.labelCols.timing, align: "right", width: "5rem", render: (row) => <span className="num">{pct(row.timing, 2, true)}</span> },
    {
      key: "raw",
      header: l.labelCols.raw,
      align: "right",
      width: "7.75rem",
      render: (row) => (
        <div className="py-1">
          <div className="num">{pct(row.excess, 2, true)}</div>
          <div className="num text-micro text-fg-3">{intervalText(row.ci.excess, 2)}</div>
        </div>
      ),
    },
    {
      key: "up",
      header: l.labelCols.up,
      align: "right",
      width: "5.5rem",
      render: (row) => (
        <div className="py-1">
          <div className="num">{pct(row.hitRate, 0)}</div>
          <div className="num text-micro text-fg-3">{intervalText(row.ci.hitRate, 0, false)}</div>
        </div>
      ),
    },
    { key: "beat", header: l.labelCols.beat, align: "right", width: "5.75rem", render: (row) => <span className="num">{pct(row.beatMedian, 0)}</span> },
  ];

  const holdoutRows: HoldoutTest[] = [holdout.composite, ...holdout.factors];
  const holdoutColumns: DataTableColumn<HoldoutTest>[] = [
    { key: "signal", header: l.holdoutCols.signal, width: "12rem", render: (row) => <span className={row.key === "composite" ? "text-fg" : undefined}>{l.holdoutNames[row.key]}</span> },
    { key: "ic", header: l.holdoutCols.ic, align: "right", width: "5.5rem", render: (row) => <span className="num">{formatIc(row.mean)}</span> },
    { key: "t", header: keepSymbols(l.holdoutCols.t), align: "right", width: "5rem", render: (row) => <span className="num">{formatT(row.t)}</span> },
    { key: "p", header: keepSymbols(l.holdoutCols.p), align: "right", width: "6.5rem", render: (row) => <span className="num">{formatP(row.p)}</span> },
    { key: "holm", header: keepSymbols(l.holdoutCols.holm), align: "right", width: "5.5rem", render: (row) => <span className="num text-fg-3">{formatP(row.holmP)}</span> },
    { key: "pass", header: l.holdoutCols.pass, align: "right", width: "5rem", render: (row) => (row.pass ? l.yes : l.no) },
  ];
  const holdoutHorizons = joinList(
    holdout.horizons.map((h) => tpl(l.horizonIc, { days: h.days, ic: formatIc(h.mean), t: formatT(h.t) })),
    lang,
  );

  return (
    <Panel title={l.title} id="track">
      <p className="max-w-prose px-3 pt-3 pb-2 text-xs leading-5 text-fg-2">
        {tpl(l.lead, {
          n: evaluation.universe,
          from: evaluation.from,
          to: evaluation.to,
          horizons: joinList(
            evaluation.horizons.map((h) => String(h.days)),
            lang,
          ),
        })}
      </p>
      <ScrollRegion label={l.summaryCaption}>
        <DataTable
          rows={evaluation.horizons}
          columns={summaryColumns}
          rowKey={(h) => String(h.days)}
          caption={l.summaryCaption}
          minWidth="46rem"
          rowClassName={() => "text-fg-2"}
          className="overflow-x-visible!"
        />
      </ScrollRegion>

      <h3 className="col-head border-t border-line px-3 pt-3 pb-1">{keepSymbols(l.subperiods)}</h3>
      <ScrollRegion label={l.subperiods}>
        <DataTable
          rows={evaluation.horizons}
          columns={subperiodColumns}
          rowKey={(h) => String(h.days)}
          caption={l.subperiods}
          minWidth="40rem"
          rowClassName={() => "text-fg-2"}
          className="overflow-x-visible!"
        />
      </ScrollRegion>

      <h3 className="col-head border-t border-line px-3 pt-3">{l.readings}</h3>
      <HorizonPicker
        label={l.cols.horizon}
        name={l.horizonName}
        value={horizonKey}
        onChange={setHorizonKey}
        options={evaluation.horizons.map((h) => ({ value: String(h.days), label: tpl(t.signal.backtest.hold, { n: h.days }) }))}
      />
      <ScrollRegion label={tpl(l.labelsCaption, { days: horizon.days })}>
        <DataTable
          rows={horizon.labels}
          columns={labelColumns}
          rowKey={(row) => row.code}
          caption={tpl(l.labelsCaption, { days: horizon.days })}
          minWidth="51rem"
          rowClassName={(row) => (isConcentrated(row, totalDates) ? "text-fg-3" : "text-fg-2")}
          className="overflow-x-visible!"
        />
      </ScrollRegion>
      <div className="space-y-1 px-3 py-2 text-xs text-fg-3">
        <p>{tpl(l.labelsLegend, { base: pct(horizon.base.mean, 2, true), hit: pct(horizon.base.hitRate, 0) })}</p>
        <p>{tpl(t.signal.track.colors, { limit: pct(EPISODE_SHARE_LIMIT, 0), share: pct(COMMON_READING_DATE_SHARE, 0) })}</p>
      </div>

      <h3 className="col-head border-t border-line px-3 pt-3 pb-1">{tpl(l.holdout, { from: holdout.from, to: holdout.to })}</h3>
      <ScrollRegion label={tpl(l.holdoutCaption, { days: holdout.horizon })}>
        <DataTable
          rows={holdoutRows}
          columns={holdoutColumns}
          rowKey={(row) => row.key}
          caption={tpl(l.holdoutCaption, { days: holdout.horizon })}
          minWidth="34rem"
          rowClassName={() => "text-fg-2"}
          className="overflow-x-visible!"
        />
      </ScrollRegion>
      <p className="border-t border-line px-3 py-2 text-xs text-fg-3">{tpl(l.holdoutNote, { horizons: holdoutHorizons })}</p>
    </Panel>
  );
}
