"use client";

import { usePrefs } from "@/components/providers/PrefsProvider";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Panel } from "@/components/ui/Panel";
import { StatTile } from "@/components/ui/StatTile";
import { cn } from "@/lib/cn";
import type { QuintileRow } from "@/lib/evaluation";
import { DASH, formatInteger, tpl } from "@/lib/format";

import { RISK_CALIBRATION } from "./data";
import { formatCorrelation, formatT, formatWeight, joinValues, pct, yearSpan } from "./stats-format";
import { keepSymbols } from "./text";

// Risk calibration (#risk): how often the forecast ranges held, how persistent volatility and beta are, and how bad a
// normal month was by volatility quintile, overall and by subperiod. This panel sits in the narrow right column (about
// 360px at a 1280px window), so label columns get the room they need and wrap; number columns are as narrow as their
// heads allow.

interface CoverageRow {
  key: string;
  label: string;
  n: number | null;
  within1: number | null;
  within2: number | null;
}

/** Share of a normal distribution within plus/minus 1 and 2 standard deviations, the reference row. */
const NORMAL = { within1: 0.6827, within2: 0.9545 };

type SubperiodRow = (typeof RISK_CALIBRATION.quintiles.subperiods)[number];

function DrawdownBar({ value, max }: { value: number | null; max: number }) {
  return (
    <span aria-hidden className="relative inline-block h-1.5 w-8 bg-line-2 align-middle">
      <span className="absolute inset-y-0 left-0 bg-fg-3" style={{ width: `${(Math.max(value ?? 0, 0) / max) * 100}%` }} />
    </span>
  );
}

export function RiskCalibrationPanel() {
  const { t, lang } = usePrefs();
  const l = t.lab.risk;
  const c = RISK_CALIBRATION;
  const threshold = pct(Math.abs(c.quintiles.threshold), 0);
  const persistence = c.persistence;
  const quintileName = (q: number) => (q === 1 ? l.calmest : q === c.quintiles.overall.length ? l.wildest : tpl(l.q, { q }));
  const estimator = c.estimator;
  const maxDrawdown = Math.max(...c.quintiles.overall.map((row) => row.drawdown ?? 0), 0.0001);

  const coverage: CoverageRow[] = [
    { key: "overall", label: yearSpan(c.window.from, c.window.to), ...c.bands.overall },
    ...c.bands.subperiods.map((row) => ({ key: row.from, label: yearSpan(row.from, row.to), n: row.n, within1: row.within1, within2: row.within2 })),
    { key: "short", label: l.shortOnly, ...c.bands.shortWindowOnly },
    { key: "normal", label: l.normal, n: null, ...NORMAL },
  ];
  const coverageColumns: DataTableColumn<CoverageRow>[] = [
    { key: "period", header: l.cols.period, className: "whitespace-normal!", render: (row) => <div className="py-1">{row.label}</div> },
    { key: "within1", header: keepSymbols(l.cols.within1), align: "right", width: "6rem", render: (row) => <span className="num">{pct(row.within1, 1)}</span> },
    { key: "within2", header: keepSymbols(l.cols.within2), align: "right", width: "6rem", render: (row) => <span className="num">{pct(row.within2, 1)}</span> },
  ];

  const quintileColumns: DataTableColumn<QuintileRow>[] = [
    // Wraps only between words (break-keep keeps "波动最大" whole); a tighter right padding lets the longest word fit
    // the narrowest column, about 74px at a 1280px window.
    {
      key: "q",
      header: l.quintileCols.q,
      className: "whitespace-normal! pr-2!",
      render: (row) => <div className="py-1 break-keep">{quintileName(row.quintile)}</div>,
    },
    { key: "median", header: l.quintileCols.median, align: "right", width: "6rem", render: (row) => <span className="num">{pct(row.medianVolatility, 0)}</span> },
    {
      key: "drawdown",
      header: tpl(l.quintileCols.drawdown, { threshold }),
      align: "right",
      width: "6.5rem",
      render: (row) => (
        <span className="inline-flex items-center justify-end gap-2">
          <DrawdownBar value={row.drawdown} max={maxDrawdown} />
          <span className="num text-fg">{pct(row.drawdown, 1)}</span>
        </span>
      ),
    },
    { key: "loss", header: tpl(l.quintileCols.loss, { threshold }), align: "right", width: "5.5rem", render: (row) => <span className="num">{pct(row.loss, 1)}</span> },
  ];

  // The period column is sized for "2016-2020"; the quintile columns share the rest.
  const subperiodColumns: DataTableColumn<SubperiodRow>[] = [
    { key: "period", header: l.cols.period, width: "5.75rem", render: (row) => <span className="num">{yearSpan(row.from, row.to)}</span> },
    ...c.quintiles.overall.map(
      (q): DataTableColumn<SubperiodRow> => ({
        key: `q${q.quintile}`,
        header: tpl(l.q, { q: q.quintile }),
        align: "right",
        render: (row) => <span className="num">{pct(row.rows.find((r) => r.quintile === q.quintile)?.drawdown, 0)}</span>,
      }),
    ),
  ];

  const latest = c.quintiles.breakpoints.latest;
  return (
    <Panel title={l.title} id="risk">
      <p className="max-w-prose px-3 pt-3 text-xs leading-5 text-fg-2">
        {tpl(l.lead, {
          days: c.bands.horizon,
          wShort: formatWeight(estimator.shortWeight),
          wLong: formatWeight(1 - estimator.shortWeight),
          short: estimator.shortWindow,
          long: estimator.longWindow,
        })}
      </p>

      <h3 className="col-head px-3 pt-3 pb-1">{tpl(l.bands, { days: c.bands.horizon })}</h3>
      <DataTable
        rows={coverage}
        columns={coverageColumns}
        rowKey={(row) => row.key}
        caption={tpl(l.bands, { days: c.bands.horizon })}
        rowClassName={(row) => cn(row.key === "overall" ? "text-fg" : row.key === "normal" ? "text-fg-3" : "text-fg-2")}
      />
      <p className="px-3 py-2 text-xs text-fg-3">
        {tpl(l.qlike, { blend: c.qlike.blend?.toFixed(3) ?? DASH, short: c.qlike.shortWindowOnly?.toFixed(3) ?? DASH, n: formatInteger(c.qlike.n, lang) })}
      </p>

      <h3 className="col-head border-t border-line px-3 pt-3 pb-1.5">{tpl(l.persistence, { days: persistence.horizon, dates: persistence.dates })}</h3>
      <div className="grid grid-cols-2 gap-px border-y border-line bg-line">
        <StatTile
          label={l.persistenceVol}
          value={formatCorrelation(persistence.volatility.mean)}
          sub={tpl(l.persistenceSub, { min: formatCorrelation(persistence.volatility.min), t: formatT(persistence.volatility.t, 1) })}
        />
        <StatTile
          label={l.persistenceBeta}
          value={formatCorrelation(persistence.beta.mean)}
          sub={tpl(l.persistenceSub, { min: formatCorrelation(persistence.beta.min), t: formatT(persistence.beta.t, 1) })}
        />
      </div>

      <h3 className="col-head px-3 pt-3 pb-1">{l.quintiles}</h3>
      <DataTable rows={c.quintiles.overall} columns={quintileColumns} rowKey={(row) => String(row.quintile)} caption={l.quintiles} rowClassName={() => "text-fg-2"} />

      <h3 className="col-head border-t border-line px-3 pt-3 pb-1">{tpl(l.bySubperiod, { threshold })}</h3>
      <DataTable
        rows={c.quintiles.subperiods}
        columns={subperiodColumns}
        rowKey={(row) => row.from}
        caption={tpl(l.bySubperiod, { threshold })}
        rowClassName={() => "text-fg-2"}
      />

      <div className="space-y-1 border-t border-line px-3 py-2 text-xs text-fg-3">
        <p className="num">
          {tpl(l.breakpoints, {
            median: joinValues(
              c.quintiles.breakpoints.median.map((v) => pct(v, 0)),
              lang,
            ),
            date: latest?.date ?? DASH,
            latest: latest
              ? joinValues(
                  latest.values.map((v) => pct(v, 0)),
                  lang,
                )
              : DASH,
          })}
        </p>
        <p>{tpl(l.quintileLegend, { threshold })}</p>
        <p>{tpl(l.measure, { days: c.quintiles.horizon })}</p>
      </div>
    </Panel>
  );
}
